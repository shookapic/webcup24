// Renderable avatar options: the single catalogue shared with Session A's editor and server allowlist (ids are stable forever; PM-fixed contract).
// Colours are free (#rrggbb); `look` selects the character model, `accessory` an optional extra. Unknown / missing values never
// throw: they fall back to the defaults, and legacy / provisional ids are accepted as aliases (no data loss).
export const LOOK_IDS = ['colon', 'lunettes', 'bandeau'];
export const ACCESSORY_IDS = ['none', 'sac', 'visiere'];
export const DEFAULT_LOOK = 'colon';
export const DEFAULT_ACCESSORY = 'none';
// Kenney Blocky Characters model letter per look (docs/ASSETS.md): colon = c (short ginger hair), lunettes = i (glasses), bandeau = n (long dark hair, headband).
export const LOOK_MODEL = { colon: 'c', lunettes: 'i', bandeau: 'n' };
const LOOK_ALIASES = { ingenieur: 'lunettes', medecin: 'bandeau' };

export const normalizeLook = (id) => (LOOK_IDS.includes(id) ? id : LOOK_ALIASES[id] ?? DEFAULT_LOOK);
export const normalizeAccessory = (id) => (ACCESSORY_IDS.includes(id) ? id : DEFAULT_ACCESSORY);
export const normalizeAvatar = (avatar) => ({ ...avatar, look: normalizeLook(avatar?.look), accessory: normalizeAccessory(avatar?.accessory) });
