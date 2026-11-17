/**
 * The reference catalog. Every other language is typed against these keys, so a
 * missing translation is a typecheck error rather than an English sentence in
 * the middle of a Japanese screen.
 *
 * The copy is the pt-BR the app shows: this file is where a wording change
 * happens, never in a component. The vocabulary follows `docs/i18n.md` — Frame
 * is a moldura, Crop a recorte, Source a origem, Board a prancheta, Tile a
 * bloco — and no screen mixes two languages.
 *
 * `{name}` marks a parameter.
 */
import type { TextRef } from './text';
import { appPtBR } from './parts/app.pt-BR';
import { exportPtBR } from './parts/export.pt-BR';
import { settingsPtBR } from './parts/settings.pt-BR';
import { stagePtBR } from './parts/stage.pt-BR';

export const ptBR = {
  // Shell and shared controls
  'common.close': 'Fechar',
  'common.cancel': 'Cancelar',
  'window.minimize': 'Minimizar',
  'window.restore': 'Restaurar',
  'window.maximize': 'Maximizar',
  'window.close': 'Fechar',
  'hex.invalid': 'HEX inválido. Use #RRGGBB.',
  'hex.title': 'HEX · Enter aplica · Esc cancela',
  'notice.busy': 'Termine a operação em andamento antes de começar outra.',

  // OS dialog chrome
  'dialog.openMedia': 'Abrir imagens ou vídeos',
  'dialog.mediaFilter': 'Imagens e vídeos',
  'dialog.exportGif': 'Exportar GIF',
  'dialog.exportPng': 'Exportar PNG',
  'dialog.exportFolder': 'Pasta das exportações',

  // Settings dialog
  'settings.title': 'Configurações',
  'settings.close': 'Fechar Configurações',
  'settings.sectionLanguage': 'Idioma',
  'settings.languageLabel': 'Idioma da interface',
  'settings.languageHint':
    'Detectado do sistema na primeira abertura. Muda na hora, sem reiniciar.',
  'settings.sectionImageChest': 'Image Chest',
  'settings.groupConnection': 'Conexão',
  'settings.tokenLabel': 'Token pessoal',
  'settings.tokenPlaceholder': 'cole o token pessoal',
  'settings.tokenAria': 'Token do Image Chest',
  'settings.tokenSavedHere': 'Salvo só neste computador.',
  'settings.generateToken': 'Gerar um token',
  'settings.testing': 'Testando…',
  'settings.testConnection': 'Testar conexão',
  'settings.clearToken': 'Limpar token',
  'settings.clearTokenTitle': 'Apaga o token salvo neste computador',
  'settings.groupUpload': 'Upload',
  'settings.defaultPrivacy': 'Privacidade padrão',
  'settings.defaultPrivacyAria': 'Privacidade padrão da publicação',
  'settings.credit': 'Crédito na descrição',
  'settings.creditHint':
    'Um crédito por publicação; num lote com publicação única, só a primeira imagem.',
  'settings.account': 'Conta',
  'settings.accountGold': 'Gold · 200 por publicação',
  'settings.accountStandard': 'Padrão · 20 por publicação',
  'settings.accountUnknown': 'não verificada · 20 por publicação',
  'settings.checkingAccount': 'Verificando…',
  'settings.checkAccount': 'Verificar conta',
  'settings.checkAccountTitle':
    'Pergunta ao Image Chest se a conta é Gold, para liberar lotes de 200',
  'settings.batchHint': '20 arquivos por publicação; 200 em contas Gold.',
  'settings.sectionBoard': 'Prancheta',
  'settings.importMode': 'Ao importar',
  'settings.importModeAria': 'O que fazer ao importar com blocos na prancheta',
  'settings.importAppend': 'Adicionar à prancheta',
  'settings.importReplace': 'Substituir a prancheta',
  'settings.importHint':
    'Adicionar mantém os blocos abertos; substituir limpa a prancheta e começa de novo com o que você importou.',
  'settings.sectionExport': 'Exportação',
  'settings.folder': 'Pasta',
  'settings.downloadsDefault': 'Downloads (padrão)',
  'settings.chooseFolder': 'Escolher pasta',
  'settings.useDownloads': 'Usar Downloads',
  'settings.useDownloadsTitle': 'Volta a usar a pasta Downloads',
  'settings.format': 'Formato',
  'settings.formatHint':
    'Escolhido no painel de exportação; uma origem estática sempre sai em PNG.',
  'settings.sectionBorder': 'Borda',
  'settings.color': 'Cor',
  'settings.borderColorAria': 'Cor da Borda',
  'settings.width': 'Largura',
  'settings.borderWidthLabel': 'Largura da Borda',
  'settings.borderHint':
    'A largura é em pixels do card 1× e cresce junto com a exportação: 1 px no 1× vira 2 px no 2×. Mudar a Borda não muda o tamanho escolhido na exportação.',
  'settings.sectionAbout': 'Sobre',
  'settings.version': 'Versão',
  'settings.tour': 'Tour',
  'settings.replayTour': 'Ver o tour novamente',
  'settings.repository': 'Repositório',
  'settings.updates': 'Atualizações',
  'settings.checkUpdateAria': 'Verificar atualizações',
  'settings.checkUpdateTitle': 'Verificar atualizações',
  'settings.updateHint':
    'A checagem roda ao abrir o app; uma versão pulada só volta a aparecer pelo botão ao lado.',
  'settings.escCloses': 'Esc fecha',

  // Image Chest privacy values
  'privacy.hidden': 'Oculta',
  'privacy.public': 'Pública',
  'privacy.secret': 'Secreta',

  // Tour chrome
  'tour.appLabel': 'Tour do app',
  'tour.close': 'Fechar o tour',
  'tour.back': 'Voltar',
  'tour.next': 'Avançar',
  'tour.finish': 'Concluir',

  // Update status
  'update.statusIdle': 'Ainda não verificado',
  'update.statusChecking': 'Verificando…',
  'update.statusCurrent': 'Atualizado',
  'update.statusAvailableVersion': 'Nova versão {version} disponível',
  'update.statusAvailable': 'Nova versão disponível',
  'update.statusDownloadingVersion': 'Baixando a versão {version}…',
  'update.statusDownloading': 'Baixando…',
  'update.statusInstalling': 'Instalando…',
  'update.statusFailed': 'Falha ao atualizar',
  'update.statusCheckFailed': 'Não foi possível verificar',
  'update.statusUnsupported': 'Verificação só no app desktop',
  'update.progressPercent': 'Baixando… {percent}%',

  // Optimize
  'optimize.baseInvalid': 'O GIF base é inválido.',
  'optimize.outputInvalid': 'O compressor devolveu um GIF inválido.',
  'optimize.failed': 'Não foi possível comprimir o GIF; o arquivo sem otimização foi mantido.',

  // Tool rail: Frame and Crop
  'rail.frame': 'Moldura',
  'rail.adjustFrame': 'Ajustar moldura',
  'rail.finishAdjust': 'Concluir',
  'rail.adjustTip':
    'Arraste as bordas ou os cantos da moldura para enquadrar. Shift solta a proporção; +Alt solta os encaixes (proporção e centro); a roda do mouse dá zoom. C ou Esc conclui.',
  'rail.scale': 'Modo de escala',
  'rail.modeFit': 'Cobrir',
  'rail.modeFitTitle': 'Cobre a moldura, cortando o excesso da origem',
  'rail.modePad': 'Conter',
  'rail.modePadTitle': 'Cabe inteira, preenchendo as sobras com a cor do preenchimento',
  'rail.modeFullWidth': 'Largura',
  'rail.modeFullWidthTitle': 'Encaixa a largura da origem na moldura',
  'rail.modeFullHeight': 'Altura',
  'rail.modeFullHeightTitle': 'Encaixa a altura da origem na moldura',
  'rail.modeFitHint': 'Cobre e corta o excesso.',
  'rail.modePadHint': 'Mostra a origem inteira.',
  'rail.modeFullWidthHint': 'Encaixa pela largura.',
  'rail.modeFullHeightHint': 'Encaixa pela altura.',
  'rail.cropAdjust': 'Ajuste do recorte',
  'rail.zoom': 'zoom',
  'rail.zoomLabel': 'Zoom',
  'rail.offsetH': 'deslocamento H',
  'rail.offsetHLabel': 'Deslocamento horizontal',
  'rail.offsetV': 'deslocamento V',
  'rail.offsetVLabel': 'Deslocamento vertical',
  'rail.rotate': 'girar',
  'rail.padColor': 'cor do preenchimento',
  'rail.padColorLabel': 'Cor do preenchimento',
  'rail.padColorTitle': 'Para pegar uma cor da imagem, use “pegar cor da imagem”',
  'rail.padHexLabel': 'HEX do preenchimento',
  'rail.pickColor': 'pegar cor da imagem',
  'rail.pickColorActive': 'clique na imagem · Esc cancela',
  'rail.resetCrop': 'redefinir recorte',

  // Tool rail: Sharpness and waifu2x
  'rail.enhance': 'Realce',
  'rail.sharpness': 'nitidez',
  'rail.sharpnessLabel': 'Nitidez',
  'rail.waifu2xEnable': 'Ligar o waifu2x',
  'rail.waifu2xDisable': 'Desligar o waifu2x',
  'rail.on': 'ligado',
  'rail.off': 'desligado',
  'rail.denoiseScale': 'Redução de ruído e escala',
  'rail.denoise': 'redução de ruído',
  'rail.denoiseLabel': 'Redução de ruído do waifu2x',
  'rail.denoiseLevel': 'Redução de ruído {level}',
  'rail.waifu2xScaleLabel': 'Escala do waifu2x',
  'rail.waifu2xKeepSize': 'Mantém o tamanho da exportação',
  'rail.waifu2xUpscale': 'Amplia {scale}× e define o tamanho da exportação',
  'rail.waifu2xChecking': 'verificando a GPU e o sidecar…',
  'rail.waifu2xApplied': 'aplicado na exportação',
  'rail.waifu2xEnableHint': 'ligue para aplicar na exportação',
  'rail.waifu2xUnavailable': 'waifu2x indisponível neste computador',

  // Tool rail: GIF
  'rail.gif': 'GIF',
  'rail.frames': 'quadros',
  'rail.framesOf': '{trimmed} de {total}',
  'rail.duration': 'duração',
  'rail.trimRange': 'trecho',
  'rail.trimState': '{start}–{end} · {state}',
  'rail.speed': 'velocidade',
  'rail.gifAdjust': 'Ajustes do GIF',
  'rail.speedLabel': 'Velocidade do GIF',
  'rail.resetTrim': 'redefinir trecho',
  'rail.showFrames': 'ver painel de quadros',
  'rail.hideFrames': 'ocultar painel de quadros',
  'rail.toggleFramesTitle': 'Mostrar ou ocultar o painel de quadros (F)',

  // Proportion menu
  'ratio.title': 'Proporção da moldura',
  'ratio.orientation': 'Orientação',
  'ratio.portrait': 'Retrato',
  'ratio.landscape': 'Paisagem',
  'ratio.presets': 'Proporções',
  'ratio.source': 'Origem',
  'ratio.snap': 'Encaixar proporções',
  'ratio.custom': 'Personalizado',

  // Border bar and Palette
  'border.label': 'Borda',
  'border.hexLabel': 'HEX da Borda',
  'border.copy': 'copiar',
  'border.copyTitle': 'Copiar o hex da Borda',
  'border.widthLabel': 'Largura da Borda',
  'border.palette': 'Cores da imagem',
  'border.swatchLabel': 'Borda {hex}',
  'border.empty': 'sem cores',
  'border.recalc': 'recalcular',
  'border.recalcTitle': 'Recalcular a paleta a partir do recorte atual',

  // Timeline
  'timeline.label': 'Reprodução do GIF',
  'timeline.pause': 'Pausar',
  'timeline.play': 'Reproduzir',
  'timeline.pauseTitle': 'Pausar (espaço)',
  'timeline.playTitle': 'Reproduzir (espaço)',
  'timeline.trim': 'trecho',
  'timeline.trimTitle': 'Escolher só um trecho do GIF',
  'timeline.startHandle': 'Primeiro quadro do trecho',
  'timeline.endHandle': 'Último quadro do trecho',
  'timeline.meta': 'quadro {index}/{count} · {duration}',

  // Frame grid
  'frames.label': 'Quadros da animação',
  'frames.title': 'Quadros',
  'frames.delay': 'duração do quadro',
  'frames.delayAt': 'duração a {speed}',
  'frames.delayLabel': 'Duração do quadro selecionado em milissegundos',
  'frames.base': 'base {ms} ms',
  'frames.baseSuffix': ', base {ms} ms',
  'frames.remove': 'remover quadro',
  'frames.removeTitle': 'Remover o quadro selecionado',
  'frames.count': 'quadro {index}/{count}',
  'frames.cellLabel': 'Quadro {index} de {count}, {ms} ms{base}',
  'frames.cellTitle': 'Quadro {index} · {ms} ms{base}',
  'frames.cellMeta': '{index} · {ms} ms',

  // Empty Board
  'empty.title': 'Arraste suas imagens',
  'empty.subtitlePreset': 'Cada uma vira uma carta {label}, pronta para exportar.',
  'empty.subtitle': 'Cada uma vira uma carta na proporção escolhida, pronta para exportar.',
  'empty.open': 'Abrir imagens…',
  'empty.hintBefore': 'ou cole um link no topo ·',
  'empty.hintAfter': '· arraste vários arquivos',

  'download.notFound': 'O link não existe (404). Confira o endereço.',
  'download.forbidden': 'O servidor recusou o acesso (403) a {host}.',
  'download.noResponse': 'O servidor não respondeu ao pedido para {host}.',
  'download.httpStatus': 'O servidor respondeu {status} para {host}.',
  'download.notImageType':
    'O link não aponta para uma imagem ou vídeo ({type}). Use um link direto para PNG, JPG, GIF, WebP, MP4, MOV ou WebM.',
  'download.notImageHost':
    'O link {host} não devolveu uma imagem ou vídeo reconhecido. Use um link direto para o arquivo.',
  'download.tooLarge': 'O download passa de 30 MB. Use um arquivo menor ou otimize o GIF antes.',
  'download.cancelled': 'Download cancelado.',
  'download.unreachable': 'Não foi possível alcançar {host}. Verifique a conexão ou o link.',
  'download.failedHost': 'Não foi possível baixar o link de {host}. {detail}',
  'download.invalidUrl': 'O link precisa começar com http:// ou https://.',
  'download.empty': 'O link devolveu um arquivo vazio.',
  'download.failed': 'Não foi possível baixar essa imagem.',
  'historyPreview.tooLarge': 'O arquivo da exportação é grande demais para a prévia.',
  'imagechest.unauthorized':
    'O token do Image Chest foi recusado. Confira o token em Configurações.',
  'imagechest.noToken': 'Salve o token do Image Chest em Configurações antes de subir.',
  'imagechest.uploadFailed': 'Não foi possível subir a imagem. Tente de novo.',
  'import.failed': 'Não foi possível abrir essa imagem.',
  'update.detail': '{detail}',
  'update.networkFailure': 'falha de rede',

  // Errors raised by src/core, src/platform and src/workers
  'common.cancelled': 'Cancelado.',
  'common.unknownCause': 'causa desconhecida',
  'notice.unknown': 'Algo deu errado. {detail}',
  'batch.noFreeName': 'Não há nome livre para "{name}" nesta pasta.',
  'export.waifuOutputUnreadable': 'A saída do waifu2x não pôde ser lida.',
  'export.waifuIncomplete': 'O waifu2x não processou a imagem inteira. Tente exportar de novo.',
  'export.errNoSource': 'Não há origem para exportar.',
  'export.errWaifuUnavailable': 'O waifu2x não está disponível.',
  'export.notAnimated': 'A origem não é animada.',
  'export.failed': 'Não foi possível exportar. {detail}',
  'gif.truncated': 'GIF truncado.',
  'gif.invalidCode': 'Código GIF inválido.',
  'gif.notGif': 'Arquivo não é um GIF.',
  'gif.noDimensions': 'GIF sem dimensões válidas.',
  'gif.invalidControlBlock': 'Bloco de controle GIF inválido.',
  'gif.unknownBlock': 'Bloco GIF desconhecido.',
  'gif.frameNoDimensions': 'Quadro GIF sem dimensões válidas.',
  'gif.invalidColorCode': 'Código de cor GIF inválido.',
  'gif.noFrames': 'GIF sem quadros.',
  'gif.frameTooSmall': 'Quadro menor que a dimensão do GIF.',
  'gif.alreadyEnded': 'O GIF já foi finalizado.',
  'gif.nothingToEncode': 'Não há quadros para codificar.',
  'gif.encodeCancelled': 'Codificação cancelada.',
  'historyPreview.unreadable': 'Não foi possível ler a exportação. {detail}',
  'historyPreview.gone': 'A exportação saiu do histórico.',
  'historyPreview.desktopOnly': 'A prévia da exportação só funciona no app desktop.',
  'imagechest.malformedAccount': 'O Image Chest respondeu sem os dados da conta. Confira o token.',
  'imagechest.postMissing': 'A publicação "{postId}" não existe. Confira o id.',
  'imagechest.postNoImages': 'A publicação "{postId}" não pode receber imagens. Confira o id.',
  'imagechest.postInvalid': 'A publicação "{postId}" não parece um id válido. Confira o id.',
  'imagechest.postNotYours':
    'A publicação "{postId}" não é sua ou não pode receber imagens. Confira o id.',
  'imagechest.noFiles': 'Nenhum arquivo para subir.',
  'imagechest.tooLarge':
    'A imagem passa de 20 MB, o limite do Image Chest por arquivo. Reduza a escala ou otimize o arquivo.',
  'imagechest.tooLargeNamed':
    '"{name}" passa de 20 MB, o limite do Image Chest por arquivo. Reduza a escala ou otimize o arquivo.',
  'imagechest.rateLimited': 'O Image Chest está limitando os pedidos. Tente de novo em {seconds}s.',
  'imagechest.serverFailure': 'O Image Chest respondeu {status}. Tente de novo em instantes.',
  'imagechest.malformed': 'O Image Chest respondeu sem um link direto. Tente de novo.',
  'imagechest.offline':
    'Sem conexão com o Image Chest. Verifique a internet e tente de novo. {detail}',
  'imagechest.notAccepted': 'O Image Chest não aceitou o upload (404). Tente de novo.',
  'imagechest.desktopOnly': 'O upload só funciona no app desktop.',
  'import.unsupportedExt':
    'Formato não suportado: .{ext}. Use PNG, JPG, GIF, WebP, APNG, MP4, MOV ou WebM.',
  'import.unsupported': 'Formato não suportado. Use PNG, JPG, GIF, WebP, APNG, MP4, MOV ou WebM.',
  'import.corrupt': 'Não foi possível ler "{name}". O arquivo pode estar corrompido.',
  'import.empty': '"{name}" está vazio.',
  'palette.cancelled': 'Paleta cancelada.',
  'png.positiveDimensions': 'O PNG precisa de dimensões positivas.',
  'png.channels': 'O PNG precisa de 3 ou 4 canais por pixel.',
  'waifu2x.cancelled': 'waifu2x cancelado.',
  'waifu2x.failed': 'O waifu2x falhou: {detail}',
  'waifu2x.noImage': 'O waifu2x não produziu uma imagem.',
  'waifu2x.unknownFailure': 'falha desconhecida',
  'waifu2x.browserUnavailable': 'waifu2x indisponível no navegador.',
  'browser.noCanvas': 'Canvas 2D indisponível.',
  'browser.pngDecodeUnavailable': 'A decodificação de PNG não está disponível.',
  'browser.pngEncodeFailed': 'Falha ao codificar o PNG.',
  'gifEncoder.terminated': 'O codificador do GIF foi encerrado.',
  'gifEncoder.failed': 'O codificador do GIF falhou.',
  'gifEncoder.invalidMessage': 'O codificador do GIF devolveu uma mensagem inválida.',
  'gifEncoder.encodeFailed': 'Não foi possível codificar o quadro do GIF.',
  'gifOptimizer.noOutput': 'O gifsicle não devolveu um GIF.',
  'system.explorerDesktopOnly': 'O Explorador só abre no app desktop.',
  'video.codec': 'Codec não suportado.',
  'video.unrecognisedFormat': 'Formato de vídeo não reconhecido.',
  'video.noDimensions': 'O vídeo não tem dimensões válidas.',
  'video.noDuration': 'O vídeo não tem duração válida.',
  'video.noCanvas': 'Não foi possível criar o canvas do vídeo.',
  'video.disposed': 'O vídeo foi descartado.',
  'video.frameFetchFailed': 'Falha ao buscar o quadro do vídeo.',
  'video.unreadable': 'Não foi possível ler este vídeo. O codec pode não ser suportado pelo app.',
  'optimize.cancelled': 'Otimização cancelada.',

  'waifu2x.missing':
    'O waifu2x não faz parte desta versão. Use o instalador ou o ZIP portátil para tê-lo; o resto do editor continua funcionando.',
  'waifu2x.unsupported': 'Este computador não tem uma GPU com Vulkan. {detail}',

  ...exportPtBR,
  ...stagePtBR,
  ...settingsPtBR,
  ...appPtBR,
} as const;

/** Every message key. A component can only ask for one of these. */
export type MessageKey = keyof typeof ptBR;

/** What every other language has to provide: all of them, no extras lost. */
export type Catalog = Readonly<Record<MessageKey, string>>;

/**
 * The `{name}` placeholders a message declares, read off the reference text, so
 * a call site cannot misspell a parameter and silently print `{width}` on
 * screen in six languages.
 */
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

export type MessageParamsFor<K extends MessageKey> = {
  [Name in Placeholders<(typeof ptBR)[K]>]: string | number | TextRef;
};
