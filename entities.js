// entities.js — Ambient birds and ground animals (deer)

import { MAP_SIZE, MAP_SHIFT, MAP_MASK, WATER_LEVEL } from './terrain.js';

// --- Shared helpers ---

function wrapCoord(v) {
    return ((v % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
}

function spawnInRadius(cx, cy, minDist, maxDist) {
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
}

function isTooFar(x, y, camX, camY, radius) {
    let dx = x - camX;
    let dy = y - camY;
    // Shortest distance on wrapping map
    if (dx > MAP_SIZE / 2) dx -= MAP_SIZE;
    else if (dx < -MAP_SIZE / 2) dx += MAP_SIZE;
    if (dy > MAP_SIZE / 2) dy -= MAP_SIZE;
    else if (dy < -MAP_SIZE / 2) dy += MAP_SIZE;
    return dx * dx + dy * dy > radius * radius * 4;
}

function moveForward(e, dt) {
    e.heading += e.turnRate * dt;
    e.x += Math.cos(e.heading) * e.speed * dt;
    e.y += Math.sin(e.heading) * e.speed * dt;
}

function wrapEntity(e) {
    e.x = wrapCoord(e.x);
    e.y = wrapCoord(e.y);
}

// --- Birds ---

const BIRD_COUNT = 30;
const FLY_HEIGHT_MIN = 200;
const FLY_HEIGHT_MAX = 350;
const BIRD_SPEED = 30;
const BIRD_TURN_SPEED = 0.3;
const BIRD_SPAWN_RADIUS = 1200;

export function createBirds(camX, camY) {
    const birds = [];
    for (let i = 0; i < BIRD_COUNT; i++) {
        const pos = spawnInRadius(camX, camY, 0, BIRD_SPAWN_RADIUS);
        birds.push({
            x: pos.x,
            y: pos.y,
            z: FLY_HEIGHT_MIN + Math.random() * (FLY_HEIGHT_MAX - FLY_HEIGHT_MIN),
            heading: Math.random() * Math.PI * 2,
            turnRate: (Math.random() - 0.5) * BIRD_TURN_SPEED,
            speed: BIRD_SPEED * (0.7 + Math.random() * 0.6),
            flapOffset: Math.random() * Math.PI * 2,
        });
    }
    return birds;
}

export function updateBirds(birds, camX, camY, dt) {
    for (let i = 0; i < birds.length; i++) {
        const b = birds[i];

        moveForward(b, dt);

        // Gentle altitude drift
        b.z += Math.sin(performance.now() * 0.0003 + b.flapOffset) * 0.05;

        // Occasionally change turn rate
        if (Math.random() < 0.005) {
            b.turnRate = (Math.random() - 0.5) * BIRD_TURN_SPEED;
        }

        // Respawn far-away birds near camera
        if (isTooFar(b.x, b.y, camX, camY, BIRD_SPAWN_RADIUS)) {
            const pos = spawnInRadius(camX, camY, BIRD_SPAWN_RADIUS * 0.5, BIRD_SPAWN_RADIUS);
            b.x = pos.x;
            b.y = pos.y;
            b.z = FLY_HEIGHT_MIN + Math.random() * (FLY_HEIGHT_MAX - FLY_HEIGHT_MIN);
            b.heading = Math.random() * Math.PI * 2;
        }

        wrapEntity(b);
    }
}

// --- Animals (deer) ---

const DEER_COUNT = 20;
const DEER_SPEED = 12;
const DEER_TURN_SPEED = 0.5;
const DEER_SPAWN_RADIUS = 600;
const DEER_HEIGHT = 8;

function spawnDeer(camX, camY, heightMap) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const pos = spawnInRadius(camX, camY, 50, DEER_SPAWN_RADIUS);
        const ix = (pos.x | 0) & MAP_MASK;
        const iy = (pos.y | 0) & MAP_MASK;
        const h = heightMap[(iy << MAP_SHIFT) | ix];
        if (h >= WATER_LEVEL + 10) {
            return {
                x: pos.x, y: pos.y,
                z: h + DEER_HEIGHT,
                heading: Math.random() * Math.PI * 2,
                turnRate: (Math.random() - 0.5) * DEER_TURN_SPEED,
                speed: DEER_SPEED * (0.6 + Math.random() * 0.8),
                animPhase: Math.random() * Math.PI * 2,
            };
        }
    }
    // Fallback
    return {
        x: camX, y: camY, z: 100,
        heading: 0, turnRate: 0, speed: DEER_SPEED,
        animPhase: 0,
    };
}

export function createAnimals(camX, camY, heightMap) {
    const animals = [];
    for (let i = 0; i < DEER_COUNT; i++) {
        animals.push(spawnDeer(camX, camY, heightMap));
    }
    return animals;
}

export function updateAnimals(animals, camX, camY, heightMap, dt) {
    for (let i = 0; i < animals.length; i++) {
        const a = animals[i];

        const prevX = a.x;
        const prevY = a.y;

        moveForward(a, dt);
        wrapEntity(a);

        // Snap to terrain
        const ix = (a.x | 0) & MAP_MASK;
        const iy = (a.y | 0) & MAP_MASK;
        const terrainH = heightMap[(iy << MAP_SHIFT) | ix];
        a.z = terrainH + DEER_HEIGHT;

        // Avoid water — revert and pick new heading
        if (terrainH < WATER_LEVEL + 5) {
            a.x = prevX;
            a.y = prevY;
            a.heading += Math.PI + (Math.random() - 0.5) * 1.0;
            const px = (a.x | 0) & MAP_MASK;
            const py = (a.y | 0) & MAP_MASK;
            a.z = heightMap[(py << MAP_SHIFT) | px] + DEER_HEIGHT;
        }

        // Occasional direction change
        if (Math.random() < dt * 0.5) {
            a.turnRate = (Math.random() - 0.5) * DEER_TURN_SPEED;
        }

        a.animPhase += dt * a.speed * 0.5;

        // Respawn if too far from camera
        if (isTooFar(a.x, a.y, camX, camY, DEER_SPAWN_RADIUS)) {
            const fresh = spawnDeer(camX, camY, heightMap);
            a.x = fresh.x; a.y = fresh.y; a.z = fresh.z;
            a.heading = fresh.heading;
        }
    }
}
