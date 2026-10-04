import './wayfinding.css';

// Recovery for the physical (3D) phone: some browsers/compositors can fail to paint the HTML screen hosted over the 3D phone (user report on Firefox: text
// flashes then disappears). One visible, keyboard-reachable control switches to the flat accessible phone dialog (same content, same A-owned screen) and the
// choice is remembered; a small control brings the 3D phone back. Nothing here changes what the screen shows.
const STR = {
  fr: { unreadable: 'Écran illisible ? Version simple', unreadableHelp: 'Ouvre le même téléphone dans une fenêtre classique', back: 'Téléphone 3D' },
  en: { unreadable: 'Screen unreadable? Simple version', unreadableHelp: 'Opens the same phone in a regular window', back: '3D phone' },
};
export const FLAT_KEY = 'tn.flatphone';
export const readFlatPreference = () => { try { return localStorage.getItem(FLAT_KEY) === '1'; } catch { return false; } };
export const writeFlatPreference = (on) => { try { if (on) localStorage.setItem(FLAT_KEY, '1'); else localStorage.removeItem(FLAT_KEY); } catch { /* storage unavailable: the choice lasts for this page only */ } };

export function PhoneRecovery({ locale, physicalOpen, flatPreferred, phoneClosed, onFlat, onPhysical }) {
  const text = STR[locale] ?? STR.fr;
  if (physicalOpen) {
    return (
      <div className="recovery recovery-top">
        <button type="button" className="way-button" onClick={onFlat} aria-describedby="recovery-help">{text.unreadable}</button>
        <span id="recovery-help" className="sr-only">{text.unreadableHelp}</span>
      </div>
    );
  }
  if (flatPreferred && phoneClosed) {
    return (
      <div className="recovery recovery-bottom">
        <button type="button" className="way-button way-secondary" onClick={onPhysical}>{text.back}</button>
      </div>
    );
  }
  return null;
}
