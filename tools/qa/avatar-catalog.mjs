// Contract test for the renderable avatar catalogue (shared with A's allowlist): node tools/qa/avatar-catalog.mjs
import assert from 'node:assert/strict';
import { ACCESSORY_IDS, LOOK_IDS, LOOK_MODEL, normalizeAccessory, normalizeAvatar, normalizeLook } from '../../world/src/avatarCatalog.js';

assert.deepEqual(LOOK_IDS, ['colon', 'ingenieur', 'medecin']);
assert.deepEqual(ACCESSORY_IDS, ['none', 'sac', 'visiere']);
for (const id of LOOK_IDS) assert.ok(LOOK_MODEL[id], `look ${id} has a model`);
assert.equal(normalizeLook(undefined), 'colon');
assert.equal(normalizeLook(null), 'colon');
assert.equal(normalizeLook('nope'), 'colon');
assert.equal(normalizeLook('<script>'), 'colon');
assert.equal(normalizeLook('lunettes'), 'ingenieur', 'provisional id from the early draft');
assert.equal(normalizeLook('bandeau'), 'medecin', 'provisional id from the early draft');
assert.equal(normalizeLook('medecin'), 'medecin');
assert.equal(normalizeAccessory(undefined), 'none');
assert.equal(normalizeAccessory('hat'), 'none');
assert.equal(normalizeAccessory('visiere'), 'visiere');
assert.deepEqual(normalizeAvatar({ skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' }), { skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3', look: 'colon', accessory: 'none' });
assert.deepEqual(normalizeAvatar(null), { look: 'colon', accessory: 'none' });
console.log('avatar catalogue: 14 assertions passed');
