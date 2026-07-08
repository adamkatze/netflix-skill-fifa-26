//------------------------------ Display Wall Background Videos -----------------
// File paths for the fullscreen background video shown behind the UI on the
// display wall, one per game state. Paths are relative to the wall page
// (assets/html/game.html) — e.g. '../videos/idle.mp4' -> assets/videos/idle.mp4
//
// Leave a value as '' (empty) to keep whatever video is already playing for
// that state — e.g. by default "gameover" simply keeps the idle/gameplay
// background until the round resets.

const wallVideos = {
    idle:     '../videos/idle.mov',
    flyover:  '../videos/flyover.mov',
    playing:  '../videos/gameplay.mov',
    gameover: ''
};
