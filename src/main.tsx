import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setActiveLocale } from './core/i18n/active';
import { detectLocale } from './core/i18n/locale';
import './styles.css';

// The settings file is read asynchronously, so seed the language from the
// webview before the first paint. The boot then resolves the real source
// (`tauri-plugin-os`, the Windows display language) and the stored choice
// replaces this a moment later; the two can disagree for one frame, which is
// cheaper than a blank window waiting on an IPC round trip.
setActiveLocale(detectLocale(typeof navigator === 'undefined' ? null : navigator.language));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
