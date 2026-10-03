import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const fields = [
  ['skin', 'Peau'],
  ['outfit', 'Combinaison'],
  ['accent', 'Visière et sac'],
];

// Native <dialog> + <input type="color">: focus trap, Escape and pickers come for free.
export function AvatarEditor({ open, avatar, onChange, onClose }) {
  const dialog = useRef();
  const saved = useRef(avatar);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (open && !dialog.current.open) {
      saved.current = avatar;
      setStatus('');
      dialog.current.showModal();
    }
    if (!open && dialog.current.open) dialog.current.close();
  }, [open]);

  const cancel = () => {
    onChange(saved.current);
    onClose();
  };

  const save = async (event) => {
    event.preventDefault();
    setStatus('Enregistrement…');
    try {
      const { avatar: stored } = await api('/api/me/avatar', 'PUT', avatar);
      saved.current = stored;
      onChange(stored);
      onClose();
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <dialog ref={dialog} className="avatar-editor" aria-labelledby="avatar-title" onCancel={(event) => { event.preventDefault(); cancel(); }}>
      <form onSubmit={save}>
        <h2 id="avatar-title">Votre colon</h2>
        {fields.map(([key, label]) => (
          <label key={key}>
            <input type="color" value={avatar[key]} onChange={(event) => onChange({ ...avatar, [key]: event.target.value })} />
            {label}
          </label>
        ))}
        <p role="status">{status}</p>
        <div className="actions">
          <button type="button" onClick={cancel}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </dialog>
  );
}
