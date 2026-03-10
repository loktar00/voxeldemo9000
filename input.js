// input.js — Keyboard/mouse/pointer lock handling

export function createInputState() {
    return {
        keys: {},
        mouseDX: 0,
        mouseDY: 0,
        pointerLocked: false,
        justPressed: {},
    };
}

export function initInput(canvas, input, onPointerLockChange) {
    // Keyboard
    window.addEventListener('keydown', (e) => {
        if (!input.keys[e.code]) input.justPressed[e.code] = true;
        input.keys[e.code] = true;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown'].includes(e.code)) {
            e.preventDefault();
        }
    });

    window.addEventListener('keyup', (e) => {
        input.keys[e.code] = false;
    });

    // Mouse movement — clamp to reject anomalous spikes some browsers emit
    window.addEventListener('mousemove', (e) => {
        if (input.pointerLocked) {
            const mx = e.movementX, my = e.movementY;
            if (mx > -300 && mx < 300 && my > -300 && my < 300) {
                input.mouseDX += mx;
                input.mouseDY += my;
            }
        }
    });

    // Pointer lock
    canvas.addEventListener('click', () => {
        if (!input.pointerLocked) {
            canvas.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        input.pointerLocked = document.pointerLockElement === canvas;
        // Clear accumulated deltas on lock transitions to prevent snap
        input.mouseDX = 0;
        input.mouseDY = 0;
        if (onPointerLockChange) onPointerLockChange(input.pointerLocked);
    });
}
