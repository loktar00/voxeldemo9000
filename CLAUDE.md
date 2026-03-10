# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based 3D voxel terrain renderer using Canvas 2D raycasting. No build system, no dependencies — vanilla HTML + JavaScript ES modules served as static files.

## Running

Open `index.html` directly in a browser, or use any static file server (e.g. `npx serve .` or `python -m http.server`). URL params: `?terrain=temple`, `?seed=42`.

## Architecture

| File | Purpose |
|------|---------|
| `index.html` | Single canvas (`#voxCanvas`), loading screen, overlay with settings UI, FPS counter |
| `engine.js` | Init, game loop, resolution scaling, settings wiring, module orchestration |
| `renderer.js` | Voxel space front-to-back raycaster, day/night cycle, fog, star dome, billboard sprite rendering (birds, animals) |
| `terrain.js` | Diamond-square heightmap generation, biome coloring, grass map, shadow baking. Exports `heightMap` (Uint8Array), `colorMap` (Uint32Array), `grassMap` (Uint8Array) |
| `camera.js` | Camera state (position, angle, horizon, settings) and movement (fly mode + gravity mode) |
| `input.js` | Keyboard/mouse/pointer lock handling |
| `entities.js` | Birds (air) and deer (ground) — shared movement helpers, spawning, respawning |
| `oldreference.js` | Legacy reference (Mayan temple renderer, not imported) |

## Key Design Patterns

- **Flat arrays with bitwise indexing**: `MAP_SIZE=2048`, `MAP_SHIFT=11`, `MAP_MASK=2047`. Offset = `(y << MAP_SHIFT) | x`.
- **Color format**: `0xAABBGGRR` (little-endian Uint32 for direct framebuffer writes).
- **Front-to-back rendering**: `hiddenY` per-column occlusion buffer tracks highest drawn pixel. `depthBuf` (Float32Array, per-pixel) stores terrain depth for sprite occlusion.
- **Billboard sprites**: `projectPoint()` maps world coords to screen using the voxel space frustum. `spriteVisible()` checks per-pixel depth buffer.
- **Day/night cycle**: Sine wave over `DAY_CYCLE_MS` (120s). `tintSunlight()` dims + blue-shifts colors. Stars fade in at night via billboard dome.
- **Fog**: Configurable start distance (`fogLevel` 0-3). `blendFog()` interpolates toward sky color.
- **Resolution scaling**: Canvas renders at `resolutionScale` (0.25–1.0) of native resolution, CSS upscales with `image-rendering: pixelated`.

## Controls

- WASD — Move, Mouse — Look, Space/Shift — Up/Down
- G — Toggle gravity mode (walking with jump vs free fly)
- 1-4 — Detail level (ray step density)
- Escape — Settings overlay (detail, fog, resolution)

## Performance Notes

- Depth buffer is ~8MB at 1080p; cached and reused across frames to avoid GC pressure.
- Resolution scaling is the primary performance lever at high native resolutions.
- Detail level controls ray step density (level 1 skips more terrain, level 4 is per-pixel).
