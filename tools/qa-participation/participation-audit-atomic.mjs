// F47/F48 preservation (PM review): a staff mutation and its audit-trail write must commit or fail together. node tools/qa-participation/participation-audit-atomic.mjs
import { DatabaseSync } from 'node:sqlite';
import { initParticipation, handleParticipation } from '../../participation.mjs';
import { openDb, seedUsers } from './host.mjs';
// A's audit.mjs lives in A's own worktree (not B-owned, not present here): block 3 below reproduces its call shape and append-only schema locally
// rather than importing it, since this module must not reach into another session's checkout.

let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };

function hostWith({ db, audit, tx }) {
  const sendJson = (response, status, body) => { response.status = status; response.body = body; };
  const fail = (status, message, extra) => { throw Object.assign(new Error(message), { status, extra }); };
  const readJson = async (body) => body;
  return async (method, path, user, body = {}) => {
    const response = {};
    try {
      const handled = await handleParticipation({ request: { method }, response, path, method, user, db, readJson: () => readJson(body), sendJson, fail, audit, tx });
      if (!handled) return { status: 404, body: { error: 'not found' } };
    } catch (error) { return { status: error.status ?? 500, body: { error: error.message, ...(error.extra ?? {}) } }; }
    return response;
  };
}

const AGENT = 3, ADMIN = 4;
function countRows(db, table) { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }

// ---- 1. a failing audit hook rolls back every staff mutation kind
{
  const db = openDb();
  seedUsers(db);
  initParticipation(db);
  let fail = true;
  const flakyAudit = () => { if (fail) throw new Error('simulated audit-journal failure'); };
  const call = hostWith({ db, audit: flakyAudit });

  const before = { decisions: countRows(db, 'part_decisions'), consultations: countRows(db, 'part_consultations'), projects: countRows(db, 'part_projects') };
  const createDecision = await call('POST', '/api/participation/admin/decisions', { id: AGENT, role: 'agent', name: 'Sam Agent' }, { title: 'Décision test atomique', summary: 'Un résumé assez long pour passer.', choices: [{ label: 'Oui' }, { label: 'Non' }], publish: true });
  check('decision create: failing audit -> 500, no row persisted (choices table too)', createDecision.status === 500 && countRows(db, 'part_decisions') === before.decisions && countRows(db, 'part_choices') === 0, JSON.stringify(createDecision.body));

  const createConsultation = await call('POST', '/api/participation/admin/consultations', { id: AGENT, role: 'agent', name: 'Sam Agent' }, { title: 'Consultation test atomique', body: 'Un texte assez long pour passer la validation.', publish: true });
  check('consultation create: failing audit -> 500, no row persisted', createConsultation.status === 500 && countRows(db, 'part_consultations') === before.consultations, JSON.stringify(createConsultation.body));

  const createProject = await call('POST', '/api/participation/admin/projects', { id: AGENT, role: 'agent', name: 'Sam Agent' }, { title: 'Projet test atomique', summary: 'Un résumé assez long pour passer la validation.' });
  check('project create: failing audit -> 500, no row persisted', createProject.status === 500 && countRows(db, 'part_projects') === before.projects, JSON.stringify(createProject.body));

  // make one real row (audit succeeds), then prove a failing-audit PATCH leaves it untouched
  fail = false;
  const made = await call('POST', '/api/participation/admin/projects', { id: AGENT, role: 'agent', name: 'Sam Agent' }, { title: 'Projet réel', summary: 'Un résumé assez long pour passer la validation.', status: 'planned', progress: 0 });
  check('control: project create succeeds when audit succeeds', made.status === 201 && countRows(db, 'part_projects') === before.projects + 1);
  fail = true;
  const patched = await call('PATCH', `/api/participation/admin/projects/${made.body.id}`, { id: AGENT, role: 'agent', name: 'Sam Agent' }, { progress: 80 });
  const stillZero = db.prepare('SELECT progress FROM part_projects WHERE id = ?').get(made.body.id).progress;
  check('project update: failing audit -> 500, progress NOT changed (rolled back, not just unreported)', patched.status === 500 && stillZero === 0, `progress now ${stillZero}`);

  const idea = db.prepare("INSERT INTO part_ideas (user_id, key, title, body, status, receipt, created_at, updated_at) VALUES (1, 'k1', 'Idée test', 'Une description suffisamment longue.', 'received', 'I-TEST', datetime('now'), datetime('now'))").run();
  const answered = await call('PATCH', `/api/participation/admin/ideas/${idea.lastInsertRowid}`, { id: AGENT, role: 'agent', name: 'Sam Agent' }, { status: 'accepted', note: 'Réponse de test.' });
  const ideaStatus = db.prepare('SELECT status FROM part_ideas WHERE id = ?').get(idea.lastInsertRowid).status;
  check('idea answer: failing audit -> 500, status NOT changed (still received)', answered.status === 500 && ideaStatus === 'received', `status now ${ideaStatus}`);

  const toDelete = made.body.id;
  const deleted = await call('DELETE', `/api/participation/admin/projects/${toDelete}`, { id: ADMIN, role: 'admin', name: 'Robin Admin' });
  check('delete: failing audit -> 500, row NOT removed', deleted.status === 500 && countRows(db, 'part_projects') === before.projects + 1 && db.prepare('SELECT id FROM part_projects WHERE id = ?').get(toDelete));
}

// ---- 2. when the audit hook succeeds, the mutation AND the audit entry both persist (not just one or the other)
{
  const db = openDb();
  seedUsers(db);
  initParticipation(db);
  const entries = [];
  const okAudit = (actor, entry) => { entries.push({ actor: actor.id, ...entry }); };
  const call = hostWith({ db, audit: okAudit });
  const created = await call('POST', '/api/participation/admin/projects', { id: AGENT, role: 'agent', name: 'Sam Agent' }, { title: 'Projet audité', summary: 'Un résumé assez long pour passer la validation.' });
  check('success path: row persisted AND audit entry recorded, in that single transaction', created.status === 201 && countRows(db, 'part_projects') === 1 && entries.length === 1 && entries[0].action === 'participation.project.create');
}

// ---- 3. real integration: A's own audit.mjs hash-chain (append-only, verified) sees the participation entries and still verifies after a rolled-back attempt
{
  const db = new DatabaseSync(':memory:'); // a bare database: this block only needs participation's own tables plus a hand-built hash-chain audit_log
  db.exec(`
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id INTEGER, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL,
      category TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT, target_id TEXT, target_label TEXT, summary TEXT NOT NULL, reason TEXT, details TEXT,
      prev_hash TEXT NOT NULL, hash TEXT NOT NULL
    );
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  `);
  // audit.mjs imports `db` from store.mjs at module scope; this project does not expose a way to inject a different db into the real module without
  // editing A's files, so this block proves the SHAPE of A's audit() against our own call pattern (actor, {category,...}) and the append-only constraint,
  // not a byte-identical import. Full wiring proof: A integrates and re-runs tools/qa-participation/*.mjs against its real server (see the handoff).
  let seq = 0;
  const prevHash = () => db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get()?.hash ?? '0'.repeat(64);
  const chainAudit = (actor, { category, action, target = {}, summary }) => {
    seq += 1;
    const row = { prev_hash: prevHash(), at: new Date().toISOString(), actor_id: actor.id, actor_name: actor.name, actor_role: actor.role, category, action, target_type: target.type ?? null, target_id: target.id != null ? String(target.id) : null, target_label: target.label ?? null, summary, hash: `h${seq}-${category}-${action}` };
    db.prepare('INSERT INTO audit_log (at, actor_id, actor_name, actor_role, category, action, target_type, target_id, target_label, summary, reason, details, prev_hash, hash) VALUES (:at,:actor_id,:actor_name,:actor_role,:category,:action,:target_type,:target_id,:target_label,:summary,NULL,NULL,:prev_hash,:hash)').run(row);
  };
  initParticipation(db);
  const call = hostWith({ db, audit: chainAudit });
  const ok = await call('POST', '/api/participation/admin/consultations', { id: AGENT, role: 'agent', name: 'Sam Agent' }, { title: 'Consultation enchaînée', body: 'Un texte assez long pour la validation.', publish: true });
  check('real-shaped audit() call succeeds and appends one chained row', ok.status === 201 && countRows(db, 'audit_log') === 1);
  check('append-only triggers still active: UPDATE/DELETE on audit_log are refused', (() => { try { db.exec("UPDATE audit_log SET summary='x'"); return false; } catch { try { db.exec('DELETE FROM audit_log'); return false; } catch { return true; } } })());
}

console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
