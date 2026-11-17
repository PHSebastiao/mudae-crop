<p align="center">
  <img src="assets/icon.svg" width="88" height="88" alt="mudae crop">
</p>

<h1 align="center">mudae crop</h1>

<p align="center">
  Um editor local para transformar imagens e GIFs em cards do Mudae.<br>
  <strong>Windows 10/11</strong> · Tauri 2 · React · TypeScript
</p>

## O que é

O mudae crop faz o caminho inteiro em uma janela: traz uma ou várias origens,
enquadra cada uma na moldura do card, ajusta a Borda e a paleta, trata o GIF e
exporta um PNG ou GIF pronto para o `$ai` — ou manda o lote inteiro para o
Image Chest de uma vez.

Tudo roda no seu computador. A única coisa que usa a rede é o upload para o
Image Chest.

## Recursos

- **Origem** de arquivo, arrastar e soltar, Ctrl+V, link ou caminho local: PNG,
  JPG, GIF, WebP, APNG e vídeos MP4/MOV/WebM.
- **Prancheta** com vários blocos: cada origem tem a sua moldura, recorte, Borda,
  preenchimento e tamanho de exportação (o formato PNG/GIF é da sessão); o bloco
  ativo comanda os ajustes, a paleta e a reprodução, o X remove o bloco (o último
  volta à tela inicial) e o **Reordenar** arrasta a ordem.
- **Importação em lote** pelo diálogo, arrastar e soltar ou Ctrl+V: cada bloco
  aparece assim que o arquivo carrega, sem esperar o lote inteiro.
- **Destaque**: duplo clique num bloco abre a origem inteira em tela cheia, com o
  recorte em destaque e o que ficou de fora em volta.
- **Navegação**: a roda rola a prancheta, Ctrl+roda dá zoom na prancheta e a roda
  sobre a imagem dá zoom no recorte.
- **Moldura** por proporção, com Cobrir, Conter, largura/altura total, zoom,
  deslocamento e rotação em 90°.
- **Ajustar moldura** abre o bloco em destaque com oito alças, proporção travada,
  encaixe de proporção e centro, e guias de terços.
- **Borda** de 1 px branca por padrão, sem teto de largura e escalando com a
  exportação (1 px no card 1× vira 2 px no 2×), com a **paleta** extraída do
  recorte (inclusive de GIFs) e cópia do HEX.
- **Nitidez** e **waifu2x** opcional (redução de ruído em 1×, 2× ou 4×) pelo
  sidecar Vulkan.
- **Ferramentas de GIF**: trecho, velocidade, grade de quadros, remover/retomar
  quadro e otimização com alvo de 10 MB.
- **Exportação** em PNG ou GIF, no tamanho nativo, Carta 1×/2× ou tamanho
  personalizado com trava de proporção; aviso de 10 MB e estimativa de tamanho.
  **Exportar todos** escolhe uma pasta e nunca sobrescreve um arquivo existente.
- **Upload** para o Image Chest com link direto copiado, crédito opcional na
  descrição (desligado por padrão; só a primeira imagem quando o lote vira uma
  publicação só) e histórico de 50 itens. **Subir todos** manda o lote numa
  publicação só — ou uma publicação por bloco, com o checkbox **mesma
  publicação** — em lotes de 20 (200 quando a conta é Gold) e copia os links
  separados por `$`.
- **Seis idiomas** — português, inglês, espanhol, russo, japonês e chinês. A
  primeira abertura segue o idioma do Windows (e cai em inglês se não houver
  correspondência); depois disso **Configurações → Idioma** troca na hora, sem
  reiniciar.
- A janela lembra tamanho e posição; cada abertura começa com a prancheta vazia.
- **Tour de boas-vindas** na primeira abertura: um passo a passo que destaca a
  origem, a proporção, a prancheta e a exportação. Pode ser revisto em
  **Configurações → Sobre**.

## Instalação

As builds ficam em [Releases](https://github.com/PHSebastiao/mudae-crop/releases).
Há três opções:

| Arquivo                                  | O que é                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `Mudae-Crop-<versão>-win64-setup.exe`    | Instalador NSIS, atalho no Menu Iniciar e waifu2x incluído. |
| `Mudae-Crop-<versão>-portable-win64.zip` | `Mudae-Crop.exe` + `waifu2x/`; descompacte e rode.          |
| `Mudae-Crop-<versão>-win64.exe`          | Executável sozinho, sem waifu2x.                            |

O instalador baixa o WebView2 se ele não estiver presente; o ZIP e o `.exe`
sozinho precisam do WebView2 já instalado. As configurações e o histórico ficam
em `%LOCALAPPDATA%\Mudae Crop`.

As três builds se atualizam sozinhas: o app consulta o `latest.json` da última
release três segundos depois de abrir, e quando há uma versão nova oferece
instalar. O instalador roda o setup assinado e reabre o app; o ZIP portátil e o
`.exe` sozinho baixam o executável assinado e trocam o arquivo no lugar. A
versão aparece em **Configurações → Sobre**, com um botão para verificar na
hora. Uma versão pulada só volta a aparecer quando a próxima sair, ou pelo botão de verificar.

## Desenvolvimento

### Pré-requisitos

- Node.js 20+
- Rust com toolchain MSVC
- Visual Studio 2022 Build Tools com **Desktop development with C++**
- WebView2 (já vem no Windows 11)
- Uma GPU com Vulkan para os controles do waifu2x (o resto funciona sem)

### Rodando

```powershell
npm install
npm run waifu2x:install   # opcional: baixa o sidecar e os modelos
npm run tauri dev
```

O `npm run tauri dev` precisa de um **Developer PowerShell for VS 2022** (ou
`vcvars64.bat`) para o `link.exe`. Para trabalhar só na UI, `npm run dev` abre no
navegador, mas diálogos nativos, drop, clipboard e salvamento só existem na
janela desktop.

O ícone do app sai de `assets/icon.svg`; `npm run icon` regenera os arquivos de
`src-tauri/icons` para todas as plataformas. Ele renderiza um master de 1024 px
antes de reduzir, para a borda fina não quebrar nos tamanhos pequenos.

### Idiomas

As mensagens vivem em `src/core/i18n/messages.<locale>.ts`: o pt-BR é a
referência, e o tipo `Catalog` obriga cada idioma a ter todas as chaves, então
uma tradução esquecida não compila. `docs/i18n.md` traz a política, a tabela de
termos por idioma e o passo a passo para adicionar um idioma; o ADR-0007 explica
por que não há biblioteca de i18n.

### Onboarding (product tour)

O tour de primeira abertura é o primitivo `Tour` em
`src/components/ui/product-tour.tsx`, montado pelo `App.tsx` com passos que
apontam para ids reais (`#tour-source`, `#tour-proportion`, `#tour-tools`,
`#tour-board`, `#tour-export`, `#tour-border`, `#tour-settings`,
`#tour-shortcuts`). O flag `tourSeen` fica em `settings.json`; terminar ou pular
grava o flag, e **Configurações → Sobre → Ver o tour novamente** abre de novo.

A etapa **Abra a origem** é interativa: o scrim é recortado em quatro painéis
em volta do campo, então o input e o botão de arquivo continuam utilizáveis. No
momento em que uma origem carrega, o tour troca sozinho para os passos do editor
(ajustes da origem, prancheta, exportação, Borda) em vez de continuar no tour
básico. Se o tour básico terminar antes da primeira importação, a primeira
origem abre o tour do editor uma vez, começando na proporção; o flag
`editorTourSeen` guarda essa escolha.

Os estilos do tour são as regras `.tour-*` em `src/styles.css`; a animação usa
`framer-motion` e os ícones vêm de `lucide-react`.

### Checks

```powershell
npm run typecheck
npm test
npm run build
npm run format:check
cargo check --manifest-path src-tauri/Cargo.toml
```

### Build de release

```powershell
npm run version:set -- 0.2.0
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\mudae-crop-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 'a senha da chave'
npm run tauri build -- --bundles nsis --config src-tauri/tauri.release.conf.json
pwsh -NoProfile -File scripts/make-portable.ps1
npm run tauri signer sign -- --app-version 0.2.0 "dist-portable/Mudae-Crop-0.2.0-win64.exe"
```

Sem as duas variáveis o build falha, porque `tauri.release.conf.json` liga
`createUpdaterArtifacts`. O `--app-version` é obrigatório: o updater tem
`requireSignedVersion` ligado e recusa uma assinatura que não declare a versão.

Os três arquivos saem em `dist-portable/`. O workflow
`.github/workflows/release.yml` faz o mesmo em `windows-latest` quando você
empurra uma tag `v*` ou dispara manualmente, e ainda escreve o `latest.json` que
o updater consulta.

A assinatura das atualizações usa um par de chaves gerado uma única vez:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.tauri\mudae-crop-updater.key"
Get-Content -Raw "$env:USERPROFILE\.tauri\mudae-crop-updater.key" |
  gh secret set TAURI_SIGNING_PRIVATE_KEY
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

A chave pública já está em `src-tauri/tauri.conf.json`. **Perder a chave ou a
senha impede qualquer atualização futura**: quem já instalou teria que baixar
uma build nova à mão.

## Estrutura

```text
src/core/       lógica pura: Board, Crop, Frame, render, Palette, GIF, Export
src/platform/   adaptadores Tauri e navegador
src/components/ UI React
src-tauri/      shell Rust, comandos nativos e sidecar waifu2x
scripts/        instalação do waifu2x e empacotamento portátil
tests/          Vitest sobre src/core
```

O `renderFrame()` em `src/core/render.ts` é o único caminho de renderização:
Preview, exportação e paleta passam por ele.

## Notas

- Windows é a plataforma validada.
- O app funciona offline; só o upload para o Image Chest precisa de rede.
- O token do Image Chest fica em texto puro no arquivo local de configurações,
  por ser um app de um único usuário.
