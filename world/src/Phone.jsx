import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const POLL = 15_000;

function stored(key, value) {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Same 'lang' preference the portal's language switch writes.
const english = () => stored('lang') === 'en';
const title = (item) => (english() && item.title_en) || item.title;
const body = (item) => (english() && item.body_en) || item.body;
const seenKey = 'world-seen-alerts';

// Polls announcements; reports urgent ones this browser has not acknowledged yet.
export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState([]);
  const [unseen, setUnseen] = useState([]);
  const seen = useRef(new Set(JSON.parse(stored(seenKey) || '[]')));

  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const { announcements: list } = await api('/api/announcements');
        setAnnouncements(list);
        setUnseen(list.filter((item) => item.urgent && !seen.current.has(item.id)));
      } catch {
        // Offline or server restarting: keep the last list, try again next tick.
      }
      timer = setTimeout(load, POLL);
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  const acknowledge = () => {
    unseen.forEach((item) => seen.current.add(item.id));
    stored(seenKey, JSON.stringify([...seen.current]));
    setUnseen([]);
  };

  return { announcements, unseen, acknowledge };
}

function formatDate(value) {
  return new Intl.DateTimeFormat(english() ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${value.replace(' ', 'T')}Z`));
}

function Alert({ item }) {
  return (
    <article className="phone-alert">
      <p className="phone-badge">Alerte · {item.audience}</p>
      <h3>{title(item)}</h3>
      {body(item).split('\n').map((line, i) => <p key={i}>{line}</p>)}
    </article>
  );
}

export function Phone({ open, alerts, announcements, onAcknowledge, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => event.key === 'Escape' && (alerts.length ? onAcknowledge() : onClose());
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, alerts, onAcknowledge, onClose]);

  if (!open) return null;
  const urgent = announcements.filter((item) => item.urgent);
  const news = announcements.filter((item) => !item.urgent).slice(0, 5);

  return (
    <section className="phone" aria-label="Téléphone">
      <div className="phone-screen">
        <header className="phone-header">
          <span>Terra Nova</span>
          <time>{new Date().toLocaleTimeString(english() ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' })}</time>
        </header>
        {alerts.length > 0 ? (
          <div role="alert">
            <h2>Nouvelle alerte</h2>
            {alerts.map((item) => <Alert key={item.id} item={item} />)}
          </div>
        ) : (
          <>
            <h2>Alertes en cours</h2>
            {urgent.length ? urgent.map((item) => <Alert key={item.id} item={item} />) : <p>Aucune alerte en cours.</p>}
            <h2>Actualités</h2>
            <ul className="phone-news">
              {news.map((item) => (
                <li key={item.id}>
                  <time>{formatDate(item.published_at)}</time>
                  <strong>{title(item)}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
        <footer className="phone-actions">
          <a href="/#actualites">Toutes les annonces</a>
          {alerts.length > 0
            ? <button type="button" onClick={onAcknowledge}>J’ai compris</button>
            : <button type="button" onClick={onClose}>Ranger (T)</button>}
        </footer>
      </div>
    </section>
  );
}
