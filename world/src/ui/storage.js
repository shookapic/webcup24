// localStorage can be missing, blocked or hold garbage: every read/write here is guarded and never throws.
export function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const MAX_SEEN = 200;
const seenKey = (userId) => `world-seen-alerts:${userId ?? 'guest'}`;

// Acknowledged alert IDs for one user. Anything that is not an array of integers is discarded.
export function loadSeen(userId) {
  try {
    const parsed = JSON.parse(readStored(seenKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Number.isSafeInteger).slice(-MAX_SEEN) : [];
  } catch {
    return [];
  }
}

export function saveSeen(userId, ids) {
  return writeStored(seenKey(userId), JSON.stringify([...ids].slice(-MAX_SEEN)));
}
