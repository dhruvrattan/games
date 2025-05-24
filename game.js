(function() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // --- UI Element References ---
    const scoreElement = document.getElementById('score');
    const livesElement = document.getElementById('lives');
    const weaponStatusElement = document.getElementById('weapon-status').childNodes[0]; // Get text node
    const weaponBarElement = document.getElementById('weapon-bar');
    const hyperspaceStatusElement = document.getElementById('hyperspace-status').childNodes[0];
    const hyperspaceChargesElement = document.getElementById('hyperspace-charges');
    const hyperspaceBarElement = document.getElementById('hyperspace-bar');
    const gameOverElement = document.getElementById('game-over');
    const finalScoreElement = document.getElementById('final-score');
    const restartButton = document.getElementById('restart-button');

    // --- Game Settings ---
    const GAME_CONFIG = {
        STAR_COUNT: 200,
        SHIP_SIZE: 30,
        SHIP_ACCELERATION: 0.15,
        SHIP_FRICTION: 0.98,
        SHIP_MAX_SPEED: 5,
        SHIP_TURN_SPEED: 0.08, // Radians per frame (not used as ship doesn't rotate)
        LASER_SPEED: 7,
        LASER_COOLDOWN: 200, // Milliseconds
        ASTEROID_INIT_COUNT: 5,
        ASTEROID_BASE_SPEED: 0.5,
        ASTEROID_MAX_INIT_SIZE: 60,
        ASTEROID_MIN_INIT_SIZE: 30,
        ASTEROID_SPAWN_RATE: 1500, // Milliseconds
        FRAGMENT_COUNT: 3, // Fragments per asteroid
        FRAGMENT_SPEED_MULTIPLIER: 1.5,
        FRAGMENT_SIZE_DIVISOR: 2.5,
        HYPERSPACE_CHARGES: 3,
        HYPERSPACE_COOLDOWN: 5000, // 5 seconds
        HYPERSPACE_MALFUNCTION_CHANCE: 0.15, // 15% chance
        SHIELD_POWERUP_MIN_SPAWN_INTERVAL: 15000, // 15 seconds
        SHIELD_POWERUP_MAX_SPAWN_INTERVAL: 30000, // 30 seconds
        SHIELD_POWERUP_SPEED: 2,
        SHIELD_POWERUP_SIZE: 15, // radius
        SHIELD_DURATION: 20000, // 20 seconds in milliseconds
    };

    let canvasWidth, canvasHeight;

    // --- Game State ---
    let ship;
    let stars = [];
    let asteroids = [];
    let lasers = [];
    let fragments = [];
    let score = 0;
    let lives = 3;
    let isGameOver = false;
    let keys = {}; // Keep track of pressed keys
    let gameTime = 0; // Used for difficulty scaling

    let lastLaserTime = 0;
    let lastAsteroidSpawn = 0;
    let lastHyperspaceTime = 0;
    let currentHyperspaceCharges = GAME_CONFIG.HYPERSPACE_CHARGES;
    let hyperspaceReady = true;
    let shieldPowerUps = [];
    let lastShieldPowerUpSpawnTime = 0;
    // Temporary global flag REMOVED

    // --- Utility Functions ---
    function random(min, max) {
        return Math.random() * (max - min) + min;
    }

    function distance(x1, y1, x2, y2) {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // --- Vector Math (simple) ---
    function normalizeVector(x, y) {
        const mag = Math.sqrt(x*x + y*y);
        if (mag === 0) return { x: 0, y: 0 };
        return { x: x / mag, y: y / mag };
    }

    // --- Game Object Classes ---

    class Star {
        constructor() {
            this.x = random(0, canvasWidth);
            this.y = random(0, canvasHeight);
            this.size = random(0.5, 2);
            // Deeper stars (smaller size) move slower
            this.speed = this.size * 0.2 + 0.1; // Base slow speed + size dependent speed
        }

        update() {
            this.y += this.speed;
            if (this.y > canvasHeight) {
                this.y = 0;
                this.x = random(0, canvasWidth);
            }
        }

        draw() {
            ctx.fillStyle = `rgba(255, 255, 255, ${this.size / 2})`; // Fainter for smaller/distant stars
            ctx.fillRect(this.x, this.y, this.size, this.size);
        }
    }

    // NEW CLASS HERE
    class ShieldPowerUp {
        constructor(x, y, size, speed) { // Note: x, y might be determined at spawn time, not passed directly if always random top
            this.x = x !== undefined ? x : random(0, canvasWidth); // If x is passed, use it, otherwise random
            this.y = y !== undefined ? y : -15; // Start off-screen top, assuming size is radius 15
            this.size = size !== undefined ? size : 15; // Default radius 15px
            this.speed = speed !== undefined ? speed : 2; // Default speed 2
            this.collisionRadius = this.size;
            // Color for the shield power-up
            this.color = 'aqua'; // A bright blue color
        }

        draw() {
            ctx.save();
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();

            // Optional: Add a border or an inner glow for better visibility
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        update() {
            this.y += this.speed;
        }
    }

    class Spaceship {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.width = GAME_CONFIG.SHIP_SIZE;
            this.height = GAME_CONFIG.SHIP_SIZE * 1.2; // Slightly taller
            this.vx = 0;
            this.vy = 0;
            this.angle = 0; // Always points up (0 radians)
            this.propulsionLevel = 0; // 0 to 1 for animation
            this.collisionRadius = this.width / 2.5; // Effective radius for collision
            this.invincible = false;
            this.invincibleTimer = 0;
            this.invincibleDuration = 1500; // 1.5 seconds invincibility after hit

            // New shield properties
            this.shieldActive = false;
            this.shieldTimer = 0;
        }

        update(deltaTime) {
            let accelerating = false;
            if (keys['ArrowUp'] || keys['w']) {
                this.vy -= GAME_CONFIG.SHIP_ACCELERATION;
                accelerating = true;
                this.propulsionLevel = Math.min(1, this.propulsionLevel + 0.1);
            }
            if (keys['ArrowDown'] || keys['s']) {
                this.vy += GAME_CONFIG.SHIP_ACCELERATION;
                this.propulsionLevel = Math.min(1, this.propulsionLevel + 0.05); // Smaller backward thrust visual
            }
            if (keys['ArrowLeft'] || keys['a']) {
                this.vx -= GAME_CONFIG.SHIP_ACCELERATION;
            }
            if (keys['ArrowRight'] || keys['d']) {
                this.vx += GAME_CONFIG.SHIP_ACCELERATION;
            }

            // Apply friction / deceleration
            this.vx *= GAME_CONFIG.SHIP_FRICTION;
            this.vy *= GAME_CONFIG.SHIP_FRICTION;

            // Cap speed
            const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (speed > GAME_CONFIG.SHIP_MAX_SPEED) {
                const factor = GAME_CONFIG.SHIP_MAX_SPEED / speed;
                this.vx *= factor;
                this.vy *= factor;
            }

             // Update position
            this.x += this.vx;
            this.y += this.vy;


            // Propulsion animation fade
            if (!accelerating && this.propulsionLevel > 0) {
                this.propulsionLevel = Math.max(0, this.propulsionLevel - 0.05);
            }

            // Boundary checks
            if (this.x < this.width / 2) this.x = this.width / 2;
            if (this.x > canvasWidth - this.width / 2) this.x = canvasWidth - this.width / 2;
            if (this.y < this.height / 2) this.y = this.height / 2;
            if (this.y > canvasHeight - this.height / 2) this.y = canvasHeight - this.height / 2;

            // Invincibility timer
            if (this.invincible) {
                this.invincibleTimer -= deltaTime;
                if (this.invincibleTimer <= 0) {
                    this.invincible = false;
                }
            }

            // Shield timer countdown
            if (this.shieldActive) {
                this.shieldTimer -= deltaTime;
                if (this.shieldTimer <= 0) {
                    this.shieldActive = false;
                    this.shieldTimer = 0; // Reset timer
                    // console.log("Shield deactivated"); // For debugging
                }
            }
        }

        draw() {
             if (this.invincible && Math.floor(Date.now() / 100) % 2 === 0) {
                // Blink when invincible
                return;
            }

            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle); // Angle is always 0, but keep for potential future rotation

            // Ship body (Retro-futuristic style)
            ctx.beginPath();
            ctx.moveTo(0, -this.height / 2); // Nose
            ctx.lineTo(this.width / 2.5, this.height / 3); // Right wing back point
            ctx.lineTo(this.width / 4, this.height / 2); // Right engine corner
            ctx.lineTo(-this.width / 4, this.height / 2); // Left engine corner
            ctx.lineTo(-this.width / 2.5, this.height / 3); // Left wing back point
            ctx.closePath();

            ctx.fillStyle = '#c0c0c0'; // Silver
            ctx.strokeStyle = '#ffffff'; // White outline
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();

            // Cockpit
            ctx.beginPath();
            ctx.ellipse(0, -this.height / 4, this.width / 4, this.height / 6, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#00aaff'; // Light blue
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
             ctx.lineWidth = 1;
            ctx.stroke();


            // Propulsion animation
            if (this.propulsionLevel > 0) {
                const flameLength = this.height * 0.6 * this.propulsionLevel * (0.8 + Math.random() * 0.4); // Add flicker
                const flameWidth = this.width / 3 * this.propulsionLevel * (0.9 + Math.random() * 0.2);

                // Base flame (Orange/Yellow)
                ctx.beginPath();
                ctx.moveTo(-flameWidth / 2, this.height / 2);
                ctx.lineTo(flameWidth / 2, this.height / 2);
                ctx.lineTo(0, this.height / 2 + flameLength);
                ctx.closePath();
                ctx.fillStyle = `rgba(255, ${150 + Math.random() * 50}, 0, ${0.5 + this.propulsionLevel * 0.4})`;
                ctx.fill();

                // Inner flame (Brighter Yellow/White)
                 if (flameLength > 5) {
                    ctx.beginPath();
                    ctx.moveTo(-flameWidth / 4, this.height / 2);
                    ctx.lineTo(flameWidth / 4, this.height / 2);
                    ctx.lineTo(0, this.height / 2 + flameLength * 0.6);
                    ctx.closePath();
                    ctx.fillStyle = `rgba(255, 255, ${100 + Math.random() * 100}, ${0.7 + this.propulsionLevel * 0.3})`;
                    ctx.fill();
                 }
            }

            // --- Draw Shield if Active (after other ship components) ---
            if (this.shieldActive) {
                const shieldRadius = this.height / 2 + 10; // Make it large enough to cover the ship
                ctx.beginPath();
                ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2); // x=0, y=0 because we've translated context
                ctx.fillStyle = 'rgba(0, 170, 255, 0.3)'; // Semi-transparent blue
                ctx.fill();
                ctx.strokeStyle = 'rgba(0, 200, 255, 0.7)'; // Brighter blue border
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            ctx.restore();
        }

        shoot() {
            const now = Date.now();
            if (now - lastLaserTime >= GAME_CONFIG.LASER_COOLDOWN) {
                // Create two lasers slightly offset from center for effect
                lasers.push(new Laser(this.x - this.width/5, this.y - this.height / 2));
                lasers.push(new Laser(this.x + this.width/5, this.y - this.height / 2));
                lastLaserTime = now;
                updateWeaponStatus(); // Update UI immediately
            }
        }

        takeHit() {
            if (!this.invincible) {
                lives--;
                updateUI();
                if (lives <= 0) {
                    gameOver();
                } else {
                    // Become invincible temporarily
                    this.invincible = true;
                    this.invincibleTimer = this.invincibleDuration;
                    // Optional: Add visual/audio feedback for hit
                }
            }
        }

        hyperspaceJump() {
             if (hyperspaceReady && currentHyperspaceCharges > 0) {
                currentHyperspaceCharges--;
                hyperspaceReady = false;
                lastHyperspaceTime = Date.now();
                updateHyperspaceStatus();

                const newX = random(this.width, canvasWidth - this.width);
                const newY = random(this.height, canvasHeight - this.height);

                // Malfunction check
                let malfunction = false;
                if (Math.random() < GAME_CONFIG.HYPERSPACE_MALFUNCTION_CHANCE) {
                    for (let ast of [...asteroids, ...fragments]) {
                        if (distance(newX, newY, ast.x, ast.y) < ast.radius + this.collisionRadius + 10) { // Check collision at destination
                            malfunction = true;
                            break;
                        }
                    }
                }

                this.x = newX;
                this.y = newY;
                this.vx = 0; // Stop movement after jump
                this.vy = 0;

                if (malfunction) {
                    console.warn("Hyperspace Malfunction!");
                    this.takeHit(); // Take damage immediately if malfunction places on asteroid
                }

                // Optional: Add visual effect for hyperspace entry/exit
            }
        }
    }

    class Laser {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.width = 4;
            this.height = 15;
            this.speed = GAME_CONFIG.LASER_SPEED;
            this.color = '#00ffff'; // Cyan laser
        }

        update() {
            this.y -= this.speed;
        }

        draw() {
            // Glowing effect
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;

            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - this.width / 2, this.y, this.width, this.height);

            // Reset shadow
            ctx.shadowBlur = 0;
        }
    }

    class Asteroid {
        constructor(x, y, size, speedMultiplier = 1) {
            this.x = x !== undefined ? x : random(0, canvasWidth);
            this.y = y !== undefined ? y : -GAME_CONFIG.ASTEROID_MAX_INIT_SIZE; // Start off-screen top
            this.size = size !== undefined ? size : random(GAME_CONFIG.ASTEROID_MIN_INIT_SIZE, GAME_CONFIG.ASTEROID_MAX_INIT_SIZE);
            this.radius = this.size / 2; // Approximate radius
            const angle = random(Math.PI * 0.25, Math.PI * 0.75); // Angle downwards (mostly)
            const baseSpeed = GAME_CONFIG.ASTEROID_BASE_SPEED + (gameTime / 30000); // Speed increases over time
            const speed = (random(baseSpeed * 0.8, baseSpeed * 1.2) / (this.size / GAME_CONFIG.ASTEROID_MAX_INIT_SIZE)) * speedMultiplier; // Smaller = faster base
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed;
            this.rotation = random(0, Math.PI * 2);
            this.rotationSpeed = random(-0.02, 0.02);
            this.vertices = this.generateVertices();
            this.isFragment = speedMultiplier > 1; // Identify if it's a fragment
            this.pointsValue = Math.max(10, Math.floor((GAME_CONFIG.ASTEROID_MAX_INIT_SIZE / this.size) * 20)) * (this.isFragment ? 1 : 2);
         }

        generateVertices() {
            const verts = [];
            const numVertices = Math.floor(random(7, 15));
            const angleStep = (Math.PI * 2) / numVertices;
            for (let i = 0; i < numVertices; i++) {
                const angle = i * angleStep;
                // Vary the distance from the center
                const radiusVariation = random(this.radius * 0.7, this.radius * 1.3);
                verts.push({
                    x: Math.cos(angle + this.rotation) * radiusVariation,
                    y: Math.sin(angle + this.rotation) * radiusVariation
                });
            }
            return verts;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.rotation += this.rotationSpeed;

            // Re-calculate vertex positions based on rotation for collision/drawing
             const cos = Math.cos(this.rotation);
             const sin = Math.sin(this.rotation);
             // We don't strictly need to update vertex positions here unless
             // we implement polygon collision. For radius collision, this isn't needed.
             // For drawing, we use translate/rotate.
        }

        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);

            ctx.beginPath();
            ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
            for (let i = 1; i < this.vertices.length; i++) {
                ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
            }
            ctx.closePath();

            ctx.fillStyle = this.isFragment ? '#a0a0a0' : '#8b4513'; // Lighter grey for fragments, brown for asteroids
            ctx.strokeStyle = this.isFragment ? '#cccccc' : '#a0522d'; // Lighter outlines
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        }
    }

    class Fragment extends Asteroid {
         constructor(x, y, parentSize, parentVx, parentVy) {
            const size = parentSize / GAME_CONFIG.FRAGMENT_SIZE_DIVISOR;
            super(x, y, size, GAME_CONFIG.FRAGMENT_SPEED_MULTIPLIER); // Use Asteroid constructor with smaller size and speed boost
            // Add initial outward velocity from parent explosion
            const explosionAngle = random(0, Math.PI * 2);
            const explosionSpeed = random(0.5, 1.5);
            this.vx = parentVx + Math.cos(explosionAngle) * explosionSpeed;
            this.vy = parentVy + Math.sin(explosionAngle) * explosionSpeed;
            this.isFragment = true; // Ensure it's marked as fragment
            this.pointsValue = Math.max(5, Math.floor((GAME_CONFIG.ASTEROID_MAX_INIT_SIZE / this.size) * 10));
        }
    }

    // --- Game Initialization ---
    function initStars() {
        stars = [];
        for (let i = 0; i < GAME_CONFIG.STAR_COUNT; i++) {
            stars.push(new Star());
        }
    }

    function initGame() {
        score = 0;
        lives = 3;
        gameTime = 0;
        isGameOver = false;
        asteroids = [];
        lasers = [];
        fragments = [];
        keys = {};
        lastLaserTime = 0;
        lastAsteroidSpawn = 0;
        lastHyperspaceTime = 0;
        currentHyperspaceCharges = GAME_CONFIG.HYPERSPACE_CHARGES;
        hyperspaceReady = true;
        shieldPowerUps = []; // Initialize
        lastShieldPowerUpSpawnTime = 0; // Initialize
        // shieldCurrentlyActive REMOVED


        ship = new Spaceship(canvasWidth / 2, canvasHeight - 80);

        // Initial asteroids
        for (let i = 0; i < GAME_CONFIG.ASTEROID_INIT_COUNT; i++) {
            // Ensure initial asteroids don't spawn right on top of the ship
            let asteroidX, asteroidY;
            do {
                asteroidX = random(0, canvasWidth);
                asteroidY = random(0, canvasHeight * 0.6); // Spawn in upper 60%
            } while (distance(ship.x, ship.y, asteroidX, asteroidY) < GAME_CONFIG.ASTEROID_MAX_INIT_SIZE + ship.collisionRadius + 50);
            asteroids.push(new Asteroid(asteroidX, asteroidY));
        }

        updateUI();
        updateWeaponStatus();
        updateHyperspaceStatus();
        gameOverElement.style.display = 'none'; // Hide game over screen

         // Ensure stars are initialized if canvas was resized
        if (stars.length === 0) {
            initStars();
        }
    }

    // --- Game Loop ---
    let lastTime = 0;
    function gameLoop(timestamp) {
        if (isGameOver) return;

        const deltaTime = timestamp - lastTime;
        lastTime = timestamp;
        gameTime += deltaTime;

        // --- Clear Canvas ---
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // --- Update ---
        // Stars
        stars.forEach(star => star.update());

        // Ship
        ship.update(deltaTime);

        // Lasers
        lasers.forEach(laser => laser.update());
        lasers = lasers.filter(laser => laser.y > -laser.height); // Remove off-screen lasers

        // Asteroids & Fragments
        asteroids.forEach(asteroid => asteroid.update());
        fragments.forEach(fragment => fragment.update());

        // Shield Power-Ups Update
        shieldPowerUps.forEach(powerUp => powerUp.update());

        // Remove off-screen asteroids/fragments (adjust boundaries as needed)
         asteroids = asteroids.filter(ast => ast.x > -ast.size && ast.x < canvasWidth + ast.size && ast.y < canvasHeight + ast.size && ast.y > -ast.size*3); // Give more leeway for top entry
         fragments = fragments.filter(frag => frag.x > -frag.size && frag.x < canvasWidth + frag.size && frag.y < canvasHeight + frag.size && frag.y > -frag.size);
        
        // Filter off-screen Shield Power-Ups
        shieldPowerUps = shieldPowerUps.filter(p => p.y - p.size < canvasHeight);


        // --- Spawning ---
        spawnAsteroid();
        spawnShieldPowerUp(); // Call the new spawn function

        // --- Handle Input ---
        handleInput(); // Process continuous movement

        // --- Collision Detection ---
        checkCollisions();

        // --- Draw ---
        // Stars (draw first - background)
        stars.forEach(star => star.draw());

        // Lasers
        lasers.forEach(laser => laser.draw());

        // Asteroids & Fragments
        asteroids.forEach(asteroid => asteroid.draw());
        fragments.forEach(fragment => fragment.draw());

        // Shield Power-Ups Draw
        shieldPowerUps.forEach(powerUp => powerUp.draw());

        // Ship (draw last - foreground)
        ship.draw();


        // --- Update UI elements not on canvas ---
        updateWeaponStatus(); // No more timestamp
        updateHyperspaceStatus(); // No more timestamp


        // --- Request Next Frame ---
        requestAnimationFrame(gameLoop);
    }

    // --- Input Handling ---
    function handleKeyDown(e) {
        keys[e.key] = true;
         // Handle single press actions
         if (e.key === ' ' || e.key === 'Spacebar') {
             e.preventDefault(); // Prevent page scrolling
             ship.shoot();
         }
         if (e.key === 'h' || e.key === 'H') {
             ship.hyperspaceJump();
         }
    }

    function handleKeyUp(e) {
        keys[e.key] = false;
    }

    function handleInput() {
       // Continuous actions (movement) are handled directly in ship.update based on 'keys' object
       // Single press actions (shoot, hyperspace) are handled in handleKeyDown
    }

    // --- Spawning ---
    function spawnAsteroid() {
         const now = Date.now();
         const spawnInterval = Math.max(300, GAME_CONFIG.ASTEROID_SPAWN_RATE - (gameTime / 100)); // Decrease interval over time, minimum 300ms
         if (now - lastAsteroidSpawn > spawnInterval) {
             lastAsteroidSpawn = now;
             // Adjust size/speed potential based on game time
             const sizeMultiplier = 1 + Math.min(1.5, gameTime / 60000); // Max size increases slightly
             const speedMultiplier = 1 + Math.min(2, gameTime / 40000); // Max speed increases more significantly
             const size = random(GAME_CONFIG.ASTEROID_MIN_INIT_SIZE * 0.8, GAME_CONFIG.ASTEROID_MAX_INIT_SIZE * sizeMultiplier);
             asteroids.push(new Asteroid(undefined, undefined, size, speedMultiplier));
         }
    }

    function spawnShieldPowerUp() {
        const now = Date.now(); // Or use gameTime if more appropriate for consistency

        // Use ship.shieldActive instead of the temporary variable
        if (ship && ship.shieldActive) { // Check if ship exists and shield is active
            return;
        }

        const randomInterval = random(GAME_CONFIG.SHIELD_POWERUP_MIN_SPAWN_INTERVAL, GAME_CONFIG.SHIELD_POWERUP_MAX_SPAWN_INTERVAL);

        if (now - lastShieldPowerUpSpawnTime > randomInterval) {
            const newPowerUpX = random(0, canvasWidth);
            // Assuming ShieldPowerUp constructor handles default y, size, speed if not provided,
            // or pass them explicitly using GAME_CONFIG values.
            shieldPowerUps.push(new ShieldPowerUp(newPowerUpX, -GAME_CONFIG.SHIELD_POWERUP_SIZE, GAME_CONFIG.SHIELD_POWERUP_SIZE, GAME_CONFIG.SHIELD_POWERUP_SPEED));
            lastShieldPowerUpSpawnTime = now;
        }
    }

    // --- Collision Detection ---
    function checkCollisions() {
        // Laser vs Asteroids/Fragments
        for (let i = lasers.length - 1; i >= 0; i--) {
            const laser = lasers[i];
            let laserHit = false;

            // Check vs Asteroids
            for (let j = asteroids.length - 1; j >= 0; j--) {
                const asteroid = asteroids[j];
                if (distance(laser.x, laser.y, asteroid.x, asteroid.y) < asteroid.radius + laser.width) { // Simple radius check
                    destroyAsteroid(asteroid, j);
                    laserHit = true;
                    break; // Laser hits one asteroid max
                }
            }

            // Check vs Fragments (if laser didn't hit a main asteroid)
            if (!laserHit) {
                for (let k = fragments.length - 1; k >= 0; k--) {
                    const fragment = fragments[k];
                     if (distance(laser.x, laser.y, fragment.x, fragment.y) < fragment.radius + laser.width) {
                        fragments.splice(k, 1); // Remove fragment
                        score += fragment.pointsValue;
                        updateUI();
                        laserHit = true;
                        break; // Laser hits one fragment max
                    }
                }
            }

            if (laserHit) {
                lasers.splice(i, 1); // Remove laser after hit
            }
        }

        // Ship vs Asteroids/Fragments
        // Check vs Asteroids
        if (ship) { // Ensure ship exists before checking its properties
            for (let j = asteroids.length - 1; j >= 0; j--) {
                const asteroid = asteroids[j];
                if (distance(ship.x, ship.y, asteroid.x, asteroid.y) < asteroid.radius + ship.collisionRadius) {
                    if (ship.shieldActive) {
                        destroyAsteroid(asteroid, j); // Destroy asteroid, shield absorbs hit
                        // console.log("Shield absorbed asteroid hit!"); // For debugging
                        if (isGameOver) return; // destroyAsteroid might lead to score that could end game
                        break; // Process one collision
                    } else {
                        // Shield is not active, proceed with normal damage mechanism
                        if (!ship.invincible) {
                            ship.takeHit();
                            destroyAsteroid(asteroid, j); // Asteroid is destroyed even on normal hit
                            if (isGameOver) return;
                            break;
                        }
                    }
                }
            }

            // Check vs Fragments
            // The shield or invincibility status could have changed from an asteroid collision,
            // so we re-evaluate conditions.
            for (let k = fragments.length - 1; k >= 0; k--) {
                const fragment = fragments[k];
                if (distance(ship.x, ship.y, fragment.x, fragment.y) < fragment.radius + ship.collisionRadius) {
                    if (ship.shieldActive) {
                        fragments.splice(k, 1); // Destroy fragment, shield absorbs hit
                        // console.log("Shield absorbed fragment hit!"); // For debugging
                        break; // Process one collision
                    } else {
                        // Shield is not active, proceed with normal damage mechanism
                        if (!ship.invincible) { // This check is important
                            ship.takeHit();
                            fragments.splice(k, 1);
                            if (isGameOver) return;
                            break;
                        }
                    }
                }
            }
        }

        // --- Ship vs Shield Power-Ups ---
        // Iterate backwards if modifying the array by splicing
        if (ship) { // Ensure ship exists
            for (let i = shieldPowerUps.length - 1; i >= 0; i--) {
                const powerUp = shieldPowerUps[i];
                if (distance(ship.x, ship.y, powerUp.x, powerUp.y) < ship.collisionRadius + powerUp.collisionRadius) {
                    ship.shieldActive = true;
                    ship.shieldTimer = GAME_CONFIG.SHIELD_DURATION;
                    shieldPowerUps.splice(i, 1); // Remove the collected power-up

                    // Optional: Add sound effect for power-up collection here
                    // console.log("Shield Activated!"); // For debugging

                    break; // Ship collects one power-up at a time
                }
            }
        }
    }

    function destroyAsteroid(asteroid, index) {
        score += asteroid.pointsValue;
        updateUI();

        // Create fragments
        if (asteroid.size > GAME_CONFIG.ASTEROID_MIN_INIT_SIZE / 1.5) { // Don't create fragments from very small asteroids
             for (let i = 0; i < GAME_CONFIG.FRAGMENT_COUNT; i++) {
                 fragments.push(new Fragment(asteroid.x, asteroid.y, asteroid.size, asteroid.vx, asteroid.vy));
             }
        }

        asteroids.splice(index, 1); // Remove original asteroid
    }


    // --- UI Updates ---
    function updateUI() {
        scoreElement.textContent = `Score: ${score}`;
        livesElement.textContent = `Lives: ${'❤️'.repeat(lives)}`; // Simple heart representation
    }

     function updateWeaponStatus(timestamp = Date.now()) {
         const timeSinceLastShot = timestamp - lastLaserTime;
         if (timeSinceLastShot >= GAME_CONFIG.LASER_COOLDOWN) {
             weaponStatusElement.textContent = "Weapon: Ready ";
             weaponBarElement.style.width = '100%';
         } else {
             const cooldownProgress = Math.min(1, timeSinceLastShot / GAME_CONFIG.LASER_COOLDOWN);
             weaponStatusElement.textContent = "Weapon: Charging ";
             weaponBarElement.style.width = `${cooldownProgress * 100}%`;
         }
     }

    function updateHyperspaceStatus() { // Removed timestamp parameter
         const now = Date.now(); // Get current time using Date.now()
         const timeSinceLastJump = now - lastHyperspaceTime;

        if (!hyperspaceReady && currentHyperspaceCharges > 0 && timeSinceLastJump >= GAME_CONFIG.HYPERSPACE_COOLDOWN) {
             hyperspaceReady = true;
        }
         if (!hyperspaceReady && timeSinceLastJump >= GAME_CONFIG.HYPERSPACE_COOLDOWN) {
             hyperspaceReady = true;
         }


         let statusText = "Hyperspace (H): ";
         let barPercentage = 0;

         if (currentHyperspaceCharges > 0) {
             if (hyperspaceReady) {
                 statusText += "Ready ";
                 barPercentage = 100;
             } else { // Still cooling down from a previous jump (and has charges)
                 statusText += "Charging ";
                 barPercentage = Math.min(100, (timeSinceLastJump / GAME_CONFIG.HYPERSPACE_COOLDOWN) * 100);
             }
         } else { // 0 charges left
             if (!hyperspaceReady && timeSinceLastJump < GAME_CONFIG.HYPERSPACE_COOLDOWN) {
                 statusText += "Charging "; // Visually show cooldown of last jump
                  barPercentage = Math.min(100, (timeSinceLastJump / GAME_CONFIG.HYPERSPACE_COOLDOWN) * 100);
             } else {
                 statusText += "Depleted ";
                  barPercentage = 0;
             }
         }

         hyperspaceStatusElement.textContent = statusText;
         hyperspaceChargesElement.textContent = `(${'⚡'.repeat(currentHyperspaceCharges)}${'-'.repeat(GAME_CONFIG.HYPERSPACE_CHARGES - currentHyperspaceCharges)})`;
         hyperspaceBarElement.style.width = `${barPercentage}%`;
         hyperspaceBarElement.style.backgroundColor = hyperspaceReady && currentHyperspaceCharges > 0 ? '#0af' : '#aa0';
    }

    // --- Game State Management ---
    function gameOver() {
        isGameOver = true;
        finalScoreElement.textContent = `Final Score: ${score}`;
        gameOverElement.style.display = 'block';
         ship.vx = 0;
         ship.vy = 0;
    }

    function restartGame() {
        initGame();
        requestAnimationFrame(gameLoop); // Start the loop again
    }

    // --- Window Resizing ---
    function resizeCanvas() {
        canvasWidth = Math.min(window.innerWidth - 30, 1200); // Max width 1200
        canvasHeight = Math.min(window.innerHeight - 30, 800); // Max height 800
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        initStars();

        if (ship) {
            ship.x = Math.max(ship.width / 2, Math.min(canvasWidth - ship.width / 2, ship.x));
            ship.y = Math.max(ship.height / 2, Math.min(canvasHeight - ship.height / 2, ship.y));
        }
    }

    // --- Event Listeners ---
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', resizeCanvas);
    restartButton.addEventListener('click', restartGame);

    // --- Initial Setup ---
    resizeCanvas(); 
    initGame();     
    requestAnimationFrame(gameLoop);

})();
