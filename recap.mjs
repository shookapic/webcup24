// F55 / F56: readable copies of a resident's own data. Pure functions: they receive the data already read for that resident and return
// a standalone HTML page or a CSV file. Everything that comes from a person is escaped; CSV cells that could run as a formula are neutralised.
const text = {
  fr: {
    locale: 'fr-FR', tz: '(heure de la cité)', at: 'à',
    status: { new: 'Reçue, pas encore prise en charge', in_progress: 'En cours de traitement', resolved: 'Résolue' },
    kind: { contact: 'Question aux services', incident: 'Signalement de problème' },
    concern: { received: 'Reçue', read: 'Lue par un agent', answered: 'Réponse donnée' },
    topic: { usage: 'À quoi servent mes données', sharing: 'Qui peut voir mes données', storage: 'Combien de temps elles sont gardées', access: 'Voir, corriger ou effacer mes données', other: 'Autre sujet' },
    none: 'Aucun', yes: 'Oui', no: 'Non',
    print: 'Pour imprimer cette page : Ctrl+P (ou ⌘P sur Mac).',
    own: 'Cette page ne contient que vos propres informations.',
  },
  en: {
    locale: 'en-GB', tz: '(city time)', at: 'at',
    status: { new: 'Received, not yet taken on', in_progress: 'Being handled', resolved: 'Resolved' },
    kind: { contact: 'Question to the services', incident: 'Problem report' },
    concern: { received: 'Received', read: 'Read by an agent', answered: 'Answered' },
    topic: { usage: 'What my data is used for', sharing: 'Who can see my data', storage: 'How long it is kept', access: 'See, correct or erase my data', other: 'Other subject' },
    none: 'None', yes: 'Yes', no: 'No',
    print: 'To print this page: Ctrl+P (or ⌘P on a Mac).',
    own: 'This page only contains your own information.',
  },
};

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pickLang = (value) => (value === 'en' ? 'en' : 'fr');

const pad = (n) => String(n).padStart(2, '0');
const dmy = (y, m, d) => `${pad(d)}/${pad(m)}/${y}`;
// stored UTC 'YYYY-MM-DD HH:MM:SS' -> city time (UTC+4) as a readable string
export function cityStamp(utc, lang = 'fr') {
  if (!utc) return '';
  const date = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(utc);
  const city = new Date(date.getTime() + 4 * 3600_000);
  return `${dmy(city.getUTCFullYear(), city.getUTCMonth() + 1, city.getUTCDate())} ${text[lang].at} ${pad(city.getUTCHours())}:${pad(city.getUTCMinutes())}`;
}
// city-local 'YYYY-MM-DDTHH:MM' (appointments)
export function localStamp(local, lang = 'fr') {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${text[lang].at} ${m[4]}:${m[5]}` : String(local || '');
}
export function duration(from, to, lang = 'fr') {
  const hours = (Date.parse(`${String(to).replace(' ', 'T')}Z`) - Date.parse(`${String(from).replace(' ', 'T')}Z`)) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return '';
  if (hours < 1) return lang === 'en' ? 'under an hour' : 'moins d’une heure';
  if (hours < 48) return `${Math.round(hours)} h`;
  return lang === 'en' ? `${Math.round(hours / 24)} days` : `${Math.round(hours / 24)} jours`;
}

// one history line per message: state in words, the date it was resolved and how long it took, and the town hall's last note
export function requestRows(data, lang) {
  const t = text[lang];
  return data.messages.map((m) => {
    const notes = data.notices.filter((n) => n.code.startsWith('message.') && n.ref_id === m.id && n.note);
    const resolved = m.status === 'resolved';
    return {
      reference: `M-${m.id}`,
      received: cityStamp(m.created_at, lang),
      kind: t.kind[m.kind] || m.kind,
      subject: m.subject,
      place: m.location || '',
      state: t.status[m.status] || m.status,
      updated: cityStamp(m.updated_at, lang),
      outcome: resolved ? `${lang === 'en' ? 'Resolved on' : 'Résolue le'} ${cityStamp(m.updated_at, lang)} (${lang === 'en' ? 'handled in' : 'traitée en'} ${duration(m.created_at, m.updated_at, lang)})` : (lang === 'en' ? 'Not resolved yet' : 'Pas encore résolue'),
      note: notes.length ? notes[notes.length - 1].note : '',
      resolvedAt: resolved ? cityStamp(m.updated_at, lang) : '',
      hours: resolved ? Math.round(((Date.parse(`${m.updated_at.replace(' ', 'T')}Z`) - Date.parse(`${m.created_at.replace(' ', 'T')}Z`)) / 3_600_000) * 10) / 10 : '',
    };
  });
}

const page = (lang, title, body) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{font:16px/1.55 system-ui,sans-serif;margin:0;padding:1.5rem 1rem;color:#14212b;background:#fff}
main{max-width:62rem;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 .25rem}h2{font-size:1.2rem;margin:1.8rem 0 .5rem;border-bottom:2px solid #14212b;padding-bottom:.2rem}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #6b7b88;padding:.4rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e8eef3}
caption{text-align:left;font-weight:700;padding:.3rem 0}.scroll{overflow-x:auto}dl{display:grid;grid-template-columns:minmax(9rem,14rem) 1fr;gap:.3rem 1rem}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}
.note{color:#33434f}@media(max-width:600px){dl{grid-template-columns:1fr}}@media print{body{padding:0}a{color:inherit}}
</style></head><body><main>${body}</main></body></html>`;

const table = (caption, heads, rows, empty) => rows.length
  ? `<div class="scroll"><table><caption>${esc(caption)}</caption><thead><tr>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : `<p>${esc(empty)}</p>`;

// F83: the receipt of one request: reference, the code that lets anyone check it, when the city received it (city time), what was asked. Only the owner gets it.
export function receiptHtml(view, lang = 'fr') {
  const fr = lang === 'fr';
  const t = text[lang];
  const row = (label, value) => (value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : '');
  const body = `<h1>${fr ? 'Accusé de réception' : 'Acknowledgement of receipt'}</h1>
<p>${fr ? 'La ville de Terra Nova a bien reçu votre demande. Gardez cette page, ou notez la référence et le code : ils permettent de retrouver la demande et de vérifier cet accusé.' : 'The city of Terra Nova has received your request. Keep this page, or note the reference and the code: they let you find the request again and check this receipt.'} ${esc(t.print)}</p>
<dl>
<dt>${fr ? 'Référence' : 'Reference'}</dt><dd><strong>${esc(view.reference)}</strong></dd>
<dt>${fr ? 'Code de vérification' : 'Verification code'}</dt><dd><strong>${esc(view.code)}</strong></dd>
<dt>${fr ? 'Reçue le' : 'Received on'}</dt><dd>${esc(view.received)} ${t.tz}</dd>
${row(fr ? 'Type' : 'Type', t.kind[view.kind] || view.kind)}${row(fr ? 'Sujet' : 'Subject', view.subject)}${row(fr ? 'Lieu' : 'Place', view.location)}${row(fr ? 'Service concerné' : 'Service concerned', view.service)}
${row(fr ? 'État le jour de l’édition' : 'State on the day of printing', t.status[view.status] || view.status)}${row(fr ? 'Déposée par' : 'Sent by', view.name)}${row(fr ? 'Votre message' : 'Your message', view.body)}
</dl>
<h2>${fr ? 'Comment vérifier cet accusé' : 'How to check this receipt'}</h2>
<p>${fr ? 'Sur le portail, ouvrez « Vérifier un accusé de réception », saisissez la référence et le code. Le portail confirme la date de réception, sans montrer le contenu de la demande.' : 'On the portal, open “Check a receipt”, enter the reference and the code. The portal confirms the date of receipt without showing what the request says.'}</p>
<p class="note">${fr ? 'Page éditée le' : 'Page produced on'} ${esc(view.generated)} ${t.tz}.</p>`;
  return page(lang, `${fr ? 'Accusé de réception' : 'Receipt'} ${view.reference}`, body);
}

export function recapHtml(data, lang = 'fr') {
  const t = text[lang];
  const rows = requestRows(data, lang);
  const resolved = rows.filter((r) => r.resolvedAt);
  const waiting = data.messages.filter((m) => m.status === 'new').length;
  const handling = data.messages.filter((m) => m.status === 'in_progress').length;
  const hours = resolved.map((r) => r.hours);
  const average = hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null;
  const fr = lang === 'fr';
  const summary = data.messages.length
    ? (fr
      ? `Vous avez envoyé ${data.messages.length} ${data.messages.length === 1 ? 'demande' : 'demandes'} à la ville, la première le ${cityStamp(data.messages[0].created_at, lang)}. ${resolved.length} ${resolved.length === 1 ? 'est résolue' : 'sont résolues'}, ${handling} ${handling === 1 ? 'est en cours de traitement' : 'sont en cours de traitement'}, ${waiting} ${waiting === 1 ? 'attend' : 'attendent'} d’être prise${waiting === 1 ? '' : 's'} en charge.${average === null ? '' : ` Délai moyen de résolution : ${average} h.`} Le détail de chaque demande est dans le tableau ci-dessous.`
      : `You sent ${data.messages.length} ${data.messages.length === 1 ? 'request' : 'requests'} to the city, the first on ${cityStamp(data.messages[0].created_at, lang)}. ${resolved.length} resolved, ${handling} being handled, ${waiting} waiting to be taken on.${average === null ? '' : ` Average time to resolve: ${average} h.`} The detail of each request is in the table below.`)
    : (fr ? 'Vous n’avez encore envoyé aucune demande.' : 'You have not sent any request yet.');
  const body = `<h1>${fr ? 'Récapitulatif de mes demandes' : 'Summary of my requests'}</h1>
<p>${fr ? 'Établi le' : 'Produced on'} ${esc(localStamp(data.generated_at, lang))} ${t.tz} ${fr ? 'pour' : 'for'} ${esc(data.account.name)}. ${esc(t.own)} ${esc(t.print)}</p>
<h2>${fr ? 'En bref' : 'In short'}</h2><p>${esc(summary)}</p>
<h2>${fr ? 'Toutes mes demandes' : 'All my requests'}</h2>
${table(fr ? 'Demandes, de la plus ancienne à la plus récente' : 'Requests, oldest first', fr ? ['N°', 'Reçue le', 'Type', 'Sujet', 'Lieu', 'État', 'Dernière mise à jour', 'Issue', 'Message de la mairie'] : ['No.', 'Received', 'Type', 'Subject', 'Place', 'State', 'Last update', 'Outcome', 'Message from the town hall'], rows.map((r) => [r.reference, r.received, r.kind, r.subject, r.place, r.state, r.updated, r.outcome, r.note]), fr ? 'Aucune demande.' : 'No request.')}
<h2>${fr ? 'Mes rendez-vous' : 'My appointments'}</h2>
${table(fr ? 'Rendez-vous réservés' : 'Booked appointments', fr ? ['Quand', 'Durée', 'Où', 'Motif'] : ['When', 'Length', 'Where', 'Reason'], data.appointments.map((a) => [localStamp(a.starts_at, lang), `${a.duration_min} min`, a.location, a.reason || '']), fr ? 'Aucun rendez-vous réservé.' : 'No booked appointment.')}
<h2>${fr ? 'Mes inquiétudes sur les données' : 'My concerns about data'}</h2>
${table(fr ? 'Inquiétudes envoyées' : 'Concerns sent', fr ? ['Réf.', 'Envoyée le', 'Sujet', 'État', 'Réponse'] : ['Ref.', 'Sent', 'Subject', 'State', 'Answer'], data.concerns.map((c) => [`C-${c.id}`, cityStamp(c.created_at, lang), t.topic[c.topic] || c.topic, t.concern[c.status] || c.status, c.response || '']), fr ? 'Aucune inquiétude envoyée.' : 'No concern sent.')}`;
  return page(lang, fr ? 'Récapitulatif de mes demandes' : 'Summary of my requests', body);
}

export function personalHtml(data, lang = 'fr') {
  const t = text[lang];
  const fr = lang === 'fr';
  const a = data.account;
  const avatar = a.avatar ? `${fr ? 'peau' : 'skin'} ${a.avatar.skin}, ${fr ? 'tenue' : 'outfit'} ${a.avatar.outfit}, accent ${a.avatar.accent}${a.avatar.look ? `, ${fr ? 'apparence' : 'look'} ${a.avatar.look}` : ''}${a.avatar.accessory ? `, ${fr ? 'accessoire' : 'accessory'} ${a.avatar.accessory}` : ''}` : (fr ? 'pas encore choisi' : 'not chosen yet');
  const rows = requestRows(data, lang);
  const body = `<h1>${fr ? 'Mes informations sur le portail' : 'My information on the portal'}</h1>
<p>${fr ? 'Établi le' : 'Produced on'} ${esc(localStamp(data.generated_at, lang))} ${t.tz}. ${esc(t.own)} ${esc(t.print)}</p>
<h2>${fr ? 'Mon compte' : 'My account'}</h2>
<dl><dt>${fr ? 'Nom affiché' : 'Display name'}</dt><dd>${esc(a.name)}</dd><dt>${fr ? 'Adresse e-mail' : 'E-mail address'}</dt><dd>${esc(a.email)}</dd><dt>${fr ? 'Quartier' : 'District'}</dt><dd>${esc(a.district || (fr ? 'non précisé' : 'not given'))}</dd><dt>${fr ? 'Inscrit depuis le' : 'Registered on'}</dt><dd>${esc(cityStamp(a.created_at, lang))}</dd><dt>${fr ? 'Mon personnage' : 'My character'}</dt><dd>${esc(avatar)}</dd><dt>${fr ? 'Mot de passe' : 'Password'}</dt><dd>${fr ? 'gardé sous une forme brouillée que personne ne peut relire : il n’est pas dans ce document' : 'kept in a scrambled form nobody can read back: it is not in this document'}</dd></dl>
<h2>${fr ? 'Mes messages et signalements' : 'My messages and reports'}</h2>
${table(fr ? 'Messages et signalements' : 'Messages and reports', fr ? ['N°', 'Reçu le', 'Type', 'Sujet', 'Lieu', 'Mon message', 'État'] : ['No.', 'Received', 'Type', 'Subject', 'Place', 'My message', 'State'], data.messages.map((m, i) => [rows[i].reference, rows[i].received, rows[i].kind, m.subject, m.location || '', m.body, rows[i].state]), fr ? 'Aucun message.' : 'No message.')}
<h2>${fr ? 'Mes rendez-vous' : 'My appointments'}</h2>
${table(fr ? 'Rendez-vous réservés' : 'Booked appointments', fr ? ['Quand', 'Durée', 'Où', 'Motif', 'Réservé le'] : ['When', 'Length', 'Where', 'Reason', 'Booked on'], data.appointments.map((x) => [localStamp(x.starts_at, lang), `${x.duration_min} min`, x.location, x.reason || '', cityStamp(x.booked_at, lang)]), fr ? 'Aucun rendez-vous réservé.' : 'No booked appointment.')}
<h2>${fr ? 'Mes inquiétudes sur les données' : 'My concerns about data'}</h2>
${table(fr ? 'Inquiétudes envoyées' : 'Concerns sent', fr ? ['Réf.', 'Envoyée le', 'Sujet', 'Mon message', 'État', 'Réponse'] : ['Ref.', 'Sent', 'Subject', 'My message', 'State', 'Answer'], data.concerns.map((c) => [`C-${c.id}`, cityStamp(c.created_at, lang), t.topic[c.topic] || c.topic, c.body, t.concern[c.status] || c.status, c.response || '']), fr ? 'Aucune inquiétude envoyée.' : 'No concern sent.')}
<h2>${fr ? 'Mes appareils' : 'My devices'}</h2>
${table(fr ? 'Appareils depuis lesquels je me suis connecté' : 'Devices I signed in from', fr ? ['Appareil', 'Première connexion', 'Dernière connexion'] : ['Device', 'First sign-in', 'Last sign-in'], (data.devices || []).map((d) => [d.label, cityStamp(d.first_seen, lang), cityStamp(d.last_seen, lang)]), fr ? 'Aucun appareil enregistré.' : 'No device recorded.')}
<h2>${fr ? 'Mes signalements publiés et mes soutiens' : 'My published reports and supports'}</h2>
${table(fr ? 'Signalements que j’ai choisi de rendre visibles' : 'Reports I chose to make visible', fr ? ['Titre public', 'Résumé public', 'Quartier', 'Publié le', 'Soutiens reçus'] : ['Public title', 'Public summary', 'District', 'Published on', 'Supports received'], data.public_requests.map((p) => [p.public_title, p.public_summary, p.district, cityStamp(p.created_at, lang), String(p.support_count)]), fr ? 'Aucun signalement publié.' : 'No published report.')}
${table(fr ? 'Demandes d’autres habitants que je soutiens' : 'Requests of other residents that I support', fr ? ['Demande', 'Soutenue le'] : ['Request', 'Supported on'], data.supports.map((s) => [s.public_title, cityStamp(s.at, lang)]), fr ? 'Vous ne soutenez aucune demande.' : 'You do not support any request.')}
<h2>${fr ? 'Les nouvelles que j’ai reçues' : 'The news I received'}</h2>
${table(fr ? 'Nouvelles' : 'News', fr ? ['Date', 'Sujet', 'Message de la mairie', 'Lue'] : ['Date', 'About', 'Message from the town hall', 'Read'], data.notices.map((n) => [cityStamp(n.at, lang), n.label, n.note || '', n.seen_at ? t.yes : t.no]), fr ? 'Aucune nouvelle.' : 'No news.')}
<h2>${fr ? 'Ce que ce document ne contient pas' : 'What this document does not contain'}</h2>
<p>${fr ? 'Ni votre mot de passe, ni vos cookies de session, ni les informations d’autres habitants. Le journal des actions du personnel, qui ne peut être ni modifié ni effacé, garde des lignes qui vous concernent sous forme réduite (prénom, initiale, e-mail masqué, numéro de compte) : il n’est pas inclus ici. Aucune durée de conservation n’est fixée pour ce journal.' : 'Neither your password, nor your session cookies, nor other residents’ information. The staff action journal, which can be neither edited nor erased, keeps lines about you in reduced form (first name, initial, masked e-mail, account number): it is not included here. No retention period is set for that journal.'}</p>`;
  return page(lang, fr ? 'Mes informations sur le portail' : 'My information on the portal', body);
}

// CSV: UTF-8 with a BOM so spreadsheets read the accents; a cell starting with = + - @ (or a tab/CR) is prefixed so it can never run as a formula
export const csvCell = (value) => {
  let cell = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",;\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};
export function recapCsv(data, lang = 'fr') {
  const fr = lang === 'fr';
  const head = fr
    ? ['Numéro', 'Reçue le', 'Type', 'Sujet', 'Lieu', 'État', 'Dernière mise à jour', 'Résolue le', 'Durée de traitement (heures)', 'Message de la mairie']
    : ['Number', 'Received', 'Type', 'Subject', 'Place', 'State', 'Last update', 'Resolved on', 'Time to resolve (hours)', 'Message from the town hall'];
  const lines = requestRows(data, lang).map((r) => [r.reference, r.received, r.kind, r.subject, r.place, r.state, r.updated, r.resolvedAt, r.hours, r.note]);
  return `﻿${[head, ...lines].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
