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





