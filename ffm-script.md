# ffm-script

Lib TypeScript Node.js pour le traitement de fichiers media (audio/vidéo), successeur moderne de `fluent-ffmpeg` (archivé mai 2025).

---

## Pourquoi ce projet existe

`fluent-ffmpeg` était la référence pour wrapper FFmpeg en Node.js. Il a été officiellement archivé en mai 2025 pour trois raisons documentées par son mainteneur :

- Architecture construite pour des use cases obsolètes (encodage Flash) qui a pollué toute la codebase
- La lib essayait de faire trop de choses
- Impossible de maintenir une API stable par-dessus une CLI FFmpeg qui change à chaque version majeure

Depuis, il n'existe aucune surcouche FFmpeg sérieuse et maintenue pour Node.js. `node-av` et `@mmomtchev/ffmpeg` sont des bindings C natifs bas niveau — puissants mais complexes, risque de segfault, pas adaptés aux devs applicatifs. `ffmpeg.wasm` ne tourne pas en Node.js côté serveur.

`ffm-script` comble ce vide : une API haut niveau, TypeScript natif, qui wrape le **binaire FFmpeg** (pas les libs C) pour les opérations courantes.

---

## Ce que la lib fait

Opérations supportées en v0.1 (formats garantis : MP4 en entrée et en sortie) :

- `probe(file)` — lire toutes les metadata d'un fichier (durée, codec, résolution, bitrate, streams)
- `convert(input, output, options)` — transcodage avec options simples
- `trim(input, output, options)` — découpage avec choix du mode (rapide sur keyframe ou précis avec réencodage)
- `extractAudio(input, output, options)` — extraction de la piste audio vers MP3 ou AAC
- `thumbnail(input, output, options)` — capture d'une frame à un timestamp donné

Ce que la lib ne fait **pas** en v0.1 : HLS, chunked transcoding, support WebM/MOV/MKV, traitement parallèle de plusieurs fichiers. C'est prévu en v0.2+.

---

## Stack technique

- **Langage** : TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **Build** : tsup → dual ESM + CJS (`.js` / `.cjs`) avec types (`.d.ts` / `.d.cts`)
- **Package manager** : pnpm
- **Tests** : Jest + ts-jest en mode ESM
- **Node.js** : >= 18
- **Dépendances runtime** : aucune (zéro dep)
- **Prérequis utilisateur** : avoir FFmpeg installé sur sa machine

---

## Architecture

```
src/
  core/
    binary.ts       Détection du binaire FFmpeg (PATH ou FFMPEG_PATH env)
    spawn.ts        Wrapper child_process : progress, cancellation, erreurs typées
  operations/
    probe.ts        Wrapper ffprobe JSON → ProbeResult
    convert.ts      Transcodage MP4 → MP4
    trim.ts         Découpage (mode fast ou precise)
    extract.ts      Extraction audio
    thumbnail.ts    Capture de frame
  types/
    index.ts        Tous les types publics exportés
  errors/
    index.ts        Hiérarchie d'erreurs typées
  index.ts          Point d'entrée public
__tests__/
  probe.test.ts
  convert.test.ts
  trim.test.ts
  errors.test.ts
fixtures/
  sample.mp4        Vidéo de test générée via FFmpeg (10s, testsrc + sine audio)
```

### Principe d'architecture

`spawn.ts` ne sait pas ce qu'il exécute — il reçoit des args et un binaire, gère le process, le progress et les erreurs.

`binary.ts` ne sait pas quelle opération sera faite — il résout juste le chemin du binaire.

Chaque fichier dans `operations/` construit ses args FFmpeg et délègue à `spawn`. Ajouter une nouvelle opération = ajouter un fichier dans `operations/`, rien d'autre à toucher.

---

## API publique cible

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
  mode: 'fast'      // coupe sur keyframe, sans réencodage (rapide, ±quelques frames)
  // mode: 'precise' // réencode pour être frame-accurate (lent)
})

// Extraction audio
await extractAudio('input.mp4', 'output.mp3', {
  codec: 'mp3',
  bitrate: '320k'
})

// Thumbnail
await thumbnail('input.mp4', 'thumb.jpg', {
  timestamp: 30,   // en secondes, ou '00:00:30'
  width: 640
})
```

### Gestion des erreurs

```ts
import {
  FFmpegNotFoundError,
  FileNotFoundError,
  InvalidFormatError,
  FFmpegError
} from 'ffm-script'

try {
  await probe('video.mp4')
} catch (err) {
  if (err instanceof FFmpegNotFoundError) {
    // Message d'installation automatiquement inclus
    console.error(err.message)
  }
  if (err instanceof FFmpegError) {
    console.error(err.stderr)    // stderr brut de FFmpeg
    console.error(err.exitCode)  // code de sortie
  }
}
```

### Annulation

```ts
const controller = new AbortController()

setTimeout(() => controller.abort(), 5000)

await convert('input.mp4', 'output.mp4', {
  signal: controller.signal
})
```

---

## Hiérarchie d'erreurs

```
ffm-scriptError (base)
  ├── FFmpegNotFoundError   FFmpeg absent, message d'install inclus
  ├── FileNotFoundError     Fichier source introuvable
  ├── InvalidFormatError    Format non supporté ou fichier corrompu
  └── FFmpegError           FFmpeg a planté (exitCode non-zero)
                            → .stderr et .exitCode accessibles
```

---

## Tickets v0.1 — ordre de développement recommandé

### Epic 1 — Setup & infra

| Ticket | Description | Effort |
|--------|-------------|--------|
| Init repo | pnpm init, tsconfig strict, tsup dual ESM+CJS, jest ESM | 2h |
| binary.ts | Détection FFmpeg dans PATH ou FFMPEG_PATH, FFmpegNotFoundError | 3h |
| spawn.ts | Wrapper child_process, progress parsing stderr, AbortSignal, FFmpegError | 4h |
| CI GitHub Actions | Install FFmpeg sur runner, typecheck + test sur push, Node 18+20 | 2h |

### Epic 2 — Opérations core

| Ticket | Description | Effort |
|--------|-------------|--------|
| probe() | ffprobe -v quiet -print_format json -show_streams -show_format → ProbeResult | 5h |
| convert() | MP4→MP4, videoCodec/audioCodec/bitrate/resolution, onProgress | 6h |
| trim() | -ss/-to avec -c copy (fast) ou réencodage (precise), doc du trade-off | 5h |
| extractAudio() | -vn vers mp3/aac, bitrate, sampleRate | 3h |
| thumbnail() | -ss -vframes 1 -vf scale= vers jpg/png | 3h |

### Epic 3 — DX

| Ticket | Description | Effort |
|--------|-------------|--------|
| Types publics | JSDoc sur chaque interface et option | 3h |
| Validation inputs | Existence fichier, extension reconnue, timestamps valides — avant FFmpeg | 3h |
| README | Why this exists, install, exemples copier-coller, prérequis | 3h |
| npm publish | package.json propre, .npmignore, tag GitHub, changelog | 2h |

### Epic 4 — Tests

| Ticket | Description | Effort |
|--------|-------------|--------|
| Fixture vidéo | Générer sample.mp4 10s via FFmpeg (testsrc + sine) | 1h |
| Tests probe() | duration/codec/résolution corrects, erreur sur fichier inexistant | 2h |
| Tests convert() | output valide via probe(), onProgress entre 0 et 100 | 3h |
| Tests trim() | durée output = end-start ±0.1s, formats HH:MM:SS et secondes | 2h |
| Tests erreurs | FFmpegNotFoundError, FileNotFoundError — bons types levés | 2h |

**Total estimé : ~55h, soit 3-4 semaines à mi-temps.**

---

## Subtilité importante sur trim()

Le mode `fast` utilise `-c copy` (pas de réencodage) : la coupure tombe sur le keyframe le plus proche, pas exactement au timestamp demandé. Décalage possible de quelques frames.

Le mode `precise` réencode : frame-accurate mais nettement plus lent.

Cette distinction doit être documentée clairement — c'est exactement le genre de nuance qui montre une vraie compréhension du media (structure GOP, keyframes) et qui fait la différence en entretien.

---

## Notes pour la v0.2

- Support formats supplémentaires en entrée : MOV, WebM, MKV
- Sortie HLS (segmentation + playlist .m3u8)
- API chainable : `ffm-script('input.mp4').trim(...).convert(...).save('out.mp4')`
- Chunked transcoding parallèle avec recollement propre sur keyframes
