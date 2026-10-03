import { Component } from 'react';
import { getLocale } from './ui/i18n.js';

// A model, texture or chunk that fails to load must not leave a blank page: show what happened and the accessible portal, with a retry.
const text = {
  fr: { title: 'Le monde 3D n’a pas pu se charger', body: 'Une ressource du monde est introuvable ou le chargement a échoué. Le portail accessible fonctionne sans la 3D.', portal: 'Ouvrir le portail accessible', retry: 'Réessayer' },
  en: { title: 'The 3D world could not load', body: 'A world resource is missing or failed to load. The accessible portal works without 3D.', portal: 'Open the accessible portal', retry: 'Try again' },
};

export class WorldErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('World failed to load:', error?.message ?? error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = text[getLocale()] ?? text.fr;
    return (
      <main role="alert" className="world-error" style={{ position: 'fixed', inset: 0, display: 'grid', placeContent: 'center', gap: '1rem', padding: '2rem', textAlign: 'center', background: '#0b0614', color: '#fff', font: '1rem/1.5 system-ui, sans-serif' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{t.title}</h1>
        <p style={{ margin: 0, maxWidth: '34rem' }}>{t.body}</p>
        <p style={{ margin: 0, display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/" style={{ padding: '0.75rem 1rem', background: '#fff', color: '#0b0614', borderRadius: '0.5rem', fontWeight: 600 }}>{t.portal}</a>
          <button type="button" onClick={() => location.reload()} style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid #fff', background: 'transparent', color: '#fff', font: 'inherit', cursor: 'pointer' }}>{t.retry}</button>
        </p>
      </main>
    );
  }
}
