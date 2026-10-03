// Audit trail (F47, F48): who did what, to what, when, and why. Written by the server from the authenticated session,
// never from client-supplied identities. Append-only (SQLite triggers refuse UPDATE and DELETE) and tamper-evident
// (each row's hash covers the previous row's hash, so any edit or removal breaks the chain: see verifyChain).
import { createHash } from 'node:crypto';
import { db } from './store.mjs';

const ZERO = '0'.repeat(64);

// Nested-safe transaction: the action and its audit row commit together or not at all.
export function tx(work) {
  db.exec('SAVEPOINT tn');
  try {
    const result = work();
    db.exec('RELEASE tn');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO tn');
    db.exec('RELEASE tn');
    throw error;
  }
}

const canonical = (row) => JSON.stringify([row.prev_hash, row.at, row.actor_id, row.actor_name, row.actor_role, row.category, row.action, row.target_type, row.target_id, row.target_label, row.summary, row.reason, row.details]);

// `actor` is the session user ({ id, name, email, role }); `target` is { type, id, label }. Staff keep their name (accountability);
// a citizen acting (self-deletion, booking, cancelling) is stored masked, exactly like a citizen target, so erasing the account
// leaves no full name or e-mail behind. Rows are never rewritten afterwards (append-only), so the rule applies from the first row. `details` holds before/after values and must
// never contain secrets (no passwords, no tokens).
export function audit(actor, { category, action, target = {}, summary, reason = null, details = null }) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
  const row = {
    prev_hash: last?.hash || ZERO, at: new Date().toISOString(), actor_id: actor.id ?? null, actor_name: actor.role === 'citizen' ? citizenLabel(actor) : actor.name, actor_role: actor.role,
    category, action, target_type: target.type ?? null, target_id: target.id != null ? String(target.id) : null, target_label: target.label ?? null,
    summary, reason, details: details ? JSON.stringify(details) : null,
  };
  row.hash = createHash('sha256').update(canonical(row)).digest('hex');
  db.prepare(`INSERT INTO audit_log (at, actor_id, actor_name, actor_role, category, action, target_type, target_id, target_label, summary, reason, details, prev_hash, hash)
    VALUES (:at, :actor_id, :actor_name, :actor_role, :category, :action, :target_type, :target_id, :target_label, :summary, :reason, :details, :prev_hash, :hash)`).run(row);
}

// A citizen appears in the log only as first name, initial and masked e-mail, so erasing the account (F33) leaves nothing more.
export function citizenLabel({ id, name, email }) {
  const [first = '', ...rest] = String(name || '').trim().split(/\s+/);
  const initial = rest.length ? ` ${rest[rest.length - 1][0].toUpperCase()}.` : '';
  const masked = String(email || '').replace(/^(.).*(@.*)$/, '$1***$2');
  return `${first}${initial} · ${masked} (n°${id})`;
}

// Recomputes the whole chain. ok = false names the first row that does not match.
export function verifyChain() {
  let previous = ZERO;
  let checked = 0;
  for (const row of db.prepare('SELECT * FROM audit_log ORDER BY id').iterate()) {
    const expected = createHash('sha256').update(canonical({ ...row, prev_hash: previous })).digest('hex');
    if (row.prev_hash !== previous || row.hash !== expected) return { ok: false, checked, brokenAt: Number(row.id) };
    previous = row.hash;
    checked += 1;
  }
  return { ok: true, checked, brokenAt: null };
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// A real calendar date (2026-02-30 and 2026-99-99 are refused), or null when absent.
function calendarDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) throw badRequest(`${label} est invalide (format AAAA-MM-JJ).`);
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw badRequest(`${label} n’existe pas dans le calendrier.`);
  return String(value);
}

// A whole number >= min, or the fallback when absent. Above `max` it is clamped (documented), never rejected.
function wholeNumber(value, label, { min, max = Number.MAX_SAFE_INTEGER, fallback = null }) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d{1,15}$/.test(String(value))) throw badRequest(`${label} doit être un nombre entier.`);
  const number = Number(value);
  if (number < min) throw badRequest(`${label} doit être au moins ${min}.`);
  return Math.min(number, max);
}

const clean = (value, max = 80) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Filters: actor (id), category, q (text), from/to (ISO date), target_type + target_id, before (id cursor), limit.
export function listAudit(query, { cityOffsetHours = 4, limitMax = 200 } = {}) {
  const where = [];
  const args = {};
  const actor = wholeNumber(query.actor, 'L’agent', { min: 0 });
  if (actor !== null) { where.push('actor_id = :actor'); args.actor = actor; }
  if (clean(query.category, 30)) { where.push('category = :category'); args.category = clean(query.category, 30); }
  if (clean(query.target_type, 30)) { where.push('target_type = :target_type'); args.target_type = clean(query.target_type, 30); }
  if (clean(query.target_id, 40)) { where.push('target_id = :target_id'); args.target_id = clean(query.target_id, 40); }
  const from = calendarDate(query.from, 'La date de début');
  const to = calendarDate(query.to, 'La date de fin');
  if (from && to && from > to) throw badRequest('La date de début est après la date de fin.');
  if (from) { where.push('at >= :from'); args.from = new Date(`${from}T00:00:00+0${cityOffsetHours}:00`).toISOString(); }
  if (to) { where.push('at < :to'); args.to = new Date(new Date(`${to}T00:00:00+0${cityOffsetHours}:00`).getTime() + 86_400_000).toISOString(); }
  const q = clean(query.q, 80);
  if (q) {
    where.push("(summary LIKE :q ESCAPE '\\' OR target_label LIKE :q ESCAPE '\\' OR actor_name LIKE :q ESCAPE '\\' OR reason LIKE :q ESCAPE '\\')");
    args.q = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  }
  const before = wholeNumber(query.before, 'Le repère de page', { min: 1 });
  if (before !== null) { where.push('id < :before'); args.before = before; }
  const limit = wholeNumber(query.limit, 'Le nombre de lignes', { min: 1, max: limitMax, fallback: 50 });
  const rows = db.prepare(`SELECT id, at, actor_id, actor_name, actor_role, category, action, target_type, target_id, target_label, summary, reason, details, hash
    FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit + 1}`).all(args);
  const more = rows.length > limit;
  const entries = rows.slice(0, limit).map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
  return { entries, next_before: more ? entries[entries.length - 1].id : null };
}

export function auditFacets() {
  return {
    actors: db.prepare('SELECT actor_id AS id, actor_name AS name, actor_role AS role, COUNT(*) AS actions FROM audit_log GROUP BY actor_id, actor_name, actor_role ORDER BY actions DESC LIMIT 100').all(),
    categories: db.prepare('SELECT category, COUNT(*) AS actions FROM audit_log GROUP BY category ORDER BY category').all(),
  };
}

// Spreadsheet-safe CSV: cells that start like a formula are prefixed so they are read as text.
export function auditCsv(entries) {
  const cell = (value) => {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = ['n°', 'date (UTC)', 'agent', 'rôle', 'catégorie', 'action', 'cible', 'résumé', 'motif', 'détails', 'empreinte'];
  return [head, ...entries.map((e) => [e.id, e.at, e.actor_name, e.actor_role, e.category, e.action, e.target_label ?? '', e.summary, e.reason ?? '', e.details ? JSON.stringify(e.details) : '', e.hash])]
    .map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
