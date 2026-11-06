export function BorderBar() {
  return (
    <footer className="border-bar">
      <div className="border-row">
        <span className="label">Borda</span>
        <div className="current-color">
          <span className="swatch" />
          <code>#FFFFFF</code>
          <button type="button" className="copy" disabled title="Cópia do hex chega numa próxima etapa">
            copiar
          </button>
        </div>
        <span className="muted">cores da imagem</span>
        <div className="palette disabled-group" aria-hidden="true">
          <span className="palette-swatch" />
          <span className="palette-swatch" />
          <span className="palette-swatch" />
          <span className="palette-swatch selected" />
          <span className="palette-swatch" />
        </div>
        <span className="recalc disabled">recalcular</span>
      </div>
      <div className="border-hint">
        Borda e Palette chegam numa próxima etapa · o Export desta versão sai sem borda
      </div>
    </footer>
  );
}
