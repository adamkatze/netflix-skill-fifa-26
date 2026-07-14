const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// When packaged as an exe (pkg), live files sit next to the binary; in dev
// they're the project directory. Everything on disk (index.html, assets/, db/)
// resolves from here so artwork and pages can change without a rebuild.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;


//Used for determining servers local ip address
const networkInterfaces = os.networkInterfaces();
const addresses = [];

//Serve local files from the folder the server runs from
const staticPath = path.join(BASE_DIR, '/');
app.use(express.static(staticPath));


//Database stuff

// Connect to the SQLite database, creating db/ on first launch so a freshly
// shipped exe self-initializes with clean tables.
const dbDir = path.join(BASE_DIR, 'db');
fs.mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(path.join(dbDir, 'database.db'));

function initDatabaseTable(tableName, tableFields, tableRoute) {

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${tableFields}
      )
    `);
    console.log(`Table "${tableName}" created or already exists`);
  } catch (error) {
    console.error('Error creating table:', error.message);
  }

  //Route to fetch data from the table
  app.get(`/${tableRoute}`, (req, res) => {
        try {
          const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
          res.json(rows);
        } catch (error) {
          console.error('Error reading data:', error.message);
          res.status(500).send('Error reading data');
        }
  });

}

//Initialize the database tables
const analyticsFields = `action TEXT`
const leaderboardFields = `name TEXT, level TEXT, time TEXT, score TEXT, gametype TEXT, timestamp TEXT`

initDatabaseTable('analytics', analyticsFields, 'analytics')
initDatabaseTable('leaderboard', leaderboardFields, 'leaderboard')

// Add any missing columns to an existing table (CREATE TABLE IF NOT EXISTS
// won't alter a table that already exists from a previous run).
function ensureColumns(tableName, columns) {
  let rows;
  try {
    rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  } catch (error) {
    console.error('Error reading table info:', error.message);
    return;
  }
  const existing = rows.map(r => r.name);
  columns.forEach(col => {
    if (!existing.includes(col.name)) {
      try {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Added column "${col.name}" to "${tableName}"`);
      } catch (err) {
        console.error(`Error adding column ${col.name}:`, err.message);
      }
    }
  });
}

// Columns used to log each completed game in the analytics table.
ensureColumns('analytics', [
  { name: 'started_at',     type: 'TEXT' },     // ISO timestamp the round started
  { name: 'lane1_score',    type: 'INTEGER' },
  { name: 'lane2_score',    type: 'INTEGER' },
  { name: 'lane1_active',   type: 'INTEGER' },   // 1 if the lane took part (0 for solo)
  { name: 'lane2_active',   type: 'INTEGER' },
  { name: 'game_length_ms', type: 'INTEGER' }    // actual play time (early ends < full length)
])




// Start the server
const port = 3001;
server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

// Iterate over network interfaces
Object.keys(networkInterfaces).forEach(interfaceName => {
  const interfaces = networkInterfaces[interfaceName];

  // Iterate over addresses of the current network interface
  interfaces.forEach(interfaceInfo => {
    if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
      addresses.push(interfaceInfo.address);
    }
  });
});

//console.log('Local IP addresses:', addresses);
console.log('----------------------')
console.log(`To access from other devices on the same local network, connect to:`);
console.log(`http://${addresses}:${port}`)
console.log('----------------------')








//-----------------------------Lane / Control Panel state-----------------------------

// The two control panel lanes we coordinate. Change here if lane ids ever differ.
const LANES = ['1', '2'];

// How long a round runs, in ms. Both control panels and the game wall count
// down from this once the game starts.
const GAME_LENGTH_MS = 120 * 1000;

// Length of the intro "flyover" animation before the timer actually begins.
// Adjust once we know the real animation length.
const FLYOVER_MS = 11600;   // actual duration of assets/videos/2_flyover.webm

// Length of the 3-2-1 countdown between the flyover and the game timer starting.
const COUNTDOWN_MS = 5 * 1000;

// Grace period after the game timer hits zero before the round auto-ends,
// in case an operator never ends it manually.
const AUTO_END_GRACE_MS = 10 * 1000;

// Current state of each control panel, keyed by lane id.
// e.g. { '1': { socketId, state: 'waiting' }, '2': { socketId, state: 'holding' } }
const laneStates = {};

// Current score for each lane, keyed by lane id. e.g. { '1': 5, '2': 3 }
const laneScores = {};

// Current round phase: 'idle' | 'flyover' | 'active'. Used to let a control
// panel rejoin the right screen if it refreshes mid-game.
let gamePhase = 'idle';      // 'idle' | 'flyover' | 'countdown' | 'active'
let gameLanes = [];          // the lanes actually taking part in the current round
let flyoverEndsAt = 0;       // ms epoch the flyover animation ends
let countdownEndsAt = 0;     // ms epoch the 3-2-1 countdown ends
let gameEndsAt = 0;          // ms epoch the game timer runs out
let flyoverTimer = null;     // setTimeout handle for the flyover -> countdown transition
let countdownTimer = null;   // setTimeout handle for the countdown -> game transition
let gameTimer = null;        // setTimeout handle for the auto-end after the round
let resultsPending = false;  // a round ended and panels are still showing the result
let gameStartedAt = 0;       // ms epoch the round started (flyover begin)
let gamePlayStartedAt = 0;   // ms epoch actual gameplay started (after flyover)

// Push the full lane state map to every connected client so panels can
// reflect whether the other lane has joined yet.
function broadcastLaneStates() {
    io.emit('message', { action: 'laneStates', data: laneStates });
}

// Push the full score map to every client (control panels + game wall).
function broadcastScores() {
    io.emit('message', { action: 'scoreUpdate', data: { scores: laneScores } });
}

// Once every lane is registered and sitting in the 'waiting' screen,
// tell both panels to advance into the game together and start the round.
function checkAllWaiting() {
    const allReady = LANES.every(lane => laneStates[lane] && laneStates[lane].state === 'waiting');

    if (allReady) {
        console.log('All lanes waiting — starting game');
        startGame();
    }
}

// Reset scores and replay from the start of the flyover for the given lanes.
// The `action` is the message clients receive ('startGame' for a fresh round,
// 'restartGame' for a mid-game restart) so they can transition appropriately.
// The broadcast carries the participant lanes so only they react.
function beginFlyover(action, lanes) {
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    gameLanes = lanes.slice();

    gameLanes.forEach(lane => {
        laneStates[lane] = laneStates[lane] || { socketId: null, state: 'game' };
        laneStates[lane].state = 'game';
        laneScores[lane] = 0;
    });

    // Begin with the flyover animation; the game timer starts after it.
    gamePhase = 'flyover';
    resultsPending = false;
    gameStartedAt = Date.now();
    gamePlayStartedAt = 0;
    flyoverEndsAt = Date.now() + FLYOVER_MS;

    io.emit('message', { action, data: { flyover: FLYOVER_MS, duration: GAME_LENGTH_MS, lanes: gameLanes } });
    broadcastLaneStates();
    broadcastScores();

    if (flyoverTimer) clearTimeout(flyoverTimer);
    flyoverTimer = setTimeout(beginCountdown, FLYOVER_MS);
}

// Start a fresh round with both lanes (after both finished waiting).
function startGame() {
    console.log('Starting game');
    beginFlyover('startGame', LANES);
}

// Start a solo round with just the one requesting lane.
function startSolo(lane) {
    console.log(`Starting solo game for lane ${lane}`);
    beginFlyover('startGame', [lane]);
}

// Restart the current round from the flyover, keeping the same participants.
function restartGame() {
    console.log('Restarting game');
    beginFlyover('restartGame', gameLanes);
}

// Send a single socket back into the live game at its current phase.
function sendRejoin(socket) {
    const endsAt = gamePhase === 'flyover' ? flyoverEndsAt
                 : gamePhase === 'countdown' ? countdownEndsAt
                 : gameEndsAt;
    socket.emit('message', {
        action: 'rejoinGame',
        data: { phase: gamePhase, duration: Math.max(0, endsAt - Date.now()), scores: laneScores }
    });
}

// Flyover finished (timed out or skipped) — run the 3-2-1 countdown. The game
// timer does NOT start yet; it waits until the countdown is over.
function beginCountdown() {
    if (flyoverTimer) { clearTimeout(flyoverTimer); flyoverTimer = null; }
    if (gamePhase !== 'flyover') return;

    gamePhase = 'countdown';
    countdownEndsAt = Date.now() + COUNTDOWN_MS;

    console.log('Flyover complete — starting countdown');
    io.emit('message', { action: 'countdown', data: { duration: COUNTDOWN_MS } });

    if (countdownTimer) clearTimeout(countdownTimer);
    countdownTimer = setTimeout(startPlay, COUNTDOWN_MS);
}

// Countdown finished — now start the actual game timer.
function startPlay() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    if (gamePhase !== 'countdown') return;

    gamePhase = 'active';
    gameEndsAt = Date.now() + GAME_LENGTH_MS;
    gamePlayStartedAt = Date.now();

    console.log('Countdown complete — game timer started');
    io.emit('message', { action: 'beginGame', data: { duration: GAME_LENGTH_MS } });

    // Auto-end the round a grace period after the timer runs out, unless an
    // operator ends or restarts it first.
    if (gameTimer) clearTimeout(gameTimer);
    gameTimer = setTimeout(() => {
        console.log('Game auto-ended (no manual end within grace period)');
        endGame();
    }, GAME_LENGTH_MS + AUTO_END_GRACE_MS);
}

// End the round for the participating lanes and notify all clients.
function endGame() {
    gamePhase = 'idle';
    resultsPending = true;
    if (flyoverTimer) { clearTimeout(flyoverTimer); flyoverTimer = null; }
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }

    logGame();   // record the completed game before we clear the participants

    gameLanes.forEach(lane => { if (laneStates[lane]) laneStates[lane].state = 'ended'; });
    gameLanes = [];

    io.emit('message', { action: 'endGame', data: {} });
    broadcastLaneStates();
}

// Write a completed game to the analytics table. Games abandoned via Restart
// or Reset never reach endGame(), so they're naturally excluded.
function logGame() {
    if (!gameLanes.length) return;   // nothing was actually running

    // Actual play time, capped at the full round length (auto-end adds a grace
    // period after the timer; 0 if the game ended before the flyover finished).
    const playLength = gamePlayStartedAt
        ? Math.min(GAME_LENGTH_MS, Date.now() - gamePlayStartedAt)
        : 0;

    const row = {
        action: 'game',
        started_at: new Date(gameStartedAt).toISOString(),
        lane1_score: laneScores['1'] || 0,
        lane2_score: laneScores['2'] || 0,
        lane1_active: gameLanes.includes('1') ? 1 : 0,
        lane2_active: gameLanes.includes('2') ? 1 : 0,
        game_length_ms: playLength
    };

    try {
        db.prepare(
            `INSERT INTO analytics
               (action, started_at, lane1_score, lane2_score, lane1_active, lane2_active, game_length_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(row.action, row.started_at, row.lane1_score, row.lane2_score, row.lane1_active, row.lane2_active, row.game_length_ms);
        console.log('Logged game to analytics:', row);
    } catch (err) {
        console.error('Error logging game:', err.message);
    }
}

// Once every panel has left the result screen (back to holding / disconnected),
// reset the game wall to idle and clear the scores.
function checkResetToIdle() {
    if (!resultsPending || gamePhase !== 'idle') return;

    const anyShowingResult = Object.values(laneStates).some(l => l.state === 'ended');
    if (anyShowingResult) return;

    resultsPending = false;
    Object.keys(laneScores).forEach(lane => delete laneScores[lane]);

    console.log('All panels idle — resetting wall to idle');
    io.emit('message', { action: 'resetIdle', data: {} });
    broadcastScores();
}

function setLaneState(lane, state, socketId) {
    if (!lane) return;
    laneStates[lane] = { socketId, state };
    console.log(`Lane ${lane} -> ${state}`);
    broadcastLaneStates();
    checkResetToIdle();
}


// Handle WebSocket connections
io.on('connection', socket => {
    console.log('A user connected');
    console.log(socket.id)

    // Handle incoming WebSocket messages
    socket.on('message', data => {
        console.log('Received message:', data);

        if (data.action == "addToLeaderboard") {
          writeToDatabase('leaderboard', data.data.fields, data.data.values)
        }

        if (data.action == "addToTable") {
          writeToDatabase(data.data.table, data.data.fields, data.data.values)
        }

        // The game wall (display) connected — send it a snapshot of the
        // current round so it renders correctly even if it loaded mid-game.
        if (data.action == "registerDisplay") {
          socket.emit('message', {
            action: 'syncState',
            data: {
              phase: gamePhase,
              lanes: LANES,
              scores: laneScores,
              flyoverRemaining: Math.max(0, flyoverEndsAt - Date.now()),
              countdownRemaining: Math.max(0, countdownEndsAt - Date.now()),
              gameRemaining: Math.max(0, gameEndsAt - Date.now())
            }
          });
        }

        // A control panel announces which lane it is and its starting state.
        if (data.action == "registerLane") {
          const lane = data.data.lane;

          if (gamePhase !== 'idle' && gameLanes.includes(lane)) {
            // A participating panel refreshed mid-round — drop it straight back
            // into the live game at the right phase, with time/score intact.
            setLaneState(lane, 'game', socket.id);
            sendRejoin(socket);
          } else if (gamePhase !== 'idle') {
            // A game is already running that this lane isn't part of — register
            // it on the holding screen and offer to join the game in progress.
            setLaneState(lane, 'holding', socket.id);
            socket.emit('message', { action: 'offerJoin', data: { phase: gamePhase } });
          } else {
            setLaneState(lane, data.data.state || 'holding', socket.id);
          }
        }

        // A control panel changed state (e.g. clicked Start Game -> 'waiting').
        if (data.action == "setLaneState") {
          setLaneState(data.data.lane, data.data.state, socket.id);
          checkAllWaiting();
        }

        // An operator pressed a +1 / +2 / +3 / -1 button.
        if (data.action == "updateScore") {
          const lane = data.data.lane;
          const delta = Number(data.data.delta) || 0;
          laneScores[lane] = Math.max(0, (laneScores[lane] || 0) + delta);
          console.log(`Lane ${lane} score -> ${laneScores[lane]}`);
          broadcastScores();
        }

        // An operator pressed the celebration button — relay it to the game wall.
        if (data.action == "celebrate") {
          console.log(`Celebration triggered by lane ${data.data.lane}`);
          io.emit('message', { action: 'celebrate', data: { lane: data.data.lane } });
        }

        // Clear Points — reset just this lane's score to 0.
        if (data.action == "clearScore") {
          const lane = data.data.lane;
          laneScores[lane] = 0;
          console.log(`Lane ${lane} score cleared`);
          broadcastScores();
        }

        // Solo play — start the round now with just this lane.
        if (data.action == "startSolo") {
          startSolo(data.data.lane);
        }

        // A lane accepted the offer to join a game already in progress.
        if (data.action == "joinGame") {
          const lane = data.data.lane;
          if (gamePhase !== 'idle') {
            if (!gameLanes.includes(lane)) gameLanes.push(lane);
            laneScores[lane] = 0;
            setLaneState(lane, 'game', socket.id);
            console.log(`Lane ${lane} joined the game in progress`);
            broadcastScores();
            sendRejoin(socket);
          }
        }

        // Skip Flyover — jump past the intro animation into the countdown.
        if (data.action == "skipFlyover") {
          console.log(`Flyover skipped by lane ${data.data.lane}`);
          beginCountdown();
        }

        // Restart Game — replay the current round from the start of the flyover.
        if (data.action == "restartGame") {
          console.log(`Game restarted by lane ${data.data.lane}`);
          restartGame();
        }

        // End Game — end the round for both lanes.
        if (data.action == "endGame") {
          console.log(`Game ended by lane ${data.data.lane}`);
          endGame();
        }
    });

    // Handle disconnections
    socket.on('disconnect', () => {
        console.log('A user disconnected');

        // Free up whichever lane this socket owned so it can rejoin.
        Object.keys(laneStates).forEach(lane => {
            if (laneStates[lane].socketId === socket.id) {
                delete laneStates[lane];
                console.log(`Lane ${lane} disconnected`);
            }
        });
        broadcastLaneStates();
        checkResetToIdle();
    });
});






//-----------------------------Helper functions---------------------------

function sendCommand(command,id,data) {
    let message = {
       "action":command,
       "id": id,
       "data":data
    }
    io.emit('message', message);     
  }
  
  


  
  function writeToDatabase(tableName, tableFields, tableValues) {

    tableName = tableName.replaceAll('/','')

    const fieldsArray = tableFields.split(',').map(f => f.trim());
    const idIndex = fieldsArray.indexOf('id');
  
    if (idIndex !== -1 && tableValues[idIndex]) {
      // Build UPDATE query
      const updateFields = fieldsArray
        .filter((_, i) => i !== idIndex) // skip 'id'
        .map(field => `${field} = ?`)
        .join(', ');
  
      const updateValues = fieldsArray
        .filter((_, i) => i !== idIndex) // skip 'id'
        .map((_, i) => tableValues[i + (i >= idIndex ? 1 : 0)]); // shift index if after id
  
      const rowId = tableValues[idIndex];
      updateValues.push(rowId); // id for WHERE clause
  
      const sql = `UPDATE ${tableName} SET ${updateFields} WHERE id = ?`;
  
      const cleanValues = updateValues.map(value => value === undefined ? null : value);

      console.log("Running SQL UPDATE:");
      console.log(sql);
      console.log("With values:", cleanValues);


      try {
        db.prepare(sql).run(...cleanValues);
        console.log(`Row updated (ID: ${rowId})`);
      } catch (err) {
        console.error("DB Error:", err);
      }


      } else {

        let len = tableFields.split(',').length
        let def = ""
        for (let i = 0; i < len; i++) {
        def = def + '?, '
        }
        def = def.slice(0, -2);

        console.log(`logging ${tableValues} to table ${tableName}`)

        // node:sqlite rejects undefined parameters — coerce to null.
        const cleanInsertValues = tableValues.map(value => value === undefined ? null : value);
        try {
          db.prepare(`INSERT INTO ${tableName} (${tableFields}) VALUES (${def})`).run(...cleanInsertValues);
        } catch (err) {
          console.error("DB Error:", err);
        }
    }

}

