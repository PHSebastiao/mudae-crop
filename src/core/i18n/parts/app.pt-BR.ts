/** Staging area for the App shell, notices and onboarding tour copy. */
export const appPtBR = {
  // Top bar and drop overlay
  'app.dropToOpen': 'Solte para abrir',
  'app.dropFormats': 'PNG · JPG · GIF · WebP · APNG · MP4 · MOV · WebM',
  'app.linkPlaceholder': 'Cole um link ou caminho',
  'app.linkLabel': 'Link ou caminho da origem',
  'app.open': 'Abrir',
  'app.openFileLabel': 'Abrir arquivo do computador',
  'app.openFileTitle': 'Abrir arquivo do computador (Ctrl+O)',
  'app.shortcutsTitle': 'Atalhos (?)',
  'app.shortcutsLabel': 'Atalhos',
  'app.settingsTitle': 'Configurações (Ctrl+,)',
  'app.settings': 'Configurações',
  'app.closeNotice': 'Fechar aviso',
  'app.cancel': 'cancelar',

  // Notices and progress
  'app.downloading': 'Baixando link… {received}',
  'app.downloadingTotal': 'de {total}',
  'app.importing': 'Importando…',
  'app.importingCount': 'Importando {done} de {total}…',
  'app.batchProgress': '{label} {done} de {total}{name}…',
  'app.exporting': 'Exportando',
  'app.rendering': 'Renderizando',
  'app.uploading': 'Subindo',
  'app.optimizingGif': 'Otimizando GIF',
  'app.enhancingWaifu2x': 'Realçando com waifu2x',
  'app.renderProgress': '{phase}… {percent}',

  // Import
  'app.imageLoaded': 'Imagem carregada.',
  'app.imagesLoaded': '{count} imagens carregadas.',
  'app.importFailures': '{count} arquivos não puderam ser importados. {first}',
  'app.finishExportBeforeImport':
    'Termine a exportação ou o upload em andamento antes de importar.',
  'app.urlImportDesktopOnly': 'Importar por link só funciona no app desktop.',
  'app.openFilesDesktopOnly': 'Abrir arquivos só funciona no app desktop.',
  'app.openDialogFailed': 'Não foi possível abrir o diálogo de arquivos. {reason}',
  'app.linkOrPathHint':
    'Cole um link http(s) ou o caminho de um arquivo PNG, JPG, GIF, WebP, APNG, MP4, MOV ou WebM.',
  'app.pathImportDesktopOnly': 'Importar por caminho de arquivo só funciona no app desktop.',
  'app.readFailed': 'Não foi possível ler "{name}". {reason}',
  'app.downloadCancelled': 'Download cancelado.',
  'app.dropActivateFailed': 'Não foi possível ativar o arrastar e soltar. Use Ctrl+O ou Ctrl+V.',

  // Export
  'app.waitImportBeforeExport': 'Aguarde a importação terminar antes de exportar.',
  'app.exportDesktopOnly': 'Exportar só funciona no app desktop.',
  'app.waifu2xUnavailableExport':
    'O waifu2x não está disponível neste computador. Desligue-o para exportar.',
  'app.exportOverwriteSource': 'a exportação não pode sobrescrever a origem. Escolha outro nome.',
  'app.exported': '{label} {width}×{height} exportado: {name}',
  'app.exportFailed': 'Não foi possível exportar o {label}. {reason}',
  'app.exportAllFailed': 'Não foi possível exportar. {reason}',
  'app.renderCancelled': 'Renderização cancelada.',
  'app.exportCancelled': 'Exportação cancelada.',
  'app.exportCancelledCount': 'Exportação cancelada. {written} de {total} exportados.',
  'app.exportFailures': '{written} de {total} exportados. Falharam: {names}{more}',
  'app.fileExported': '{count} arquivo exportado em {folder}',
  'app.filesExported': '{count} arquivos exportados em {folder}',
  'app.exportFolder': 'Pasta das exportações: {folder}',
  'app.folderDesktopOnly': 'A pasta só pode ser escolhida no app desktop.',
  'app.chooseFolderFailed': 'Não foi possível escolher a pasta. {reason}',

  // Upload
  'app.waitImportBeforeUpload': 'Aguarde a importação terminar antes de subir.',
  'app.uploadDesktopOnly': 'O upload só funciona no app desktop.',
  'app.waifu2xUnavailableUpload':
    'O waifu2x não está disponível neste computador. Desligue-o para subir.',
  'app.waifu2xUnavailableTiles':
    'O waifu2x não está disponível neste computador. Desligue-o nos blocos que o usam.',
  'app.waifu2xUnavailable': 'O waifu2x não está disponível neste computador.',
  'app.saveTokenBeforeUpload': 'Salve o token do Image Chest em Configurações antes de subir.',
  'app.saveTokenBeforeCheck': 'Salve o token do Image Chest antes de verificar a conta.',
  'app.postIdInvalid': 'O id da publicação aceita só letras e números.',
  'app.uploadCooldown': 'Aguarde {seconds}s antes de subir de novo.',
  'app.tileNoLongerActive': 'O bloco que falhou não é mais o ativo.',
  'app.noImageUploaded': 'Nenhuma imagem subiu.',
  'app.goldDemoted':
    'O Image Chest recusou o lote maior. A conta voltou para 20 arquivos por publicação.',
  'app.linkCopied': 'Link copiado: {link}',
  'app.exportedToPostNoCopy':
    'Exportação na publicação {postId}. Não foi possível copiar; use o histórico.',
  'app.linkCopiedNoted': 'Link copiado: {link} · a descrição não foi aplicada.',
  'app.exportedToPostNoCopyNoted':
    'Exportação na publicação {postId} · a descrição não foi aplicada. Use o histórico.',
  'app.linksCopied': '{count} links copiados.',
  'app.postWhere': 'Publicação {postId}',
  'app.postOne': '{count} publicação',
  'app.postMany': '{count} publicações',
  'app.uploadedOneCopied': '{count} imagem na {where} · links copiados',
  'app.uploadedManyCopied': '{count} imagens na {where} · links copiados',
  'app.uploadedNotCopied': '{count} imagens na {where}. Não foi possível copiar; use o histórico.',
  'app.defaultCardName': 'carta',
  'app.openSettings': 'Abrir Configurações',
  'app.tryAgain': 'Tentar de novo',

  // Settings and History
  'app.saveSettingsFailed': 'Não foi possível salvar as Configurações. {reason}',
  'app.saveHistoryFailed': 'Não foi possível salvar o histórico. {reason}',
  'app.loadSettingsFailed': 'Não foi possível ler as Configurações; usando os padrões. {reason}',
  'app.tokenRemovedMessage': 'Token removido deste computador.',
  'app.tokenRemovedNotice': 'Token do Image Chest removido.',
  'app.testTokenDesktopOnly': 'Testar o token só funciona no app desktop.',
  'app.pasteTokenFirst': 'Cole o token antes de testar.',
  'app.connectedAs': 'Conectado como {name}.',
  'app.connectedAsGold': 'Conectado como {name} (Gold).',
  'app.checkAccountDesktopOnly': 'Verificar a conta só funciona no app desktop.',
  'app.accountGold': '{name}: conta Gold, 200 arquivos por publicação.',
  'app.accountStandard': '{name}: conta padrão, 20 arquivos por publicação.',
  'app.historyCleared': 'Histórico limpo.',
  'app.copied': 'Copiado: {value}',
  'app.copyFailed': 'Não foi possível copiar. {reason}',
  'app.openLinkFailed': 'Não foi possível abrir o link. {reason}',
  'app.revealFailed': 'Não foi possível abrir no Explorador. {reason}',

  // Stage
  'app.padColor': 'Cor do preenchimento: {hex}',
  'app.pickTransparent': 'Essa área é transparente. Escolha outro ponto.',
  'app.pickInsideFrame': 'Clique dentro da moldura para pegar uma cor.',

  // Onboarding tour
  'tour.welcomeTitle': 'Bem-vindo ao mudae crop',
  'tour.welcomeBody':
    'Monte cartas a partir das suas imagens: escolha a proporção, enquadre a moldura e exporte em PNG ou GIF. O tour leva menos de um minuto —',
  'tour.welcomeEnd': 'encerra quando quiser.',
  'tour.finishTitle': 'Tudo pronto',
  'tour.finishBody': 'Bom proveito! Para rever este guia, abra',
  'tour.editorFinishBody':
    'Bom proveito! Quando você importar uma imagem, o tour do editor abre com os ajustes da origem, da prancheta, da exportação e da Borda. Para rever este guia, abra',
  'tour.settingsLink': 'Configurações → Sobre',
  'tour.settingsTitle': 'Configurações',
  'tour.settingsBody':
    'Token do Image Chest, pasta das exportações, Borda padrão e atualizações ficam nesta janela.',
  'tour.sourceTitle': 'Abra a origem',
  'tour.sourceBody':
    'Cole um link, escolha um arquivo ou arraste imagens. Pode experimentar agora: o tour continua assim que a origem carregar.',
  'tour.ratioTitle': 'Escolha a proporção',
  'tour.ratioBody':
    'A proporção define o formato da carta. As proporções do Mudae já trazem os tamanhos Carta 1× e 2× na exportação.',
  'tour.shortcutsTitle': 'Atalhos',
  'tour.shortcutsBody':
    'Este botão abre a janela de Atalhos, com todas as teclas do editor. Consulte quando esquecer uma combinação.',
  'tour.frameRatioTitle': 'Proporção da moldura',
  'tour.sourceToolsTitle': 'Ajustes da origem',
  'tour.sourceToolsBody':
    'Cobrir, Conter, zoom, rotação, nitidez e waifu2x ficam nesta barra. As setas do teclado movem a origem 1 pixel por vez; com Shift, 10 pixels.',
  'tour.cropTitle': 'Enquadre a carta',
  'tour.cropBody':
    'Arraste para mover a origem, use a roda para o zoom e os cantos para redimensionar a moldura.',
  'tour.cropEnd': 'entra em Ajustar moldura.',
  'tour.exportTitle': 'Exportação',
  'tour.exportBody': 'Escolha o formato, o tamanho e a otimização.',
  'tour.exportKeys': 'exporta;',
  'tour.exportUpload': 'envia para o Image Chest.',
  'tour.borderTitle': 'Borda e paleta',
  'tour.borderBody':
    'A Borda é desenhada por último, depois do realce. A paleta sugere cores tiradas da própria imagem.',
} as const;
