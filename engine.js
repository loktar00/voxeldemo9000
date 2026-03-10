// engine.js — Init, game loop, module orchestration

import { MAP_SIZE, createTerrain } from './terrain.js';
import { render, renderBirds, renderAnimals } from './renderer.js';
import { createCamera, updateCamera } from './camera.js';
import { createInputState, initInput } from './input.js';
import { createBirds, updateBirds, createAnimals, updateAnimals } from './entities.js';

const canvas = document.getElementById('voxCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const fpsEl = document.getElementById('fps');

// Screen dimensions & resolution scaling
let screenWidth, screenHeight;
let frameBuf, frameBuf8, frameBuf32, imageData;
let resolutionScale = 0.5;

function resizeCanvas() {
    screenWidth = Math.max(320, Math.round(window.innerWidth * resolutionScale));
    screenHeight = Math.max(200, Math.round(window.innerHeight * resolutionScale));
    canvas.width = screenWidth;
    canvas.height = screenHeight;

    frameBuf = new ArrayBuffer(screenWidth * screenHeight * 4);
    frameBuf8 = new Uint8ClampedArray(frameBuf);
    frameBuf32 = new Uint32Array(frameBuf);
    imageData = ctx.createImageData(screenWidth, screenHeight);
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Loading UI
const loadBar = document.getElementById('loadBar');
const loadStatus = document.getElementById('loadStatus');
const loadingScreen = document.getElementById('loading');

// Determine terrain mode from URL params
const params = new URLSearchParams(window.location.search);
const terrainMode = params.get('terrain') || 'procedural';
const seed = params.get('seed');
const mode = terrainMode === 'temple' ? 'temple' : (seed || 'random');

// --- Settings UI helpers ---

function setActive(containerId, val) {
    const buttons = document.getElementById(containerId).querySelectorAll('button');
    buttons.forEach(b => {
        b.classList.toggle('active', b.dataset.val == val);
    });
}

function setupSetting(containerId, setter) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // don't trigger pointer lock
            setter(btn.dataset.val);
            // Update active state
            container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// Generate terrain with progress
async function init() {
    const { heightMap, colorMap, grassMap } = await createTerrain(mode, (pct, msg) => {
        loadBar.style.width = pct + '%';
        loadStatus.textContent = msg;
    });

    // Hide loading screen
    loadingScreen.style.display = 'none';

    // Camera
    const camera = createCamera();

    // Position camera based on terrain mode
    if (terrainMode === 'temple') {
        camera.x = MAP_SIZE / 2;
        camera.y = MAP_SIZE + 50;
        camera.height = 200;
        camera.angle = 0;
    } else {
        camera.x = MAP_SIZE / 2;
        camera.y = MAP_SIZE / 2 + 100;
        camera.height = 250;
        camera.angle = 0;
    }

    // Birds & animals
    const birds = createBirds(camera.x, camera.y);
    const animals = createAnimals(camera.x, camera.y, heightMap);

    // Input
    const input = createInputState();

    function updateOverlaySettings() {
        setActive('detailOptions', camera.detailLevel);
        setActive('fogOptions', camera.fogLevel);
        setActive('resOptions', resolutionScale);
    }

    initInput(canvas, input, (locked) => {
        overlay.style.display = locked ? 'none' : 'flex';
        if (!locked) updateOverlaySettings();
    });

    // Wire up settings buttons
    setupSetting('detailOptions', (v) => { camera.detailLevel = parseInt(v); });
    setupSetting('fogOptions', (v) => { camera.fogLevel = parseInt(v); });
    setupSetting('resOptions', (v) => {
        resolutionScale = parseFloat(v);
        resizeCanvas();
    });

    // Set initial active states
    updateOverlaySettings();

    // Overlay click → engage pointer lock (overlay has z-index above canvas)
    overlay.addEventListener('click', () => {
        canvas.requestPointerLock();
    });

    // FPS tracking
    let frameCount = 0;
    let fpsTime = performance.now();

    // Game loop
    let lastTime = performance.now();

    function gameLoop(now) {
        const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
        lastTime = now;

        // FPS counter
        frameCount++;
        if (now - fpsTime >= 500) {
            fpsEl.textContent = (frameCount * 1000 / (now - fpsTime) | 0) + ' FPS';
            frameCount = 0;
            fpsTime = now;
        }

        updateCamera(camera, input, heightMap, dt);
        const { hiddenY, depthBuf } = render(camera, heightMap, colorMap, grassMap, frameBuf32, screenWidth, screenHeight, now);
        updateBirds(birds, camera.x, camera.y, dt);
        updateAnimals(animals, camera.x, camera.y, heightMap, dt);
        renderBirds(camera, birds, frameBuf32, screenWidth, screenHeight, depthBuf);
        renderAnimals(camera, animals, frameBuf32, screenWidth, screenHeight, depthBuf);

        imageData.data.set(frameBuf8);
        ctx.putImageData(imageData, 0, 0);

        requestAnimationFrame(gameLoop);
    }

    requestAnimationFrame(gameLoop);
}

init();
