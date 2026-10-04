// Civic participation UI (F65 decisions, F66 consultations, F67 projects, F68 ideas, F76 service feedback). Classic script, no dependency.
//   TerraParticipation.mount(root, { user, lang, api, services? }) -> { update({ user, lang }), unmount() }
// `api(path, method = 'GET', body)` is the portal adapter (same session cookie). Every string from the server is written with textContent: no HTML string insertion anywhere.
(() => {
  const STR = {
    fr: {
      title: 'Participation citoyenne', intro: 'Ici, la ville vous demande votre avis. Un vote officiel compte une voix par habitant et ne peut pas être modifié. Une consultation recueille des avis : ce n’est pas un vote.',
      loading: 'Chargement…', retry: 'Réessayer', loadError: 'La participation n’a pas pu être chargée.', demo: 'Exemple (démonstration)',
      decisions: 'Décisions soumises à vote', consultations: 'Consultations (avis, pas un vote)', projects: 'Projets en cours dans la ville', ideas: 'Proposer une idée', feedback: 'Donner son avis sur un service', mine: 'Ma participation',
      none: 'Rien pour le moment.', login: 'Connectez-vous à votre espace pour participer.', loginLink: 'Aller à mon espace', staffNoVote: 'Les agents et administrateurs ne votent pas : la voix appartient aux habitants.',
      open: 'Ouvert', closed: 'Clos', draft: 'Brouillon', closesOn: 'Clôture : {d}', closedOn: 'Clos', participants: '{n} participant(s)', officialVote: 'Vote officiel', notAVote: 'Consultation : pas un vote',
      yourChoice: 'Votre choix', vote: 'Voter', confirmVote: 'Confirmer mon vote', cancel: 'Annuler', confirmText: 'Vous allez voter pour « {c} ». Un vote ne peut pas être modifié.', pickOne: 'Choisissez une option.',
      voted: 'Vous avez voté le {d}. Reçu : {r}. Votre choix n’est pas conservé avec votre nom.', voteDone: 'Vote enregistré. Reçu : {r}. Gardez ce numéro comme preuve.', voteAlready: 'Vous avez déjà voté pour cette décision.', voteClosed: 'Ce vote est clos.',
      results: 'Résultats', votesN: '{n} voix ({p} %)', outcome: 'Décision : {t}',
      rating: 'Votre note', r1: '1 sur 5', ratingN: '{n} sur 5', comment: 'Votre commentaire', optional: '(facultatif)', sendOpinion: 'Envoyer mon avis', editOpinion: 'Modifier mon avis',
      opinionDone: 'Avis enregistré. Reçu : {r}.', opinionUpdated: 'Avis mis à jour. Reçu : {r}.', myOpinion: 'Votre avis enregistré (reçu {r}). Vous pouvez le modifier tant que la consultation est ouverte.', opinionNeeded: 'Donnez une note ou un commentaire.',
      progress: 'Avancement', district: 'Quartier', pPlanned: 'Prévu', pIn_progress: 'En cours', pDone: 'Terminé',
      ideaTitle: 'Titre de l’idée', ideaBody: 'Décrivez votre idée', sendIdea: 'Envoyer mon idée', ideaDone: 'Idée reçue. Reçu : {r}. Vous pouvez suivre son état ci-dessous.', ideaDup: 'Cette idée était déjà enregistrée. Reçu : {r}.', myIdeas: 'Mes idées',
      sReceived: 'Reçue', sUnder_review: 'À l’étude', sAccepted: 'Retenue', sDeclined: 'Non retenue', staffNote: 'Réponse de la ville : {t}', receiptN: 'Reçu {r}',
      service: 'Service concerné', choose: '— Choisir —', sendFeedback: 'Envoyer mon avis', feedbackDone: 'Merci. Avis enregistré. Reçu : {r}.', feedbackDup: 'Cet avis était déjà enregistré. Reçu : {r}.', noServices: 'Aucun service à noter pour le moment.',
      historyVotes: 'Mes votes', historyOpinions: 'Mes avis sur les consultations', historyFeedback: 'Mes avis sur les services', historyEmpty: 'Vous n’avez pas encore participé.',
      tooMany: 'Trop d’envois récents. Réessayez dans quelques minutes.', needLogin: 'Votre session a expiré : reconnectez-vous.', failed: 'L’envoi a échoué : {m}', sending: 'Envoi…',
      staffTitle: 'Gestion de la participation (agents)', newDecision: 'Nouvelle décision soumise à vote', newConsultation: 'Nouvelle consultation', newProject: 'Nouveau projet',
      fTitle: 'Titre', fSummary: 'Résumé', fBody: 'Texte de la consultation', fChoices: 'Choix (un par ligne, 2 à 6)', fClose: 'Clôture (facultatif)', fDemo: 'Contenu de démonstration (affiché « Exemple »)', fPublish: 'Publier tout de suite',
      fDistrict: 'Quartier', fStatus: 'État', create: 'Créer', created: 'Créé.', closeIt: 'Clore', publishIt: 'Publier', deleteIt: 'Supprimer', setProgress: 'Mettre à jour', answer: 'Répondre', note: 'Réponse à l’habitant (facultatif)',
      staffIdeas: 'Idées des habitants', staffFeedback: 'Avis sur les services (anonymes)', staffOpinions: '{n} avis, moyenne {a}', adminOnlyDelete: 'Suppression réservée aux administrateurs.', confirmDelete: 'Supprimer « {t} » définitivement ?', done: 'Fait.',
      requiredCreate: 'Le titre et le texte sont obligatoires.', author: 'Par {a}', noComment: '(sans commentaire)',
    },
    en: {
      title: 'Citizen participation', intro: 'Here the city asks for your view. An official vote counts one voice per resident and cannot be changed. A consultation gathers opinions: it is not a vote.',
      loading: 'Loading…', retry: 'Try again', loadError: 'Participation could not be loaded.', demo: 'Example (demonstration)',
      decisions: 'Decisions put to a vote', consultations: 'Consultations (opinions, not a vote)', projects: 'Projects under way in the city', ideas: 'Suggest an idea', feedback: 'Give feedback on a service', mine: 'My participation',
      none: 'Nothing for now.', login: 'Sign in to your space to take part.', loginLink: 'Go to my space', staffNoVote: 'Agents and administrators do not vote: the voice belongs to residents.',
      open: 'Open', closed: 'Closed', draft: 'Draft', closesOn: 'Closes: {d}', closedOn: 'Closed', participants: '{n} participant(s)', officialVote: 'Official vote', notAVote: 'Consultation: not a vote',
      yourChoice: 'Your choice', vote: 'Vote', confirmVote: 'Confirm my vote', cancel: 'Cancel', confirmText: 'You are about to vote for “{c}”. A vote cannot be changed.', pickOne: 'Choose an option.',
      voted: 'You voted on {d}. Receipt: {r}. Your choice is not kept with your name.', voteDone: 'Vote recorded. Receipt: {r}. Keep this number as proof.', voteAlready: 'You have already voted on this decision.', voteClosed: 'This vote is closed.',
      results: 'Results', votesN: '{n} votes ({p}%)', outcome: 'Decision: {t}',
      rating: 'Your rating', r1: '1 out of 5', ratingN: '{n} out of 5', comment: 'Your comment', optional: '(optional)', sendOpinion: 'Send my opinion', editOpinion: 'Update my opinion',
      opinionDone: 'Opinion recorded. Receipt: {r}.', opinionUpdated: 'Opinion updated. Receipt: {r}.', myOpinion: 'Your saved opinion (receipt {r}). You can change it while the consultation is open.', opinionNeeded: 'Give a rating or a comment.',
      progress: 'Progress', district: 'District', pPlanned: 'Planned', pIn_progress: 'In progress', pDone: 'Done',
      ideaTitle: 'Idea title', ideaBody: 'Describe your idea', sendIdea: 'Send my idea', ideaDone: 'Idea received. Receipt: {r}. Follow its status below.', ideaDup: 'This idea was already recorded. Receipt: {r}.', myIdeas: 'My ideas',
      sReceived: 'Received', sUnder_review: 'Under review', sAccepted: 'Accepted', sDeclined: 'Declined', staffNote: 'City reply: {t}', receiptN: 'Receipt {r}',
      service: 'Service concerned', choose: '— Choose —', sendFeedback: 'Send my feedback', feedbackDone: 'Thank you. Feedback recorded. Receipt: {r}.', feedbackDup: 'This feedback was already recorded. Receipt: {r}.', noServices: 'No service to rate for now.',
      historyVotes: 'My votes', historyOpinions: 'My opinions on consultations', historyFeedback: 'My feedback on services', historyEmpty: 'You have not taken part yet.',
      tooMany: 'Too many recent submissions. Try again in a few minutes.', needLogin: 'Your session expired: sign in again.', failed: 'Sending failed: {m}', sending: 'Sending…',
      staffTitle: 'Participation management (agents)', newDecision: 'New decision put to a vote', newConsultation: 'New consultation', newProject: 'New project',
      fTitle: 'Title', fSummary: 'Summary', fBody: 'Consultation text', fChoices: 'Choices (one per line, 2 to 6)', fClose: 'Closing date (optional)', fDemo: 'Demonstration content (shown as “Example”)', fPublish: 'Publish right away',
      fDistrict: 'District', fStatus: 'Status', create: 'Create', created: 'Created.', closeIt: 'Close', publishIt: 'Publish', deleteIt: 'Delete', setProgress: 'Update', answer: 'Reply', note: 'Reply to the resident (optional)',
      staffIdeas: 'Residents’ ideas', staffFeedback: 'Feedback on services (anonymous)', staffOpinions: '{n} opinions, average {a}', adminOnlyDelete: 'Deleting is for administrators only.', confirmDelete: 'Delete “{t}” permanently?', done: 'Done.',
      requiredCreate: 'Title and text are required.', author: 'By {a}', noComment: '(no comment)',
    },
  };

  function mount(root, options) {
    let { user, lang, api } = options;
    let state = { overview: null, mine: null, admin: null, services: options.services ?? null, error: null, loading: true };
    let alive = true;
    const flash = new Map(); // status-line key -> { text, error }, shown (and focused) after the next render so a confirmation survives the reload
    let focusAfter = null;
    const keys = new Map(); // form -> submission key, reused until the server accepted it (a double click or retry returns the same receipt)
    const T = (key, vars = {}) => (STR[lang]?.[key] ?? STR.fr[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
    const pick = (row, field) => (lang === 'en' && row[`${field}_en`]) || row[field];
    const fmt = (iso) => { try { return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return String(iso); } };
    const isCitizen = () => user?.role === 'citizen';
    const isStaff = () => user && (user.role === 'agent' || user.role === 'admin');
    const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40).padEnd(8, '0');

    function h(tag, attrs, ...children) {
      const el = document.createElement(tag);
      for (const [name, value] of Object.entries(attrs ?? {})) {
        if (value === undefined || value === null || value === false) continue;
        if (name === 'class') el.className = value;
        else if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
        else if (value === true) el.setAttribute(name, '');
        else el.setAttribute(name, String(value));
      }
      for (const child of children.flat()) if (child !== undefined && child !== null && child !== false) el.append(child.nodeType ? child : document.createTextNode(String(child)));
      return el;
    }
    const field = (label, control, hint) => { const id = `tp-${Math.random().toString(36).slice(2, 9)}`; control.id = id; return h('div', { class: 'tp-field' }, h('label', { for: id }, label, hint ? h('span', { class: 'tp-hint' }, ` ${hint}`) : null), control); };
    const badge = (text, kind) => h('span', { class: `tp-badge tp-badge-${kind}` }, text);
    const statusLine = (key) => {
      const el = h('p', { class: 'tp-status', role: 'status', 'aria-live': 'polite', tabindex: '-1' });
      const message = key && flash.get(key);
      if (message) { el.textContent = message.text; el.classList.toggle('tp-error', !!message.error); flash.delete(key); focusAfter = el; }
      return el;
    };
    const flashAndReload = async (key, text, error) => { flash.set(key, { text, error }); await load(); };
    const say = (el, message, error) => { el.textContent = message; el.classList.toggle('tp-error', !!error); el.focus?.(); };
    const errorText = (error, form) => {
      if (error?.status === 401) return T('needLogin');
      if (error?.status === 429) return T('tooMany');
      return T('failed', { m: error?.message || '' });
    };

    async function load() {
      state.loading = true; state.error = null;
      if (!state.overview) render(); // first load only; later reloads keep the current DOM until the new data is there
      try {
        state.overview = await api('/api/participation/overview');
        state.mine = isCitizen() ? await api('/api/participation/mine') : null;
        state.admin = isStaff() ? await api('/api/participation/admin/overview') : null;
        if (isCitizen() && !state.services) { try { const data = await api('/api/services'); state.services = (data.services ?? []).map((s) => ({ id: s.id, title: s.title })); } catch { state.services = []; } }
      } catch (error) { state.error = error; }
      state.loading = false;
      if (alive) render();
    }

    // ---- sections
    function decisionCard(d) {
      const card = h('article', { class: 'tp-card', 'aria-labelledby': `tp-d${d.id}` });
      card.append(h('h4', { id: `tp-d${d.id}` }, pick(d, 'title'), ' ', d.demo ? badge(T('demo'), 'demo') : null));
      card.append(h('p', { class: 'tp-meta' }, badge(T('officialVote'), 'vote'), ' ', badge(T(d.status), d.status), ' ', d.closesAt ? T('closesOn', { d: fmt(d.closesAt) }) : '', ' · ', T('participants', { n: d.participants })));
      card.append(h('p', null, pick(d, 'summary')));
      const out = statusLine(`d${d.id}`);
      card.append(out); // stays in the card for every state (a confirmation survives the reload); the vote form moves it below its button
      if (d.status === 'closed') {
        const total = d.choices.reduce((sum, c) => sum + (c.votes ?? 0), 0) || 0;
        card.append(h('h5', null, T('results')), h('ul', { class: 'tp-results' }, d.choices.map((c) => h('li', null, pick(c, 'label'), ' — ', T('votesN', { n: c.votes ?? 0, p: total ? Math.round(((c.votes ?? 0) * 100) / total) : 0 })))));
        if (d.outcomeNote) card.append(h('p', null, T('outcome', { t: d.outcomeNote })));
        if (d.myVote) card.append(h('p', { class: 'tp-receipt' }, T('voted', { d: fmt(d.myVote.votedAt), r: d.myVote.receipt })));
        return card;
      }
      if (!user) card.append(h('p', null, T('login'), ' ', h('a', { href: '#espace' }, T('loginLink'))));
      else if (isStaff()) card.append(h('p', { class: 'tp-hint' }, T('staffNoVote')));
      else if (d.myVote) card.append(h('p', { class: 'tp-receipt' }, T('voted', { d: fmt(d.myVote.votedAt), r: d.myVote.receipt })));
      else {
        const form = h('form', { class: 'tp-form', novalidate: true });
        const set = h('fieldset', null, h('legend', null, T('yourChoice')));
        d.choices.forEach((c, i) => set.append(h('label', { class: 'tp-radio' }, h('input', { type: 'radio', name: `vote-${d.id}`, value: c.id, required: i === 0 }), ' ', pick(c, 'label'))));
        const confirmBox = h('div', { class: 'tp-confirm', hidden: true });
        const go = h('button', { type: 'submit', class: 'tp-button' }, T('vote'));
        form.append(set, confirmBox, go, out);
        let pending = null;
        const reset = () => { pending = null; confirmBox.hidden = true; confirmBox.replaceChildren(); go.hidden = false; set.disabled = false; };
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!pending) {
            const chosen = form.querySelector('input[type=radio]:checked');
            if (!chosen) return say(out, T('pickOne'), true);
            pending = Number(chosen.value);
            const label = pick(d.choices.find((c) => c.id === pending), 'label');
            set.disabled = true; go.hidden = true; confirmBox.hidden = false;
            const yes = h('button', { type: 'submit', class: 'tp-button' }, T('confirmVote'));
            const no = h('button', { type: 'button', class: 'tp-button tp-secondary', onclick: reset }, T('cancel'));
            confirmBox.replaceChildren(h('p', null, T('confirmText', { c: label })), yes, ' ', no);
            yes.focus();
            return;
          }
          const chosenId = pending;
          confirmBox.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try {
            const result = await api(`/api/participation/decisions/${d.id}/vote`, 'POST', { choiceId: chosenId });
            options.onChange?.('vote');
            await flashAndReload(`d${d.id}`, T('voteDone', { r: result.receipt }));
          } catch (error) {
            reset();
            if (error?.status === 409) await flashAndReload(`d${d.id}`, /clos/i.test(error.message) ? T('voteClosed') : T('voteAlready'), true);
            else say(out, errorText(error), true);
          }
        });
        card.append(form);
      }
      return card;
    }
    function consultationCard(c) {
      const card = h('article', { class: 'tp-card', 'aria-labelledby': `tp-c${c.id}` });
      card.append(h('h4', { id: `tp-c${c.id}` }, pick(c, 'title'), ' ', c.demo ? badge(T('demo'), 'demo') : null));
      card.append(h('p', { class: 'tp-meta' }, badge(T('notAVote'), 'consult'), ' ', badge(T(c.status), c.status), ' ', c.closesAt ? T('closesOn', { d: fmt(c.closesAt) }) : ''));
      card.append(h('p', null, pick(c, 'body')));
      if (!user) { card.append(h('p', null, T('login'), ' ', h('a', { href: '#espace' }, T('loginLink')))); return card; }
      if (!isCitizen()) return card;
      const out = statusLine(`c${c.id}`);
      if (c.myOpinion) card.append(h('p', { class: 'tp-receipt' }, T('myOpinion', { r: c.myOpinion.receipt }), c.myOpinion.rating ? ` ${T('ratingN', { n: c.myOpinion.rating })}.` : ''));
      if (c.status === 'closed') return card;
      const form = h('form', { class: 'tp-form', novalidate: true });
      const set = h('fieldset', null, h('legend', null, T('rating'), ' ', h('span', { class: 'tp-hint' }, T('optional'))));
      [1, 2, 3, 4, 5].forEach((n) => set.append(h('label', { class: 'tp-radio' }, h('input', { type: 'radio', name: `rate-${c.id}`, value: n, checked: c.myOpinion?.rating === n }), ' ', String(n))));
      const text = h('textarea', { rows: 3, maxlength: 1000 }); text.value = c.myOpinion?.comment ?? '';
      const send = h('button', { type: 'submit', class: 'tp-button' }, c.myOpinion ? T('editOpinion') : T('sendOpinion'));
      form.append(set, field(T('comment'), text, T('optional')), send, out);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const chosen = form.querySelector('input[type=radio]:checked');
        if (!chosen && !text.value.trim()) return say(out, T('opinionNeeded'), true);
        send.disabled = true;
        try {
          const result = await api(`/api/participation/consultations/${c.id}/opinion`, 'PUT', { rating: chosen ? Number(chosen.value) : null, comment: text.value.trim() || null });
          await flashAndReload(`c${c.id}`, T(result.updated ? 'opinionUpdated' : 'opinionDone', { r: result.receipt }));
        } catch (error) { send.disabled = false; say(out, errorText(error), true); }
      });
      card.append(form);
      return card;
    }

    function projectCard(p) {
      const label = T(`p${p.status[0].toUpperCase()}${p.status.slice(1)}`);
      return h('article', { class: 'tp-card', 'aria-labelledby': `tp-p${p.id}` },
        h('h4', { id: `tp-p${p.id}` }, pick(p, 'title'), ' ', p.demo ? badge(T('demo'), 'demo') : null),
        h('p', { class: 'tp-meta' }, badge(label, p.status), p.district ? ` · ${T('district')} : ${p.district}` : ''),
        h('p', null, pick(p, 'summary')),
        h('p', { class: 'tp-progress' }, h('label', { for: `tp-pr${p.id}` }, `${T('progress')} : ${p.progress} %`), ' ', h('progress', { id: `tp-pr${p.id}`, max: 100, value: p.progress }, `${p.progress} %`)));
    }

    function ideaSection() {
      const sec = h('section', { 'aria-labelledby': 'tp-ideas' }, h('h3', { id: 'tp-ideas' }, T('ideas')));
      if (!isCitizen()) { sec.append(h('p', null, user ? T('staffNoVote') : T('login'), ' ', user ? '' : h('a', { href: '#espace' }, T('loginLink')))); return sec; }
      const out = statusLine('idea');
      const title = h('input', { type: 'text', maxlength: 100, required: true }), body = h('textarea', { rows: 4, maxlength: 1000, required: true });
      const send = h('button', { type: 'submit', class: 'tp-button' }, T('sendIdea'));
      const form = h('form', { class: 'tp-form', novalidate: true }, field(T('ideaTitle'), title), field(T('ideaBody'), body), send, out);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (title.value.trim().length < 4 || body.value.trim().length < 10) return say(out, T('failed', { m: `${T('ideaTitle')} ≥ 4, ${T('ideaBody')} ≥ 10` }), true);
        if (!keys.has('idea')) keys.set('idea', newKey());
        send.disabled = true; out.textContent = T('sending');
        try {
          const result = await api('/api/participation/ideas', 'POST', { title: title.value.trim(), body: body.value.trim(), key: keys.get('idea') });
          keys.delete('idea');
          await flashAndReload('idea', T(result.duplicate ? 'ideaDup' : 'ideaDone', { r: result.idea.receipt }));
        } catch (error) { send.disabled = false; say(out, errorText(error), true); }
      });
      sec.append(form);
      const mine = state.mine?.ideas ?? [];
      if (mine.length) sec.append(h('h4', null, T('myIdeas')), h('ul', { class: 'tp-list' }, mine.map((i) => h('li', null, h('strong', null, i.title), ' ', badge(T(`s${i.status[0].toUpperCase()}${i.status.slice(1)}`), i.status), ' ', h('span', { class: 'tp-hint' }, T('receiptN', { r: i.receipt }), ' · ', fmt(i.createdAt)), i.staffNote ? h('p', null, T('staffNote', { t: i.staffNote })) : null))));
      return sec;
    }

    function feedbackSection() {
      const sec = h('section', { 'aria-labelledby': 'tp-feedback' }, h('h3', { id: 'tp-feedback' }, T('feedback')));
      if (!isCitizen()) { sec.append(h('p', null, user ? T('staffNoVote') : T('login'), ' ', user ? '' : h('a', { href: '#espace' }, T('loginLink')))); return sec; }
      const services = state.services ?? [];
      if (!services.length) { sec.append(h('p', null, T('noServices'))); return sec; }
      const out = statusLine('feedback');
      const select = h('select', { required: true }, h('option', { value: '' }, T('choose')), services.map((s) => h('option', { value: s.id }, s.title)));
      const set = h('fieldset', null, h('legend', null, T('rating')));
      [1, 2, 3, 4, 5].forEach((n) => set.append(h('label', { class: 'tp-radio' }, h('input', { type: 'radio', name: 'fb-rating', value: n }), ' ', String(n))));
      const text = h('textarea', { rows: 3, maxlength: 1000 });
      const send = h('button', { type: 'submit', class: 'tp-button' }, T('sendFeedback'));
      const form = h('form', { class: 'tp-form', novalidate: true }, field(T('service'), select), set, field(T('comment'), text, T('optional')), send, out);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const chosen = form.querySelector('input[name=fb-rating]:checked');
        if (!select.value || !chosen) return say(out, T('failed', { m: `${T('service')}, ${T('rating')}` }), true);
        if (!keys.has('feedback')) keys.set('feedback', newKey());
        send.disabled = true; out.textContent = T('sending');
        try {
          const result = await api('/api/participation/feedback', 'POST', { serviceId: Number(select.value), rating: Number(chosen.value), comment: text.value.trim() || null, key: keys.get('feedback') });
          keys.delete('feedback');
          await flashAndReload('feedback', T(result.duplicate ? 'feedbackDup' : 'feedbackDone', { r: result.feedback.receipt }));
        } catch (error) { send.disabled = false; say(out, errorText(error), true); }
      });
      sec.append(form);
      return sec;
    }

    function historySection() {
      const m = state.mine;
      const sec = h('section', { 'aria-labelledby': 'tp-mine' }, h('h3', { id: 'tp-mine' }, T('mine')));
      if (!m || (!m.votes.length && !m.opinions.length && !m.ideas.length && !m.feedback.length)) { sec.append(h('p', null, T('historyEmpty'))); return sec; }
      if (m.votes.length) sec.append(h('h4', null, T('historyVotes')), h('ul', { class: 'tp-list' }, m.votes.map((v) => h('li', null, pick(v, 'title'), ' — ', fmt(v.votedAt), ' · ', T('receiptN', { r: v.receipt })))));
      if (m.opinions.length) sec.append(h('h4', null, T('historyOpinions')), h('ul', { class: 'tp-list' }, m.opinions.map((o) => h('li', null, pick(o, 'title'), o.rating ? ` — ${T('ratingN', { n: o.rating })}` : '', ' · ', T('receiptN', { r: o.receipt })))));
      if (m.feedback.length) sec.append(h('h4', null, T('historyFeedback')), h('ul', { class: 'tp-list' }, m.feedback.map((f) => h('li', null, f.serviceTitle ?? `#${f.serviceId}`, ` — ${T('ratingN', { n: f.rating })} · `, T('receiptN', { r: f.receipt })))));
      return sec;
    }

    function staffSection() {
      const admin = state.admin;
      const sec = h('section', { class: 'tp-staff', 'aria-labelledby': 'tp-staff' }, h('h3', { id: 'tp-staff' }, T('staffTitle')));
      const out = statusLine('staff');
      const act = async (promise, message) => { try { await promise; await flashAndReload('staff', message ?? T('done')); } catch (error) { say(out, errorText(error), true); } };
      // creation forms
      const mk = (kind, heading, fields) => {
        const form = h('form', { class: 'tp-form', novalidate: true }, h('h4', null, heading));
        const inputs = {};
        for (const [name, label, control, hint] of fields) { inputs[name] = control; form.append(field(label, control, hint)); }
        const publish = h('input', { type: 'checkbox' }), demo = h('input', { type: 'checkbox' });
        if (kind !== 'projects') form.append(h('label', { class: 'tp-radio' }, publish, ' ', T('fPublish')));
        form.append(h('label', { class: 'tp-radio' }, demo, ' ', T('fDemo')), h('button', { type: 'submit', class: 'tp-button' }, T('create')));
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const body = { demo: demo.checked, publish: publish.checked };
          for (const [name, control] of Object.entries(inputs)) body[name] = control.value.trim();
          if (kind === 'decisions') body.choices = String(inputs.choices.value).split('\n').map((l) => l.trim()).filter(Boolean).map((label) => ({ label }));
          if (body.closesAt) body.closesAt = new Date(body.closesAt).toISOString(); else delete body.closesAt;
          if (!body.title || (!body.summary && !body.body)) return say(out, T('requiredCreate'), true);
          await act(api(`/api/participation/admin/${kind}`, 'POST', body), T('created'));
        });
        return form;
      };
      sec.append(
        mk('decisions', T('newDecision'), [['title', T('fTitle'), h('input', { type: 'text', maxlength: 120 })], ['summary', T('fSummary'), h('textarea', { rows: 3, maxlength: 1000 })], ['choices', T('fChoices'), h('textarea', { rows: 3 })], ['closesAt', T('fClose'), h('input', { type: 'datetime-local' })]]),
        mk('consultations', T('newConsultation'), [['title', T('fTitle'), h('input', { type: 'text', maxlength: 120 })], ['body', T('fBody'), h('textarea', { rows: 3, maxlength: 2000 })], ['closesAt', T('fClose'), h('input', { type: 'datetime-local' })]]),
        mk('projects', T('newProject'), [['title', T('fTitle'), h('input', { type: 'text', maxlength: 120 })], ['summary', T('fSummary'), h('textarea', { rows: 2, maxlength: 1000 })], ['district', T('fDistrict'), h('input', { type: 'text', maxlength: 80 })]]),
      );
      const row = (kind, item, extra) => h('li', null, h('strong', null, item.title), ' ', item.demo ? badge(T('demo'), 'demo') : null, ' ', badge(T(item.status in { draft: 1, open: 1, closed: 1 } ? item.status : `p${item.status[0].toUpperCase()}${item.status.slice(1)}`), item.status), ' ', extra,
        item.status === 'draft' ? h('button', { type: 'button', class: 'tp-button tp-secondary', onclick: () => act(api(`/api/participation/admin/${kind}/${item.id}`, 'PATCH', { status: 'open' })) }, T('publishIt')) : null,
        item.status === 'open' ? h('button', { type: 'button', class: 'tp-button tp-secondary', onclick: () => act(api(`/api/participation/admin/${kind}/${item.id}`, 'PATCH', { status: 'closed' })) }, T('closeIt')) : null,
        user.role === 'admin' ? h('button', { type: 'button', class: 'tp-button tp-danger', onclick: () => { if (globalThis.confirm?.(T('confirmDelete', { t: item.title }))) act(api(`/api/participation/admin/${kind}/${item.id}`, 'DELETE')); } }, T('deleteIt')) : null);
      if (admin) {
        sec.append(h('h4', null, T('decisions')), h('ul', { class: 'tp-list' }, admin.decisions.map((d) => row('decisions', d, ` ${T('participants', { n: d.participants })}`))));
        sec.append(h('h4', null, T('consultations')), h('ul', { class: 'tp-list' }, admin.consultations.map((c) => h('li', null, row('consultations', c, ` ${T('staffOpinions', { n: c.opinionCount ?? 0, a: c.averageRating ?? '–' })}`),
          (c.comments ?? []).length ? h('ul', null, c.comments.slice(0, 20).map((x) => h('li', null, x.rating ? `${T('ratingN', { n: x.rating })} — ` : '', x.comment))) : null))));
        sec.append(h('h4', null, T('projects')), h('ul', { class: 'tp-list' }, admin.projects.map((p) => {
          const range = h('input', { type: 'number', min: 0, max: 100, value: p.progress, 'aria-label': `${T('progress')} ${p.title}`, class: 'tp-small' });
          const status = h('select', { 'aria-label': `${T('fStatus')} ${p.title}` }, ['planned', 'in_progress', 'done'].map((s) => h('option', { value: s, selected: s === p.status }, T(`p${s[0].toUpperCase()}${s.slice(1)}`))));
          return h('li', null, h('strong', null, p.title), ' ', p.demo ? badge(T('demo'), 'demo') : null, ' ', status, ' ', range, ' ',
            h('button', { type: 'button', class: 'tp-button tp-secondary', onclick: () => act(api(`/api/participation/admin/projects/${p.id}`, 'PATCH', { status: status.value, progress: Number(range.value) })) }, T('setProgress')),
            user.role === 'admin' ? h('button', { type: 'button', class: 'tp-button tp-danger', onclick: () => { if (globalThis.confirm?.(T('confirmDelete', { t: p.title }))) act(api(`/api/participation/admin/projects/${p.id}`, 'DELETE')); } }, T('deleteIt')) : null);
        })));
        sec.append(h('h4', null, T('staffIdeas')), h('ul', { class: 'tp-list' }, admin.ideas.map((i) => {
          const status = h('select', { 'aria-label': `${T('fStatus')} ${i.title}` }, ['received', 'under_review', 'accepted', 'declined'].map((s) => h('option', { value: s, selected: s === i.status }, T(`s${s[0].toUpperCase()}${s.slice(1)}`))));
          const note = h('input', { type: 'text', maxlength: 500, value: i.staffNote ?? '', 'aria-label': `${T('note')} ${i.title}` });
          return h('li', null, h('strong', null, i.title), ' ', h('span', { class: 'tp-hint' }, T('author', { a: i.author ?? '?' })), h('p', null, i.body), status, ' ', note, ' ',
            h('button', { type: 'button', class: 'tp-button tp-secondary', onclick: () => act(api(`/api/participation/admin/ideas/${i.id}`, 'PATCH', { status: status.value, note: note.value.trim() || null })) }, T('answer')));
        })));
        sec.append(h('h4', null, T('staffFeedback')), h('ul', { class: 'tp-list' }, admin.feedback.slice(0, 50).map((f) => h('li', null, `${f.serviceTitle ?? `#${f.serviceId}`} — ${T('ratingN', { n: f.rating })} — `, f.comment || T('noComment')))));
      }
      sec.append(out);
      return sec;
    }

    function list(title, id, items, build) {
      return h('section', { 'aria-labelledby': id }, h('h3', { id }, title), items.length ? h('div', { class: 'tp-grid' }, items.map(build)) : h('p', null, T('none')));
    }

    function render() {
      if (!alive) return;
      root.replaceChildren();
      focusAfter = null;
      const wrap = h('div', { class: 'tp-root', lang });
      wrap.append(h('h2', { id: 'tp-title' }, T('title')), h('p', { class: 'tp-intro' }, T('intro')));
      if (state.loading && !state.overview) { wrap.append(h('p', { role: 'status' }, T('loading'))); root.append(wrap); return; }
      if (state.error && !state.overview) {
        wrap.append(h('p', { role: 'alert', class: 'tp-error' }, T('loadError')), h('button', { type: 'button', class: 'tp-button', onclick: load }, T('retry')));
        root.append(wrap); return;
      }
      const o = state.overview;
      wrap.append(
        list(T('decisions'), 'tp-decisions', o.decisions, decisionCard),
        list(T('consultations'), 'tp-consultations', o.consultations, consultationCard),
        list(T('projects'), 'tp-projects', o.projects, projectCard),
        ideaSection(), feedbackSection(),
      );
      if (isCitizen()) wrap.append(historySection());
      if (isStaff()) wrap.append(staffSection());
      root.append(wrap);
      focusAfter?.focus?.();
    }

    load();
    return {
      update(next) { if (next.user !== undefined) user = next.user; if (next.lang) lang = next.lang; state = { ...state, overview: null, mine: null, admin: null, loading: true }; load(); },
      unmount() { alive = false; root.replaceChildren(); keys.clear(); },
    };
  }

  window.TerraParticipation = { mount };
})();
