// Deterministic interleavings for participation.mjs (PM review): a request whose BODY arrives after another request changed or closed the row, expired rows
// that must not reopen, delayed staff PATCHes, and a vote body arriving after closing. node tools/qa-participation/participation-races.mjs
import { request as httpRequest } from 'node:http';
import { openDb, seedUsers, startHost } from './host.mjs';

let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(ok ? 'PASS' : 'FAIL', name, info); };
const db = openDb();
seedUsers(db);
const host = await startHost({ db });
const CIT = 1, CIT2 = 2, AGENT = 3, ADMIN = 4;
const call = async (user, method, path, body) => {
  const response = await fetch(host.base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: `u=${user}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
// headers are sent at once, the body is withheld until release(): the server has already started handling the request
const slow = (user, method, path, payload) => {
  const url = new URL(host.base + path);
  const text = JSON.stringify(payload);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const done = new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), Cookie: `u=${user}` } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    req.flushHeaders();
    gate.then(() => req.end(text));
  });
  return { release, done };
};
const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const past = new Date(Date.now() - 3_600_000).toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();
const decisionBody = (title, extra = {}) => ({ title, summary: 'Un résumé assez long pour passer.', choices: [{ label: 'Oui' }, { label: 'Non' }], publish: true, ...extra });

// 1. consultation opinion: staff closes while the body is in flight
{
  const c = (await call(AGENT, 'POST', '/api/participation/admin/consultations', { title: 'Consultation course', body: 'Une consultation pour la course de fermeture.', publish: true })).body.id;
  const pending = slow(CIT2, 'PUT', `/api/participation/consultations/${c}/opinion`, { rating: 2, comment: 'Trop tard ?' });
  await waitMs(150);
  await call(AGENT, 'PATCH', `/api/participation/admin/consultations/${c}`, { status: 'closed' });
  pending.release();
  const late = await pending.done;
  check('opinion whose body arrives after staff closed the consultation -> 409 closed, nothing stored', late.status === 409 && late.body.code === 'closed' && db.prepare('SELECT COUNT(*) AS n FROM part_opinions WHERE consultation_id = ?').get(c).n === 0);
}
// 2. the deadline passes while the body is in flight
{
  const d = (await call(AGENT, 'POST', '/api/participation/admin/consultations', { title: 'Consultation échéance', body: 'Une consultation avec une échéance proche.', publish: true, closesAt: new Date(Date.now() + 900).toISOString() })).body.id;
  const pending = slow(CIT2, 'PUT', `/api/participation/consultations/${d}/opinion`, { rating: 4 });
  await waitMs(1100);
  pending.release();
  const late = await pending.done;
  check('opinion whose body arrives after the deadline passed -> 409 closed, nothing stored', late.status === 409 && db.prepare('SELECT COUNT(*) AS n FROM part_opinions WHERE consultation_id = ?').get(d).n === 0);
}
// 3. expired rows still stored as open: moving/clearing the deadline or setting open must not reopen them
{
  const expiredDecision = (await call(AGENT, 'POST', '/api/participation/admin/decisions', decisionBody('Décision échue', { closesAt: past }))).body.id;
  const expiredConsultation = (await call(AGENT, 'POST', '/api/participation/admin/consultations', { title: 'Consultation échue', body: 'Une consultation dont la date est passée.', publish: true, closesAt: past })).body.id;
  check('fixtures: both expired rows are still STORED as open', db.prepare('SELECT status FROM part_decisions WHERE id = ?').get(expiredDecision).status === 'open' && db.prepare('SELECT status FROM part_consultations WHERE id = ?').get(expiredConsultation).status === 'open');
  const attempts = [];
  for (const [kind, rowId] of [['decisions', expiredDecision], ['consultations', expiredConsultation]]) {
    for (const change of [{ closesAt: future }, { closesAt: null }, { status: 'open', closesAt: future }, { status: 'open' }]) attempts.push((await call(AGENT, 'PATCH', `/api/participation/admin/${kind}/${rowId}`, change)).status);
  }
  check('moving the deadline, clearing it, or setting open: all refused with 409 (8/8)', attempts.every((status) => status === 409), attempts.join());
  const view = (await call(CIT, 'GET', '/api/participation/overview')).body;
  check('both are still effectively closed for citizens after those attempts', view.decisions.find((x) => x.id === expiredDecision).status === 'closed' && view.consultations.find((x) => x.id === expiredConsultation).status === 'closed');
  const choice = view.decisions.find((x) => x.id === expiredDecision).choices[0].id;
  check('votes and opinions on them are still refused', (await call(CIT, 'POST', `/api/participation/decisions/${expiredDecision}/vote`, { choiceId: choice })).status === 409 && (await call(CIT, 'PUT', `/api/participation/consultations/${expiredConsultation}/opinion`, { rating: 3 })).status === 409);
  const closedExplicitly = await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${expiredDecision}`, { status: 'closed', outcomeNote: 'Constaté après échéance' });
  check('an expired row can still be closed explicitly (closed_at = its deadline) and get its outcome note', closedExplicitly.status === 200 && db.prepare('SELECT closed_at, outcome_note FROM part_decisions WHERE id = ?').get(expiredDecision).closed_at === past);
  check('closing again with the same deadline is allowed (idempotent), a different deadline is not', (await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${expiredDecision}`, { status: 'closed', closesAt: past })).status === 200 && (await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${expiredDecision}`, { status: 'closed', closesAt: future })).status === 409);
}
// 4. delayed staff PATCH acts on the fresh row
{
  const racing = (await call(AGENT, 'POST', '/api/participation/admin/decisions', decisionBody('Décision en course'))).body.id;
  const delayedReopen = slow(AGENT, 'PATCH', `/api/participation/admin/decisions/${racing}`, { status: 'open', closesAt: future });
  const delayedDeadline = slow(AGENT, 'PATCH', `/api/participation/admin/decisions/${racing}`, { closesAt: future });
  await waitMs(150);
  await call(ADMIN, 'PATCH', `/api/participation/admin/decisions/${racing}`, { status: 'closed' });
  delayedReopen.release(); delayedDeadline.release();
  const [reopen, deadline] = await Promise.all([delayedReopen.done, delayedDeadline.done]);
  check('delayed staff PATCH (set open / move deadline) after another staff closed the decision -> both 409, stays closed', reopen.status === 409 && deadline.status === 409 && db.prepare('SELECT status FROM part_decisions WHERE id = ?').get(racing).status === 'closed');
  const consultation = (await call(AGENT, 'POST', '/api/participation/admin/consultations', { title: 'Consultation en course', body: 'Une consultation pour la course de modification.', publish: true })).body.id;
  const delayedC = slow(AGENT, 'PATCH', `/api/participation/admin/consultations/${consultation}`, { status: 'open', closesAt: future });
  await waitMs(150);
  await call(ADMIN, 'PATCH', `/api/participation/admin/consultations/${consultation}`, { status: 'closed' });
  delayedC.release();
  check('same for a consultation: delayed reopen -> 409, stays closed', (await delayedC.done).status === 409 && db.prepare('SELECT status FROM part_consultations WHERE id = ?').get(consultation).status === 'closed');
  const draft = (await call(AGENT, 'POST', '/api/participation/admin/consultations', { title: 'Consultation brouillon', body: 'Une consultation créée en brouillon.' })).body.id;
  const delayedPublish = slow(AGENT, 'PATCH', `/api/participation/admin/consultations/${draft}`, { status: 'open' });
  await waitMs(150);
  await call(ADMIN, 'DELETE', `/api/participation/admin/consultations/${draft}`);
  delayedPublish.release();
  check('delayed PATCH on a row deleted meanwhile -> 404, nothing resurrected', (await delayedPublish.done).status === 404 && db.prepare('SELECT COUNT(*) AS n FROM part_consultations WHERE id = ?').get(draft).n === 0);
}
// 5. a vote whose body arrives after the decision closed
{
  const voteRace = (await call(AGENT, 'POST', '/api/participation/admin/decisions', decisionBody('Vote en course'))).body.id;
  const choiceId = (await call(CIT, 'GET', '/api/participation/overview')).body.decisions.find((x) => x.id === voteRace).choices[0].id;
  const delayedVote = slow(CIT2, 'POST', `/api/participation/decisions/${voteRace}/vote`, { choiceId });
  await waitMs(150);
  await call(AGENT, 'PATCH', `/api/participation/admin/decisions/${voteRace}`, { status: 'closed' });
  delayedVote.release();
  const late = await delayedVote.done;
  check('vote whose body arrives after the decision was closed -> 409 closed, no voter row, counter unchanged', late.status === 409 && late.body.code === 'closed' && db.prepare('SELECT COUNT(*) AS n FROM part_voters WHERE decision_id = ?').get(voteRace).n === 0 && db.prepare('SELECT votes FROM part_choices WHERE id = ?').get(choiceId).votes === 0);
}
await host.close();
console.log(failures ? `FAILURES (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
