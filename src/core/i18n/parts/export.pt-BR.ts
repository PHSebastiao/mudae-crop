/**
 * Staging area for the reference catalog: one fragment per screen, so the copy
 * of a screen is written next to nothing else. `messages.pt-BR.ts` spreads them
 * into the single catalog the app reads.
 */
export const exportPtBR = {
  // Export panel: History row
  'export.copy': 'copiar',
  'export.copyPathTitle': 'Copiar caminho',
  'export.reveal': 'mostrar',
  'export.revealTitle': 'Abrir no Explorador',
  'export.rowMeta': '{format} · {width}×{height} · {size}',

  // Export panel: size controls
  'export.sizeCapTitle':
    'Limite de renderização: {side} px por lado (memória do canvas/GIF, não é uma regra do Mudae).',

  // Export panel: summary
  'export.awaitLink': 'Aguarde o link…',
  'export.exporting': 'Exportando…',
  'export.export': 'Exportar {format}',
  'export.estimateCapped': '≤ {size}',
  'export.estimateApproximate': '~{size}',
  'export.estimateVideoTitle':
    'Estimativa pelo quadro atual; um vídeo em movimento pode ficar maior',
  'export.estimateExactTitle': 'Tamanho do arquivo',
  'export.estimateTitle': 'Tamanho estimado; a otimização pode mudar o resultado',
  'export.postHidden': 'Publicação oculta',
  'export.postPublic': 'Publicação pública',
  'export.postSecret': 'Publicação secreta',

  // Export panel: actions
  'export.waifuUnavailable':
    'waifu2x indisponível neste computador. Desligue-o para exportar ou subir.',
  'export.uploadNoSourceTitle': 'Importe uma origem primeiro',
  'export.uploadWaifuTitle': 'Desligue o waifu2x para subir',
  'export.uploadNoTokenTitle': 'Configure o token do Image Chest para enviar',
  'export.uploadBadPostTitle': 'Confira o id da publicação',
  'export.uploadTitle': 'Cria uma publicação oculta e copia o link direto',
  'export.configureToken': 'Configurar token para subir',
  'export.uploading': 'Subindo…',
  'export.cooldown': 'Aguarde {seconds}s',
  'export.upload': 'Subir e copiar link',
  'export.exportAllTitle': 'Escolhe uma pasta e exporta todos os blocos',
  'export.exportAll': 'Exportar todos ({count})',
  'export.uploadAllOnePostTitle': 'Uma publicação com todos os blocos',
  'export.uploadAllPerTileTitle': 'Uma publicação por bloco',
  'export.uploadAll': 'Subir todos ({count})',
  'export.uploadAllToken': 'Token para subir todos',
  'export.hintWithToken': 'Ctrl+S exporta · Ctrl+Enter envia · Shift faz o lote todo.',
  'export.hint': 'Ctrl+S exporta.',

  // Export panel: section
  'export.heading': 'Exportação',
  'export.noDimensions': '—',
  'export.ratioCard': 'proporção da carta',
  'export.ratioStretched': 'esticada',
  'export.optimized': 'otimizado · {size}',
  'export.sourceMeta': 'origem {format} {width}×{height}',
  'export.overGuidance': '{estimate} passa dos {limit} recomendados pelo Mudae.',
  'export.overGuidanceGif': ' Otimize o GIF para reduzir; o upload continua liberado.',
  'export.overGuidanceReduced':
    ' O upload continua liberado; reduza a escala para um arquivo menor.',

  // Export panel: format
  'export.formatLabel': 'Formato da exportação',
  'export.formatPng': 'PNG',
  'export.formatPngTitle': 'Imagem estática',
  'export.formatGif': 'GIF',
  'export.formatGifAnimatedTitle': 'GIF animado',
  'export.formatGifStaticTitle': 'A origem é estática',
  'export.gifNeedsAnimation': 'GIF só para origem animada.',

  // Export panel: size
  'export.sizeHeading': 'Tamanho',
  'export.sizeLabel': 'Tamanho da exportação',
  'export.carta1': 'Carta 1×',
  'export.carta2': 'Carta 2×',
  'export.carta2Title': 'Renderiza a origem em 2×',
  'export.customSizeTitle': 'Tamanho personalizado',
  'export.autoSizeTitle': 'Tamanho automático do recorte',
  'export.custom': 'Personalizado',
  'export.native': 'Nativo',
  'export.customSize': 'Tamanho personalizado ›',
  'export.widthLabel': 'Largura da exportação',
  'export.lockLabel': 'Travar proporção da carta',
  'export.lockedTitle': 'Proporção da carta travada',
  'export.unlockedTitle': 'Proporção livre — a imagem pode esticar',
  'export.heightLabel': 'Altura da exportação',
  'export.noSource': 'sem origem',
  'export.customState': 'personalizado',
  'export.autoState': 'automático',
  'export.nativeTitle': 'Tamanho nativo do recorte',
  'export.halve': '÷2',
  'export.halveTitle': 'Metade do tamanho atual',
  'export.double': '×2',
  'export.doubleTitle': 'Dobro do tamanho atual',
  'export.waifuLockedHint': 'waifu2x {scale}× define o tamanho final · base {width}×{height}',
  'export.offRatioHint': 'fora da proporção da carta — a imagem vai esticar',
  'export.nativeCappedHint': 'nativo {width}×{height} · limite de renderização: {side} px por lado',
  'export.aboveNativeHint': 'acima do nativo — ampliando',
  'export.aboveNativeOnlyHint': 'acima do nativo — só amplia',
  'export.carta2GifHint': 'Carta 2× renderiza a origem maior; o GIF pode passar de {limit}.',

  // Export panel: Optimize
  'export.optimizeHeading': 'Otimizar GIF',
  'export.optimizeOnTarget': 'ligado · {size} MB',
  'export.optimizeOnNoTarget': 'ligado · sem alvo',
  'export.optimizeOn': 'ligado',
  'export.optimizeOff': 'desligado',
  'export.useTarget': 'usar alvo',
  'export.targetMb': 'alvo MB',
  'export.targetMbLabel': 'Alvo de tamanho em MB',
  'export.noTargetHint': 'sem alvo — aplica a compressão escolhida, mesmo abaixo de {limit}',
  'export.compression': 'compressão',
  'export.lossyLabel': 'Compressão com lossy',
  'export.compressionLevel': 'Intensidade da compressão',
  'export.levelLight': 'leve',
  'export.levelMedium': 'média',
  'export.levelMax': 'máxima',
  'export.reduceColors': 'reduzir cores',
  'export.colors': 'cores',
  'export.colorsLabel': 'Número de cores',
  'export.lossyHint': 'sem reduzir cores, 100–200 comprime mais · compressão até {max}',
  'export.resultApplied': 'compressão aplicada',
  'export.resultMet': 'alvo atingido',
  'export.resultMissed': 'alvo não atingido',
  'export.resultNoGain': ' · sem ganho; original mantido',
  'export.resultGain': ' · {base} → {size} (−{gain})',
  'export.resultLossy': '· lossy {lossy}',
  'export.resultColors': ' · {colors} cores',
  'export.resultDropped': ' · {frames} repetidos',

  // Export panel: Image Chest
  'export.imageChest': 'Image Chest',
  'export.privacyTitle': 'Privacidade das novas publicações',
  'export.postId': 'Publicação {id}',
  'export.postIdPlaceholder': 'id da publicação (opcional)',
  'export.postIdLabel': 'id da publicação para anexar a exportação',
  'export.samePost': 'mesma publicação',
  'export.samePostTitle':
    'Uma publicação com todos os blocos do lote (o id da publicação também agrupa)',

  // Export panel: History
  'export.history': 'Histórico',
  'export.historyEmpty': 'vazio',
  'export.historyItem': '{count} item',
  'export.historyItems': '{count} itens',
  'export.historyHint': 'Últimos uploads e exportações',
  'export.clear': 'limpar',
  'export.historyNone': 'Nenhum upload ou exportação ainda.',
  'export.uploadMeta': '{format} · Publicação {post} · {size}',
  'export.open': 'abrir',
} as const;
