<p align="center">
  <img src="assets/icon.svg" width="88" height="88" alt="mudae crop">
</p>

<h1 align="center">mudae crop</h1>

<p align="center">
  Um editor local para transformar imagens e GIFs em cards do Mudae.<br>
  <strong>Windows 10/11</strong> · Tauri 2 · React · TypeScript
</p>

## O que é

O mudae crop faz o caminho inteiro em uma janela: traz uma Source, enquadra no
Frame do card, ajusta a Borda e a Palette, trata o GIF e exporta um PNG ou GIF
pronto para o `$ai`.

Tudo roda no seu computador. A única coisa que usa a rede é o upload para o
Image Chest.

## Recursos

- **Source** de arquivo, arrastar e soltar, Ctrl+V, link ou caminho local: PNG,
  JPG, GIF, WebP, APNG e vídeos MP4/MOV/WebM.
- **Frame** por proporção, com Fit, Pad, largura/altura total, zoom, pan e
  rotação em 90°.
- **Ajustar Frame** com oito alças, proporção travada, encaixe de proporção e
  centro, e guias de terços.
- **Borda** de 1 px branca por padrão, sem teto de largura e escalando com o
  Export (1 px no card 1× vira 2 px no 2×), com a **Palette** extraída do Crop
  (inclusive de GIFs) e cópia do HEX.
- **Sharpness** e **waifu2x** opcional (denoise 1×, 2× ou 4×) pelo sidecar
  Vulkan.
- **GIF tools**: trim, velocidade, grade de quadros, remover/retomar quadro e
  otimização com alvo de 10 MB.
- **Export** PNG ou GIF, no tamanho nativo, Carta 1×/2× ou resize com trava de
  proporção; aviso de 10 MB e estimativa de tamanho.
- **Upload** para o Image Chest com link direto copiado, crédito opcional na
  descrição da imagem (desligado por padrão) e Histórico de 50 itens.
- A janela lembra tamanho e posição; cada abertura começa com um documento
  vazio.

## Instalação

As builds ficam em [Releases](https://github.com/PHSebastiao/mudae-crop/releases).
Há três opções:

| Arquivo                                  | O que é                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `Mudae-Crop-<versão>-win64-setup.exe`    | Instalador NSIS, atalho no Menu Iniciar e waifu2x incluído. |
| `Mudae-Crop-<versão>-portable-win64.zip` | `Mudae-Crop.exe` + `waifu2x/`; descompacte e rode.          |
| `Mudae-Crop-<versão>-win64.exe`          | Executável sozinho, sem waifu2x.                            |

O instalador baixa o WebView2 se ele não estiver presente; o ZIP e o `.exe`
sozinho precisam do WebView2 já instalado. As configurações e o Histórico ficam
em `%LOCALAPPDATA%\Mudae Crop`.

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
npm run tauri build -- --bundles nsis
pwsh -NoProfile -File scripts/make-portable.ps1
```

Os três arquivos saem em `dist-portable/`. O workflow
`.github/workflows/release.yml` faz o mesmo em `windows-latest` quando você
empurra uma tag `v*` ou dispara manualmente.

## Estrutura

```text
src/core/       lógica pura: Crop, Frame, render, Palette, GIF, Export
src/platform/   adaptadores Tauri e navegador
src/components/ UI React
src-tauri/      shell Rust, comandos nativos e sidecar waifu2x
scripts/        instalação do waifu2x e empacotamento portátil
tests/          Vitest sobre src/core
```

O `renderFrame()` em `src/core/render.ts` é o único caminho de renderização:
Preview, Export e Palette passam por ele.

## Notas

- Windows é a plataforma validada.
- O app funciona offline; só o upload para o Image Chest precisa de rede.
- O token do Image Chest fica em texto puro no arquivo local de configurações,
  por ser um app de um único usuário.
