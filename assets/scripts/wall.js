//------------------------------------------------------------------------------
// Game Wall (display) — placeholder
//
// A read-only display driven entirely by the server's socket broadcasts. It
// mirrors the round the control panels are running: shows the current state
// (idle / countdown / playing / gameover), each lane's score, a shared
// countdown timer, and a confetti burst when a lane triggers its Celebration
// button. The gameplay background video loops continuously through every state.
//------------------------------------------------------------------------------

const socket = io();
const LANES = ['1', '2'];

// Debug mode (game.html?debug): the wall stays frozen on the game-over screen
// instead of auto-advancing back to idle, so the overlay videos can be
// positioned manually.
const DEBUG = new URLSearchParams(window.location.search).has('debug');

let wallState = 'idle';     // 'idle' | 'countdown' | 'playing' | 'gameover'
let timerEnd = 0;           // performance.now() timestamp the countdown ends at
let timerInterval = null;
let countdownTimer = null;  // interval for the 3-2-1 start countdown
let latestScores = {};      // most recent score map, used to pick the winner
let bgFadeTimer = null;     // setTimeout handle for the background-video crossfade
let activeVideoId = 'wallVideo';  // Track which video is currently active ('wallVideo' or 'wallVideo2')
let musicPlayers = [];      // one preloaded Audio per track in musicTracks
let musicIndex = -1;        // index of the currently selected track (-1 = none)
let musicPending = false;   // play() was blocked by autoplay policy — retry on unlock

// Background-video fade duration, in ms. Keep in sync with the CSS opacity
// transition on #wallVideo (var(--anim-speed), 500ms).
const BG_FADE_MS = 0;

// The WINNER animation + scores fade out over the confetti video's final
// stretch, so the board resets to 0 invisibly. The fade starts this many
// seconds before the confetti ends; the CSS transition on #wall.uiFadeOut
// (1.5s) must stay shorter so the fade completes before the reset.
const UI_FADE_LEAD_S = 2;

const STATE_LABELS = {
    idle:      'IDLE',
    countdown: 'COUNTDOWN',
    playing:   'PLAYING',
    gameover:  'GAME OVER'
};


function initWall() {
    setupWallLayout();
    initMusic();
    enableAudioOnFirstGesture();
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

    // Pick the initial idle's track right away rather than waiting for the
    // server's syncState. If a round is actually live, the resulting
    // setState() stops it; if autoplay blocks it, the unlock gesture retries.
    startMusic(true);
}

// Render a static game-over screen (scores, "Game Over!", confetti, WINNER) so
// those overlay videos can be positioned without running a live round.
function forceDebugGameOver() {
    const winnerLane = new URLSearchParams(window.location.search).get('winner') === '2' ? '2' : '1';
    updateScores(winnerLane === '2' ? { '1': 3, '2': 7 } : { '1': 7, '2': 3 });

    setState('gameover');
    stopTimer();
    renderTimerMs(0);

    // Debug: loop the confetti so the frozen celebration never advances back
    // to idle (its 'ended' handler never fires).
    const ov = document.getElementById('wallOverlay');
    if (ov) ov.loop = true;

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


//--------------------------------- Audio unlock -------------------------------

// Browsers block sound until the page has real "user activation", and an
// unmute attempted without it gets the video PAUSED instead ("Unmuting failed
// and the element was paused..."). Activation is granted at touchend /
// pointerup / click / keydown — NOT at touchstart — so listen only for
// activation-carrying events, verify activation actually exists before
// unmuting, and stay armed for the next gesture if it doesn't. Every player
// starts muted so autoplay always works; the first real gesture unmutes them
// all for the rest of the session. If Chrome is launched with
// --autoplay-policy=no-user-gesture-required, this stays harmless.
function enableAudioOnFirstGesture() {
    const EVENTS = ['click', 'keydown', 'pointerup', 'touchend'];
    let unlocked = false;

    const unmute = function () {
        if (unlocked) return;

        // No real activation yet (e.g. synthetic event) — wait for the next one.
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;

        document.querySelectorAll('video').forEach(v => {
            const wasPlaying = !v.paused && !v.ended;
            v.muted = false;
            // Chrome pauses an autoplay-muted video the moment it's unmuted;
            // resume it within this same gesture so it's allowed with sound.
            if (wasPlaying && v.paused) {
                const played = v.play();
                if (played && played.catch) played.catch(() => {});
            }
        });

        unlocked = true;
        EVENTS.forEach(evt => window.removeEventListener(evt, unmute));
        console.log('[wall] audio unlocked — videos unmuted');

        // Music that was blocked by autoplay policy can start now.
        if (musicPending) startMusic(false);
    };

    EVENTS.forEach(evt => window.addEventListener(evt, unmute));
}


//--------------------------------- Background music ---------------------------

// Preload every track at page load (kiosk runs locally and rarely refreshes).
function initMusic() {
    if (typeof musicTracks === 'undefined' || !musicTracks.length) return;

    musicPlayers = musicTracks.map(function (src) {
        const a = new Audio(src);
        a.preload = 'auto';
        a.loop = true;   // idle longer than the song? the SAME song loops on
        a.volume = (typeof musicVolume !== 'undefined') ? musicVolume : 1.0;
        return a;
    });
}

// Ramp a player's volume to `target` over musicFadeMs (per-player timer, so a
// stopping track can fade out while a new one fades in). A new fade on the
// same player replaces any fade already running on it.
function fadeTo(player, target, done) {
    if (player._fade) clearInterval(player._fade);
    player._fadingOut = target === 0;

    const STEP_MS = 50;
    const fadeMs = (typeof musicFadeMs !== 'undefined') ? musicFadeMs : 2000;
    const steps = Math.max(1, Math.round(fadeMs / STEP_MS));
    const startVol = player.volume;
    let n = 0;

    player._fade = setInterval(function () {
        n++;
        player.volume = Math.min(1, Math.max(0, startVol + (target - startVol) * (n / steps)));
        if (n >= steps) {
            clearInterval(player._fade);
            player._fade = null;
            player._fadingOut = false;
            if (done) done();
        }
    }, STEP_MS);
}

// Play the soundtrack. reroll=true picks a fresh random track (never the same
// one twice in a row) and starts it from the beginning; reroll=false retries
// the already-selected track (used after the autoplay unlock). Either way the
// volume fades in from silence.
function startMusic(reroll) {
    if (!musicPlayers.length) return;

    if (reroll || musicIndex === -1) {
        stopMusic();
        let next = Math.floor(Math.random() * musicPlayers.length);
        if (musicPlayers.length > 1 && next === musicIndex) {
            next = (next + 1) % musicPlayers.length;
        }
        musicIndex = next;
        musicPlayers[musicIndex].currentTime = 0;
    }

    musicPending = false;
    const player = musicPlayers[musicIndex];
    player.volume = 0;
    const played = player.play();
    if (played && played.catch) {
        played.catch(function () { musicPending = true; });   // blocked — retry on unlock
    }
    fadeTo(player, (typeof musicVolume !== 'undefined') ? musicVolume : 1.0);
}

// Fade the current track to silence, then pause it. The fade bleeds into the
// next state (e.g. over the start of the countdown) by design.
function stopMusic() {
    musicPending = false;
    if (musicIndex === -1) return;

    const player = musicPlayers[musicIndex];
    if (player.paused) return;

    fadeTo(player, 0, function () { player.pause(); });
}

function musicIsPlaying() {
    if (musicIndex === -1) return false;
    const player = musicPlayers[musicIndex];
    return !player.paused && !player._fadingOut;
}

// Music plays ONLY during idle — a fresh random track each time the wall
// returns there; every other state silences it.
function updateMusicForState(state) {
    if (DEBUG) return;   // debug views are for positioning — no music

    if (state === 'idle') {
        if (!musicIsPlaying()) startMusic(true);
    } else {
        stopMusic();
    }
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

// Swap the fullscreen background video to match the current state using dual
// video elements and z-index swapping to eliminate black flicker.
function updateBackgroundVideo(state) {
    const src = (typeof wallVideos !== 'undefined') ? wallVideos[state] : null;
    if (!src) return;

    // Get both video elements
    const activeVideo = document.getElementById(activeVideoId);
    const inactiveVideoId = activeVideoId === 'wallVideo' ? 'wallVideo2' : 'wallVideo';
    const inactiveVideo = document.getElementById(inactiveVideoId);

    if (!activeVideo || !inactiveVideo) return;
    if (activeVideo.dataset.state === state) return;  // Already playing this state

    // The new state uses the file already on screen (e.g. idle and playing
    // share the gameplay video) — keep it looping untouched, no reload.
    if (activeVideo.getAttribute('src') === src) {
        activeVideo.dataset.state = state;
        return;
    }

    // Prepare the inactive video with the new source
    inactiveVideo.dataset.state = state;
    inactiveVideo.loop = true;
    inactiveVideo.src = src;
    inactiveVideo.load();

    // When the new video is ready, swap the z-indexes
    const swapVideos = function () {
        // Swap active class for z-index management
        activeVideo.classList.remove('active');
        inactiveVideo.classList.add('active');

        // Update the active video tracker
        activeVideoId = inactiveVideoId;

        // Stop the now-hidden video to free resources
        setTimeout(function() {
            activeVideo.pause();
            activeVideo.src = '';  // Clear source to free memory
        }, 100);
    };

    // Start playing the new video and swap when ready
    const played = inactiveVideo.play();
    if (played && played.catch) {
        played.then(swapVideos).catch(() => {
            // If autoplay fails, swap anyway
            swapVideos();
        });
    } else {
        // Fallback for browsers without promise support
        inactiveVideo.oncanplay = swapVideos;
        setTimeout(swapVideos, 100);  // Failsafe
    }
}

// Fill the screen height and anchor the wall to the right edge; any unused
// width (e.g. a 16:9 4K TV showing the 1.5:1 canvas) is left as a black gap
// on the left, and on narrower screens the excess crops off the left.
function scaleWall() {
    const stage = document.getElementById('wallStage');
    const scale = window.innerHeight / wallHeight;

    const offsetX = window.innerWidth - wallWidth * scale;

    stage.style.transform = `translate(${offsetX}px, 0px) scale(${scale})`;
}


function listenForServer() {
    socket.on('message', (data) => {
        switch (data.action) {

            // Snapshot sent right after we connect.
            case 'syncState':
                applyState(data.data);
                break;

            // A round started (or restarted) — the 'countdown' broadcast that
            // follows immediately drives the visual transition.
            case 'startGame':
            case 'restartGame':
                resetScores();
                break;

            // Show the 3-2-1 countdown over the hidden UI.
            case 'countdown':
                startCountdownVisual(data.data && data.data.duration);
                break;

            // Countdown finished — reveal the game and start the timer.
            case 'beginGame':
                revealGame(data.data && data.data.duration);
                break;

            // The round ended. If the wall's own timer already hit zero, the
            // game-over sequence is running (or done) — don't restart it.
            case 'endGame':
                if (wallState !== 'countdown' && wallState !== 'playing') break;
                enterGameOver();
                break;

            // Panels returned to idle — clear the board and go back to idle.
            // The game-over sequence (confetti → idle) self-completes, so an
            // early panel reset must not cut it short.
            case 'resetIdle':
                if (DEBUG) break;   // debug: stay frozen for manual positioning
                if (wallState === 'gameover') break;
                setState('idle');
                stopTimer();
                renderTimerMs(0);
                resetScores();
                break;

            // Authoritative score map. The server broadcasts an EMPTY map when
            // every panel resets; if that lands during the game-over sequence
            // (confetti + fade still running), keep the final scores on screen —
            // goIdle resets the board once it's invisible.
            case 'scoreUpdate':
                if (wallState === 'gameover' && !Object.keys(data.data.scores || {}).length) break;
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

    if (s.phase === 'countdown') {
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
    $('#wall').removeClass('uiFadeOut');   // restore the UI faded during the confetti
    $('#wallState').text(STATE_LABELS[state] || state);

    // 'gameover' has no video configured (empty string), so the gameplay
    // video naturally keeps looping under the confetti.
    updateBackgroundVideo(state);

    if (state !== 'gameover') {
        hideGameOverOverlay();
        hideWinner();
    }
    // KICK video shows during countdown/playing; hide for any other state.
    if (state !== 'playing') hideKickVideo();

    updateMusicForState(state);
}


//--------------------------------- Game over -----------------------------------

// Run the game-over sequence: scores + "Game Over!", confetti overlay, and the
// WINNER animation. Called both when the wall's own timer hits zero (the round
// is still live on the server through its grace period) and when the server's
// endGame arrives first — the overlays' playing-guards make a second call a
// no-op. The confetti's 'ended' handler advances the wall back to idle.
function enterGameOver() {
    setState('gameover');
    stopTimer();
    renderTimerMs(0);
    playGameOverOverlay();
    showWinner();
    if (!gameOverOverlayVideo) goIdle();   // no confetti configured — idle now
}

// The confetti finished (or was never configured) — clear the board and idle.
function goIdle() {
    if (wallState !== 'gameover') return;
    setState('idle');
    stopTimer();
    renderTimerMs(0);
    resetScores();
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

    // Plays once; when it finishes, hide it and return the wall to idle.
    // (In debug the overlay loops, so this never fires.)
    v.onended = v.onerror = function () {
        hideGameOverOverlay();
        goIdle();
    };

    // Fade the WINNER + scores out over the confetti's final stretch so the
    // reset to 0 happens invisibly. (In debug the overlay loops — never fade.)
    v.ontimeupdate = function () {
        if (v.loop) return;
        if (isFinite(v.duration) && v.duration - v.currentTime <= UI_FADE_LEAD_S) {
            $('#wall').addClass('uiFadeOut');
            v.ontimeupdate = null;
        }
    };

    const played = v.play();
    if (played && played.catch) played.catch(() => {});
}

function hideGameOverOverlay() {
    const v = document.getElementById('wallOverlay');
    if (!v) return;
    v.pause();
    v.ontimeupdate = null;
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
let kickSoundPlayer = null;

function getKickSoundPlayer() {
    if (typeof kickCountdownSound === 'undefined' || !kickCountdownSound) return null;
    if (!kickSoundPlayer) {
        kickSoundPlayer = new Audio(kickCountdownSound);
        kickSoundPlayer.preload = 'auto';
    }
    return kickSoundPlayer;
}

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

    const sfx = getKickSoundPlayer();
    if (sfx) {
        sfx.currentTime = 0;
        const sfxPlayed = sfx.play();
        if (sfxPlayed && sfxPlayed.catch) sfxPlayed.catch(() => {});
    }
}

function hideKickVideo() {
    const v = document.getElementById('wallKick');
    if (!v) return;
    v.pause();
    v.style.display = 'none';
    v.dataset.playing = '0';

    const sfx = getKickSoundPlayer();
    if (sfx) {
        sfx.pause();
        sfx.currentTime = 0;
    }
}


//--------------------------- Start-of-play countdown --------------------------

// The server started the countdown phase: show the counting numbers over the
// (still hidden) UI. The game timer is held on the server, so the UI reveal
// happens when the 'beginGame' message arrives. setState clears any leftover
// game-over overlays (e.g. a restart during the grace period) and stops the
// idle music.
function startCountdownVisual(durationMs) {
    setState('countdown');
    updateBackgroundVideo('playing');   // gameplay background behind the 3-2-1

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
        // Run the game-over sequence the moment the timer hits zero, even
        // though the round stays live on the server through its grace period.
        if (wallState === 'playing') enterGameOver();
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
