# 3D Bizcard

Web AR prototype for a business card back. Scanning the QR opens the web app; pointing the app camera at the same QR shows a Three.js character that follows the QR position.

Production URL:

```text
https://3dbizcard.vercel.app
```

## Features

- QR-code launch flow
- Browser camera view
- QR tracking with corner-based overlay placement
- Three.js character rendered over the camera feed
- Pinch zoom from 0.5x to 3.0x
- Character admin screen at `/admin`
- Custom `.glb` or self-contained `.gltf` model storage in the browser
- Demo mode using a generated business card back image

## Setup

Node.js 20.19 or newer is required.

```bash
nvm use
npm install
npm run generate:card
npm run dev
```

Open the local URL shown by Vite.

For desktop verification without a camera:

```text
http://localhost:5173/?demo=1&card=default
```

To run automated demo verification while the dev server is running:

```bash
npm run verify:demo
```

## Character Admin

Open:

```text
https://3dbizcard.vercel.app/admin
```

Upload a `.glb` file to replace the AR character on that device/browser. The selected model is saved in IndexedDB and loaded by the AR screen on the same origin.

Blender source files (`.blend`) are not directly renderable in browser WebGL. Export from Blender with:

```text
File > Export > glTF 2.0 > Format: GLB Binary
```

Pack textures into the GLB and keep the file under 5MB when possible.

## Test Card

The generated back-side image is:

```text
public/cards/bizcard-back.svg
```

To generate a card QR for a deployed URL:

```bash
CARD_URL="https://your-domain.example/?card=default" npm run generate:card
```

## Notes

This MVP uses QR corner detection for tracking because it is fast to test with printed cards and a browser camera. For production-grade tracking, the next step is replacing the tracker with full image-target tracking using the whole card back or a dedicated marker around the QR code, as described in `SPEC.md`.
