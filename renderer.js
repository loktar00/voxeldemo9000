// renderer.js — Voxel Space render core

import { MAP_SHIFT, MAP_MASK, WATER_LEVEL, ihash } from './terrain.js';

const WATER_RIPPLE_AMP = 1.5;
const WATER_RIPPLE_FREQ = 0.02;
const WATER_RIPPLE_SPEED = 0.001;
const WATER_COLOR_R = 15;
const WATER_COLOR_G = 35;
const WATER_COLOR_B = 70;

// Day/night cycle
const DAY_CYCLE_MS = 120000; // full cycle in ms (2 minutes)
const DAY_SKY_R = 0x60, DAY_SKY_G = 0x88, DAY_SKY_B = 0xB0;
const NIGHT_SKY_R = 0x08, NIGHT_SKY_G = 0x0A, NIGHT_SKY_B = 0x20;
const NIGHT_BRIGHTNESS = 0.12;

// Per-frame state
let curFogR = DAY_SKY_R, curFogG = DAY_SKY_G, curFogB = DAY_SKY_B;
let curSunlight = 1.0;
let fogStart = 0.6, fogScale = 2.5; // fog blend parameters

// Cached per-frame buffers (avoid GC pressure from per-frame allocation)
let _depthBuf = null, _hiddenY = null, _prevW = 0, _prevH = 0;

// Cached per-frame camera decomposition (set in render, used by renderBillboards)
let frameSinA = 0, frameCosA = 0, frameScaleH = 0, frameAspect = 1, frameHorizon = 0;

// Stars — billboard positions on a sky dome, generated once
const STAR_COUNT = 2500;
const STAR_DOME_RADIUS = 5000;
let starDome = null; // [dx, dy, dz, brightness] per star — offsets from camera

function generateStars() {
    starDome = new Float64Array(STAR_COUNT * 4);
    for (let i = 0; i < STAR_COUNT; i++) {
        const idx = i * 4;
        const az = Math.random() * Math.PI * 2;
        // Elevation angle from horizon (0) to zenith (PI/2)
        // Bias toward higher elevations for even sky coverage
        const elevAngle = Math.acos(1 - Math.random()) * 0.9; // 0 to ~PI/2
        // Place on hemisphere using spherical coords
        const r = STAR_DOME_RADIUS * Math.cos(elevAngle);
        starDome[idx]     = Math.cos(az) * r;
        starDome[idx + 1] = Math.sin(az) * r;
        starDome[idx + 2] = STAR_DOME_RADIUS * Math.sin(elevAngle);
        starDome[idx + 3] = 0.3 + Math.random() * 0.7;
    }
}

/**
 * Project a world-space point to screen coordinates using the voxel space projection.
 *
 * The terrain frustum at depth z spans lateral [-z, +z] mapped to [0, screenWidth].
 * Camera forward: (-sinA, -cosA), Camera right: (cosA, -sinA)
 *
 * Returns null if behind camera or off screen, otherwise {sx, sy, depth, pixelScale}
 * where pixelScale = screenWidth / (2 * depth) (world units → screen pixels).
 */
function projectPoint(wx, wy, wz, camera, screenWidth, screenHeight) {
    const rx = wx - camera.x;
    const ry = wy - camera.y;

    const depth = -rx * frameSinA - ry * frameCosA;
    if (depth < 1) return null;

    const lateral = rx * frameCosA - ry * frameSinA;
    const sx = ((lateral / (depth * frameAspect) + 1) * 0.5 * screenWidth) | 0;

    const invz = frameScaleH / depth;
    const sy = ((camera.height - wz) * invz + frameHorizon) | 0;

    // No screen bounds culling here — let callers clip per-pixel
    return { sx, sy, depth, pixelScale: screenWidth / (2 * depth * frameAspect) };
}

export function render(camera, heightMap, colorMap, grassMap, frameBuf32, screenWidth, screenHeight, time) {
    // Reuse buffers across frames (avoid GC pressure from 8MB+ allocs)
    if (screenWidth !== _prevW || screenHeight !== _prevH) {
        _depthBuf = new Float32Array(screenWidth * screenHeight);
        _hiddenY = new Int32Array(screenWidth);
        _prevW = screenWidth;
        _prevH = screenHeight;
    }
    const depthBuf = _depthBuf;
    const hiddenY = _hiddenY;
    depthBuf.fill(Infinity);
    hiddenY.fill(screenHeight);

    const sinAngle = Math.sin(camera.angle);
    const cosAngle = Math.cos(camera.angle);
    // Resolution-independent scaling: normalize to a 540px reference height
    const vScale = screenHeight / 540;
    const scaleHeight = (camera.scaleHeight || 1100) * vScale;
    const pixelHorizon = camera.horizon * vScale;

    // Aspect-ratio-dependent horizontal FOV (wider screens see more of the world)
    const fovScale = (screenWidth / screenHeight) / (16 / 9);

    // Cache for billboard rendering
    frameSinA = sinAngle;
    frameCosA = cosAngle;
    frameScaleH = scaleHeight;
    frameAspect = fovScale;
    frameHorizon = pixelHorizon;

    // Fog level: 0=off, 1=near, 2=medium, 3=far
    const fl = camera.fogLevel !== undefined ? camera.fogLevel : 2;
    if (fl === 0)      { fogStart = 2.0; fogScale = 1.0; }  // never triggers (fogFactor <= 1)
    else if (fl === 1) { fogStart = 0.3; fogScale = 1.0 / 0.7; }
    else if (fl === 2) { fogStart = 0.6; fogScale = 2.5; }
    else               { fogStart = 0.8; fogScale = 5.0; }

    // Day/night cycle: sine wave, 0=midnight, 1=noon
    const dayPhase = (Math.sin(time * Math.PI * 2 / DAY_CYCLE_MS + Math.PI / 2) + 1) * 0.5;
    curSunlight = NIGHT_BRIGHTNESS + dayPhase * (1.0 - NIGHT_BRIGHTNESS);
    curFogR = (NIGHT_SKY_R + dayPhase * (DAY_SKY_R - NIGHT_SKY_R)) | 0;
    curFogG = (NIGHT_SKY_G + dayPhase * (DAY_SKY_G - NIGHT_SKY_G)) | 0;
    curFogB = (NIGHT_SKY_B + dayPhase * (DAY_SKY_B - NIGHT_SKY_B)) | 0;
    const skyColor = 0xFF000000 | (curFogB << 16) | (curFogG << 8) | curFogR;

    frameBuf32.fill(skyColor);

    // Detail presets
    const detail = camera.detailLevel || 2;
    const dzStart  = detail === 1 ? 2.0  : detail === 2 ? 1.0  : detail === 3 ? 0.5 : 0.15;
    const dzGrowth = detail === 1 ? 0.015 : detail === 2 ? 0.005 : detail === 3 ? 0.002 : 0.0005;

    let dz = dzStart;
    let z = dzStart;
    const maxDist = camera.distance || 400;
    const grassDist = maxDist;

    while (z < maxDist) {
        const lateralZ = z * fovScale;
        let plx = -cosAngle * lateralZ - sinAngle * z + camera.x;
        let ply =  sinAngle * lateralZ - cosAngle * z + camera.y;
        const prx =  cosAngle * lateralZ - sinAngle * z + camera.x;
        const pry = -sinAngle * lateralZ - cosAngle * z + camera.y;

        const dx = (prx - plx) / screenWidth;
        const dy = (pry - ply) / screenWidth;

        const invz = 1.0 / z * scaleHeight;
        const showGrass = z < grassDist;

        for (let i = 0; i < screenWidth; i++) {
            const mapX = plx | 0;
            const mapY = ply | 0;
            const offset = ((mapY & MAP_MASK) << MAP_SHIFT) | (mapX & MAP_MASK);

            const rawHeight = heightMap[offset];
            const isWater = rawHeight < WATER_LEVEL;

            let terrainHeight, color;

            if (isWater) {
                const ripple = Math.sin(mapX * WATER_RIPPLE_FREQ + time * WATER_RIPPLE_SPEED)
                             * Math.sin(mapY * WATER_RIPPLE_FREQ * 0.7 + time * WATER_RIPPLE_SPEED * 1.3);
                terrainHeight = WATER_LEVEL + ripple * WATER_RIPPLE_AMP;

                const shimmer = Math.sin(mapX * 0.03 + time * 0.0008)
                              * Math.cos(mapY * 0.025 + time * 0.0012) * 15;
                let wr = WATER_COLOR_R + shimmer * 0.4;
                let wg = WATER_COLOR_G + shimmer * 0.7;
                let wb = WATER_COLOR_B + shimmer;
                if (wr < 0) wr = 0; else if (wr > 255) wr = 255;
                if (wg < 0) wg = 0; else if (wg > 255) wg = 255;
                if (wb < 0) wb = 0; else if (wb > 255) wb = 255;
                color = 0xFF000000 | ((wb & 0xFF) << 16) | ((wg & 0xFF) << 8) | (wr & 0xFF);
            } else {
                const grassHeight = showGrass ? grassMap[offset] : 0;
                terrainHeight = rawHeight + grassHeight;
                color = colorMap[offset];
            }

            const screenY = ((camera.height - terrainHeight) * invz + pixelHorizon) | 0;

            if (screenY < hiddenY[i]) {
                const yStart = Math.max(screenY, 0);
                const yEnd = hiddenY[i];

                color = tintSunlight(color, curSunlight);

                const fogFactor = z / maxDist;
                let foggedColor;
                if (fogFactor > fogStart) {
                    foggedColor = blendFog(color, fogFactor);
                } else {
                    foggedColor = color;
                }

                if (!isWater && showGrass && grassMap[offset] > 0 && yStart < yEnd) {
                    const grassHeight = grassMap[offset];
                    const grassTipY = ((camera.height - rawHeight - grassHeight) * invz + pixelHorizon) | 0;
                    const grassBaseY = ((camera.height - rawHeight) * invz + pixelHorizon) | 0;
                    const tipStart = Math.max(grassTipY, yStart);
                    const tipEnd = Math.min(grassBaseY, yEnd);

                    const bh = ihash(mapX, mapY);
                    const shift = ((bh >>> 16) & 31) - 15;
                    const tipColor = shiftChannels(color, shift, shift, shift);
                    const foggedTip = fogFactor > fogStart ? blendFog(tipColor, fogFactor) : tipColor;

                    for (let y = tipStart; y < tipEnd; y++) {
                        const pix = y * screenWidth + i;
                        frameBuf32[pix] = foggedTip;
                        depthBuf[pix] = z;
                    }
                    for (let y = tipEnd; y < yEnd; y++) {
                        const pix = y * screenWidth + i;
                        frameBuf32[pix] = foggedColor;
                        depthBuf[pix] = z;
                    }
                } else {
                    for (let y = yStart; y < yEnd; y++) {
                        const pix = y * screenWidth + i;
                        frameBuf32[pix] = foggedColor;
                        depthBuf[pix] = z;
                    }
                }

                hiddenY[i] = screenY;
            }

            plx += dx;
            ply += dy;
        }

        z += dz;
        dz += dzGrowth;
    }

    // Stars — billboard sprites on a dome that follows the camera
    const starAlpha = 1.0 - Math.min(1.0, curSunlight * 2.0);
    if (starAlpha > 0.01) {
        if (!starDome) generateStars();
        const now = performance.now();

        for (let s = 0; s < STAR_COUNT; s++) {
            const idx = s * 4;
            // Star position = camera + fixed dome offset
            const wx = camera.x + starDome[idx];
            const wy = camera.y + starDome[idx + 1];
            const wz = camera.height + starDome[idx + 2];

            const p = projectPoint(wx, wy, wz, camera, screenWidth, screenHeight);
            if (!p) continue;
            if (p.sx < 0 || p.sx >= screenWidth || p.sy < 0 || p.sy >= screenHeight) continue;
            if (p.sy >= hiddenY[p.sx]) continue;

            const twinkle = 0.7 + 0.3 * Math.sin(now * 0.003 + s * 1.7);
            const bright = (starDome[idx + 3] * starAlpha * twinkle * 255) | 0;
            frameBuf32[p.sy * screenWidth + p.sx] = 0xFF000000 | (bright << 16) | (bright << 8) | bright;
        }
    }

    return { hiddenY, depthBuf };
}

/** Shift RGB channels independently, clamped to 0-255 */
function shiftChannels(color, rAmt, gAmt, bAmt) {
    let r = (color & 0xFF) + rAmt;
    let g = ((color >> 8) & 0xFF) + gAmt;
    let b = ((color >> 16) & 0xFF) + bAmt;
    if (r < 0) r = 0; else if (r > 255) r = 255;
    if (g < 0) g = 0; else if (g > 255) g = 255;
    if (b < 0) b = 0; else if (b > 255) b = 255;
    return 0xFF000000 | (b << 16) | (g << 8) | r;
}

/**
 * Render billboard sprites after terrain.
 * Uses projectPoint() — same projection as terrain.
 */
const BIRD_WINGSPAN = 3; // world units

/** Check if a sprite pixel is visible (not occluded by closer terrain) */
function spriteVisible(sx, sy, spriteDepth, screenWidth, screenHeight, depthBuf) {
    if (sx < 0 || sx >= screenWidth || sy < 0 || sy >= screenHeight) return false;
    return spriteDepth < depthBuf[sy * screenWidth + sx];
}

export function renderBirds(camera, birds, frameBuf32, screenWidth, screenHeight, depthBuf) {
    const maxDist = camera.distance || 400;

    for (let b = 0; b < birds.length; b++) {
        const bird = birds[b];

        const p = projectPoint(bird.x, bird.y, bird.z, camera, screenWidth, screenHeight);
        if (!p) continue;
        if (p.depth > maxDist) continue;

        const screenX = p.sx;
        const screenY = p.sy;
        const d = p.depth;

        // Wingspan in screen pixels
        const size = Math.max(2, Math.min(20, (BIRD_WINGSPAN * p.pixelScale) | 0));

        // Wing flap
        const flapPhase = Math.sin(bird.flapOffset + performance.now() * 0.008);
        const wingDip = (flapPhase * size * 0.6) | 0;

        // Color
        const fogFactor = d / maxDist;
        let birdColor = tintSunlight(0xFFEBE6E6, curSunlight);
        if (fogFactor > fogStart) {
            birdColor = blendFog(birdColor, fogFactor);
        }

        // Body
        const bodyThick = size > 6 ? 2 : 1;
        for (let t = 0; t < bodyThick; t++) {
            const by = screenY - t;
            if (spriteVisible(screenX, by, d, screenWidth, screenHeight, depthBuf)) {
                frameBuf32[by * screenWidth + screenX] = birdColor;
            }
        }

        // Wings — V-shape
        for (let w = 1; w <= size; w++) {
            const tipY = screenY + ((w * wingDip / size) | 0);
            const wingThick = size > 8 ? 2 : 1;

            const lx = screenX - w;
            for (let t = 0; t < wingThick; t++) {
                if (spriteVisible(lx, tipY - t, d, screenWidth, screenHeight, depthBuf)) {
                    frameBuf32[(tipY - t) * screenWidth + lx] = birdColor;
                }
            }
            const rx = screenX + w;
            for (let t = 0; t < wingThick; t++) {
                if (spriteVisible(rx, tipY - t, d, screenWidth, screenHeight, depthBuf)) {
                    frameBuf32[(tipY - t) * screenWidth + rx] = birdColor;
                }
            }
        }
    }
}

/**
 * Render ground animals (deer) as billboard sprites.
 * Deer are drawn as a simple silhouette: body rectangle + 4 legs + head.
 * z is the TOP of the deer (body top), body extends downward.
 */
const DEER_BODY_W = 5;   // world units wide
const DEER_BODY_H = 4;   // world units tall (body only)
const DEER_LEG_H  = 4;   // world units (legs below body)
const DEER_HEAD_H = 2;   // world units above body
const DEER_HEAD_W = 1.5;

// ABGR colors
const DEER_BODY_COLOR  = 0xFF1E5A8C; // brown body (R=140, G=90, B=30)
const DEER_LEG_COLOR   = 0xFF103860; // darker brown legs
const DEER_BELLY_COLOR = 0xFF40AAD0; // tan belly (R=208, G=170, B=64)

export function renderAnimals(camera, animals, frameBuf32, screenWidth, screenHeight, depthBuf) {
    const maxDist = camera.distance || 400;

    for (let a = 0; a < animals.length; a++) {
        const animal = animals[a];

        // Project the body top (animal.z is body top)
        const p = projectPoint(animal.x, animal.y, animal.z, camera, screenWidth, screenHeight);
        if (!p) continue;
        if (p.depth > maxDist) continue;

        const ps = p.pixelScale; // world units → screen pixels
        const cx = p.sx;         // screen center column

        // Pixel dimensions
        const bodyW = Math.max(2, (DEER_BODY_W * ps) | 0);
        const bodyH = Math.max(2, (DEER_BODY_H * ps) | 0);
        const legH  = Math.max(1, (DEER_LEG_H * ps) | 0);
        const headH = Math.max(1, (DEER_HEAD_H * ps) | 0);
        const headW = Math.max(1, (DEER_HEAD_W * ps) | 0);

        const halfW = (bodyW >> 1);

        // Screen Y positions (p.sy = body top projected)
        const bodyTop = p.sy;
        const bodyBot = bodyTop + bodyH;
        const legBot  = bodyBot + legH;
        const headTop = bodyTop - headH;

        // Fog
        const fogFactor = p.depth / maxDist;

        // Leg walk animation: offset legs
        const legAnim = Math.sin(animal.animPhase) * (legH * 0.3) | 0;

        // Apply sunlight + fog to colors
        let bodyC  = tintSunlight(DEER_BODY_COLOR, curSunlight);
        let legC   = tintSunlight(DEER_LEG_COLOR, curSunlight);
        let bellyC = tintSunlight(DEER_BELLY_COLOR, curSunlight);
        let headC  = bodyC;
        if (fogFactor > fogStart) {
            bodyC  = blendFog(bodyC, fogFactor);
            legC   = blendFog(legC, fogFactor);
            bellyC = blendFog(bellyC, fogFactor);
            headC  = blendFog(headC, fogFactor);
        }

        const d = p.depth;

        // Draw head (small rectangle above body)
        for (let dx = -headW; dx <= headW; dx++) {
            const sx = cx + dx;
            for (let sy = headTop; sy < bodyTop; sy++) {
                if (spriteVisible(sx, sy, d, screenWidth, screenHeight, depthBuf)) {
                    frameBuf32[sy * screenWidth + sx] = headC;
                }
            }
        }

        // Draw body (rectangle)
        for (let dx = -halfW; dx <= halfW; dx++) {
            const sx = cx + dx;

            // Top 60% body color, bottom 40% belly color
            const bellyStart = bodyTop + ((bodyH * 0.6) | 0);
            for (let sy = bodyTop; sy < bellyStart; sy++) {
                if (spriteVisible(sx, sy, d, screenWidth, screenHeight, depthBuf)) {
                    frameBuf32[sy * screenWidth + sx] = bodyC;
                }
            }
            for (let sy = bellyStart; sy < bodyBot; sy++) {
                if (spriteVisible(sx, sy, d, screenWidth, screenHeight, depthBuf)) {
                    frameBuf32[sy * screenWidth + sx] = bellyC;
                }
            }
        }

        // Draw legs (4 thin columns below body)
        const legW = Math.max(1, (halfW * 0.3) | 0);
        const legPositions = [-halfW + legW, -legW, legW, halfW - legW];
        for (let l = 0; l < 4; l++) {
            const lx = cx + legPositions[l];
            // Alternate legs with walk animation
            const offset = (l & 1) ? legAnim : -legAnim;
            const lTop = bodyBot;
            const lBot = legBot + offset;
            for (let sy = lTop; sy < lBot; sy++) {
                if (spriteVisible(lx, sy, d, screenWidth, screenHeight, depthBuf)) {
                    frameBuf32[sy * screenWidth + lx] = legC;
                }
            }
        }
    }
}

/** Apply sunlight brightness + slight blue tint at night */
function tintSunlight(color, sunlight) {
    let r = (color & 0xFF);
    let g = ((color >> 8) & 0xFF);
    let b = ((color >> 16) & 0xFF);

    const nightBlue = (1.0 - sunlight) * 0.15;
    r = (r * sunlight) | 0;
    g = (g * sunlight * (1.0 + nightBlue * 0.3)) | 0;
    b = (b * sunlight + nightBlue * 40) | 0;

    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;

    return 0xFF000000 | (b << 16) | (g << 8) | r;
}

/** Blend color toward current sky/fog color based on distance factor */
function blendFog(color, factor) {
    const t = (factor - fogStart) * fogScale;
    const invT = 1.0 - t;

    const r = (color & 0xFF);
    const g = ((color >> 8) & 0xFF);
    const b = ((color >> 16) & 0xFF);

    const nr = (r * invT + curFogR * t) | 0;
    const ng = (g * invT + curFogG * t) | 0;
    const nb = (b * invT + curFogB * t) | 0;

    return 0xFF000000 | (nb << 16) | (ng << 8) | nr;
}
