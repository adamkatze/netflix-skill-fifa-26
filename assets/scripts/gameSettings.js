//------------------------------Game Settings------------------------------------
const gameWidth = 1920          
const gameHeight = 1080
const gameOrientation = 'portrait'
const gameAspectRatio = '16x9'

const gameScale = 0.3


const showInstructionsScreen = true
const instructionsScreenTimeout = 5000

const gameLength = 12000;

// Length of the intro "flyover" animation that plays before the timer starts.
// Adjust once we know the real animation length. The server is authoritative.
const flyoverLength = 10000;


//------------------------------Display Wall Settings-----------------------------
// Full dimensions of the physical wall panel, in px.
const wallWidth = 6240
const wallHeight = 2080

// The region of the wall the game UI occupies. It is aligned to the RIGHT edge
// of the wall; the remaining width to the left is left empty for now.
const gameAreaWidth = 2496
const gameAreaHeight = 2080

var depthSettings = {
    bg_sub: 10,
    bg : 20,
    enemies: 30,
    player : 40,
    explosions: 45,
    ui : 50,
    overlay: 60,
}



//--------------End of Game Options-------------------



//--------------------------------------Global Variables-------------------------------------------------------
//------------------Do not change these--------------------------------
var game
var gameTick
var now

var currentGameScreen = 'loading'
var gameOver = true
var startTime

gameStart = false





