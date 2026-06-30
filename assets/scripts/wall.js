//------------------------------------------------------------------------------
// Game Wall (display) — placeholder
//
// A read-only display driven entirely by the server's socket broadcasts. It
// mirrors the round the control panels are running: shows the current state
// (idle / flyover / playing / gameover), each lane's score, a shared countdown
// timer, and a confetti burst when a lane triggers its Celebration button.
//------------------------------------------------------------------------------

const socket = io();
const LANES = ['1', '2'];

let wallState = 'idle';     // 'idle' | 'flyover' | 'playing' | 'gameover'
let timerEnd = 0;           // performance.now() timestamp the countdown ends at
let timerInterval = null;

const STATE_LABELS = {
    idle:     'IDLE',
    flyover:  'FLYOVER',
    playing:  'PLAYING',
    gameover: 'GAME OVER'
};


function initWall() {
    listenForServer();

    // Ask the server for the current round in case we loaded mid-game.
    socket.emit('message', { action: 'registerDisplay' });
}


function listenForServer() {
    socket.on('message', (data) => {
        switch (data.action) {

            // Snapshot sent right after we connect.
            case 'syncState':
                applyState(data.data);
                break;

            // A round started (or restarted) — flyover intro is playing.
            case 'startGame':
            case 'restartGame':
                setState('flyover');
                resetScores();
                startTimer(data.data && data.data.flyover, flyoverLength);
                break;

            // Flyover finished — the game timer is now running.
            case 'beginGame':
                setState('playing');
                startTimer(data.data && data.data.duration, gameLength);
                break;

            // The round ended.
            case 'endGame':
                setState('gameover');
                stopTimer();
                renderTimerMs(0);
                break;

            // Panels returned to idle — clear the board and go back to idle.
            case 'resetIdle':
                setState('idle');
                stopTimer();
                renderTimerMs(0);
                resetScores();
                break;

            // Authoritative score map.
            case 'scoreUpdate':
                updateScores(data.data.scores);
                break;

            // A lane hit its Celebration button.
            case 'celebrate':
                celebrate(data.data.lane);
                break;
        }
    });
}


// Render whatever state the server reports on initial connect.
function applyState(s) {
    updateScores(s.scores);

    if (s.phase === 'flyover') {
        setState('flyover');
        startTimer(s.flyoverRemaining, flyoverLength);
    } else if (s.phase === 'active') {
        setState('playing');
        startTimer(s.gameRemaining, gameLength);
    } else {
        setState('idle');
        stopTimer();
        renderTimerMs(0);
    }
}


//--------------------------------- State --------------------------------------

function setState(state) {
    wallState = state;
    $('#wall').attr('data-state', state);
    $('#wallState').text(STATE_LABELS[state] || state);
}


//--------------------------------- Timer --------------------------------------

function startTimer(durationMs, fallback) {
    timerEnd = performance.now() + (durationMs ?? fallback ?? 0);

    if (timerInterval) clearInterval(timerInterval);
    renderTimer();
    timerInterval = setInterval(renderTimer, 250);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function renderTimer() {
    let remainingMs = Math.max(0, timerEnd - performance.now());
    renderTimerMs(remainingMs);
    if (remainingMs <= 0) stopTimer();
}

function renderTimerMs(remainingMs) {
    let totalSeconds = Math.ceil(remainingMs / 1000);
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds - (minutes * 60);

    let display = (minutes < 10 ? '0' + minutes : minutes) + ':';
    display += (seconds < 10 ? '0' + seconds : seconds);
    $('#wallTimer').text(display);
}


//--------------------------------- Scores -------------------------------------

function updateScores(scores) {
    if (!scores) return;
    LANES.forEach(lane => {
        $('#wallScore' + lane).text(scores[lane] != null ? scores[lane] : 0);
    });
}

function resetScores() {
    LANES.forEach(lane => $('#wallScore' + lane).text('0'));
}


//--------------------------------- Confetti -----------------------------------

function celebrate(lane) {
    const layer = document.getElementById('confetti' + lane);
    if (!layer) return;

    const colors = ['#E50914', '#FBBC04', '#34A853', '#4285F4', '#ffffff'];
    const count = 80;

    for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'confettiPiece';
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.setProperty('--drift', (Math.random() * 240 - 120) + 'px');

        const duration = 1.8 + Math.random() * 1.6;
        const delay = Math.random() * 0.4;
        piece.style.animationDuration = duration + 's';
        piece.style.animationDelay = delay + 's';

        layer.appendChild(piece);
        setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }
}
