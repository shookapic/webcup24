// API-level checks of participation.mjs on disposable SQLite databases. node tools/qa-participation/participation-test.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, seedUsers, startHost } from './host.mjs';
import { initParticipation, eraseParticipationUser } from '../../participation.mjs';

let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const dir = mkdtempSync(join(tmpdir(), 'part-'));

// ---- 1. migration: additive, idempotent, existing rows untouched, survives restart
const file = join(dir, 'existing.sqlite');
{
  const db = openDb(file);
  seedUsers(db);
  db.exec("CREATE TABLE announcements (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO announcements (title) VALUES ('Annonce existante');");
  const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  initParticipation(db); initParticipation(db); initParticipation(db, { seedDemo: true }); initParticipation(db, { seedDemo: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'part_%'").all().map((row) => row.name).sort();
  check('migration creates the 8 part_ tables, idempotent over 4 runs', tables.length === 8, tables.join(','));
  check('existing rows untouched by migration', db.prepare('SELECT COUNT(*) AS n FROM users').get().n === before && db.prepare('SELECT title FROM announcements').get().title === 'Annonce existante');
  check('demo seed inserted once (not duplicated by the 2nd run), labelled demo, no votes', db.prepare('SELECT COUNT(*) AS n FROM part_decisions WHERE demo = 1').get().n === 1 && db.prepare('SELECT COALESCE(SUM(votes),0) AS v FROM part_choices').get().v === 0 && db.prepare("SELECT COUNT(*) AS n FROM part_projects WHERE title NOT LIKE 'Exemple%'").get().n === 0);
  db.close();
  const again = new DatabaseSync(file);
  initParticipation(again);
  check('restart on the same file: rows still there, no error', again.prepare('SELECT COUNT(*) AS n FROM part_decisions').get().n === 1);
  again.close();
}

// ---- 2. API
const db = openDb();
seedUsers(db);
const host = await startHost({ db });
const call = async (user, method, path, body, headers = {}) => {
  const response = await fetch(host.base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: `u=${user}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const CIT = 1, CIT2 = 2, AGENT = 3, ADMIN = 4;

// permissions and routing
check('unknown participation path -> 404 JSON', (await call(CIT, 'GET', '/api/participation/nope')).status === 404);
check('non-participation path is not claimed (host 404, not module)', (await call(CIT, 'GET', '/api/other')).status === 404);
check('anonymous cannot vote -> 401', (await call(null, 'POST', '/api/participation/decisions/1/vote', { choiceId: 1 })).status === 401);
check('citizen cannot create a decision -> 403', (await call(CIT, 'POST', '/api/participation/admin/decisions', { title: 'Titre valide', summary: 'Un résumé assez long', choices: [{ label: 'A' }, { label: 'B' }], publish: true })).status === 403);
check('anonymous cannot read admin overview -> 401', (await call(null, 'GET', '/api/participation/admin/overview')).status === 401);
check('cross-origin write refused by the host contract', (await call(CIT, 'POST', '/api/participation/ideas', { title: 'x', body: 'y', key: 'k' }, { Origin: 'https://evil.example' })).status === 403);

// staff publish a decision, a consultation, a project
const decision = await call(AGENT, 'POST', '/api/participation/admin/decisions', { title: 'Nom de la nouvelle place', title_en: 'Name of the new square', summary: 'Quel nom pour la place centrale ?', choices: [{ label: 'Place des Colons', label_en: 'Settlers Square' }, { label: 'Place du Marché' }, { label: 'Place Neuve' }], publish: true });
check('agent publishes a decision (201)', decision.status === 201, JSON.stringify(decision.body));
const draft = await call(AGENT, 'POST', '/api/participation/admin/decisions', { title: 'Brouillon caché', summary: 'Un résumé de brouillon assez long', choices: [{ label: 'Oui' }, { label: 'Non' }] });
check('draft is not visible to citizens', !(await call(CIT, 'GET', '/api/participation/overview')).body.decisions.some((d) => d.id === draft.body.id));
check('draft vote -> 404', (await call(CIT, 'POST', `/api/participation/decisions/${draft.body.id}/vote`, { choiceId: 1 })).status === 404);
check('bad decision shapes rejected (1 choice, 7 choices, empty title)', (await call(AGENT, 'POST', '/api/participation/admin/decisions', { title: 'Titre valide', summary: 'Un résumé assez long', choices: [{ label: 'A' }] })).status === 400
  && (await call(AGENT, 'POST', '/api/participation/admin/decisions', { title: 'Titre valide', summary: 'Un résumé assez long', choices: Array.from({ length: 7 }, (_, i) => ({ label: `c${i}` })) })).status === 400
  && (await call(AGENT, 'POST', '/api/participation/admin/decisions', { title: '', summary: 'Un résumé assez long', choices: [{ label: 'A' }, { label: 'B' }] })).status === 400);
const overview = (await call(CIT, 'GET', '/api/participation/overview')).body;
const open = overview.decisions.find((d) => d.id === decision.body.id);
check('open decision visible: choices without counts while open, participants shown, myVote null', open && open.status === 'open' && open.choices.every((c) => c.votes === undefined) && open.myVote === null && open.participants === 0);

// vote: one per user, receipt, no choice stored, privacy
const choice = open.choices[0].id;
const voted = await call(CIT, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: choice });
check('citizen votes (201) and gets a receipt', voted.status === 201 && /^V-[0-9A-F]{10}$/.test(voted.body.receipt), voted.body.receipt);
const second = await call(CIT, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: open.choices[1].id });
check('second vote by the same citizen -> 409 already_voted with the first receipt', second.status === 409 && second.body.code === 'already_voted' && second.body.receipt === voted.body.receipt);
check('invalid choice id -> 400', (await call(CIT2, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: 99999 })).status === 400);
check('staff cannot vote -> 403', (await call(AGENT, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: choice })).status === 403);
const cols = db.prepare('PRAGMA table_info(part_voters)').all().map((c) => c.name);
check('vote privacy: part_voters has no choice column and the vote row holds no choice', !cols.some((c) => /choice/.test(c)), cols.join(','));
check('myVote shows receipt (never the choice)', (await call(CIT, 'GET', '/api/participation/overview')).body.decisions.find((d) => d.id === decision.body.id).myVote.receipt === voted.body.receipt);
const stillHidden = (await call(CIT2, 'GET', '/api/participation/overview')).body.decisions.find((d) => d.id === decision.body.id);
check('results hidden from another citizen while open (participants only)', stillHidden.participants === 1 && stillHidden.choices.every((c) => c.votes === undefined));

// concurrency: 40 parallel votes by the same user, and by many users
{
  const users = Array.from({ length: 30 }, (_, i) => 100 + i);
  for (const uid of users) db.prepare("INSERT INTO users (id, email, name, role) VALUES (?, ?, 'Votant', 'citizen')").run(uid, `v${uid}@example.org`);
  const single = await Promise.all(Array.from({ length: 40 }, () => call(CIT2, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: choice })));
  check('40 concurrent votes by one citizen: exactly one 201, the rest 409', single.filter((r) => r.status === 201).length === 1 && single.filter((r) => r.status === 409).length === 39);
  const many = await Promise.all(users.flatMap((uid) => [call(uid, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: choice }), call(uid, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: choice })]));
  check('30 citizens x 2 simultaneous requests: 30 accepted, 30 refused', many.filter((r) => r.status === 201).length === 30 && many.filter((r) => r.status === 409).length === 30);
  const counted = db.prepare('SELECT votes FROM part_choices WHERE id = ?').get(choice).votes;
  const voters = db.prepare('SELECT COUNT(*) AS n FROM part_voters WHERE decision_id = ?').get(decision.body.id).n;
  check('counter equals voter rows (no lost or double count)', counted === voters && voters === 32, `counter ${counted}, voters ${voters}`);
}

// closing: results appear, no more votes, no reopening
const closeBad = await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${decision.body.id}`, { status: 'weird' });
check('invalid status -> 400', closeBad.status === 400);
const closed = await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${decision.body.id}`, { status: 'closed', outcomeNote: 'Résultat constaté par le Haut Conseil' });
check('agent closes the vote', closed.status === 200);
const after = (await call(CIT2, 'GET', '/api/participation/overview')).body.decisions.find((d) => d.id === decision.body.id);
check('closed vote shows counts (32 on the first choice) and the outcome note', after.status === 'closed' && after.choices[0].votes === 32 && after.outcomeNote.startsWith('Résultat'));
check('vote after close -> 409 closed', (await call(100, 'POST', `/api/participation/decisions/${decision.body.id}/vote`, { choiceId: choice })).body.code === 'closed');
check('closed vote cannot be reopened -> 409', (await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${decision.body.id}`, { status: 'open' })).status === 409);
// auto-close by date
const timed = await call(AGENT, 'POST', '/api/participation/admin/decisions', { title: 'Vote déjà échu', summary: 'Un résumé assez long', choices: [{ label: 'Oui' }, { label: 'Non' }], publish: true, closesAt: new Date(Date.now() - 60_000).toISOString() });
const timedView = (await call(CIT, 'GET', '/api/participation/overview')).body.decisions.find((d) => d.id === timed.body.id);
check('past closing date: effective status closed, vote refused (409 closed)', timedView.status === 'closed' && (await call(CIT, 'POST', `/api/participation/decisions/${timed.body.id}/vote`, { choiceId: timedView.choices[0].id })).body.code === 'closed');

// consultation: opinion, not a vote
const consultation = await call(AGENT, 'POST', '/api/participation/admin/consultations', { title: 'Horaires du marché', body: 'Quels horaires préférez-vous pour le marché ?', publish: true });
check('agent publishes a consultation', consultation.status === 201);
const opinion = await call(CIT, 'PUT', `/api/participation/consultations/${consultation.body.id}/opinion`, { rating: 4, comment: 'Plutôt le matin, svp.' });
check('citizen gives an opinion (201) with a receipt', opinion.status === 201 && /^O-/.test(opinion.body.receipt));
const edited = await call(CIT, 'PUT', `/api/participation/consultations/${consultation.body.id}/opinion`, { rating: 5, comment: 'Finalement très tôt.' });
check('same citizen edits their opinion (200, same receipt, not a second row)', edited.status === 200 && edited.body.receipt === opinion.body.receipt && edited.body.updated === true && db.prepare('SELECT COUNT(*) AS n FROM part_opinions WHERE consultation_id = ? AND user_id = 1').get(consultation.body.id).n === 1);
check('empty opinion refused', (await call(CIT2, 'PUT', `/api/participation/consultations/${consultation.body.id}/opinion`, {})).status === 400);
check('rating out of range refused', (await call(CIT2, 'PUT', `/api/participation/consultations/${consultation.body.id}/opinion`, { rating: 9 })).status === 400);
const rawComment = '<img src=x onerror=alert(1)> contenu';
check('HTML in a comment is stored as text (escaping is the client job: safe DOM)', (await call(CIT2, 'PUT', `/api/participation/consultations/${consultation.body.id}/opinion`, { rating: 3, comment: rawComment })).status === 201 && db.prepare('SELECT comment FROM part_opinions WHERE user_id = 2').get().comment === rawComment);
const summary = (await call(AGENT, 'GET', '/api/participation/admin/overview')).body.consultations.find((c) => c.id === consultation.body.id);
check('staff summary: 2 opinions, average 4, comments anonymous (no author field)', summary.opinionCount === 2 && summary.averageRating === 4 && summary.comments.every((c) => !('user' in c) && !('author' in c) && !('user_id' in c)));
check('citizen cannot read the staff summary -> 403', (await call(CIT, 'GET', '/api/participation/admin/overview')).status === 403);
check('consultation opinion is not counted as a vote', db.prepare('SELECT COALESCE(SUM(votes),0) AS v FROM part_choices').get().v === 32 + 0);
await call(AGENT, 'PATCH', `/api/participation/admin/consultations/${consultation.body.id}`, { status: 'closed' });
check('opinion after close -> 409 closed', (await call(CIT, 'PUT', `/api/participation/consultations/${consultation.body.id}/opinion`, { rating: 1 })).body.code === 'closed');

// projects (read-only for citizens)
const project = await call(AGENT, 'POST', '/api/participation/admin/projects', { title: 'Rénovation de la serre', summary: 'Remise en état de la serre du quartier nord.', district: 'Quartier nord', status: 'in_progress', progress: 40, demo: true });
check('agent adds a project (labelled demo flag)', project.status === 201);
check('citizen sees the project incl. demo flag and progress; anonymous too', (await call(null, 'GET', '/api/participation/projects')).body.projects.some((p) => p.id === project.body.id && p.demo === true && p.progress === 40));
check('citizen cannot edit a project -> 403', (await call(CIT, 'PATCH', `/api/participation/admin/projects/${project.body.id}`, { progress: 100 })).status === 403);
check('project progress out of range refused', (await call(AGENT, 'PATCH', `/api/participation/admin/projects/${project.body.id}`, { progress: 120 })).status === 400);
check('agent updates progress', (await call(AGENT, 'PATCH', `/api/participation/admin/projects/${project.body.id}`, { progress: 60, status: 'in_progress' })).status === 200);

// ideas: key idempotency, status, rate cap
const keyA = 'idea-key-0001';
const idea = await call(CIT, 'POST', '/api/participation/ideas', { title: 'Plus de bancs au parc', body: 'Des bancs supplémentaires près de la serre.', key: keyA });
const idea2 = await call(CIT, 'POST', '/api/participation/ideas', { title: 'Plus de bancs au parc', body: 'Des bancs supplémentaires près de la serre.', key: keyA });
check('idea created (201) with receipt; same key again -> 200 duplicate, same receipt, one row', idea.status === 201 && idea2.status === 200 && idea2.body.duplicate === true && idea2.body.idea.receipt === idea.body.idea.receipt && db.prepare('SELECT COUNT(*) AS n FROM part_ideas WHERE user_id = 1').get().n === 1);
const burst = await Promise.all(Array.from({ length: 10 }, () => call(CIT, 'POST', '/api/participation/ideas', { title: 'Plus de bancs au parc', body: 'Des bancs supplémentaires près de la serre.', key: keyA })));
check('10 concurrent retries with the same key still one row', db.prepare('SELECT COUNT(*) AS n FROM part_ideas WHERE user_id = 1').get().n === 1 && burst.every((r) => r.status === 200));
check('idea validation (short title, bad key)', (await call(CIT, 'POST', '/api/participation/ideas', { title: 'a', body: 'Des bancs supplémentaires près de la serre.', key: 'idea-key-0002' })).status === 400 && (await call(CIT, 'POST', '/api/participation/ideas', { title: 'Un titre ok', body: 'Des bancs supplémentaires près de la serre.', key: 'x' })).status === 400);
let limited = 0;
for (let i = 3; i < 12; i++) if ((await call(CIT, 'POST', '/api/participation/ideas', { title: `Idée numéro ${i}`, body: 'Une description suffisamment longue.', key: `idea-key-${String(i).padStart(4, '0')}` })).status === 429) limited++;
check('hourly cap on ideas (5/h) -> 429 rate_limited', limited >= 1 && db.prepare('SELECT COUNT(*) AS n FROM part_ideas WHERE user_id = 1').get().n === 5, `limited ${limited}`);
check('citizen sees only own ideas', (await call(CIT2, 'GET', '/api/participation/ideas/mine')).body.ideas.length === 0 && (await call(CIT, 'GET', '/api/participation/ideas/mine')).body.ideas.length === 5);
const answer = await call(AGENT, 'PATCH', `/api/participation/admin/ideas/${idea.body.idea.id}`, { status: 'accepted', note: 'Merci, nous l’étudions pour le budget 2027.' });
check('staff answers an idea; the citizen sees status and note', answer.status === 200 && (await call(CIT, 'GET', '/api/participation/ideas/mine')).body.ideas.find((i) => i.id === idea.body.idea.id).staffNote.startsWith('Merci'));
check('citizen cannot answer ideas -> 403; bad status -> 400', (await call(CIT, 'PATCH', `/api/participation/admin/ideas/${idea.body.idea.id}`, { status: 'accepted' })).status === 403 && (await call(AGENT, 'PATCH', `/api/participation/admin/ideas/${idea.body.idea.id}`, { status: 'nope' })).status === 400);

// feedback
const fb = await call(CIT2, 'POST', '/api/participation/feedback', { serviceId: 1, rating: 5, comment: 'Très rapide, merci.', key: 'fb-key-00001' });
check('service feedback accepted (201) with receipt and service title', fb.status === 201 && /^F-/.test(fb.body.feedback.receipt) && fb.body.feedback.serviceTitle === 'Carte de résident');
check('same key again -> 200 duplicate, still one row', (await call(CIT2, 'POST', '/api/participation/feedback', { serviceId: 1, rating: 5, comment: 'Très rapide, merci.', key: 'fb-key-00001' })).body.duplicate === true && db.prepare('SELECT COUNT(*) AS n FROM part_feedback WHERE user_id = 2').get().n === 1);
check('unknown service / bad rating refused', (await call(CIT2, 'POST', '/api/participation/feedback', { serviceId: 999, rating: 5, key: 'fb-key-00002' })).status === 400 && (await call(CIT2, 'POST', '/api/participation/feedback', { serviceId: 1, rating: 0, key: 'fb-key-00003' })).status === 400);
check('staff cannot post feedback as a resident -> 403', (await call(AGENT, 'POST', '/api/participation/feedback', { serviceId: 1, rating: 5, key: 'fb-key-00004' })).status === 403);
check('public summary shows the average without comments or names', (await call(null, 'GET', '/api/participation/feedback/summary')).body.services.some((s) => s.serviceId === 1 && s.average === 5 && s.count === 1 && !('comment' in s)));

// history and deletion
const mine = (await call(CIT, 'GET', '/api/participation/mine')).body;
check('"my participation" history lists vote (no choice), opinion, ideas', mine.votes.length === 1 && !('choiceId' in mine.votes[0]) && mine.opinions.length === 1 && mine.ideas.length === 5);
const votesBefore = db.prepare('SELECT SUM(votes) AS v FROM part_choices').get().v;
await call(null, 'POST', '/__erase', { id: 1 });
check('account deletion removes voter row, opinion, ideas, feedback of that user', ['part_voters', 'part_opinions', 'part_ideas', 'part_feedback'].every((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 1`).get().n === 0));
check('account deletion keeps the anonymous aggregate counts', db.prepare('SELECT SUM(votes) AS v FROM part_choices').get().v === votesBefore);

// deletion by admin only, cascade
check('agent cannot delete a decision -> 403', (await call(AGENT, 'DELETE', `/api/participation/admin/decisions/${decision.body.id}`)).status === 403);
check('admin deletes a decision with its choices and voters', (await call(ADMIN, 'DELETE', `/api/participation/admin/decisions/${decision.body.id}`)).status === 200 && db.prepare('SELECT COUNT(*) AS n FROM part_choices WHERE decision_id = ?').get(decision.body.id).n === 0 && db.prepare('SELECT COUNT(*) AS n FROM part_voters WHERE decision_id = ?').get(decision.body.id).n === 0);
check('staff mutations were audited (host audit hook received them)', host.audits.length >= 8 && host.audits.every((a) => a.category === 'participation'), `${host.audits.length} entries`);
check('malformed JSON -> 400, oversize -> 413', (await fetch(host.base + '/api/participation/ideas', { method: 'POST', headers: { Cookie: 'u=2', 'Content-Type': 'application/json' }, body: '{bad' })).status === 400 && (await fetch(host.base + '/api/participation/ideas', { method: 'POST', headers: { Cookie: 'u=2', 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(25_000) }) })).status === 413);

await host.close();
rmSync(dir, { recursive: true, force: true });
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
