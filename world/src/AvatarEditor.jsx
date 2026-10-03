import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { defaultAvatar } from './Avatar.jsx';
import { getLocale, normalizeLocale, t } from './ui/i18n.js';

const fields = ['skin', 'outfit', 'accent'];
const hex = /^#[0-9a-f]{6}$/i;
const colorOf = (avatar, key) => (hex.test(avatar?.[key]) ? avatar[key] : defaultAvatar[key]);

// Native <dialog> + <input type="color">: focus trap, Escape and pickers come for free.
// `preview` is an optional node from the 3D scene (B) that follows `avatar` while the colors change.
// Cancel (button or Escape) restores the saved colors; a failed save keeps the dialog open and says why.
export function AvatarEditor({ open, avatar, onChange, onClose, preview, locale }) {
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
      const { avatar: stored } = await api('/api/me/avatar', 'PUT', Object.fromEntries(fields.map((key) => [key, colorOf(avatar, key)])));
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
