import { randomBytes } from 'node:crypto';
import { db } from './store.mjs';
import { hashPassword } from './security.mjs';

const [email, name, role = 'agent'] = process.argv.slice(2);
if (!email || !name || name.trim().length < 2 || name.trim().length > 80 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['agent', 'admin'].includes(role)) {
  console.error('Usage: npm run create-staff -- email@example.org "Nom affiché" [agent|admin]');
  process.exit(1);
}

const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email.toLowerCase());
if (existing?.role === 'citizen') {
  console.error('Cette adresse appartient déjà à un compte citoyen.');
  process.exit(1);
}

const password = randomBytes(24).toString('base64url');
const hash = await hashPassword(password);
if (existing) {
  db.prepare('UPDATE users SET name = ?, role = ?, password_hash = ? WHERE id = ?').run(name.trim(), role, hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
} else {
  db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)').run(email.toLowerCase(), name.trim(), role, hash);
}

console.log(`Compte ${role} prêt pour ${email}. Mot de passe à conserver : ${password}`);
