// terrain.js — Heightmap + colormap generation, shadow baking

export const MAP_SIZE = 2048;
export const MAP_SHIFT = 11;
export const MAP_MASK = 2047;
export const WATER_LEVEL = 46;  // 0.18 * 255

/** Flat index into map arrays with bitwise wrapping */
export function mapOffset(x, y) {
    return ((y & MAP_MASK) << MAP_SHIFT) | (x & MAP_MASK);
}

/**
 * Generate the Mayan temple heightmap (ported from oldreference.js)
 * Heights are 0-255 in a Uint8Array
 */
export function generateTempleHeightmap(heightMap) {
    const dim = MAP_SIZE;

    for (let x = 0; x < dim; x++) {
        for (let y = 0; y < dim; y++) {
            const off = mapOffset(x, y);
            let startingBound = dim / 4;
            let endingBound = (dim / 4) * 3;

            if (y > startingBound && y < endingBound && x > startingBound && x < endingBound) {
                const base = endingBound - startingBound;
                const sections = 10;
                const sectionSize = base / sections;
                const baseHeight = 50; // ~0.2 * 255
                const colIncr = (255 - baseHeight) / sections;

                let sb = startingBound;
                let eb = endingBound;
                for (let i = 0; i < sections; i++) {
                    if (y > sb && y < eb && x > sb && x < eb) {
                        heightMap[off] = Math.min(255, (i * colIncr + baseHeight) | 0);
                    }
                    sb += sectionSize / 2;
                    eb -= sectionSize / 2;
                }
            } else {
                heightMap[off] = (Math.random() * 25) | 0;
            }
        }
    }
}

/**
 * Toroidal midpoint displacement terrain generation
 * Produces seamlessly wrapping terrain (size×size, no +1 border)
 */
function generateMidpointDisplacement(size, roughness) {
    const data = [];
    for (let i = 0; i < size; i++) {
        data[i] = new Float32Array(size);
    }

    function wrap(v) {
        return ((v % size) + size) % size;
    }

    function displace(amount) {
        return (Math.random() - 0.5) * (amount / (size * 2) * roughness);
    }

    // Seed single corner (on a torus all 4 corners are the same point)
    data[0][0] = Math.random();

    let step = size;
    while (step > 1) {
        const half = step >> 1;

        // Diamond step — set center of each square using wrapped corners
        for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
                const avg = (
                    data[x][y] +
                    data[wrap(x + step)][y] +
                    data[x][wrap(y + step)] +
                    data[wrap(x + step)][wrap(y + step)]
                ) / 4;
                data[x + half][y + half] = avg + displace(step);
            }
        }

        // Square step — always 4 neighbors (wrapping provides boundary neighbors)
        for (let y = 0; y < size; y += half) {
            for (let x = ((y / half) & 1) === 0 ? half : 0; x < size; x += step) {
                const avg = (
                    data[x][wrap(y - half)] +
                    data[x][wrap(y + half)] +
                    data[wrap(x - half)][y] +
                    data[wrap(x + half)][y]
                ) / 4;
                data[x][y] = avg + displace(step);
            }
        }

        step = half;
    }

    // Clamp all values to [0, 1]
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (data[x][y] < 0) data[x][y] = 0;
            if (data[x][y] > 1) data[x][y] = 1;
        }
    }

    return data;
}

/**
 * Smooth a 2D float array with 4-directional wrapping passes
 */
function smoothMap2D(data, size, amt) {
    const inv = 1 - amt;
    // Left to right (x=0 wraps from x=size-1)
    for (let x = 0; x < size; x++) {
        const prev = (x - 1 + size) % size;
        for (let y = 0; y < size; y++) {
            data[x][y] = data[prev][y] * amt + data[x][y] * inv;
        }
    }
    // Right to left (x=size-1 wraps from x=0)
    for (let x = size - 1; x >= 0; x--) {
        const next = (x + 1) % size;
        for (let y = 0; y < size; y++) {
            data[x][y] = data[next][y] * amt + data[x][y] * inv;
        }
    }
    // Top to bottom (y=0 wraps from y=size-1)
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            const prev = (y - 1 + size) % size;
            data[x][y] = data[x][prev] * amt + data[x][y] * inv;
        }
    }
    // Bottom to top (y=size-1 wraps from y=0)
    for (let x = 0; x < size; x++) {
        for (let y = size - 1; y >= 0; y--) {
            const next = (y + 1) % size;
            data[x][y] = data[x][next] * amt + data[x][y] * inv;
        }
    }
}

/**
 * Normalize a 2D float array to span the full 0-1 range
 */
function normalizeMap2D(data, size) {
    let min = Infinity, max = -Infinity;
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            if (data[x][y] < min) min = data[x][y];
            if (data[x][y] > max) max = data[x][y];
        }
    }
    const range = max - min || 1;
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            data[x][y] = (data[x][y] - min) / range;
        }
    }
}

/**
 * Generate biome colors with smooth continuous interpolation between color stops
 */
// Color stops: [height, r, g, b]
const COLOR_STOPS = [
    [0.00,   5,  15,  50],  // Deep water
    [0.10,  10,  20,  55],  // Water
    [0.17, 140, 120,  80],  // Shallow sand (underwater)
    [0.18, 194, 170, 120],  // Wet sand (waterline)
    [0.19, 210, 190, 140],  // Dry sand (beach)
    [0.21, 170, 160, 100],  // Sand-to-grass transition
    [0.30,  30,  70,   8],  // Grass
    [0.50,  45,  90,  12],  // Lush grass
    [0.70,  67, 100,  18],  // High grass
    [0.80,  75,  70,  25],  // Mountain base
    [0.90,  60,  56,  31],  // Mountain
    [0.95,  90,  90,  90],  // Rock
    [1.00, 130, 130, 130],  // Snow
];

// Height range that counts as grass (used for grass map)
const GRASS_MIN = 0.22;
const GRASS_MAX = 0.72;
export const GRASS_BLADE_MAX = 12; // max blade height in terrain units (1 to this)


/** Simple integer hash with good bit mixing (no visible patterns) */
export function ihash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return h;
}

function generateBiomeColors(map2D, colorMap, grassMap, size) {
    const stops = COLOR_STOPS;
    const last = stops.length - 1;

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            const h = map2D[x][y];
            const off = mapOffset(x, y);

            // Find the two stops surrounding this height
            let i = 0;
            while (i < last && stops[i + 1][0] < h) i++;
            if (i >= last) i = last - 1;

            const [h0, r0, g0, b0] = stops[i];
            const [h1, r1, g1, b1] = stops[i + 1];
            const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
            const tc = t < 0 ? 0 : t > 1 ? 1 : t;

            const r = (r0 + tc * (r1 - r0)) | 0;
            const g = (g0 + tc * (g1 - g0)) | 0;
            const b = (b0 + tc * (b1 - b0)) | 0;

            colorMap[off] = 0xFF000000 | (b << 16) | (g << 8) | r;

            // Mark grass pixels — pseudo-random blade height
            if (h >= GRASS_MIN && h <= GRASS_MAX) {
                grassMap[off] = 1 + ((ihash(x, y) >>> 0) % GRASS_BLADE_MAX);
            }
        }
    }
}


/**
 * Convert 2D float heightmap to Uint8Array heightmap
 */
function convertToHeightMap(map2D, heightMap, size) {
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            heightMap[mapOffset(x, y)] = (map2D[x][y] * 255) | 0;
        }
    }
}

/**
 * Generate temple-style color map (green grass, blue tower)
 */
export function generateTempleColors(heightMap, colorMap) {
    for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            const off = mapOffset(x, y);
            const h = heightMap[off];
            let r, g, b;

            if (h > 40) {
                // Tower — blue gradient
                r = 50;
                g = 80;
                b = (100 + (h * 0.6)) | 0;
            } else {
                // Grass — green tones
                const variation = ((x * 7 + y * 13) & 15) - 8;
                r = 40 + variation;
                g = 120 + variation;
                b = 30 + variation;
            }

            r = clamp8(r);
            g = clamp8(g);
            b = clamp8(b);

            colorMap[off] = 0xFF000000 | (b << 16) | (g << 8) | r;
        }
    }
}

/**
 * Bake shadows into colorMap by raycasting toward sun (wrapping, distance-capped)
 */
const MAX_SHADOW_DIST = 512;

export function bakeShadows(heightMap, colorMap, sunX, sunY, sunHeight) {
    for (let x = 0; x < MAP_SIZE; x++) {
        for (let y = 0; y < MAP_SIZE; y++) {
            const off = mapOffset(x, y);
            const h = heightMap[off];

            // Direction toward sun
            let dX = sunX - x;
            let dY = sunY - y;
            let dZ = sunHeight * 255 - h;

            const mag = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
            if (mag === 0) continue;

            dX /= mag;
            dY /= mag;
            dZ /= mag;

            let pX = x + dX;
            let pY = y + dY;
            let pZ = h + dZ;

            let shadowed = false;
            let steps = 0;

            while (steps < MAX_SHADOW_DIST && pZ <= sunHeight * 255) {
                const sampleOff = mapOffset(pX | 0, pY | 0);
                if (heightMap[sampleOff] > pZ) {
                    shadowed = true;
                    break;
                }
                pX += dX;
                pY += dY;
                pZ += dZ;
                steps++;
            }

            if (shadowed) {
                const c = colorMap[off];
                // 30% brightness (70% darker)
                const r = ((c & 0xFF) * 0.3) | 0;
                const g = (((c >> 8) & 0xFF) * 0.3) | 0;
                const b = (((c >> 16) & 0xFF) * 0.3) | 0;
                colorMap[off] = 0xFF000000 | (b << 16) | (g << 8) | r;
            }
        }
    }
}

/**
 * Place the Mayan temple structure into an existing heightmap
 */
export function placeTemple(heightMap, cx, cy, radius) {
    const sections = 10;
    const baseHeight = 50;
    const colIncr = (255 - baseHeight) / sections;

    for (let x = cx - radius; x < cx + radius; x++) {
        for (let y = cy - radius; y < cy + radius; y++) {
            let sb = cx - radius;
            let eb = cx + radius;
            let sbY = cy - radius;
            let ebY = cy + radius;
            const sectionSize = (radius * 2) / sections;

            for (let i = 0; i < sections; i++) {
                if (x > sb && x < eb && y > sbY && y < ebY) {
                    const h = Math.min(255, (i * colIncr + baseHeight) | 0);
                    const off = mapOffset(x & MAP_MASK, y & MAP_MASK);
                    heightMap[off] = Math.max(heightMap[off], h);
                }
                sb += sectionSize / 2;
                eb -= sectionSize / 2;
                sbY += sectionSize / 2;
                ebY -= sectionSize / 2;
            }
        }
    }
}

/** Yield to let the browser repaint */
function yieldFrame() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/** Create all terrain data — returns { heightMap, colorMap, grassMap } */
export async function createTerrain(mode, onProgress) {
    const report = onProgress || (() => {});
    const heightMap = new Uint8Array(MAP_SIZE * MAP_SIZE);
    const colorMap = new Uint32Array(MAP_SIZE * MAP_SIZE);
    const grassMap = new Uint8Array(MAP_SIZE * MAP_SIZE);

    if (mode === 'temple') {
        report(0, 'Building temple...');
        await yieldFrame();
        generateTempleHeightmap(heightMap);

        report(25, 'Colorizing...');
        await yieldFrame();
        generateTempleColors(heightMap, colorMap);

        report(50, 'Baking shadows (1/2)...');
        await yieldFrame();
        bakeShadows(heightMap, colorMap, 2, 1, 2);

        report(75, 'Baking shadows (2/2)...');
        await yieldFrame();
        bakeShadows(heightMap, colorMap, 2, -1, 3);
    } else {
        report(0, 'Generating heightmap...');
        await yieldFrame();
        const map2D = generateMidpointDisplacement(MAP_SIZE, 2);

        report(20, 'Smoothing terrain...');
        await yieldFrame();
        smoothMap2D(map2D, MAP_SIZE, 0.1);
        smoothMap2D(map2D, MAP_SIZE, 0.1);
        normalizeMap2D(map2D, MAP_SIZE);

        report(40, 'Generating biome colors...');
        await yieldFrame();
        generateBiomeColors(map2D, colorMap, grassMap, MAP_SIZE);

        report(60, 'Converting heightmap...');
        await yieldFrame();
        convertToHeightMap(map2D, heightMap, MAP_SIZE);

        report(80, 'Baking shadows...');
        await yieldFrame();
        bakeShadows(heightMap, colorMap, 2, 1, 2.5);
    }

    report(100, 'Done');
    return { heightMap, colorMap, grassMap };
}

// --- Utilities ---

function clamp8(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

