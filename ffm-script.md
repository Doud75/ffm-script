# ffm-script — Document de référence

> Successeur moderne de `fluent-ffmpeg` (archivé mai 2025).
> Lib Node.js TypeScript pour le traitement media — des fondations solides jusqu'au chunked transcoding parallèle.

---

## Pourquoi ce projet existe

`fluent-ffmpeg` était la référence pour wrapper FFmpeg en Node.js pendant 10 ans. Archivé en mai 2025 pour trois raisons documentées par son mainteneur :

- Architecture conçue pour des use cases obsolètes (encodage Flash) qui a pollué toute la codebase
- La lib faisait trop de choses, impossible à maintenir
- Construire quelque chose de stable par-dessus une CLI FFmpeg qui casse à chaque version majeure

Depuis, il n'existe aucune surcouche FFmpeg haut niveau, maintenue, TypeScript native pour Node.js. `node-av` et `@mmomtchev/ffmpeg` sont des bindings C natifs — puissants mais complexes, risque de segfault, pas adaptés aux devs applicatifs. `ffmpeg.wasm` ne tourne pas côté serveur.

`ffm-script` comble ce vide. Et va plus loin.

---

## Principes non négociables

- **Zéro dépendance runtime** — s'installe sans tirer 50 packages
- **TypeScript strict natif** — pas de `@types/` séparé, pas de `any`
- **Zéro serveur requis** — FFmpeg tourne sur la machine de l'utilisateur
- **Erreurs lisibles** — jamais de stderr brut balancé à l'utilisateur
- **API prévisible** — chaque fonction fait une chose, bien documentée

---

## Stack technique

- **Langage** : TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **Build** : tsup → dual ESM + CJS (`.js` / `.cjs`) avec types (`.d.ts` / `.d.cts`)
- **Package manager** : pnpm
- **Tests** : Jest + ts-jest en mode ESM
- **Node.js** : >= 22
- **Dépendances runtime** : aucune
- **Prérequis utilisateur** : avoir FFmpeg installé sur sa machine

---

## Architecture interne

```
src/
  core/
    binary.ts      Détection FFmpeg (PATH ou FFMPEG_PATH env)
    spawn.ts       Wrapper child_process — progress, abort, timeout, erreurs
    validate.ts    Validation inputs avant spawn (existence fichier, extension)
  operations/
    probe.ts
    convert.ts
    trim.ts
    extract.ts
    thumbnail.ts
  types/index.ts
  errors/index.ts
  index.ts
__tests__/
  probe.test.ts
  convert.test.ts
  trim.test.ts
  errors.test.ts
fixtures/
  sample.mp4      Vidéo de test 10s générée via FFmpeg (testsrc + sine audio)
```

**Règle d'architecture :** `spawn.ts` ne sait pas ce qu'il exécute. `binary.ts` ne sait pas quelle opération sera faite. Chaque fichier dans `operations/` construit ses args FFmpeg et délègue à `spawn`. Ajouter une opération = ajouter un fichier, toucher à rien d'autre.

---

## Hiérarchie d'erreurs

```
FfmScriptError (base)
  ├── FFmpegNotFoundError    FFmpeg absent, message d'install inclus (macOS/Ubuntu/Windows)
  ├── FileNotFoundError      Fichier source introuvable
  ├── InvalidFormatError     Format non supporté ou fichier corrompu
  ├── FFmpegTimeoutError     Timeout dépassé (contient duration)
  └── FFmpegError            FFmpeg a planté (exitCode non-zero)
                             → .stderr et .exitCode accessibles
```

Comportement abort vs timeout :
- **Abort (AbortSignal)** → SIGTERM — laisse FFmpeg nettoyer ses fichiers temporaires → `DOMException('Operation aborted', 'AbortError')`
- **Timeout** → SIGKILL — tue immédiatement → `FFmpegTimeoutError`

---

## v0.1 — Les fondations (3-4 semaines)

Format garanti : **MP4 en entrée et sortie uniquement.**

### API publique

```ts
import { probe, convert, trim, extractAudio, thumbnail } from 'ffm-script'

// Lire les metadata
const info = await probe('video.mp4')
console.log(info.duration)     // 124.5 (secondes)
console.log(info.video?.codec) // "h264"
console.log(info.video?.width) // 1920

// Transcodage
await convert('input.mp4', 'output.mp4', {
  videoCodec: 'libx264',
  audioBitrate: '192k',
  width: 1280,
  onProgress: (p) => console.log(`${p.percent}%`)
})

// Découpage
await trim('input.mp4', 'output.mp4', {
  start: '00:01:00',
  end: '00:03:00',
  mode: 'fast'      // keyframe-aligned, sans réencodage, rapide
  // mode: 'precise'  // frame-accurate, réencode, lent
})

// Extraction audio
await extractAudio('input.mp4', 'output.mp3', {
  codec: 'mp3',
  bitrate: '320k'
})

// Capture d'une frame
await thumbnail('input.mp4', 'thumb.jpg', {
  timestamp: 30,   // en secondes, ou '00:00:30'
  width: 640
})
```

### Gestion des erreurs

```ts
import { FFmpegNotFoundError, FFmpegError } from 'ffm-script'

try {
  await convert('input.mp4', 'output.mp4')
} catch (err) {
  if (err instanceof FFmpegNotFoundError) {
    // Message d'installation inclus automatiquement
    console.error(err.message)
  }
  if (err instanceof FFmpegError) {
    console.error(err.stderr)
    console.error(err.exitCode)
  }
}
```

### Annulation

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)

await convert('input.mp4', 'output.mp4', { signal: controller.signal })
```

### Subtilité importante sur trim()

Le mode `fast` utilise `-c copy` (pas de réencodage) : la coupure tombe sur le keyframe le plus proche, pas exactement au timestamp demandé. Décalage possible de quelques frames.

Le mode `precise` réencode : frame-accurate mais nettement plus lent.

Cette distinction doit être documentée clairement — c'est le genre de nuance qui montre une vraie compréhension de la structure GOP et qui fait la différence en entretien.

### Tickets v0.1

**Epic 1 — Setup & infra**

| Ticket | Description | Effort |
|--------|-------------|--------|
| Init repo | pnpm init, tsconfig strict, tsup dual ESM+CJS, jest ESM | 2h |
| binary.ts | Détection FFmpeg dans PATH ou FFMPEG_PATH, FFmpegNotFoundError | 3h |
| spawn.ts | Wrapper child_process, progress parsing stderr, AbortSignal, timeout, FFmpegError | 4h |
| validate.ts | Existence fichier, extension reconnue — avant tout appel FFmpeg | 3h |
| CI GitHub Actions | Install FFmpeg sur runner, typecheck + test sur push, Node 22 | 2h |

**Epic 2 — Opérations core**

| Ticket | Description | Effort |
|--------|-------------|--------|
| probe() | ffprobe -print_format json -show_streams -show_format → ProbeResult | 5h |
| convert() | MP4→MP4, videoCodec/audioCodec/bitrate/resolution, onProgress | 6h |
| trim() | -ss/-to avec -c copy (fast) ou réencodage (precise), doc du trade-off | 5h |
| extractAudio() | -vn vers mp3/aac, bitrate, sampleRate | 3h |
| thumbnail() | -ss -vframes 1 -vf scale= vers jpg/png | 3h |

**Epic 3 — DX**

| Ticket | Description | Effort |
|--------|-------------|--------|
| Types publics | JSDoc sur chaque interface et option | 3h |
| README | Why this exists, install, exemples copier-coller, prérequis | 3h |
| npm publish | package.json propre, .npmignore, tag GitHub, changelog | 2h |

**Epic 4 — Tests**

| Ticket | Description | Effort |
|--------|-------------|--------|
| Fixture vidéo | Générer sample.mp4 10s via FFmpeg (testsrc + sine) | 1h |
| Tests probe() | duration/codec/résolution corrects, erreur sur fichier inexistant | 2h |
| Tests convert() | output valide via probe(), onProgress entre 0 et 100 | 3h |
| Tests trim() | durée output = end-start ±0.1s, formats HH:MM:SS et secondes | 2h |
| Tests erreurs | FFmpegNotFoundError, FileNotFoundError — bons types levés | 2h |

**Total estimé : ~55h, soit 3-4 semaines à mi-temps.**

---

## v0.2 — Formats & HLS (4-6 semaines après v0.1)

### Formats supplémentaires en entrée
- MOV (conteneur ISOBMFF comme MP4, codecs ProRes inclus)
- WebM (conteneur Matroska, codec VP9/AV1)
- MKV
- MP3, AAC, WAV, FLAC (audio seul)

### Sortie HLS

```ts
import { toHLS } from 'ffm-script'

await toHLS('input.mp4', './output/', {
  segmentDuration: 6,
  resolutions: [
    { width: 1920, bitrate: '5000k' },
    { width: 1280, bitrate: '2500k' },
    { width: 854,  bitrate: '1000k' },
  ],
  onProgress: (p) => console.log(`${p.percent}%`)
})
// → output/master.m3u8 + output/1080p/ + output/720p/ + output/480p/
```

### API chainable

```ts
await ffmscript('input.mp4')
  .trim({ start: 60, end: 180 })
  .convert({ width: 1280 })
  .save('output.mp4')
// → Une seule commande FFmpeg, pas trois process successifs
```

---

## v0.3 — Chunked transcoding parallèle (le vrai différenciateur)

### Le problème

Transcoder une vidéo longue est séquentiel par défaut. Les plateformes vidéo découpent en chunks et transcendent en parallèle sur plusieurs workers. Le problème : couper arbitrairement crée des artefacts aux jonctions — les codecs vidéo encodent des deltas par rapport aux frames précédentes (P-frames, B-frames). Couper au milieu d'un GOP prive le décodeur du contexte nécessaire.

C'est ce que des équipes comme Scoreplay implémentent à la main. `ffm-script` le package proprement.

### API

```ts
import { parallelConvert } from 'ffm-script'

await parallelConvert('input.mp4', 'output.mp4', {
  workers: 4,
  targetBitrate: '2000k',
  onProgress: (p) => console.log(`${p.percent}%`)
})
```

### Comment ça marche

**Étape 1 — Lecture de l'index keyframes**

La `stss` box (sync sample box) du container MP4 contient les positions de tous les keyframes. On la lit en binaire pur TypeScript avec `DataView` — pas besoin de FFmpeg, lecture directe du fichier.

```ts
const keyframes = await extractKeyframeIndex('input.mp4')
// → [{ timestamp: 0 }, { timestamp: 2.0 }, { timestamp: 4.0 }, ...]
```

**Étape 2 — Plan de découpe sur keyframes**

```ts
const segments = planSegments(keyframes, { workerCount: 4 })
// → [{ startTs: 0, endTs: '15:00' }, { startTs: '15:00', endTs: '30:00' }, ...]
```

Chaque segment commence et finit sur un keyframe — zéro artefact aux jonctions garanti.

**Étape 3 — Transcodage parallèle**

```ts
const chunks = await Promise.all(
  segments.map((seg, i) =>
    spawnFFmpeg({ args: ['-ss', seg.startTs, '-to', seg.endTs, ...] })
  )
)
```

**Étape 4 — Recollement sans réencodage**

```ts
// FFmpeg concat demuxer — recolle les chunks sans réencodage
await spawnFFmpeg({
  args: ['-f', 'concat', '-safe', '0', '-i', 'chunks.txt', '-c', 'copy', 'output.mp4']
})
```

### Gain de performance attendu

Sur une machine 8 cœurs, un transcodage 1080p→720p d'1h de vidéo passe de ~45 minutes (séquentiel) à ~12 minutes (4 workers).

### Pourquoi c'est non trivial

- Lire la `stss` box en binaire pur TypeScript (DataView, spec ISOBMFF)
- Agréger le progress depuis N workers en parallèle
- Nettoyer les chunks temporaires même en cas d'erreur
- Gérer les vidéos sans keyframe index (fallback sur `-force_key_frames`)
- Garantir la continuité PTS/DTS aux jonctions pour éviter les glitches audio

---

## Roadmap résumée

| Version | Quoi | Valeur |
|---------|------|--------|
| v0.1 | probe, convert, trim, extractAudio, thumbnail — MP4 | Remplace fluent-ffmpeg |
| v0.2 | Formats supplémentaires, HLS multi-résolution, API chainable | Couvre les cas streaming |
| v0.3 | Chunked transcoding parallèle sur keyframes | Différenciateur réel |

---

## Ce que ce projet prouve en entretien

- **Formats media** : différence MP4/MOV/WebM, ISOBMFF, conteneur vs codec
- **Structure GOP** : keyframes, P-frames, B-frames, impact sur le découpage
- **Parsing binaire** : lire une `stss` box en DataView, spec ISOBMFF
- **Gestion de process Node.js** : child_process, spawn, stderr parsing, AbortSignal
- **Parallélisme** : worker pool, progress agrégé, nettoyage en cas d'erreur
- **Architecture de lib** : séparation des responsabilités, API publique stable, versioning