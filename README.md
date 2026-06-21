# 3D Bizcard

Web AR prototype for a business card back. Scanning the QR opens the web app; pointing the app camera at the same QR shows a Three.js character that follows the QR position.

## Features

- QR-code launch flow
- Browser camera view
- QR tracking with corner-based overlay placement
- Three.js character rendered over the camera feed
- Pinch zoom from 0.5x to 3.0x
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
