import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { defaultAvatar } from './Avatar.jsx';
import { getLocale, normalizeLocale, t } from './ui/i18n.js';

const fields = ['skin', 'outfit', 'accent'];
const hex = /^#[0-9a-f]{6}$/i;
const colorOf = (avatar, key) => (hex.test(avatar?.[key]) ? avatar[key] : defaultAvatar[key]);
// the selected option: the stored id when the renderer ships it, otherwise the first (default) one, so an old or unknown value shows a real choice
const choiceOf = (value, options) => (options.includes(value) ? value : options[0]);

// A label for an id the renderer ships but this build has no words for yet: show the id rather than a raw translation key
const choiceLabel = (loc, group, id) => { const key = `editor.${group}.${id}`; const label = t(loc, key); return label === key ? id : label; };

// Native <dialog> + <input type="color">: focus trap, Escape and pickers come for free.
// `preview` is an optional node from the 3D scene (B) that follows `avatar` while the colors change.
// Cancel (button or Escape) restores the saved colors, look and accessory; a failed save keeps the dialog open and says why.
// `looks` and `accessories` are the ids the 3D renderer really ships (B's catalogue, passed in by App.jsx). A group is only offered when it has
// more than one option; with neither prop the editor behaves exactly as before (colours only) and a save sends colours only.
export function AvatarEditor({ open, avatar, onChange, onClose, preview, locale, looks = [], accessories = [] }) {
  const loc = normalizeLocale(locale ?? getLocale());
  const dialog = useRef();
  const saved = useRef(avatar);
  const [status, setStatus] = useState({ text: '', error: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && !dialog.current.open) {
      saved.current = avatar;
      setStatus({ text: '', error: false });
      setSaving(false);
      dialog.current.showModal();
    }
    if (!open && dialog.current.open) dialog.current.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => {
    if (saving) return;
    onChange(saved.current);
    onClose();
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus({ text: t(loc, 'editor.saving'), error: false });
    try {
      const body = Object.fromEntries(fields.map((key) => [key, colorOf(avatar, key)]));
      if (looks.length > 1) body.look = choiceOf(avatar?.look, looks);
      if (accessories.length > 1) body.accessory = choiceOf(avatar?.accessory, accessories);
      const { avatar: stored } = await api('/api/me/avatar', 'PUT', body);
      saved.current = stored;
      onChange(stored);
      onClose();
    } catch (error) {
      setStatus({ text: t(loc, 'editor.error', { message: error.message }), error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="avatar-editor"
      aria-labelledby="avatar-title"
      lang={loc}
      onCancel={(event) => { event.preventDefault(); cancel(); }}
      // Keys typed in the editor must not drive the avatar; Escape still reaches the dialog's own cancel.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={save}>
        <h2 id="avatar-title">{t(loc, 'editor.title')}</h2>
        {preview && <div className="avatar-preview" role="group" aria-label={t(loc, 'editor.preview')}>{preview}</div>}
        {fields.map((key) => (
          <label key={key}>
            <input type="color" value={colorOf(avatar, key)} disabled={saving} onChange={(event) => onChange({ ...defaultAvatar, ...avatar, [key]: event.target.value })} />
            {t(loc, `editor.${key}`)}
          </label>
        ))}
        {[['look', looks], ['accessory', accessories]].map(([group, options]) => options.length > 1 && (
          <fieldset key={group} disabled={saving}>
            <legend>{t(loc, `editor.${group}`)}</legend>
            {options.map((id) => (
              <label key={id} className="avatar-choice">
                <input type="radio" name={`avatar-${group}`} value={id} checked={choiceOf(avatar?.[group], options) === id} onChange={() => onChange({ ...defaultAvatar, ...avatar, [group]: id })} />
                {choiceLabel(loc, group, id)}
              </label>
            ))}
          </fieldset>
        ))}
        <p className="avatar-hint">{t(loc, 'editor.hint')}</p>
        <p className={status.error ? 'avatar-status avatar-error' : 'avatar-status'} role={status.error ? 'alert' : 'status'}>{status.text}</p>
        <div className="actions">
          <button type="button" onClick={cancel} disabled={saving}>{t(loc, 'editor.cancel')}</button>
          <button type="submit" disabled={saving}>{t(loc, 'editor.save')}</button>
        </div>
      </form>
    </dialog>
  );
}
