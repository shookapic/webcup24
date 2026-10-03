// Renderable avatar options: the single catalogue shared with Session A's editor and server allowlist (ids are stable forever).
// Colours are free (#rrggbb); `look` selects the character model, `accessory` an optional extra. Unknown / missing values never
// throw: they fall back to the defaults, and the provisional ids from early drafts are accepted as aliases (no data loss).
export const LOOK_IDS = ['colon', 'ingenieur', 'medecin'];
export const ACCESSORY_IDS = ['none', 'sac', 'visiere'];
export const DEFAULT_LOOK = 'colon';
export const DEFAULT_ACCESSORY = 'none';
// Kenney Blocky Characters model letter per look (docs/ASSETS.md): colon = c (short ginger hair), ingenieur = i (glasses), medecin = n (long dark hair).
export const LOOK_MODEL = { colon: 'c', ingenieur: 'i', medecin: 'n' };
const LOOK_ALIASES = { lunettes: 'ingenieur', bandeau: 'medecin' };

export const normalizeLook = (id) => (LOOK_IDS.includes(id) ? id : LOOK_ALIASES[id] ?? DEFAULT_LOOK);
export const normalizeAccessory = (id) => (ACCESSORY_IDS.includes(id) ? id : DEFAULT_ACCESSORY);
export const normalizeAvatar = (avatar) => ({ ...avatar, look: normalizeLook(avatar?.look), accessory: normalizeAccessory(avatar?.accessory) });
