


var config = {
    type: Phaser.AUTO,
    transparent: true,
    parent: 'gameContainer',
    scale: {
        mode: Phaser.Scale.NONE, // Let us handle scaling
        autoCenter: Phaser.Scale.NO_CENTER, // We'll center manually
        width: gameWidth,
        height: gameHeight,       
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            fps: 60 
        },
    },
    fps: { 
        max: 60,
        min: 20,
        target: 60,
    },
    dom: {
        createContainer: true
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};



//--------------------------------------Game Functions-------------------------------------------------------
function initGame() {
    game = new Phaser.Game(config);
    window.game = game;
}

function preload () {
    scene = this;
    gameW = scene.game.renderer.width
    gameH = scene.game.renderer.height       

    //this.load.image('player01', '../images/__icon_ship_01.png');
    
}

function create () {
    scene.DEPTH = depthSettings

    //currentGameScreen = 'loaded'

    if (gameStart) {
        drawGame()
    }

}


//----------------------------------------------------Update -------------------------------------------------
function update (time, delta) {
    now = this.time.now; // Current time in ms

    gameTick++
    if (gameTick > 100) {
      gameTick = 0
    }    

    //Update the game elements while game is active
    if (  gameOver == false) {
       updateTimer() 
    }

}




//--------------------------------------Update Timer----------------------------------------
function updateTimer() {   

  //Elapsed time since game start in ms 
  let curT = new Date();
  let ms = curT.getTime() -  startTime.getTime()
  let dur =  ms / 1000



  //Format elapsed time for display
  let minutes = Math.floor(dur / 60);
  let seconds = Math.floor(dur) - (60 * minutes);

  let timeDisplay = minutes + ':'
  timeDisplay += (seconds < 10) ? '0' + seconds : seconds


  //Format for remaining time
  let totalSeconds = gameLength / 1000
  let remainingSeconds = (totalSeconds - dur) + 1

  let remMinutes = Math.floor(remainingSeconds / 60);
  let remSeconds = Math.floor(remainingSeconds) - (60 * remMinutes);

  //let remTimeDisplay = remMinutes + ':'
  let remTimeDisplay = (remMinutes < 10) ? '0' + remMinutes + ':' : remMinutes + ':'
  remTimeDisplay += (remSeconds < 10) ? '0' + remSeconds : remSeconds



  //timerText.setText(remTimeDisplay)

 
  if ( ms > gameLength ) {
    drawGameOver()
  } 
}


//-----------------------------------------------------------------------------------------------------
function drawGame() {

    startTime = new Date()
   
    //Init groups for game objects
    //scene.playerGroup = scene.physics.add.group();

    currentGameScreen = 'game'
    gameOver = false

    //handle key inputs
    cursors = scene.input.keyboard.createCursorKeys();
    

}  




function drawGameOver() {
    gameOver = true   
    showGameOver()    
}



//-----------------------------------------------------------------------------------------------------
//--------------Input Functions------------------------------------------------------------------------
//-----------------------------------------------------------------------------------------------------
function handleInput() {

}




function getChildById(group,id) {
    return group.getChildren().find(child => child.id === id);
}


function groupLength(group) {
    return scene[group].children.entries.length
}


















 //-----------End of Game Scenario Animations-----------------------------------

function showAIBombCountdown() {

   $('.aibombCountdown').addClass('animIn greenFlash')

   let count = aibombCountdownTime / 1000

   $('.aibombCountdown').html(`Gemini Investigative Assistant activating in ${count} seconds`)

   let aibombCountdownTimer = setInterval(function() {
      count = count - 1
      $('.aibombCountdown').html(`Gemini Investigative Assistant activating in ${count} seconds`)
      
      if (count < 0) {
         clearInterval(aibombCountdownTimer)
         sfx_gemini_activated.play()
         $('.aibombCountdown').html(`Gemini Investigative Assistant activated`)
         $('.aibombCountdown').removeClass('greenFlash')

         launchAIBomb()
      }

      
   }, 1000)

}




function launchAIBomb() {   
    
    //Create the ai scanner
    let aiScanner = scene.physics.add.image(gameWidth / 2, gameHeight + 100, 'aiscanner').setDepth(scene.DEPTH.player);   
        aiScanner.setScale(gameScale)

    scene.gameOverObjectGroup.add(aiScanner)

    //Create an enemy group that excludes some enemies that wont die
    let bombTargets = scene.enemyGroup.getChildren().slice(); // clone array
    Phaser.Utils.Array.Shuffle(bombTargets);
    
    // Move the rest to another group
    let move = bombTargets.slice(4);
    move.forEach(enemy => {
        scene.enemyBombTargetGroup.add(enemy);
    });

    //Animate the ai scanner to center of screen
    scene.physics.moveTo(aiScanner, gameWidth / 2, gameHeight / 2, 0, aibombAnimTime);

    scene.time.delayedCall(aibombAnimTime, () => {
        aiScanner.setVelocity(0,0)

        sfx_gemini_explosion.play()

        //Make a shockwave expand out from the scanner that destroys enemies
        const ring = scene.physics.add.sprite(aiScanner.x, aiScanner.y, 'aiscanner-circle');
        ring.setScale(0.01); // Start tiny
        ring.setAlpha(0.5);  // Optional: make it semi-transparent
        ring.body.setCircle(ring.width / 2); 
        ring.body.setAllowGravity(false);    
        ring.body.setImmovable(true);        


        scene.physics.add.overlap(ring, scene.enemyBombTargetGroup, (ring, enemy) => {
            explode(enemy.x, enemy.y, true)
            enemy.destroy(); 
        });

        //Animate the ring expansion
        scene.tweens.add({
            targets: ring,
            scaleX: 14,
            scaleY: 14,
            duration: 1400,
            ease: 'Sine.easeIn',
            onUpdate: () => {
                ring.body.setCircle(
                    (ring.width * ring.scaleX) / 2,
                    -(ring.width * ring.scaleX) / 2,
                    -(ring.height * ring.scaleY) / 2
                );
            },
            onComplete: () => {
                scene.tweens.add({
                    targets: ring,
                    scaleX: 16,
                    scaleY: 16,
                    alpha: 0,
                    duration: 200,
                    ease: 'Linear',
                    onUpdate: () => {
                        ring.body.setCircle(
                            (ring.width * ring.scaleX) / 2,
                            -(ring.width * ring.scaleX) / 2,
                            -(ring.height * ring.scaleY) / 2
                        );
                    },
                    onComplete: () => {
                        ring.destroy(); // Remove ring after expansion

                        $('.aibombCountdown').html(`Gemini Investigative Assistant<br>neutralized the majority of threats`)

                        if (endless || gameOver) {
                            showGameOver()
                        } else {
                            scene.tweens.add({
                                targets: aiScanner,
                                alpha: 0,
                                duration: 500,
                                ease: 'Sine.easeIn',                               
                                onComplete: () => {
                                    aiScanner.destroy()
                                }
                            })                            
                            reenableControl()
                        }
                        
                    }
                });
            }
        });
    });
}

