// Compact DOM HUD: district block top left, labeled controls top right. It only calls back: no key listeners
// (B's App owns input), no camera access. The portal link is always visible as the accessible fallback.
import { getLocale, normalizeLocale, t } from './i18n.js';

const icons = {
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v12h8V5H8zm4 14.2a1 1 0 1 0 0 .01',
  view: 'M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.200 10.500-7C21.300 9.200 17.500 5 12 5zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  avatar: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.400 0 8 2.200 8 5v3H4v-3c0-2.800 3.600-5 8-5z',
  help: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 15v2h2v-2h-2zm1-11a3.500 3.500 0 0 0-3.500 3.500h2a1.500 1.500 0 1 1 2.200 1.300c-1.200.700-1.700 1.400-1.700 2.700v.5h2v-.4c0-.700.200-.900 1-1.400A3.300 3.300 0 0 0 12 6z',
  portal: 'M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3z',
};

function Icon({ name }) {
  return <svg className="hud-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={icons[name]} fill="currentColor" /></svg>;
}

export function WorldHud({ locale, view, phoneOpen, unreadCount = 0, district, onTogglePhone, onToggleView, onEditAvatar, onToggleHelp }) {
  const loc = normalizeLocale(locale ?? getLocale());
  const unread = Math.max(0, Number(unreadCount) || 0);
  return (
    <div className="world-hud">
      {district ? (
        <p className="hud-district">
          <span className="hud-district-label">{t(loc, 'hud.district')}</span>
          <strong>{district}</strong>
        </p>
      ) : <span />}
      <nav className="hud-controls" aria-label={t(loc, 'hud.nav')}>
        {onTogglePhone && (
          <button type="button" onClick={onTogglePhone} aria-expanded={Boolean(phoneOpen)}>
            <Icon name="phone" />
            <span>{t(loc, 'hud.phone')}</span>
            <kbd aria-hidden="true">T</kbd>
            {unread > 0 && (
              <>
                <span className="hud-badge" aria-hidden="true">{unread}</span>
                <span className="sr-only">{t(loc, 'hud.phoneUnread', { n: unread })}</span>
              </>
            )}
          </button>
        )}
        {onToggleView && (
          <button type="button" onClick={onToggleView}>
            <Icon name="view" />
            <span>{t(loc, view === 'fps' ? 'hud.viewTps' : 'hud.viewFps')}</span>
            <kbd aria-hidden="true">V</kbd>
          </button>
        )}
        {onEditAvatar && (
          <button type="button" onClick={onEditAvatar}>
            <Icon name="avatar" />
            <span>{t(loc, 'hud.avatar')}</span>
          </button>
        )}
        {onToggleHelp && (
          <button type="button" onClick={onToggleHelp}>
            <Icon name="help" />
            <span>{t(loc, 'hud.help')}</span>
          </button>
        )}
        <a href="/">
          <Icon name="portal" />
          <span>{t(loc, 'hud.portal')}</span>
        </a>
      </nav>
    </div>
  );
}
