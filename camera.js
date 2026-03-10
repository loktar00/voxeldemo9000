// camera.js — Camera state and movement

import { MAP_SIZE, mapOffset, WATER_LEVEL } from './terrain.js';

export function createCamera() {
    return {
        x: 128,
        y: 300,
        height: 180,
        angle: 0,
        horizon: 60,
        distance: 1800,
        scaleHeight: 1100,
        speed: 100,        // units per second
        lookSensitivity: 0.002,
        verticalSensitivity: 0.8,
        minClearance: 15,
        // Gravity mode
        gravityMode: false,
        velocityY: 0,
        eyeHeight: 20,     // eye offset above terrain
        gravity: 300,       // units/sec²
        jumpForce: 150,     // initial upward velocity
        onGround: false,
        detailLevel: 2,     // 1=low, 2=medium, 3=high, 4=ultra
        fogLevel: 2,        // 0=off, 1=near, 2=medium, 3=far
    };
}

/**
 * Update camera based on input state and delta time
 */
export function updateCamera(camera, input, heightMap, dt) {
    const moveSpeed = camera.speed * dt;

    // Detail level (1-4)
    if (input.justPressed['Digit1']) camera.detailLevel = 1;
    if (input.justPressed['Digit2']) camera.detailLevel = 2;
    if (input.justPressed['Digit3']) camera.detailLevel = 3;
    if (input.justPressed['Digit4']) camera.detailLevel = 4;

    // Toggle gravity mode
    if (input.justPressed['KeyG']) {
        camera.gravityMode = !camera.gravityMode;
        camera.velocityY = 0;
        camera.onGround = false;
    }
    // Clear justPressed flags
    for (const k in input.justPressed) delete input.justPressed[k];

    // Mouse look
    if (input.pointerLocked) {
        camera.angle -= input.mouseDX * camera.lookSensitivity;
        camera.horizon -= input.mouseDY * camera.verticalSensitivity;
    }

    // Clamp horizon to prevent extreme pitch warping
    camera.horizon = Math.max(-200, Math.min(camera.horizon, 800));

    // Keyboard rotation (arrow keys, fallback)
    if (input.keys['ArrowLeft'])  camera.angle -= 2.0 * dt;
    if (input.keys['ArrowRight']) camera.angle += 2.0 * dt;

    // Forward/back direction
    const sinA = Math.sin(camera.angle);
    const cosA = Math.cos(camera.angle);

    // WASD + arrows — move relative to view direction
    if (input.keys['KeyW'] || input.keys['ArrowUp']) {
        camera.x -= sinA * moveSpeed;
        camera.y -= cosA * moveSpeed;
    }
    if (input.keys['KeyS'] || input.keys['ArrowDown']) {
        camera.x += sinA * moveSpeed;
        camera.y += cosA * moveSpeed;
    }
    if (input.keys['KeyA']) {
        camera.x -= cosA * moveSpeed;
        camera.y += sinA * moveSpeed;
    }
    if (input.keys['KeyD']) {
        camera.x += cosA * moveSpeed;
        camera.y -= sinA * moveSpeed;
    }

    // Wrap camera to map bounds
    camera.x = ((camera.x % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
    camera.y = ((camera.y % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;

    const terrainH = heightMap[mapOffset(camera.x | 0, camera.y | 0)];
    const surfaceH = terrainH < WATER_LEVEL ? WATER_LEVEL : terrainH;

    if (camera.gravityMode) {
        // Gravity walking mode
        const groundLevel = surfaceH + camera.eyeHeight;

        // Apply gravity
        camera.velocityY -= camera.gravity * dt;
        camera.height += camera.velocityY * dt;

        // Ground collision
        if (camera.height <= groundLevel) {
            camera.height = groundLevel;
            camera.velocityY = 0;
            camera.onGround = true;
        } else {
            camera.onGround = false;
        }

        // Jump
        if (input.keys['Space'] && camera.onGround) {
            camera.velocityY = camera.jumpForce;
            camera.onGround = false;
        }
    } else {
        // Free fly mode
        if (input.keys['Space'] || input.keys['PageUp'] || input.keys['KeyR']) {
            camera.height += moveSpeed;
        }
        if (input.keys['ShiftLeft'] || input.keys['ShiftRight'] || input.keys['PageDown'] || input.keys['KeyF']) {
            camera.height -= moveSpeed;
        }

        // Terrain collision
        const minHeight = surfaceH + camera.minClearance;
        if (camera.height < minHeight) {
            camera.height = minHeight;
        }
    }

    // Reset mouse deltas
    input.mouseDX = 0;
    input.mouseDY = 0;
}
