// Civic participation slice (F65 decisions/votes, F66 consultations, F67 projects, F68 ideas, F76 service feedback).
// Standalone module: no dependency, node:sqlite only. The host (server.mjs) owns sessions, origin checks, body limits and throttling and calls
//   initParticipation(db, { seedDemo })      once at start: additive, idempotent migrations (CREATE ... IF NOT EXISTS only)
//   handleParticipation(ctx)                 per request: true when it answered (path under /api/participation), false otherwise
//   eraseParticipationUser(db, userId)       inside the host's account-deletion transaction
// Contract: coordination/reports/B-participation-contract.md, docs/PARTICIPATION_HANDOFF_B.md.
import { randomBytes } from 'node:crypto';

const STATUS_DECISION = ['draft', 'open', 'closed'];
const STATUS_PROJECT = ['planned', 'in_progress', 'done'];
const STATUS_IDEA = ['received', 'under_review', 'accepted', 'declined'];
const HOURLY_CAP = 5; // ideas and feedback per user per rolling hour

export function initParticipation(db, { seedDemo = false } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS part_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_en TEXT, summary TEXT NOT NULL, summary_en TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')), closes_at TEXT,
      demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)), created_by_label TEXT, created_at TEXT NOT NULL, closed_at TEXT, outcome_note TEXT
    );
    CREATE TABLE IF NOT EXISTS part_choices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL REFERENCES part_decisions(id) ON DELETE CASCADE,
      label TEXT NOT NULL, label_en TEXT, votes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS part_choices_decision ON part_choices(decision_id);
    CREATE TABLE IF NOT EXISTS part_voters (
      decision_id INTEGER NOT NULL REFERENCES part_decisions(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
      receipt TEXT NOT NULL, voted_at TEXT NOT NULL, UNIQUE (decision_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS part_voters_user ON part_voters(user_id);
    CREATE TABLE IF NOT EXISTS part_consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_en TEXT, body TEXT NOT NULL, body_en TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')), closes_at TEXT,
      demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)), created_by_label TEXT, created_at TEXT NOT NULL, closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS part_opinions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, consultation_id INTEGER NOT NULL REFERENCES part_consultations(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
      rating INTEGER CHECK (rating BETWEEN 1 AND 5), comment TEXT, receipt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (consultation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS part_opinions_user ON part_opinions(user_id);
    CREATE TABLE IF NOT EXISTS part_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_en TEXT, summary TEXT NOT NULL, summary_en TEXT, district TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done')), progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      starts_on TEXT, ends_on TEXT, demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)), created_by_label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS part_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'under_review', 'accepted', 'declined')), staff_note TEXT,
      receipt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (user_id, key)
    );
    CREATE INDEX IF NOT EXISTS part_ideas_status ON part_ideas(status);
    CREATE TABLE IF NOT EXISTS part_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, service_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT, receipt TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (user_id, key)
    );
    CREATE INDEX IF NOT EXISTS part_feedback_service ON part_feedback(service_id);
  `);
  if (seedDemo) seed(db);
}

// Clearly labelled demonstration content, only into empty tables and only when the host asks. No votes, no results, no opinions.
function seed(db) {
  const empty = ['part_decisions', 'part_consultations', 'part_projects'].every((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0);
  if (!empty) return;
  const now = new Date().toISOString();
  const decision = db.prepare("INSERT INTO part_decisions (title, title_en, summary, summary_en, status, demo, created_by_label, created_at) VALUES (?, ?, ?, ?, 'open', 1, 'Démonstration', ?)")
    .run('Exemple (démonstration) : nom de la future place du Marché', 'Example (demonstration): name of the future Market square',
      'Décision fictive pour montrer le vote : aucun résultat réel, aucune conséquence.', 'Fictional decision to show voting: no real result, no consequence.', now).lastInsertRowid;
  for (const [fr, en] of [['Place des Colons', 'Settlers Square'], ['Place du Marché-Haut', 'Upper Market Square'], ['Place des Quatre Jardins', 'Four Gardens Square']]) {
    db.prepare('INSERT INTO part_choices (decision_id, label, label_en) VALUES (?, ?, ?)').run(decision, fr, en);
  }
  db.prepare("INSERT INTO part_consultations (title, title_en, body, body_en, status, demo, created_by_label, created_at) VALUES (?, ?, ?, ?, 'open', 1, 'Démonstration', ?)")
    .run('Exemple (démonstration) : horaires du marché', 'Example (demonstration): market opening hours',
      'Consultation fictive : donnez votre avis, ce n’est pas un vote officiel.', 'Fictional consultation: share your view, this is not an official vote.', now);
  for (const [fr, en, status, progress, district] of [
    ['Exemple (démonstration) : nouvelle ligne de tram T3', 'Example (demonstration): new tram line T3', 'planned', 0, 'Quartier ouest'],
    ['Exemple (démonstration) : rénovation de la serre', 'Example (demonstration): greenhouse renovation', 'in_progress', 40, 'Quartier nord'],
    ['Exemple (démonstration) : éclairage de l’avenue sud', 'Example (demonstration): south avenue lighting', 'done', 100, 'Quartier sud'],
  ]) {
    db.prepare("INSERT INTO part_projects (title, title_en, summary, summary_en, district, status, progress, demo, created_by_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'Démonstration', ?, ?)")
      .run(fr, en, 'Projet fictif pour la démonstration.', 'Fictional project for the demonstration.', district, status, progress, now, now);
  }
}

export function eraseParticipationUser(db, userId) {
  for (const table of ['part_voters', 'part_opinions', 'part_ideas', 'part_feedback']) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
}

const receipt = (prefix) => `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
const iso = () => new Date().toISOString();

export async function handleParticipation(ctx) {
  const { path, method, user, db, readJson, sendJson, fail } = ctx;
  if (!path.startsWith('/api/participation/') && path !== '/api/participation') return false;
  const parts = path.slice('/api/participation/'.length).split('/').filter(Boolean);
  const tx = (work) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const audit = (entry) => ctx.audit?.(user, { category: 'participation', ...entry });
  const need = (roles) => {
    if (!user) fail(401, 'Connectez-vous pour continuer.', { code: 'login_required' });
    if (!roles.includes(user.role)) fail(403, 'Accès réservé.', { code: 'forbidden' });
    return user;
  };
  const staff = () => need(['agent', 'admin']);
  const citizen = () => need(['citizen']);

  const clean = (value, min, max, label, optional = false) => {
    if (value === undefined || value === null || value === '') {
      if (optional) return null;
      fail(400, `${label} est obligatoire.`, { code: 'invalid' });
    }
    const text = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() : '';
    if (text.length < min || text.length > max) fail(400, `${label} doit contenir entre ${min} et ${max} caractères.`, { code: 'invalid' });
    return text;
  };
  const integer = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) fail(400, `${label} est invalide.`, { code: 'invalid' });
    return value;
  };
  const id = (value) => { const n = Number(value); if (!/^\d{1,9}$/.test(String(value)) || n < 1) fail(404, 'Introuvable.', { code: 'not_found' }); return n; };
  const when = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(400, 'La date de clôture est invalide.', { code: 'invalid' });
    return new Date(value).toISOString();
  };
  const effective = (row) => (row.status === 'open' && row.closes_at && Date.parse(row.closes_at) <= Date.now() ? 'closed' : row.status);
  const staffLabel = () => `${user.role === 'admin' ? 'Administration' : 'Agent'} ${String(user.name || '').slice(0, 40)}`.trim();
  const key = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) fail(400, 'Clé de soumission invalide.', { code: 'invalid' });
    return value;
  };
  const rateCheck = (table) => {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    if (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND created_at > ?`).get(user.id, since).n >= HOURLY_CAP) fail(429, 'Trop d’envois récents, réessayez plus tard.', { code: 'rate_limited', retryAfter: 600 });
  };
  const serviceTitle = (serviceId) => { try { return db.prepare('SELECT title FROM services WHERE id = ?').get(serviceId)?.title ?? null; } catch { return null; } };

  // ---- views
  const choicesOf = (decisionId) => db.prepare('SELECT id, label, label_en, votes FROM part_choices WHERE decision_id = ? ORDER BY id').all(decisionId);
  const decisionView = (row, { results = false } = {}) => {
    const status = effective(row);
    const choices = choicesOf(row.id);
    const view = {
      id: row.id, title: row.title, title_en: row.title_en, summary: row.summary, summary_en: row.summary_en, status, closesAt: row.closes_at, demo: !!row.demo,
      participants: choices.reduce((sum, choice) => sum + choice.votes, 0), outcomeNote: status === 'closed' ? row.outcome_note : null,
      choices: choices.map(({ id: choiceId, label, label_en, votes }) => ({ id: choiceId, label, label_en, ...(results || status === 'closed' ? { votes } : {}) })),
    };
    if (user?.role === 'citizen') {
      const mine = db.prepare('SELECT receipt, voted_at FROM part_voters WHERE decision_id = ? AND user_id = ?').get(row.id, user.id);
      view.myVote = mine ? { receipt: mine.receipt, votedAt: mine.voted_at } : null; // never the choice: it is not stored
    }
    return view;
  };
  const consultationView = (row, { summary = false } = {}) => {
    const view = { id: row.id, title: row.title, title_en: row.title_en, body: row.body, body_en: row.body_en, status: effective(row), closesAt: row.closes_at, demo: !!row.demo };
    if (user?.role === 'citizen') {
      const mine = db.prepare('SELECT rating, comment, receipt, created_at, updated_at FROM part_opinions WHERE consultation_id = ? AND user_id = ?').get(row.id, user.id);
      view.myOpinion = mine ? { rating: mine.rating, comment: mine.comment, receipt: mine.receipt, createdAt: mine.created_at, updatedAt: mine.updated_at } : null;
    }
    if (summary) {
      const stats = db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS average FROM part_opinions WHERE consultation_id = ?').get(row.id);
      view.opinionCount = stats.n;
      view.averageRating = stats.average === null ? null : Math.round(stats.average * 10) / 10;
      view.comments = db.prepare("SELECT rating, comment, updated_at FROM part_opinions WHERE consultation_id = ? AND comment IS NOT NULL AND comment <> '' ORDER BY updated_at DESC LIMIT 200").all(row.id)
        .map((comment) => ({ rating: comment.rating, comment: comment.comment, at: comment.updated_at })); // anonymous on purpose
    }
    return view;
  };
  const projectView = (row) => ({ id: row.id, title: row.title, title_en: row.title_en, summary: row.summary, summary_en: row.summary_en, district: row.district, status: row.status, progress: row.progress, startsOn: row.starts_on, endsOn: row.ends_on, demo: !!row.demo, updatedAt: row.updated_at });
  const ideaView = (row, withAuthor = false) => ({ id: row.id, title: row.title, body: row.body, status: row.status, staffNote: row.staff_note, receipt: row.receipt, createdAt: row.created_at, updatedAt: row.updated_at, ...(withAuthor ? { author: row.author ?? null } : {}) });
  const feedbackView = (row) => ({ id: row.id, serviceId: row.service_id, serviceTitle: serviceTitle(row.service_id), rating: row.rating, comment: row.comment, receipt: row.receipt, createdAt: row.created_at });

  const [area, a, b, c] = parts;
  const body = () => readJson(ctx.request);

  // ---- public / citizen
  if (area === 'overview' && method === 'GET' && !a) {
    const decisions = db.prepare("SELECT * FROM part_decisions WHERE status IN ('open', 'closed') ORDER BY id DESC LIMIT 50").all().map((row) => decisionView(row));
    const consultations = db.prepare("SELECT * FROM part_consultations WHERE status IN ('open', 'closed') ORDER BY id DESC LIMIT 50").all().map((row) => consultationView(row));
    const projects = db.prepare('SELECT * FROM part_projects ORDER BY id DESC LIMIT 100').all().map(projectView);
    return sendJson(ctx.response, 200, { decisions, consultations, projects }), true;
  }
  if (area === 'projects' && method === 'GET' && !a) return sendJson(ctx.response, 200, { projects: db.prepare('SELECT * FROM part_projects ORDER BY id DESC LIMIT 100').all().map(projectView) }), true;

  if (area === 'decisions' && b === 'vote' && method === 'POST') {
    const me = citizen();
    const decisionId = id(a);
    const { choiceId } = await body();
    const outcome = tx(() => {
      const row = db.prepare('SELECT * FROM part_decisions WHERE id = ?').get(decisionId);
      if (!row || row.status === 'draft') fail(404, 'Décision introuvable.', { code: 'not_found' });
      if (effective(row) !== 'open') fail(409, 'Ce vote est clos.', { code: 'closed' });
      const choice = db.prepare('SELECT id FROM part_choices WHERE id = ? AND decision_id = ?').get(choiceId, decisionId);
      if (!choice) fail(400, 'Choix invalide.', { code: 'invalid_choice' });
      const already = db.prepare('SELECT receipt, voted_at FROM part_voters WHERE decision_id = ? AND user_id = ?').get(decisionId, me.id);
      if (already) fail(409, 'Vous avez déjà voté pour cette décision.', { code: 'already_voted', receipt: already.receipt, votedAt: already.voted_at });
      const code = receipt('V');
      const at = iso();
      db.prepare('INSERT INTO part_voters (decision_id, user_id, receipt, voted_at) VALUES (?, ?, ?, ?)').run(decisionId, me.id, code, at);
      db.prepare('UPDATE part_choices SET votes = votes + 1 WHERE id = ?').run(choice.id); // counter only: no voter-to-choice relation is stored (running totals and voter timestamps are not absolute anonymity)
      return { receipt: code, votedAt: at };
    });
    return sendJson(ctx.response, 201, outcome), true;
  }

  if (area === 'consultations' && b === 'opinion' && (method === 'PUT' || method === 'POST' || method === 'GET')) {
    const me = citizen();
    const consultationId = id(a);
    if (method === 'GET') {
      const row = db.prepare('SELECT * FROM part_consultations WHERE id = ?').get(consultationId);
      if (!row || row.status === 'draft') fail(404, 'Consultation introuvable.', { code: 'not_found' });
      return sendJson(ctx.response, 200, { opinion: consultationView(row).myOpinion }), true;
    }
    const input = await body(); // the row is read again INSIDE the write transaction below: staff may close it, or its deadline may pass, while the body arrives
    const rating = input.rating === undefined || input.rating === null ? null : integer(input.rating, 1, 5, 'La note');
    const comment = clean(input.comment, 2, 1000, 'Le commentaire', true);
    if (rating === null && !comment) fail(400, 'Donnez une note ou un commentaire.', { code: 'invalid' });
    const result = tx(() => {
      const row = db.prepare('SELECT * FROM part_consultations WHERE id = ?').get(consultationId);
      if (!row || row.status === 'draft') fail(404, 'Consultation introuvable.', { code: 'not_found' });
      if (effective(row) !== 'open') fail(409, 'Cette consultation est close.', { code: 'closed' });
      const existing = db.prepare('SELECT receipt FROM part_opinions WHERE consultation_id = ? AND user_id = ?').get(consultationId, me.id);
      const at = iso();
      if (existing) {
        db.prepare('UPDATE part_opinions SET rating = ?, comment = ?, updated_at = ? WHERE consultation_id = ? AND user_id = ?').run(rating, comment, at, consultationId, me.id);
        return { status: 200, receipt: existing.receipt, updated: true, savedAt: at };
      }
      const code = receipt('O');
      db.prepare('INSERT INTO part_opinions (consultation_id, user_id, rating, comment, receipt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(consultationId, me.id, rating, comment, code, at, at);
      return { status: 201, receipt: code, updated: false, savedAt: at };
    });
    const { status, ...payload } = result;
    return sendJson(ctx.response, status, payload), true;
  }

  if (area === 'ideas' && !a && method === 'POST') {
    const me = citizen();
    const input = await body();
    const submissionKey = key(input.key);
    const result = tx(() => {
      const existing = db.prepare('SELECT * FROM part_ideas WHERE user_id = ? AND key = ?').get(me.id, submissionKey);
      if (existing) return { status: 200, idea: ideaView(existing), duplicate: true };
      const title = clean(input.title, 4, 100, 'Le titre');
      const text = clean(input.body, 10, 1000, 'La description');
      rateCheck('part_ideas');
      const at = iso();
      const code = receipt('I');
      const rowId = db.prepare('INSERT INTO part_ideas (user_id, key, title, body, receipt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(me.id, submissionKey, title, text, code, at, at).lastInsertRowid;
      return { status: 201, idea: ideaView(db.prepare('SELECT * FROM part_ideas WHERE id = ?').get(rowId)), duplicate: false };
    });
    const { status, ...payload } = result;
    return sendJson(ctx.response, status, payload), true;
  }
  if (area === 'ideas' && a === 'mine' && method === 'GET') {
    const me = citizen();
    return sendJson(ctx.response, 200, { ideas: db.prepare('SELECT * FROM part_ideas WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(me.id).map((row) => ideaView(row)) }), true;
  }

  if (area === 'feedback' && !a && method === 'POST') {
    const me = citizen();
    const input = await body();
    const submissionKey = key(input.key);
    const result = tx(() => {
      const existing = db.prepare('SELECT * FROM part_feedback WHERE user_id = ? AND key = ?').get(me.id, submissionKey);
      if (existing) return { status: 200, feedback: feedbackView(existing), duplicate: true };
      const serviceId = integer(input.serviceId, 1, 1_000_000_000, 'Le service');
      if (serviceTitle(serviceId) === null) fail(400, 'Service inconnu.', { code: 'unknown_service' });
      const rating = integer(input.rating, 1, 5, 'La note');
      const comment = clean(input.comment, 2, 1000, 'Le commentaire', true);
      rateCheck('part_feedback');
      const code = receipt('F');
      const rowId = db.prepare('INSERT INTO part_feedback (user_id, key, service_id, rating, comment, receipt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(me.id, submissionKey, serviceId, rating, comment, code, iso()).lastInsertRowid;
      return { status: 201, feedback: feedbackView(db.prepare('SELECT * FROM part_feedback WHERE id = ?').get(rowId)), duplicate: false };
    });
    const { status, ...payload } = result;
    return sendJson(ctx.response, status, payload), true;
  }
  if (area === 'feedback' && a === 'summary' && method === 'GET') {
    const rows = db.prepare('SELECT service_id, COUNT(*) AS n, AVG(rating) AS average FROM part_feedback GROUP BY service_id').all();
    return sendJson(ctx.response, 200, { services: rows.map((row) => ({ serviceId: row.service_id, serviceTitle: serviceTitle(row.service_id), count: row.n, average: Math.round(row.average * 10) / 10 })) }), true;
  }

  if (area === 'mine' && !a && method === 'GET') {
    const me = citizen();
    const votes = db.prepare('SELECT part_voters.receipt, part_voters.voted_at, part_decisions.id AS decision_id, part_decisions.title, part_decisions.title_en, part_decisions.status, part_decisions.closes_at FROM part_voters JOIN part_decisions ON part_decisions.id = part_voters.decision_id WHERE part_voters.user_id = ? ORDER BY part_voters.voted_at DESC').all(me.id)
      .map((row) => ({ decisionId: row.decision_id, title: row.title, title_en: row.title_en, status: effective(row), receipt: row.receipt, votedAt: row.voted_at }));
    const opinions = db.prepare('SELECT part_opinions.*, part_consultations.title, part_consultations.title_en, part_consultations.status AS cstatus, part_consultations.closes_at FROM part_opinions JOIN part_consultations ON part_consultations.id = part_opinions.consultation_id WHERE part_opinions.user_id = ? ORDER BY part_opinions.updated_at DESC').all(me.id)
      .map((row) => ({ consultationId: row.consultation_id, title: row.title, title_en: row.title_en, status: effective({ status: row.cstatus, closes_at: row.closes_at }), rating: row.rating, comment: row.comment, receipt: row.receipt, updatedAt: row.updated_at }));
    const ideas = db.prepare('SELECT * FROM part_ideas WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(me.id).map((row) => ideaView(row));
    const feedback = db.prepare('SELECT * FROM part_feedback WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(me.id).map(feedbackView);
    return sendJson(ctx.response, 200, { votes, opinions, ideas, feedback }), true;
  }

  // ---- staff
  if (area === 'admin') {
    if (a === 'overview' && method === 'GET') {
      staff();
      const decisions = db.prepare('SELECT * FROM part_decisions ORDER BY id DESC LIMIT 100').all().map((row) => decisionView(row, { results: true }));
      const consultations = db.prepare('SELECT * FROM part_consultations ORDER BY id DESC LIMIT 100').all().map((row) => consultationView(row, { summary: true }));
      const projects = db.prepare('SELECT * FROM part_projects ORDER BY id DESC LIMIT 100').all().map(projectView);
      const ideas = db.prepare('SELECT part_ideas.*, users.name AS author FROM part_ideas LEFT JOIN users ON users.id = part_ideas.user_id ORDER BY part_ideas.id DESC LIMIT 200').all().map((row) => ideaView(row, true));
      const feedback = db.prepare('SELECT * FROM part_feedback ORDER BY id DESC LIMIT 200').all().map((row) => ({ ...feedbackView(row) })); // anonymous
      return sendJson(ctx.response, 200, { decisions, consultations, projects, ideas, feedback }), true;
    }
    if (a === 'ideas' && b && method === 'PATCH') {
      staff();
      const ideaId = id(b);
      const input = await body();
      if (!STATUS_IDEA.includes(input.status)) fail(400, 'Statut invalide.', { code: 'invalid' });
      const note = clean(input.note, 2, 500, 'La réponse', true);
      const row = db.prepare('SELECT * FROM part_ideas WHERE id = ?').get(ideaId);
      if (!row) fail(404, 'Idée introuvable.', { code: 'not_found' });
      db.prepare('UPDATE part_ideas SET status = ?, staff_note = ?, updated_at = ? WHERE id = ?').run(input.status, note, iso(), ideaId);
      audit({ action: 'participation.idea.answer', target: { type: 'idea', id: ideaId, label: row.title }, summary: `a répondu à l’idée « ${row.title.slice(0, 60)} » (${input.status})` });
      return sendJson(ctx.response, 200, { idea: ideaView(db.prepare('SELECT * FROM part_ideas WHERE id = ?').get(ideaId)) }), true;
    }
    const kinds = { decisions: 'part_decisions', consultations: 'part_consultations', projects: 'part_projects' };
    const table = kinds[a];
    if (table && !b && method === 'POST') {
      staff();
      const input = await body();
      const at = iso();
      const common = { title: clean(input.title, 4, 120, 'Le titre'), title_en: clean(input.title_en, 4, 120, 'Le titre anglais', true), demo: input.demo ? 1 : 0 };
      let rowId;
      if (a === 'decisions') {
        const summary = clean(input.summary, 10, 1000, 'Le résumé');
        const choices = Array.isArray(input.choices) ? input.choices : [];
        if (choices.length < 2 || choices.length > 6) fail(400, 'Une décision a entre 2 et 6 choix.', { code: 'invalid' });
        const labels = choices.map((choice) => ({ label: clean(choice?.label, 1, 80, 'Le choix'), label_en: clean(choice?.label_en, 1, 80, 'Le choix anglais', true) }));
        rowId = tx(() => {
          const newId = db.prepare('INSERT INTO part_decisions (title, title_en, summary, summary_en, status, closes_at, demo, created_by_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(common.title, common.title_en, summary, clean(input.summary_en, 10, 1000, 'Le résumé anglais', true), input.publish ? 'open' : 'draft', when(input.closesAt), common.demo, staffLabel(), at).lastInsertRowid;
          for (const choice of labels) db.prepare('INSERT INTO part_choices (decision_id, label, label_en) VALUES (?, ?, ?)').run(newId, choice.label, choice.label_en);
          return newId;
        });
      } else if (a === 'consultations') {
        rowId = db.prepare('INSERT INTO part_consultations (title, title_en, body, body_en, status, closes_at, demo, created_by_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(common.title, common.title_en, clean(input.body, 10, 2000, 'Le texte'), clean(input.body_en, 10, 2000, 'Le texte anglais', true), input.publish ? 'open' : 'draft', when(input.closesAt), common.demo, staffLabel(), at).lastInsertRowid;
      } else {
        const status = STATUS_PROJECT.includes(input.status) ? input.status : 'planned';
        const progress = input.progress === undefined ? 0 : integer(input.progress, 0, 100, 'L’avancement');
        rowId = db.prepare('INSERT INTO part_projects (title, title_en, summary, summary_en, district, status, progress, starts_on, ends_on, demo, created_by_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(common.title, common.title_en, clean(input.summary, 10, 1000, 'Le résumé'), clean(input.summary_en, 10, 1000, 'Le résumé anglais', true), clean(input.district, 2, 80, 'Le quartier', true), status, progress, clean(input.startsOn, 4, 10, 'La date de début', true), clean(input.endsOn, 4, 10, 'La date de fin', true), common.demo, staffLabel(), at, at).lastInsertRowid;
      }
      audit({ action: `participation.${a.slice(0, -1)}.create`, target: { type: a.slice(0, -1), id: rowId, label: common.title }, summary: `a créé « ${common.title.slice(0, 60)} »${common.demo ? ' (démonstration)' : ''}` });
      return sendJson(ctx.response, 201, { id: rowId }), true;
    }
    if (table && b && !c && method === 'PATCH') {
      staff();
      const rowId = id(b);
      const input = await body();
      // Fresh row inside the write transaction (after the body arrived): a delayed PATCH never acts on a stale row and never reopens what another request closed.
      const row = tx(() => {
        const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
        if (!current) fail(404, 'Introuvable.', { code: 'not_found' });
        if (a === 'projects') {
          const status = input.status === undefined ? current.status : (STATUS_PROJECT.includes(input.status) ? input.status : fail(400, 'Statut invalide.', { code: 'invalid' }));
          const progress = input.progress === undefined ? current.progress : integer(input.progress, 0, 100, 'L’avancement');
          db.prepare('UPDATE part_projects SET status = ?, progress = ?, summary = ?, summary_en = ?, updated_at = ? WHERE id = ?')
            .run(status, progress, input.summary === undefined ? current.summary : clean(input.summary, 10, 1000, 'Le résumé'), input.summary_en === undefined ? current.summary_en : clean(input.summary_en, 10, 1000, 'Le résumé anglais', true), iso(), rowId);
          return current;
        }
        const next = input.status === undefined ? current.status : input.status;
        if (!STATUS_DECISION.includes(next)) fail(400, 'Statut invalide.', { code: 'invalid' });
        const closedNow = effective(current) === 'closed'; // includes auto-closure by date, even when the stored status still says open
        if (closedNow && (next !== 'closed' || (input.closesAt !== undefined && when(input.closesAt) !== current.closes_at))) fail(409, a === 'decisions' ? 'Un vote clos ne peut pas être rouvert.' : 'Une consultation close ne peut pas être rouverte.', { code: 'closed' });
        if (current.status === 'open' && next === 'draft') fail(409, 'Une publication ne repasse pas en brouillon.', { code: 'invalid' });
        const closedAt = next === 'closed' ? (current.closed_at ?? (closedNow ? current.closes_at : iso())) : null;
        const closesAt = input.closesAt === undefined ? current.closes_at : when(input.closesAt);
        if (a === 'decisions') db.prepare('UPDATE part_decisions SET status = ?, closes_at = ?, closed_at = ?, outcome_note = ? WHERE id = ?').run(next, closesAt, closedAt, input.outcomeNote === undefined ? current.outcome_note : clean(input.outcomeNote, 2, 500, 'La note de décision', true), rowId);
        else db.prepare('UPDATE part_consultations SET status = ?, closes_at = ?, closed_at = ? WHERE id = ?').run(next, closesAt, closedAt, rowId);
        return current;
      });
      audit({ action: `participation.${a.slice(0, -1)}.update`, target: { type: a.slice(0, -1), id: rowId, label: row.title }, summary: `a modifié « ${row.title.slice(0, 60)} »` });
      return sendJson(ctx.response, 200, { ok: true }), true;
    }
    if (table && b && !c && method === 'DELETE') {
      need(['admin']);
      const rowId = id(b);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
      if (!row) fail(404, 'Introuvable.', { code: 'not_found' });
      tx(() => {
        if (a === 'decisions') { db.prepare('DELETE FROM part_voters WHERE decision_id = ?').run(rowId); db.prepare('DELETE FROM part_choices WHERE decision_id = ?').run(rowId); }
        if (a === 'consultations') db.prepare('DELETE FROM part_opinions WHERE consultation_id = ?').run(rowId);
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId);
      });
      audit({ action: `participation.${a.slice(0, -1)}.delete`, target: { type: a.slice(0, -1), id: rowId, label: row.title }, summary: `a supprimé « ${row.title.slice(0, 60)} »` });
      return sendJson(ctx.response, 200, { ok: true }), true;
    }
  }
  fail(404, 'Introuvable.', { code: 'not_found' });
}
