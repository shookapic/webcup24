// Phone content for the colony: data hook, accessible screen, flat dialog fallback.
// Contracts (CLAUDE.md "Frontend integration contracts"):
//   useAnnouncements({ userId })  -> { announcements, unseen, status, error, lastUpdated, acknowledge(ids), retry }
//   <PhoneScreen .../>            semantic HTML only: no Canvas, no camera, no fixed positioning. B's PhoneRig hosts it.
//   <PhoneFallback open .../>     the same screen in an accessible flat dialog (focus in/trap/return, Escape, scrolling)
//   <AlertAnnouncer alerts/>      hidden live region for an alert that cannot be presented yet (e.g. while editing)
// Additive, optional props beyond the contract: `onRetry` (announcements) and, on `services`/`transports`, either a
// plain array or a polled-feed object { data | services | lines, status, lastUpdated, retry } as `useTransports()` returns.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audience as audienceName, formatCityTime, formatDate, formatTime, fold, getLocale, localized, normalizeLocale, t } from './ui/i18n.js';
import { loadSeen, saveSeen } from './ui/storage.js';
import { usePolled, useServices, useTransports } from './ui/usePolled.js';
import { useDialogFocus } from './ui/useDialog.js';

export const PHONE_PAGES = ['home', 'alerts', 'news', 'services', 'transports'];
export { useServices, useTransports };

const validAnnouncements = (data) => Array.isArray(data?.announcements);

// Polls announcements every 15 s. `unseen` = urgent items this user has not acknowledged, derived from the
// latest list, so a withdrawn alert disappears by itself. Seen IDs are stored per user, parsed defensively.
// `ready: false` (e.g. while /api/me is still loading) reports no unseen alerts, so a returning user's
// acknowledged alerts do not flash up under the guest key before their own seen list is loaded.
export function useAnnouncements({ userId, ready = true } = {}) {
  const feed = usePolled('/api/announcements', { interval: 15_000, validate: validAnnouncements });
  const key = userId ?? 'guest';
  const [seen, setSeen] = useState(() => ({ key, ids: loadSeen(userId) }));
  let ids = seen.ids;
  if (seen.key !== key) {
    ids = loadSeen(userId);
    setSeen({ key, ids });
  }

  const announcements = useMemo(
    () => (validAnnouncements(feed.data) ? feed.data.announcements.filter((item) => item && Number.isSafeInteger(item.id)) : []),
    [feed.data],
  );
  const unseen = useMemo(() => (ready ? announcements.filter((item) => item.urgent && !ids.includes(item.id)) : []), [announcements, ids, ready]);
  const unseenRef = useRef(unseen);
  unseenRef.current = unseen;

  // Pass the IDs that were actually shown. Without an argument (old callers) every current unseen alert counts.
  const acknowledge = useCallback((list) => {
    const shown = (Array.isArray(list) ? list : unseenRef.current.map((item) => item.id)).filter(Number.isSafeInteger);
    if (!shown.length) return;
    setSeen((previous) => {
      const base = previous.key === key ? previous.ids : loadSeen(userId);
      const next = [...base.filter((id) => !shown.includes(id)), ...shown].slice(-200);
      saveSeen(userId, next);
      return { key, ids: next };
    });
  }, [key, userId]);

  return { announcements, unseen, status: feed.status, error: feed.error, lastUpdated: feed.lastUpdated, acknowledge, retry: feed.retry };
}

// Announces new alerts to assistive technology when the phone cannot show them yet. Mount it only while
// the phone is NOT presenting those alerts (`active`), or the same text is read twice.
export function AlertAnnouncer({ alerts = [], locale, active = true }) {
  const loc = normalizeLocale(locale ?? getLocale());
  if (!active) return null;
  return (
    <div className="sr-only" role="alert" aria-live="assertive">
      {alerts.map((item) => {
        const title = localized(item, 'title', loc);
        const body = localized(item, 'body', loc);
        return <p key={item.id} lang={body.lang}>{`${t(loc, 'alerts.badge', { audience: audienceName(loc, item.audience) })}. ${title.text}. ${body.text}`}</p>;
      })}
    </div>
  );
}

function useNow(interval) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

// Accepts a plain array or a polled-feed object; anything else (not fetched yet) counts as loading.
function feedOf(value, key) {
  if (Array.isArray(value)) return { items: value, status: 'ready', lastUpdated: null, retry: undefined };
  if (value && typeof value === 'object') {
    const list = [value[key], value.data?.[key]].find(Array.isArray);
    return { items: list ?? [], status: value.status || 'ready', lastUpdated: value.lastUpdated ?? null, retry: value.retry };
  }
  return { items: [], status: 'loading', lastUpdated: null, retry: undefined };
}

const FrTag = ({ locale }) => <span className="phone-tag" role="img" aria-label={t(locale, 'lang.fallback')} title={t(locale, 'lang.fallback')}>FR</span>;

function Paragraphs({ text, lang }) {
  return <div lang={lang}>{text.split('\n').filter((line) => line.trim()).map((line, index) => <p key={index}>{line}</p>)}</div>;
}

// Loading / error / stale presentation shared by every page. Returns null when there is nothing to say.
function Notice({ status, hasData, lastUpdated, onRetry, locale }) {
  if (status === 'loading' && !hasData) return <p className="phone-note" role="status">{t(locale, 'state.loading')}</p>;
  if (status === 'error' && !hasData) {
    return (
      <div className="phone-note phone-note-error" role="status">
        <p><strong>{t(locale, 'state.error')}</strong> {t(locale, 'state.errorHint')}</p>
        {onRetry && <button type="button" onClick={onRetry}>{t(locale, 'state.retry')}</button>}
      </div>
    );
  }
  if (status === 'stale') {
    return (
      <div className="phone-note phone-note-stale" role="status">
        <p>{t(locale, 'state.stale', { time: lastUpdated ? formatTime(lastUpdated, locale) : '—' })}</p>
        {onRetry && <button type="button" onClick={onRetry}>{t(locale, 'state.retry')}</button>}
      </div>
    );
  }
  return null;
}
const settled = (status, hasData) => hasData || status === 'ready' || status === 'stale';

function AlertCard({ item, locale }) {
  const title = localized(item, 'title', locale);
  const body = localized(item, 'body', locale);
  return (
    <article className="phone-card phone-alert">
      <p className="phone-badge">{t(locale, 'alerts.badge', { audience: audienceName(locale, item.audience) })}</p>
      <h3 lang={title.lang}>{title.text}{title.fallback && <> <FrTag locale={locale} /></>}</h3>
      <p className="phone-date">{formatDate(item.published_at, locale)}</p>
      <Paragraphs text={body.text} lang={body.lang} />
      <p className="phone-meta">{t(locale, 'alerts.audience', { audience: audienceName(locale, item.audience) })}</p>
    </article>
  );
}

const readable = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#10181d' : '#ffffff';
};
const lineColor = (value) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#4a8c87');

// Stops of `name` across all lines. `nearest` is a stop name (or { name }) from the player's position.
function nearestName(value) {
  return fold(typeof value === 'string' ? value : value?.name);
}

function LineCard({ line, nearest, locale }) {
  const color = lineColor(line.color);
  const stops = [...line.stops].sort((a, b) => (nearest && fold(b.name) === nearest) - (nearest && fold(a.name) === nearest));
  return (
    <article className="phone-card phone-line-card">
      <header className="phone-line-head">
        <span className="phone-line" style={{ background: color, color: readable(color) }}>{line.code}</span>
        <h3>{line.name}</h3>
      </header>
      {line.status === 'perturbé'
        ? <p className="phone-line-status phone-disrupted"><strong>{t(locale, 'transports.disrupted')}</strong>{line.message && <> — <span lang="fr">{line.message}</span></>}</p>
        : <p className="phone-line-status phone-normal">{t(locale, 'transports.normal')}</p>}
      <ul className="phone-stops">
        {stops.map((stop) => {
          const here = nearest && fold(stop.name) === nearest;
          const times = Array.isArray(stop.next) ? stop.next : [];
          return (
            <li key={stop.name} className={here ? 'phone-stop phone-stop-nearest' : 'phone-stop'}>
              <strong>{stop.name}</strong>
              {here && <span className="phone-tag phone-tag-nearest">{t(locale, 'transports.nearest')}</span>}
              <span className="phone-next">{t(locale, 'transports.next')} : {times.length ? times.join(' · ') : t(locale, 'transports.noTimes')}</span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function TransportsPage({ lines, feed, nearest, locale }) {
  const valid = lines.filter((line) => line && Array.isArray(line.stops));
  const ordered = [...valid].sort((a, b) => (nearest && b.stops.some((s) => fold(s.name) === nearest)) - (nearest && a.stops.some((s) => fold(s.name) === nearest)));
  return (
    <>
      <Notice status={feed.status} hasData={valid.length > 0} lastUpdated={feed.lastUpdated} onRetry={feed.retry} locale={locale} />
      {ordered.map((line) => <LineCard key={line.code} line={line} nearest={nearest} locale={locale} />)}
      {settled(feed.status, valid.length > 0) && !valid.length && <p className="phone-empty">{t(locale, 'transports.none')}</p>}
    </>
  );
}

function ServicesPage({ items, feed, locale }) {
  const [query, setQuery] = useState('');
  const services = useMemo(() => [...items].filter((item) => item && item.id != null).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)), [items]);
  const needle = fold(query.trim());
  const shown = services.filter((item) => fold(['title', 'description', 'details'].map((field) => localized(item, field, locale).text).join(' ')).includes(needle));
  return (
    <>
      <label className="phone-search">
        <span>{t(locale, 'services.search')}</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(locale, 'services.placeholder')} autoComplete="off" enterKeyHint="search" />
      </label>
      <Notice status={feed.status} hasData={services.length > 0} lastUpdated={feed.lastUpdated} onRetry={feed.retry} locale={locale} />
      <p className="phone-count" role="status">
        {!settled(feed.status, services.length > 0) ? '' : !services.length ? t(locale, 'services.none') : !shown.length ? t(locale, 'services.noMatch')
          : needle ? t(locale, shown.length > 1 ? 'services.countMany' : 'services.countOne', { n: shown.length }) : ''}
      </p>
      {shown.map((item) => {
        const title = localized(item, 'title', locale);
        const description = localized(item, 'description', locale);
        const details = localized(item, 'details', locale);
        const down = item.availability === 'unavailable';
        const reason = down ? localized(item, 'unavailable_reason', locale) : null;
        const alternative = down && item.alternative ? localized(item, 'alternative', locale) : null;
        return (
          <article key={item.id} className={`phone-card${item.featured ? ' phone-featured' : ''}${down ? ' phone-unavailable' : ''}`}>
            {item.featured ? <p className="phone-tag phone-tag-featured">{t(locale, 'services.featured')}</p> : null}
            <h3 lang={title.lang}>{title.text}{title.fallback && <> <FrTag locale={locale} /></>}</h3>
            <p lang={description.lang}>{description.text}</p>
            {down && (
              <div className="phone-outage">
                <p><strong>{t(locale, 'services.unavailable')}</strong></p>
                <p lang={reason.lang}>{reason.text}</p>
                <p>{item.available_again ? t(locale, 'services.back', { date: formatCityTime(item.available_again, locale) }) : t(locale, 'services.backUnknown')}</p>
                {alternative && <p><strong>{t(locale, 'services.meanwhile')}</strong> <span lang={alternative.lang}>{alternative.text}</span></p>}
              </div>
            )}
            <details>
              <summary>{t(locale, 'services.more')}</summary>
              <p lang={details.lang}>{details.text}</p>
            </details>
          </article>
        );
      })}
      <p className="phone-links">
        <a href="/#services" target="_blank" rel="noopener">{t(locale, 'services.portal')} <span className="sr-only">{t(locale, 'services.newTab')}</span></a>
        <a href="/#message-form" target="_blank" rel="noopener">{t(locale, 'services.request')} <span className="sr-only">{t(locale, 'services.newTab')}</span></a>
      </p>
    </>
  );
}

function NewsPage({ news, detailId, onOpen, onBack, status, lastUpdated, onRetry, locale }) {
  const item = detailId != null ? news.find((entry) => entry.id === detailId) : null;
  if (item) {
    const title = localized(item, 'title', locale);
    const body = localized(item, 'body', locale);
    return (
      <article className="phone-card phone-detail">
        <button type="button" className="phone-back" onClick={onBack}>← {t(locale, 'news.back')}</button>
        <h3 lang={title.lang}>{title.text}{title.fallback && <> <FrTag locale={locale} /></>}</h3>
        <p className="phone-date">{formatDate(item.published_at, locale)} · {t(locale, 'alerts.audience', { audience: audienceName(locale, item.audience) })}</p>
        <Paragraphs text={body.text} lang={body.lang} />
      </article>
    );
  }
  return (
    <>
      <Notice status={status} hasData={news.length > 0} lastUpdated={lastUpdated} onRetry={onRetry} locale={locale} />
      {settled(status, news.length > 0) && !news.length && <p className="phone-empty">{t(locale, 'news.none')}</p>}
      <ul className="phone-list">
        {news.map((entry) => {
          const title = localized(entry, 'title', locale);
          const body = localized(entry, 'body', locale);
          return (
            <li key={entry.id}>
              <button type="button" className="phone-row" onClick={() => onOpen(entry.id)}>
                <span className="phone-date">{formatDate(entry.published_at, locale)}</span>
                <strong lang={title.lang}>{title.text}</strong>
                <span className="phone-excerpt" lang={body.lang}>{body.text.replace(/\s+/g, ' ').slice(0, 110)}{body.text.length > 110 ? '…' : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="phone-links"><a href="/#actualites" target="_blank" rel="noopener">{t(locale, 'news.all')} <span className="sr-only">{t(locale, 'services.newTab')}</span></a></p>
    </>
  );
}

function HomePage({ urgent, news, status, lastUpdated, onRetry, transportFeed, lines, nearest, go, locale }) {
  const hasData = urgent.length > 0 || news.length > 0;
  const nearestLines = nearest ? lines.filter((line) => Array.isArray(line.stops) && line.stops.some((stop) => fold(stop.name) === nearest)) : [];
  const nearestStop = nearestLines[0]?.stops.find((stop) => fold(stop.name) === nearest);
  return (
    <>
      <Notice status={status} hasData={hasData} lastUpdated={lastUpdated} onRetry={onRetry} locale={locale} />
      {settled(status, hasData) && (
        <section className={urgent.length ? 'phone-card phone-alert' : 'phone-card'}>
          <h3>{t(locale, 'alerts.title')}</h3>
          <p>{urgent.length ? t(locale, urgent.length > 1 ? 'alerts.countMany' : 'alerts.countOne', { n: urgent.length }) : t(locale, 'alerts.none')}</p>
          {urgent.length > 0 && <button type="button" className="phone-action" onClick={() => go('alerts')}>{t(locale, 'page.alerts')}</button>}
        </section>
      )}
      {nearest && (
        <section className="phone-card">
          <h3>{t(locale, 'home.nearest')}</h3>
          {nearestStop ? (
            <>
              <p><strong>{nearestStop.name}</strong></p>
              {nearestLines.map((line) => {
                const stop = line.stops.find((entry) => fold(entry.name) === nearest);
                const color = lineColor(line.color);
                return (
                  <p key={line.code} className="phone-next">
                    <span className="phone-line" style={{ background: color, color: readable(color) }}>{line.code}</span>{' '}
                    {Array.isArray(stop.next) && stop.next.length ? stop.next.join(' · ') : t(locale, 'transports.noTimes')}
                    {line.status === 'perturbé' && <strong className="phone-disrupted"> · {t(locale, 'transports.disrupted')}</strong>}
                  </p>
                );
              })}
            </>
          ) : <Notice status={transportFeed.status} hasData={false} onRetry={transportFeed.retry} locale={locale} />}
          <button type="button" className="phone-action" onClick={() => go('transports')}>{t(locale, 'page.transports')}</button>
        </section>
      )}
      {news.length > 0 && (
        <section className="phone-card">
          <h3>{t(locale, 'home.latest')}</h3>
          <ul className="phone-list">
            {news.slice(0, 3).map((entry) => {
              const title = localized(entry, 'title', locale);
              return (
                <li key={entry.id}>
                  <button type="button" className="phone-row" onClick={() => go('news', entry.id)}>
                    <span className="phone-date">{formatDate(entry.published_at, locale)}</span>
                    <strong lang={title.lang}>{title.text}</strong>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="phone-links"><a href="/" target="_blank" rel="noopener">{t(locale, 'home.portal')} <span className="sr-only">{t(locale, 'services.newTab')}</span></a></p>
    </>
  );
}

export function PhoneScreen({
  page = 'home', onPageChange, announcements = [], pendingAlerts = [], services, transports, nearestStop,
  status = 'ready', error, lastUpdated, onAcknowledge, onClose, onRetry, locale,
}) {
  const loc = normalizeLocale(locale ?? getLocale());
  const now = useNow(30_000);
  const [localPage, setLocalPage] = useState(page);
  const [detail, setDetail] = useState(null);
  const headingRef = useRef(null);
  const bodyRef = useRef(null);
  const mounted = useRef(false);
  const current = PHONE_PAGES.includes(onPageChange ? page : localPage) ? (onPageChange ? page : localPage) : 'home';

  const list = Array.isArray(announcements) ? announcements.filter((item) => item && item.id != null) : [];
  const urgent = list.filter((item) => item.urgent);
  const news = list.filter((item) => !item.urgent);
  const pending = Array.isArray(pendingAlerts) ? pendingAlerts.filter((item) => item && item.id != null) : [];
  const pendingKey = pending.map((item) => item.id).join(',');
  const transportFeed = feedOf(transports, 'lines');
  const serviceFeed = feedOf(services, 'services');
  const nearest = nearestName(nearestStop);
  void error;

  const go = (next, detailId = null) => {
    setDetail(detailId);
    setLocalPage(next);
    onPageChange?.(next);
  };
  const acknowledge = () => onAcknowledge?.(pending.map((item) => item.id));

  // After the first render: a page change moves focus to the new title; an alert arriving or being
  // acknowledged moves it to the alert heading or back to the page title.
  const previousPending = useRef(pendingKey);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [current, detail, Boolean(pendingKey)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pendingKey && pendingKey !== previousPending.current) headingRef.current?.focus({ preventScroll: true });
    previousPending.current = pendingKey;
  }, [pendingKey]);

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (pending.length) acknowledge();
    else if (detail != null) setDetail(null);
    else onClose?.();
  };

  const title = pending.length ? t(loc, pending.length > 1 ? 'alerts.newMany' : 'alerts.newOne') : t(loc, `page.${current}`);

  return (
    <div className="phone-screen" lang={loc} onKeyDown={onKeyDown}>
      <header className="phone-bar">
        <span className="phone-brand">Terra Nova</span>
        <time className="phone-clock">{formatTime(now, loc)}</time>
        {!pending.length && onClose && (
          <button type="button" className="phone-close" onClick={onClose} aria-label={t(loc, 'phone.closeLabel')}>
            {t(loc, 'phone.close')} <kbd aria-hidden="true">T</kbd>
          </button>
        )}
      </header>
      <div className="phone-body" ref={bodyRef} role="region" aria-label={t(loc, 'phone.content')} tabIndex={0}>
        <h2 className="phone-title" ref={headingRef} tabIndex={-1} data-autofocus>{title}</h2>
        {pending.length > 0 ? (
          <div role="alert">
            {pending.map((item) => <AlertCard key={item.id} item={item} locale={loc} />)}
            <button type="button" className="phone-ack" onClick={acknowledge}>{t(loc, 'alerts.ack')}</button>
          </div>
        ) : current === 'alerts' ? (
          <>
            <Notice status={status} hasData={urgent.length > 0} lastUpdated={lastUpdated} onRetry={onRetry} locale={loc} />
            {settled(status, urgent.length > 0) && !urgent.length && <p className="phone-empty">{t(loc, 'alerts.none')}</p>}
            {urgent.map((item) => <AlertCard key={item.id} item={item} locale={loc} />)}
          </>
        ) : current === 'news' ? (
          <NewsPage news={news} detailId={detail} onOpen={(id) => setDetail(id)} onBack={() => { setDetail(null); }} status={status} lastUpdated={lastUpdated} onRetry={onRetry} locale={loc} />
        ) : current === 'services' ? (
          <ServicesPage items={serviceFeed.items} feed={serviceFeed} locale={loc} />
        ) : current === 'transports' ? (
          <TransportsPage lines={transportFeed.items} feed={transportFeed} nearest={nearest} locale={loc} />
        ) : (
          <HomePage urgent={urgent} news={news} status={status} lastUpdated={lastUpdated} onRetry={onRetry} transportFeed={transportFeed} lines={transportFeed.items} nearest={nearest} go={go} locale={loc} />
        )}
      </div>
      {!pending.length && (
        <nav className="phone-nav" aria-label={t(loc, 'phone.nav')}>
          {PHONE_PAGES.map((name) => (
            <button key={name} type="button" aria-current={current === name ? 'page' : undefined} onClick={() => go(name)}>
              {t(loc, `page.${name}`)}
              {name === 'alerts' && urgent.length > 0 && <span className="phone-count-badge" aria-label={String(urgent.length)}>{urgent.length}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

// Same screen as an accessible flat dialog: desktop fallback, narrow screens and the base for the 3D host's semantics.
export function PhoneFallback({ open, onClose, locale, ...screen }) {
  const host = useRef(null);
  useDialogFocus(host, Boolean(open));
  if (!open) return null;
  const loc = normalizeLocale(locale ?? getLocale());
  return (
    // A press on the backdrop (the scene behind) must not drop focus out of the dialog, or Escape and Tab stop working.
    <div className="phone-backdrop" onMouseDown={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      host.current?.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
    }}>
      <div className="phone-sheet" ref={host} role="dialog" aria-modal="true" aria-label={t(loc, 'phone.label')}>
        <PhoneScreen {...screen} locale={loc} onClose={onClose} />
      </div>
    </div>
  );
}

// Old export kept until B integrates PhoneScreen: same props as before, now with services and transports fetched here.
export function Phone({ open, alerts = [], announcements = [], onAcknowledge, onClose, locale }) {
  const [page, setPage] = useState('home');
  const services = useServices(Boolean(open));
  const transports = useTransports(Boolean(open));
  return (
    <PhoneFallback
      open={open} page={page} onPageChange={setPage} announcements={announcements} pendingAlerts={alerts}
      services={services} transports={transports} status="ready" onAcknowledge={onAcknowledge} onClose={onClose} locale={locale}
    />
  );
}
