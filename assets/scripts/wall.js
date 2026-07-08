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

let wallState = 'idle';     // 'idle' | 'flyover' | 'countdown' | 'playing' | 'gameover'
let timerEnd = 0;           // performance.now() timestamp the countdown ends at
let timerInterval = null;
let countdownTimer = null;  // interval for the 3-2-1 start countdown

const STATE_LABELS = {
    idle:     'IDLE',
    flyover:  'FLYOVER',
    playing:  'PLAYING',
    gameover: 'GAME OVER'
};


function initWall() {
    setupWallLayout();
    window.addEventListener('resize', scaleWall);

    listenForServer();

    // Ask the server for the current round in case we loaded mid-game.
    socket.emit('message', { action: 'registerDisplay' });
}


//--------------------------------- Wall layout --------------------------------

// Size the full wall canvas and the right-aligned game UI area from config,
// then scale the whole thing to fit the current screen.
function setupWallLayout() {
    const stage = document.getElementById('wallStage');
    stage.style.width = wallWidth + 'px';
    stage.style.height = wallHeight + 'px';

    const wall = document.getElementById('wall');
    wall.style.width = gameAreaWidth + 'px';
    wall.style.height = gameAreaHeight + 'px';

    updateBackgroundVideo('idle');   // show the idle background right away
    scaleWall();
}

// Swap the fullscreen background video to match the current state. States with
// no configured video (empty string) keep whatever is already playing.
function updateBackgroundVideo(state) {
    const src = (typeof wallVideos !== 'undefined') ? wallVideos[state] : null;
    if (!src) return;

    const video = document.getElementById('wallVideo');
    if (!video || video.dataset.state === state) return;

    video.dataset.state = state;
    video.src = src;
    video.load();

    const played = video.play();
    if (played && played.catch) played.catch(() => {});   // ignore autoplay blocks
}

// Fit the fixed-size wall canvas into the browser window, centered.
function scaleWall() {
    const stage = document.getElementById('wallStage');
    const scale = Math.min(window.innerWidth / wallWidth, window.innerHeight / wallHeight);

    const offsetX = (window.innerWidth - wallWidth * scale) / 2;
    const offsetY = (window.innerHeight - wallHeight * scale) / 2;

    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
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

            // Flyover finished — show the 3-2-1 countdown over the hidden UI.
            case 'countdown':
                startCountdownVisual(data.data && data.data.duration);
                break;

            // Countdown finished — reveal the game and start the timer.
            case 'beginGame':
                revealGame(data.data && data.data.duration);
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
    } else if (s.phase === 'countdown') {
        startCountdownVisual(s.countdownRemaining);
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
    stopCountdown();                 // cancel any in-progress start countdown
    wallState = state;
    $('#wall').attr('data-state', state);
    $('#wallState').text(STATE_LABELS[state] || state);
    updateBackgroundVideo(state);
}


//--------------------------- Start-of-play countdown --------------------------

// The server started the countdown phase: switch to the gameplay background and
// show the counting numbers over the (still hidden) UI. The game timer is held
// on the server, so the reveal happens when the 'beginGame' message arrives.
function startCountdownVisual(durationMs) {
    stopCountdown();
    updateBackgroundVideo('playing');

    wallState = 'countdown';
    $('#wall').attr('data-state', 'countdown');

    const el = document.getElementById('wallCountdown');
    let n = Math.max(1, Math.round((durationMs ?? 3000) / 1000));
    showCountdownNumber(el, n);

    countdownTimer = setInterval(function () {
        n--;
        if (n >= 1) showCountdownNumber(el, n);
        else stopCountdown();        // reached zero — wait for beginGame to reveal
    }, 1000);
}

function showCountdownNumber(el, n) {
    el.textContent = n;
    el.classList.remove('pop');
    void el.offsetWidth;             // reflow to restart the pop animation
    el.classList.add('pop');
}

function stopCountdown() {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

// Countdown finished on the server — reveal the game UI and start the timer.
function revealGame(durationMs) {
    setState('playing');
    startTimer(durationMs ?? gameLength);
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
    const count = 120;

    for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'confettiPiece';
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.setProperty('--drift', (Math.random() * 600 - 300) + 'px');

        const duration = 1.8 + Math.random() * 1.6;
        const delay = Math.random() * 0.4;
        piece.style.animationDuration = duration + 's';
        piece.style.animationDelay = delay + 's';

        layer.appendChild(piece);
        setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }
}
