import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { WorldErrorBoundary } from './WorldErrorBoundary.jsx';
import { Gallery } from './Gallery.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('gallery') || new URLSearchParams(location.search).has('lineup') ? <Gallery /> : <WorldErrorBoundary><App /></WorldErrorBoundary>);
