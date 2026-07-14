//------------------------------ Display Wall Background Videos -----------------
// File paths for the fullscreen background video shown behind the UI on the
// display wall, one per game state. Paths are relative to the wall page
// (assets/html/game.html) — e.g. '../videos/idle.mp4' -> assets/videos/idle.mp4
//
// Leave a value as '' (empty) to keep whatever video is already playing for
// that state — e.g. by default "gameover" simply keeps the idle/gameplay
// background until the round resets.

const wallVideos = {
    idle:     '../videos/1_idle.webm',
    flyover:  '../videos/2_flyover.webm',
    playing:  '../videos/3_gameplay.webm',
    gameover: '',
    playreveal: '../videos/4_NETFLIX_AND SKILL_REVEAL.webm'
};


// Transparent video overlaid over the whole wall (on top of the background
// video and UI) when the game ends. Use a format with an alpha channel —
// e.g. WebM (VP9 alpha) for Chrome, or HEVC-with-alpha .mov for Safari.
// Set to '' to disable the overlay.
const gameOverOverlayVideo = '../videos/confetti.webm';


// Transparent "WINNER" animation shown over the winning lane's column when the
// game ends. Same alpha-capable format requirement as above. Set to '' to disable.
const winnerVideo = '../videos/WINNER.webm';


// Transparent "3-2-1 -> KICK" animation played during the countdown phase,
// centered across the two lanes at the top. It should NOT loop — it ends on the
// "KICK" frame, which stays visible through gameplay. Set '' to use plain text.
// Tip: match COUNTDOWN_MS on the server to the video's 3-2-1 length so the game
// starts exactly as "KICK" appears.
const kickCountdownVideo = '../videos/KICK.webm';


//------------------------------ Background Music -------------------------------
// One track is picked at random when the playreveal state starts and keeps
// looping through the following idle; silent during gameplay. All tracks are
// preloaded when the wall page loads. Set to [] to disable music.
const musicTracks = [
    '../music/es-una-fiesta-drops-latin-house-remix-instrumental-ivy-states-musicbed.wav',
    '../music/no-estoy-pa-la-venta-instrumental-don-ryvcko-musicbed.wav',
    '../music/vamanos-instrumental-easy-mccoy-musicbed.wav'
];
const musicVolume = 1.0;   // 0..1
const musicFadeMs = 2000;  // volume fade when music starts/stops

