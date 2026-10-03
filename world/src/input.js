import { useEffect, useRef } from 'react';

// Own keyboard state instead of drei KeyboardControls: a key released while the window is blurred
// never sends keyup, which left the player walking. Here everything clears on blur/hidden/lock and
// movement resumes only on a fresh press.
const bindings = {
  forward: ['KeyW', 'KeyZ', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  leftward: ['KeyA', 'KeyQ', 'ArrowLeft'],
  rightward: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
};
const actionOf = new Map(Object.entries(bindings).flatMap(([action, codes]) => codes.map((code) => [code, action])));
const idle = Object.freeze({ forward: false, backward: false, leftward: false, rightward: false, run: false, jump: false });

const isTyping = (target) => target instanceof Element && target.closest('input, textarea, select, [contenteditable], dialog, [role=dialog]');

export function useMovementInput(enabled) {
  const held = useRef(new Set());
  const jumpQueued = useRef(false);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    held.current.clear();
    jumpQueued.current = false;
  }, [enabled]);

  useEffect(() => {
    const clear = () => {
      held.current.clear();
      jumpQueued.current = false;
    };
    const down = (event) => {
      const action = actionOf.get(event.code);
      if (!action || !enabledRef.current || isTyping(event.target)) return;
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault(); // no page scroll
      if (event.repeat) return;
      held.current.add(action);
      if (action === 'jump') jumpQueued.current = true;
    };
    const up = (event) => {
      const action = actionOf.get(event.code);
      if (action) held.current.delete(action);
    };
    const visibility = () => document.hidden && clear();
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  // Read once per frame. Jump is true for a single frame per press.
  return () => {
    if (!enabledRef.current) return idle;
    const jump = jumpQueued.current;
    jumpQueued.current = false;
    const h = held.current;
    return { forward: h.has('forward'), backward: h.has('backward'), leftward: h.has('leftward'), rightward: h.has('rightward'), run: h.has('run'), jump };
  };
}
