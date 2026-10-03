import { useEffect } from 'react';

const focusable = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
let active = null;

const usable = (node) => !node.disabled && !node.closest('[hidden], [inert]');

// Dialog focus contract for the flat fallback and for the 3D screen's DOM host (only one screen at a time):
// on activation focus moves in (`[data-autofocus]` first), Tab/Shift+Tab stay inside, and on deactivation
// focus returns to whatever had it before. Escape is handled by the screen itself, not here.
export function useDialogFocus(ref, enabled) {
  useEffect(() => {
    const host = ref.current;
    if (!enabled || !host) return undefined;
    if (active && active !== host) console.warn('Two phone screens are focusable at once; only one should be mounted.');
    active = host;
    const previous = document.activeElement;
    if (!host.hasAttribute('tabindex')) host.tabIndex = -1;
    (host.querySelector('[data-autofocus]') || [...host.querySelectorAll(focusable)].find(usable) || host).focus({ preventScroll: true });

    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const items = [...host.querySelectorAll(focusable)].filter(usable);
      if (!items.length) {
        event.preventDefault();
        host.focus();
        return;
      }
      const inside = host.contains(document.activeElement);
      const edge = event.shiftKey ? items[0] : items.at(-1);
      if (!inside || document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0]).focus();
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      if (active === host) active = null;
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    };
  }, [ref, enabled]);
}
