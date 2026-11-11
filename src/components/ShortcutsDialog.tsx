import { useEffect } from 'react';

interface Shortcut {
  readonly keys: string;
  readonly label: string;
}

const KEYBOARD: readonly Shortcut[] = [
  { keys: 'Ctrl+O', label: 'Abrir um arquivo' },
  { keys: 'Ctrl+V', label: 'Colar uma imagem, um link ou um caminho' },
  { keys: 'Ctrl+S', label: 'Exportar o Frame' },
  { keys: 'Ctrl+Enter', label: 'Subir e copiar o link' },
  { keys: 'Ctrl+,', label: 'Abrir Configurações' },
  { keys: 'C', label: 'Ajustar ou concluir o Frame' },
  { keys: 'F', label: 'Mostrar ou ocultar os quadros (imagem animada)' },
  { keys: 'Espaço', label: 'Reproduzir ou pausar a animação' },
  { keys: 'Setas', label: 'Mover o Crop 1 px' },
  { keys: 'Shift+Setas', label: 'Mover o Crop 10 px' },
  { keys: '+ / −', label: 'Aumentar ou diminuir o zoom' },
  { keys: 'R', label: 'Girar o Crop 90°' },
  { keys: '[ / ]', label: 'Diminuir ou aumentar a Borda' },
  { keys: '1 / 2', label: 'Escolher as proporções Mudae e 1:1' },
  { keys: 'Esc', label: 'Sair da ferramenta atual' },
  { keys: '?', label: 'Abrir esta lista' },
];

const MOUSE: readonly Shortcut[] = [
  { keys: 'Arrastar', label: 'Mover a Source ou o Frame' },
  { keys: 'Roda do mouse', label: 'Zoom no ponto do cursor' },
  { keys: 'Shift', label: 'Soltar a proporção em Ajustar Frame' },
  { keys: 'Alt', label: 'Ignorar os encaixes de proporção e de centro' },
];

function ShortcutList({ items }: { readonly items: readonly Shortcut[] }) {
  return (
    <dl className="shortcut-list">
      {items.map((item) => (
        <div key={item.keys}>
          <dt>
            <kbd>{item.keys}</kbd>
          </dt>
          <dd>{item.label}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutsDialog({ onClose }: { readonly onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="settings-modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <header className="settings-head">
          <h2 id="shortcuts-title">Atalhos</h2>
          <button
            type="button"
            className="icon"
            onClick={onClose}
            aria-label="Fechar atalhos"
            autoFocus
          >
            ×
          </button>
        </header>

        <section>
          <h3>Teclado</h3>
          <ShortcutList items={KEYBOARD} />
        </section>

        <section>
          <h3>Mouse e gestos</h3>
          <ShortcutList items={MOUSE} />
        </section>

        <footer className="settings-foot">
          <span className="settings-hint">Esc fecha</span>
          <button type="button" className="settings-close" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
