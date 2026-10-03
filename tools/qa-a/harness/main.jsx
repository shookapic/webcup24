// QA harness for Session A's world UI: the real components over a bright, sky-like background (worst case for the
// semi-transparent HUD), with the API faked by tools/qa-a/world-browser.mjs. Not shipped: nothing imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Phone, PhoneFallback, PhoneScreen, AlertAnnouncer, useAnnouncements, useTransports, useServices } from '../../../world/src/Phone.jsx';
import { WorldHud } from '../../../world/src/ui/WorldHud.jsx';
import { AvatarEditor } from '../../../world/src/AvatarEditor.jsx';
import '../../../world/src/styles.css';

const params = new URLSearchParams(location.search);
const locale = params.get('lang') === 'en' ? 'en' : 'fr';
const userId = params.get('user') ? Number(params.get('user')) : 7;

function App() {
  const { announcements, unseen, status, error, lastUpdated, acknowledge, retry } = useAnnouncements({ userId, ready: true });
  const transports = useTransports(true);
  const services = useServices(true);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [page, setPage] = useState('home');
  const [editing, setEditing] = useState(false);
  const [avatar, setAvatar] = useState({ skin: '#e0ac69', outfit: '#3a6ea5', accent: '#ff4fa3' });
  const [view, setView] = useState('tps');
  const [help, setHelp] = useState(false);
  const alerting = unseen.length > 0 && !editing;
  return (
    <>
      <div className="sky" style={{ position: 'fixed', inset: 0, background: 'linear-gradient(#f4f1e6, #e9d9a8 60%, #c9b27a)' }} />
      <WorldHud
        locale={locale} view={view} phoneOpen={phoneOpen || alerting} unreadCount={unseen.length} district="Centre-ville"
        onTogglePhone={() => setPhoneOpen((open) => !open)} onToggleView={() => setView((v) => (v === 'tps' ? 'fps' : 'tps'))}
        onEditAvatar={() => setEditing(true)} onToggleHelp={() => setHelp((v) => !v)}
      />
      {help && <p id="help-line" style={{ position: 'fixed', bottom: 8, left: 8 }}>help</p>}
      <p id="state" style={{ position: 'fixed', bottom: 8, right: 8, color: '#000' }}>{`view=${view} avatar=${avatar.skin}/${avatar.outfit}/${avatar.accent}`}</p>
      <AlertAnnouncer alerts={unseen} locale={locale} active={editing} />
      <PhoneFallback
        open={phoneOpen || alerting} page={page} onPageChange={setPage} announcements={announcements} pendingAlerts={alerting ? unseen : []}
        services={services} transports={transports} nearestStop="Mairie" status={status} error={error} lastUpdated={lastUpdated}
        onAcknowledge={acknowledge} onRetry={retry} onClose={() => setPhoneOpen(false)} locale={locale}
      />
      <AvatarEditor open={editing} avatar={avatar} onChange={setAvatar} onClose={() => setEditing(false)} locale={locale} preview={<p style={{ margin: 8 }}>preview</p>} />
      {params.get('embed') && (
        <div id="device" style={{ position: 'fixed', left: 20, top: 120, width: 360, height: 740, border: '4px solid #111', borderRadius: 24, overflow: 'hidden' }}>
          <PhoneScreen page={page} onPageChange={setPage} announcements={announcements} services={services} transports={transports} nearestStop="Santé" status={status} locale={locale} onClose={() => {}} />
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
// the legacy export must keep compiling too
void Phone;
