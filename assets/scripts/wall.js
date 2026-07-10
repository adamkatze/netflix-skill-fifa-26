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

// Debug mode (game.html?debug): the wall stays frozen on the game-over screen
// instead of auto-advancing back to idle, so the overlay videos can be
// positioned manually.
const DEBUG = new URLSearchParams(window.location.search).has('debug');

let wallState = 'idle';     // 'idle' | 'flyover' | 'countdown' | 'playing' | 'gameover'
let timerEnd = 0;           // performance.now() timestamp the countdown ends at
let timerInterval = null;
let countdownTimer = null;  // interval for the 3-2-1 start countdown
let latestScores = {};      // most recent score map, used to pick the winner
let bgFadeTimer = null;     // setTimeout handle for the background-video crossfade

// Background-video fade duration, in ms. Keep in sync with the CSS opacity
// transition on #wallVideo (var(--anim-speed), 500ms).
const BG_FADE_MS = 500;

const STATE_LABELS = {
    idle:     'IDLE',
    flyover:  'FLYOVER',
    playing:  'PLAYING',
    gameover: 'GAME OVER'
};


function initWall() {
    setupWallLayout();
    window.addEventListener('resize', scaleWall);

    // Debug: skip live updates and hold a state so overlay videos can be
    // positioned in CSS. ?debug=gameover (default) shows confetti + WINNER;
    // ?debug=kick shows the KICK countdown video. ?winner=1|2 picks the side.
    if (DEBUG) {
        const mode = new URLSearchParams(window.location.search).get('debug');
        console.log('[wall] DEBUG mode — frozen view for positioning (mode=' + (mode || 'gameover') + ')');
        if (mode === 'kick') forceDebugKick();
        else forceDebugGameOver();
        return;
    }

    listenForServer();

    // Ask the server for the current round in case we loaded mid-game.
    socket.emit('message', { action: 'registerDisplay' });
}

// Render a static game-over screen (scores, "Game Over!", confetti, WINNER) so
// those overlay videos can be positioned without running a live round.
function forceDebugGameOver() {
    const winnerLane = new URLSearchParams(window.location.search).get('winner') === '2' ? '2' : '1';
    updateScores(winnerLane === '2' ? { '1': 3, '2': 7 } : { '1': 7, '2': 3 });

    setState('gameover');
    stopTimer();
    renderTimerMs(0);
    playGameOverOverlay();
    showWinner();
}

// Render the playing state and play the KICK countdown video so it can be
// positioned. Loops in debug so the whole 3-2-1 -> KICK animation stays visible.
function forceDebugKick() {
    updateScores({ '1': 0, '2': 0 });
    setState('playing');

    const v = document.getElementById('wallKick');
    if (v) v.loop = true;

    playKickVideo();
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

// Swap the fullscreen background video to match the current state, fading out
// the old source and fading in the new one. States with no configured video
// (empty string) keep whatever is already playing.
function updateBackgroundVideo(state) {
    const src = (typeof wallVideos !== 'undefined') ? wallVideos[state] : null;
    if (!src) return;

    const video = document.getElementById('wallVideo');
    if (!video || video.dataset.state === state) return;

    video.dataset.state = state;

    // Fade out, then swap the source and fade back in once it has a frame.
    if (bgFadeTimer) clearTimeout(bgFadeTimer);
    video.style.opacity = '0';

    bgFadeTimer = setTimeout(function () {
        video.src = src;
        video.load();

        const played = video.play();
        if (played && played.catch) played.catch(() => {});   // ignore autoplay blocks

        const fadeIn = function () { video.style.opacity = '1'; };
        video.oncanplay = fadeIn;   // fade in as soon as the new video can render
        setTimeout(fadeIn, 300);    // fallback in case 'canplay' doesn't fire
    }, BG_FADE_MS);
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
                playGameOverOverlay();
                showWinner();
                break;

            // Panels returned to idle — clear the board and go back to idle.
            case 'resetIdle':
                if (DEBUG) break;   // debug: stay on game-over for manual positioning
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
    $('#wall').removeClass('timeup');   // cleared here; re-added when the timer hits 0
    $('#wallState').text(STATE_LABELS[state] || state);
    updateBackgroundVideo(state);

    if (state !== 'gameover') {
        hideGameOverOverlay();
        hideWinner();
    }
    // KICK video shows during countdown/playing; hide for any other state.
    if (state !== 'playing') hideKickVideo();
}


//--------------------------- Game-over overlay video --------------------------

// Transparent overlay played over the whole wall when the game ends.
function playGameOverOverlay() {
    const v = document.getElementById('wallOverlay');
    if (!v || !gameOverOverlayVideo) return;
    if (v.dataset.playing === '1') return;   // already running

    if (v.dataset.loaded !== '1') {
        v.src = gameOverOverlayVideo;
        v.dataset.loaded = '1';
    }
    v.dataset.playing = '1';
    v.style.display = 'block';
    v.currentTime = 0;

    const played = v.play();
    if (played && played.catch) played.catch(() => {});
}

function hideGameOverOverlay() {
    const v = document.getElementById('wallOverlay');
    if (!v) return;
    v.pause();
    v.style.display = 'none';
    v.dataset.playing = '0';
}


//--------------------------- Winner overlay video -----------------------------

// Play the "WINNER" animation over the winning lane's column. Ties show nothing.
function showWinner() {
    if (!winnerVideo) return;

    const s1 = latestScores['1'] != null ? latestScores['1'] : 0;
    const s2 = latestScores['2'] != null ? latestScores['2'] : 0;
    if (s1 === s2) return;                 // tie — no winner

    const winningLane = s1 > s2 ? '1' : '2';
    const v = document.getElementById('winner' + winningLane);
    if (!v || v.dataset.playing === '1') return;

    if (v.dataset.loaded !== '1') {
        v.src = winnerVideo;
        v.dataset.loaded = '1';
    }
    v.dataset.playing = '1';
    v.style.display = 'block';
    v.currentTime = 0;

    const played = v.play();
    if (played && played.catch) played.catch(() => {});
}

function hideWinner() {
    LANES.forEach(lane => {
        const v = document.getElementById('winner' + lane);
        if (!v) return;
        v.pause();
        v.style.display = 'none';
        v.dataset.playing = '0';
    });
}


//--------------------------- KICK countdown video -----------------------------

// Plays the "3-2-1 -> KICK" video (does not loop; holds "KICK" on its last frame).
function playKickVideo() {
    const v = document.getElementById('wallKick');
    if (!v || !kickCountdownVideo) return;
    if (v.dataset.playing === '1') return;

    if (v.dataset.loaded !== '1') {
        v.src = kickCountdownVideo;
        v.dataset.loaded = '1';
    }
    v.dataset.playing = '1';
    v.style.display = 'block';
    v.currentTime = 0;

    const played = v.play();
    if (played && played.catch) played.catch(() => {});
}

function hideKickVideo() {
    const v = document.getElementById('wallKick');
    if (!v) return;
    v.pause();
    v.style.display = 'none';
    v.dataset.playing = '0';
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

    // If a KICK countdown video is configured, it provides the 3-2-1 (and holds
    // "KICK" into gameplay); otherwise fall back to the plain DOM numbers.
    if (kickCountdownVideo) {
        $('#wallCountdown').text('');
        playKickVideo();
        return;
    }

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
    if (remainingMs <= 0) {
        stopTimer();
        // Show "Game Over!" + overlay the moment the timer hits zero, even
        // though the round stays live on the server through its grace period.
        if (wallState === 'playing') {
            $('#wall').addClass('timeup');
            hideKickVideo();
            playGameOverOverlay();
            showWinner();
        }
    }
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
    latestScores = scores;
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
