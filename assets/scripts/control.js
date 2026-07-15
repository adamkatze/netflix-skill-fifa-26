//------------------------------------------------------------------------------
// Control Panel logic
//
// Each control panel runs in one of two "lanes", chosen via the URL parameter:
//     control.html?lane=1   or   control.html?lane=2
//
// Flow:
//   holding  -> (Start Game)        -> waiting   (tells server this lane is waiting)
//   waiting  -> (both lanes waiting) -> gameWrapper (server broadcasts 'startGame')
//
// The server keeps the authoritative state of every lane; this panel just
// reports its own state changes and reacts to the broadcasts it receives.
//------------------------------------------------------------------------------

let myLane = null;
let controlState = 'holding';
let gamePhase = null;          // 'countdown' | 'active'
let gameInProgress = false;    // is a round live somewhere (even if not ours)?
let myScore = 0;
let latestScores = {};         // most recent full score map from the server
let timerEnd = 0;       // performance.now() timestamp the current countdown ends at
let timerInterval = null;
let autoResetTimer = null;     // returns the score screen to holding automatically

// How long the score screen stays up before auto-returning to the start screen.
const scoreScreenTimeout = 10000;


function initControl() {

    // Reuse the existing socket + helpers created in scripts.js
    myLane = getUrlParameter('lane');

    if (!myLane) {
        console.warn('No "lane" URL parameter found. Open this page with ?lane=1 or ?lane=2');
    }

    // Show this panel's lane, and tell the waiting screen which lane we're waiting on.
    const otherLane = myLane === '1' ? '2' : (myLane === '2' ? '1' : 'the other lane');
    $('.laneIndicator').text('Lane ' + (myLane || '?'));
    $('#lane').text(myLane ? 'Lane ' + otherLane : 'the other lane');

    listenForServer();

    // Register this panel + lane with the server.
    sendCommand('registerLane', { lane: myLane, state: controlState });
}


function listenForServer() {

    socket.on('message', (data) => {

        // A round is starting — advance into the control panel and show the
        // 3-2-1 countdown, but only if this lane is one of the participants.
        if (data.action === 'startGame') {
            gameInProgress = true;
            if (laneIsPlaying(data.data && data.data.lanes)) {
                advanceToControlPanel(data.data && data.data.countdown);
            }
        }

        // The 3-2-1 countdown before the game timer starts.
        if (data.action === 'countdown') {
            gameInProgress = true;
            if (controlState === 'game') startCountdownPhase(data.data && data.data.duration);
        }

        // Countdown finished — start the real game timer.
        if (data.action === 'beginGame') {
            gameInProgress = true;
            if (controlState === 'game') beginGame(data.data && data.data.duration);
        }

        // Authoritative snapshot of every lane's state.
        if (data.action === 'laneStates') {
            updateLaneStatus(data.data);
        }

        // Authoritative score map from the server.
        if (data.action === 'scoreUpdate') {
            updateScoreDisplay(data.data.scores);
        }

        // The game was restarted — fade out and replay from the countdown.
        if (data.action === 'restartGame') {
            gameInProgress = true;
            if (controlState === 'game') handleRestart(data.data && data.data.countdown);
        }

        // The game was ended — close out the panel (only if we were playing).
        if (data.action === 'endGame') {
            gameInProgress = false;
            if (controlState === 'game') handleEndGame();
        }

        // A game is already in progress — ask whether to join it.
        if (data.action === 'offerJoin') {
            gameInProgress = true;
            promptJoinGame();
        }

        // This panel refreshed mid-round — server is restoring the live game.
        if (data.action === 'rejoinGame') {
            rejoinLiveGame(data.data.phase, data.data.duration, data.data.scores);
        }
    });
}


//--------------------------------- Screen transitions -------------------------

// Start Game button (holding screen).
function startGameRequest() {
    if (controlState !== 'holding') return;

    // A round is already running — offer to join it instead of waiting forever.
    if (gameInProgress) {
        promptJoinGame();
        return;
    }

    controlState = 'waiting';
    animateSwap('#holding', '#waiting', menuAnimSpeed, 0, animatingMenu);

    sendCommand('setLaneState', { lane: myLane, state: 'waiting' });
}


// Back to Home button (waiting screen) — leave the waiting state.
function cancelWaiting() {
    if (controlState !== 'waiting') return;

    controlState = 'holding';
    animateSwap('#waiting', '#holding', menuAnimSpeed, 0, animatingMenu);

    sendCommand('setLaneState', { lane: myLane, state: 'holding' });
}


// Triggered by the server once every lane is waiting.
function advanceToControlPanel(countdownDuration) {
    if (controlState === 'game') return;

    controlState = 'game';
    $('#cpLaneNum').text(myLane || '?');
    animateSwap('#waiting', '#controlPanel', menuAnimSpeed, 0, animatingMenu);

    // The server's 'countdown' broadcast follows immediately and re-syncs this.
    startCountdownPhase(countdownDuration);
}


//--------------------------------- Game phases --------------------------------

// Countdown phase — the 3-2-1 before the game timer. Scoring stays disabled and
// the game timer is held until the server's 'beginGame' message.
function startCountdownPhase(durationMs) {
    gamePhase = 'countdown';
    $('#controlPanel').attr('data-phase', 'countdown');
    $('#cpTimerLabel').text('Get Ready');
    startTimer(durationMs ?? 3000);
}

// Active phase — the real game timer is running.
function beginGame(durationMs) {
    gamePhase = 'active';
    $('#controlPanel').attr('data-phase', 'active');
    $('#cpTimerLabel').text('Time Remaining');
    startTimer(durationMs ?? gameLength);
}

// True if this lane is in the participant list for a starting round.
// (Older messages without a lanes list are treated as applying to everyone.)
function laneIsPlaying(lanes) {
    if (!lanes) return true;
    return lanes.indexOf(myLane) !== -1;
}

// A game is already running — offer to join it (after confirmation).
function promptJoinGame() {
    askConfirm('A game is already in progress. Join it?', function() {
        sendCommand('joinGame', { lane: myLane });
    }, 'Join Game');
}


// "Skip to game for solo play" button (waiting screen). Starts the round on the
// server (without waiting for the other lane) so the countdown and auto-begin
// all run through the same server-driven lifecycle.
function skipToSolo() {
    sendCommand('startSolo', { lane: myLane });
}


// Restore a live game after a page refresh. On a fresh load we're sitting on
// the holding screen, so we jump straight from there into the control panel.
function rejoinLiveGame(phase, duration, scores) {
    if (controlState === 'game') return;

    gameInProgress = true;
    controlState = 'game';
    $('#cpLaneNum').text(myLane || '?');
    animateSwap('#holding', '#controlPanel', menuAnimSpeed, 0, animatingMenu);

    updateScoreDisplay(scores);

    if (phase === 'countdown') {
        startCountdownPhase(duration);
    } else {
        beginGame(duration);
    }
}


//--------------------------------- Round timer --------------------------------

// Count down the remaining round time and render it as mm:ss.
function startTimer(durationMs) {
    timerEnd = performance.now() + durationMs;

    if (timerInterval) clearInterval(timerInterval);
    renderTimer();
    timerInterval = setInterval(renderTimer, 250);
}

function renderTimer() {
    let remainingMs = Math.max(0, timerEnd - performance.now());
    let totalSeconds = Math.ceil(remainingMs / 1000);

    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds - (minutes * 60);

    let display = (minutes < 10 ? '0' + minutes : minutes) + ':';
    display += (seconds < 10 ? '0' + seconds : seconds);
    $('#cpTimer').text(display);

    if (remainingMs <= 0 && timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}


//--------------------------------- Score & celebration ------------------------

// +1 / +2 / +3 / -1 buttons. The server is authoritative; the display updates
// when its 'scoreUpdate' broadcast comes back.
function addScore(delta) {
    sendCommand('updateScore', { lane: myLane, delta: delta });
}

// Show a celebration on the game wall (max once per cooldown window, so the
// button can't be spammed).
const CELEBRATE_COOLDOWN_MS = 1000;
let celebrateCooldownUntil = 0;

function triggerCelebration() {
    if (performance.now() < celebrateCooldownUntil) return;
    celebrateCooldownUntil = performance.now() + CELEBRATE_COOLDOWN_MS;

    sendCommand('celebrate', { lane: myLane });

    // The help modal holds a decorative copy of this button — scope to the panel.
    const btn = $('#controlPanel .cpCelebrate');
    btn.prop('disabled', true);
    setTimeout(function () { btn.prop('disabled', false); }, CELEBRATE_COOLDOWN_MS);
}

// Render this lane's score from the server's authoritative map.
function updateScoreDisplay(scores) {
    if (scores) latestScores = scores;
    if (!scores || myLane === null) return;
    myScore = scores[myLane] || 0;
    $('#cpScore').text(myScore);
}


//--------------------------------- Confirm modal -----------------------------

let pendingAction = null;

// Show the "Are you sure?" modal; `action` runs only if the operator confirms.
function askConfirm(message, action, confirmLabel) {
    pendingAction = action;
    $('#cpModalText').text(message);
    $('#cpModalConfirm').text(confirmLabel || "Yes, I'm sure");
    $('#cpModal').removeClass('hide');
}

function closeConfirm() {
    pendingAction = null;
    $('#cpModal').addClass('hide');
}

function confirmAction() {
    if (typeof pendingAction === 'function') pendingAction();
    closeConfirm();
}


//--------------------------------- Help modal --------------------------------

function openHelp() {
    $('#cpHelpModal').removeClass('hide');
}

function closeHelp() {
    $('#cpHelpModal').addClass('hide');
}


//--------------------------------- Danger actions ----------------------------

// Clear Points — reset only this lane's score to 0 (after confirmation).
function clearPoints() {
    askConfirm('Clear all points for this lane?', function() {
        sendCommand('clearScore', { lane: myLane });
    });
}

// Restart Game — replay the round from the countdown (after confirmation).
function restartGame() {
    askConfirm('Restart the game from the beginning?', function() {
        sendCommand('restartGame', { lane: myLane });
    });
}

// End Game — end the round for BOTH lanes (after confirmation).
function endGame() {
    askConfirm('End the game for BOTH lanes?', function() {
        sendCommand('endGame', { lane: myLane });
    });
}

// Server told every lane to restart — fade the panel out, then replay the countdown.
function handleRestart(countdownDuration) {
    controlState = 'game';

    $('#controlPanel').removeClass('animIn');           // fade out
    setTimeout(function() {
        $('#controlPanel').addClass('animIn');          // fade back in
        startCountdownPhase(countdownDuration);
    }, menuAnimSpeed);
}

// Server told every lane the game is over.
function handleEndGame() {
    if (controlState === 'ended') return;
    controlState = 'ended';

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    closeConfirm();
    showFinalScores();
    animateSwap('#controlPanel', '#score', menuAnimSpeed, 0, animatingMenu);

    // Return to the start screen on its own if no one hits Start Over.
    if (autoResetTimer) clearTimeout(autoResetTimer);
    autoResetTimer = setTimeout(function() {
        if (controlState === 'ended') resetControl();
    }, scoreScreenTimeout);
}

// Fill the score screen with both lanes' final scores.
function showFinalScores() {
    $('#finalScore1').text(latestScores['1'] != null ? latestScores['1'] : 0);
    $('#finalScore2').text(latestScores['2'] != null ? latestScores['2'] : 0);
}

// Start Over button on the score screen — return to holding for a new game.
function resetControl() {
    if (autoResetTimer) {
        clearTimeout(autoResetTimer);
        autoResetTimer = null;
    }
    controlState = 'holding';
    gamePhase = null;
    animateSwap('#score', '#holding', menuAnimSpeed, 0, animatingMenu);
    sendCommand('setLaneState', { lane: myLane, state: 'holding' });
}


//--------------------------------- UI feedback --------------------------------

// Reflect whether the other lane has connected / is waiting yet.
function updateLaneStatus(laneStates) {
    const otherLane = myLane === '1' ? '2' : (myLane === '2' ? '1' : null);
    if (!otherLane) return;

    const other = laneStates[otherLane];
    const joined = other && other.state === 'waiting';

    $('body').attr('data-other-lane', joined ? 'waiting' : (other ? 'connected' : 'absent'));
}
