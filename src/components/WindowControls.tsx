import { memo, useEffect, useState } from 'react';
import {
  closeWindow,
  hasWindowControls,
  minimizeWindow,
  toggleMaximizeWindow,
  watchWindowMaximized,
} from '../platform/tauri';

/**
 * The window is undecorated, so the top bar doubles as the title bar and these
 * are the only caption buttons. The browser build renders nothing: there is no
 * window to control there.
 */
export const WindowControls = memo(function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!hasWindowControls()) return;
    let active = true;
    let stop: (() => void) | undefined;
    void watchWindowMaximized((value) => {
      if (active) setMaximized(value);
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  if (!hasWindowControls()) return null;

  return (
    <div className="window-controls">
      <button
        type="button"
        aria-label="Minimizar"
        title="Minimizar"
        onClick={() => void minimizeWindow()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        title={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => void toggleMaximizeWindow()}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M2.5 2.5V1h6.5v6.5H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect
              x="1"
              y="2.5"
              width="6.5"
              height="6.5"
              rx="0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <rect
              x="1"
              y="1"
              width="8"
              height="8"
              rx="0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-close"
        aria-label="Fechar"
        title="Fechar"
        onClick={() => void closeWindow()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
});
