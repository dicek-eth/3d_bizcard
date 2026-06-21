import jsQR, { type QRCode } from 'jsqr';
import * as THREE from 'three';
import './styles.css';

type Point = {
  x: number;
  y: number;
};

type TrackState = {
  center: Point;
  size: number;
  rotation: number;
  code: string;
};

type MediaSourceElement = HTMLVideoElement | HTMLImageElement;

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root was not found.');
}

app.innerHTML = `
  <main class="ar-shell">
    <section class="stage" aria-label="AR camera stage">
      <div class="feed-layer" id="feedLayer"></div>
      <canvas class="scene-canvas" id="sceneCanvas" aria-hidden="true"></canvas>
      <div class="reticle" id="reticle" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="top-bar">
        <div>
          <p class="eyebrow">3D Bizcard</p>
          <p class="status" id="statusText">Ready</p>
        </div>
        <button class="icon-button" id="restartButton" type="button" title="Restart camera" aria-label="Restart camera">
          <span aria-hidden="true">↻</span>
        </button>
      </div>
      <div class="bottom-panel">
        <button class="primary-button" id="startButton" type="button">
          <span aria-hidden="true">▶</span>
          Start AR
        </button>
        <p class="hint" id="hintText">Scan the business card QR with your camera.</p>
      </div>
    </section>
  </main>
`;

const feedLayer = document.querySelector<HTMLDivElement>('#feedLayer')!;
const sceneCanvas = document.querySelector<HTMLCanvasElement>('#sceneCanvas')!;
const stage = document.querySelector<HTMLElement>('.stage')!;
const startButton = document.querySelector<HTMLButtonElement>('#startButton')!;
const restartButton = document.querySelector<HTMLButtonElement>('#restartButton')!;
const statusText = document.querySelector<HTMLParagraphElement>('#statusText')!;
const hintText = document.querySelector<HTMLParagraphElement>('#hintText')!;
const reticle = document.querySelector<HTMLDivElement>('#reticle')!;

const params = new URLSearchParams(window.location.search);
const demoMode = params.get('demo') === '1';
const verifyMode = params.get('verify') === '1';
const expectedCardId = params.get('card') ?? 'default';
const trackHoldMs = 900;

let mediaElement: MediaSourceElement | null = null;
let cameraStream: MediaStream | null = null;
let running = false;
let latestTrack: TrackState | null = null;
let smoothedTrack: TrackState | null = null;
let lastDetectedAt = 0;
let consecutiveMisses = 0;
let userScale = 1;
let animationFrame = 0;
let detectionFrame = 0;

const detectorCanvas = document.createElement('canvas');
const detectorContext = createDetectorContext(detectorCanvas);

const renderer = new THREE.WebGLRenderer({
  canvas: sceneCanvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: verifyMode,
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
camera.position.z = 10;

const root = new THREE.Group();
root.visible = false;
scene.add(root);

const character = createCharacter();
root.add(character);

const ambient = new THREE.AmbientLight(0xffffff, 1.7);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(1, 2, 3);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x5fd9ff, 1.4);
rimLight.position.set(-2, 1, 2);
scene.add(rimLight);

setupGestures();
resizeScene();
window.addEventListener('resize', resizeScene);

startButton.addEventListener('click', () => {
  void startExperience();
});

restartButton.addEventListener('click', () => {
  void restartExperience();
});

if (demoMode) {
  startButton.textContent = 'Start Demo';
  hintText.textContent = 'Demo mode uses the generated card image as the camera target.';
}

function createCharacter(): THREE.Group {
  const group = new THREE.Group();
  group.rotation.x = -0.35;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f8a70,
    roughness: 0.45,
    metalness: 0.08,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd7a8,
    roughness: 0.55,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4d6d,
    roughness: 0.35,
    metalness: 0.05,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x141820,
    roughness: 0.5,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 8, 18), bodyMaterial);
  body.position.y = 0.1;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), headMaterial);
  head.position.y = 0.88;
  group.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), accentMaterial);
  cap.position.y = 0.96;
  cap.scale.y = 0.45;
  group.add(cap);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.16), darkMaterial);
  visor.position.set(0, 0.95, 0.28);
  group.add(visor);

  const eyeGeometry = new THREE.SphereGeometry(0.035, 12, 8);
  const leftEye = new THREE.Mesh(eyeGeometry, darkMaterial);
  leftEye.position.set(-0.11, 0.91, 0.31);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.11;
  group.add(leftEye, rightEye);

  const armGeometry = new THREE.CapsuleGeometry(0.08, 0.48, 6, 10);
  const leftArm = new THREE.Mesh(armGeometry, accentMaterial);
  leftArm.position.set(-0.48, 0.28, 0);
  leftArm.rotation.z = -0.55;
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.48;
  rightArm.rotation.z = 0.55;
  group.add(leftArm, rightArm);

  const legGeometry = new THREE.CapsuleGeometry(0.09, 0.42, 6, 10);
  const leftLeg = new THREE.Mesh(legGeometry, darkMaterial);
  leftLeg.position.set(-0.18, -0.55, 0);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.18;
  group.add(leftLeg, rightLeg);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.65, 0.018, 8, 96),
    new THREE.MeshStandardMaterial({
      color: 0x63d9ff,
      roughness: 0.2,
      metalness: 0.35,
      emissive: 0x123344,
      emissiveIntensity: 0.35,
    }),
  );
  ring.position.y = -0.72;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.userData = { ring, leftArm, rightArm };
  return group;
}

function createDetectorContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('2D canvas is not available.');
  }

  return context;
}

async function startExperience(): Promise<void> {
  setStatus('Starting');
  startButton.disabled = true;

  try {
    stopCamera();
    clearFeed();

    if (demoMode) {
      mediaElement = await createDemoImage();
      setStatus('Demo target loaded');
      hintText.textContent = 'QR detected from the generated test card image.';
    } else {
      mediaElement = await createCameraVideo();
      setStatus('Camera ready');
      hintText.textContent = `Point the camera at the ${expectedCardId} business card QR.`;
    }

    running = true;
    stage.classList.add('is-running');
    latestTrack = null;
    smoothedTrack = null;
    lastDetectedAt = 0;
    consecutiveMisses = 0;
    detectionLoop();
    renderLoop();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown camera error';
    setStatus('Error');
    hintText.textContent = message;
    stage.classList.remove('is-running');
    startButton.disabled = false;
  }
}

async function restartExperience(): Promise<void> {
  stopCamera();
  running = false;
  cancelAnimationFrame(animationFrame);
  clearTimeout(detectionFrame);
  root.visible = false;
  reticle.classList.remove('is-locked');
  stage.classList.remove('is-running');
  startButton.disabled = false;
  await startExperience();
}

async function createCameraVideo(): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.className = 'camera-feed';
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.autoplay = true;

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  video.srcObject = cameraStream;
  feedLayer.append(video);
  await video.play();
  return video;
}

async function createDemoImage(): Promise<HTMLImageElement> {
  const image = document.createElement('img');
  image.className = 'camera-feed camera-feed--image';
  image.alt = 'Generated business card back test target';
  image.src = '/cards/bizcard-back.svg';
  feedLayer.append(image);

  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error('Demo card image could not be loaded.')), { once: true });
    });
  }

  return image;
}

function detectionLoop(): void {
  if (!running || !mediaElement) {
    return;
  }

  const sourceSize = getSourceSize(mediaElement);
  if (sourceSize.width > 0 && sourceSize.height > 0) {
    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / sourceSize.width);
    const width = Math.max(1, Math.round(sourceSize.width * scale));
    const height = Math.max(1, Math.round(sourceSize.height * scale));

    detectorCanvas.width = width;
    detectorCanvas.height = height;
    detectorContext.drawImage(mediaElement, 0, 0, width, height);
    const imageData = detectorContext.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height, {
      inversionAttempts: 'attemptBoth',
    });

    if (code) {
      latestTrack = toTrackState(code, sourceSize, scale);
      lastDetectedAt = performance.now();
      consecutiveMisses = 0;
      updateStatusFromTrack(latestTrack);
    } else {
      consecutiveMisses += 1;
      const elapsedSinceDetection = performance.now() - lastDetectedAt;
      const shouldHoldTrack = latestTrack && (elapsedSinceDetection <= trackHoldMs || consecutiveMisses <= 3);

      if (shouldHoldTrack) {
        updateStatusFromTrack(latestTrack);
      } else {
        latestTrack = null;
        smoothedTrack = null;
        updateStatusFromTrack(null);
      }
    }
  }

  detectionFrame = window.setTimeout(detectionLoop, demoMode ? 400 : 90);
}

function toTrackState(code: QRCode, sourceSize: { width: number; height: number }, detectorScale: number): TrackState {
  const rawPoints = [
    code.location.topLeftCorner,
    code.location.topRightCorner,
    code.location.bottomRightCorner,
    code.location.bottomLeftCorner,
  ].map((point) => ({
    x: point.x / detectorScale,
    y: point.y / detectorScale,
  }));

  const points = rawPoints.map((point) => mapSourcePointToStage(point, sourceSize));
  const center = averagePoint(points);
  const topWidth = distance(points[0], points[1]);
  const bottomWidth = distance(points[3], points[2]);
  const leftHeight = distance(points[0], points[3]);
  const rightHeight = distance(points[1], points[2]);
  const size = (topWidth + bottomWidth + leftHeight + rightHeight) / 4;
  const rotation = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);

  return {
    center,
    size,
    rotation,
    code: code.data,
  };
}

function renderLoop(time = 0): void {
  resizeScene();

  if (latestTrack) {
    smoothedTrack = smoothedTrack ? smoothTrack(smoothedTrack, latestTrack) : latestTrack;
  }

  if (smoothedTrack && latestTrack) {
    placeCharacter(smoothedTrack, time);
    root.visible = true;
    reticle.classList.add('is-locked');
    reticle.style.transform = `translate(${smoothedTrack.center.x}px, ${smoothedTrack.center.y}px) rotate(${smoothedTrack.rotation}rad)`;
    reticle.style.width = `${smoothedTrack.size * 1.18}px`;
    reticle.style.height = `${smoothedTrack.size * 1.18}px`;
  } else {
    root.visible = false;
    reticle.classList.remove('is-locked');
  }

  renderer.render(scene, camera);

  if (running) {
    animationFrame = requestAnimationFrame(renderLoop);
  }
}

function placeCharacter(track: TrackState, time: number): void {
  const stageRect = feedLayer.getBoundingClientRect();
  const stageX = track.center.x - stageRect.width / 2;
  const stageY = stageRect.height / 2 - track.center.y;
  const baseScale = Math.max(48, track.size * 0.24) * userScale;
  const lift = track.size * 0.3;

  root.position.set(stageX, stageY + lift, 0);
  root.scale.setScalar(baseScale);
  root.rotation.set(0, 0, -track.rotation);

  const hover = Math.sin(time * 0.002) * 2;
  character.position.y = hover;
  character.rotation.y = Math.sin(time * 0.0015) * 0.12;

  const ring = character.userData.ring as THREE.Mesh;
  ring.rotation.z = time * 0.002;

  const leftArm = character.userData.leftArm as THREE.Mesh;
  const rightArm = character.userData.rightArm as THREE.Mesh;
  leftArm.rotation.z = -0.55 + Math.sin(time * 0.003) * 0.06;
  rightArm.rotation.z = 0.55 - Math.sin(time * 0.003) * 0.06;
}

function setupGestures(): void {
  const pointers = new Map<number, PointerEvent>();
  let pinchStartDistance = 0;
  let pinchStartScale = userScale;

  sceneCanvas.addEventListener('pointerdown', (event) => {
    sceneCanvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, event);

    if (pointers.size === 2) {
      pinchStartDistance = pointerDistance([...pointers.values()]);
      pinchStartScale = userScale;
    }
  });

  sceneCanvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    pointers.set(event.pointerId, event);

    if (pointers.size === 2 && pinchStartDistance > 0) {
      const currentDistance = pointerDistance([...pointers.values()]);
      userScale = clamp(pinchStartScale * (currentDistance / pinchStartDistance), 0.5, 3);
      hintText.textContent = `Scale ${userScale.toFixed(2)}x`;
    }
  });

  const releasePointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchStartDistance = 0;
    }
  };

  sceneCanvas.addEventListener('pointerup', releasePointer);
  sceneCanvas.addEventListener('pointercancel', releasePointer);
}

function getSourceSize(element: MediaSourceElement): { width: number; height: number } {
  if (element instanceof HTMLVideoElement) {
    return {
      width: element.videoWidth,
      height: element.videoHeight,
    };
  }

  return {
    width: element.naturalWidth,
    height: element.naturalHeight,
  };
}

function mapSourcePointToStage(point: Point, sourceSize: { width: number; height: number }): Point {
  const stageRect = feedLayer.getBoundingClientRect();
  const scale = Math.max(stageRect.width / sourceSize.width, stageRect.height / sourceSize.height);
  const renderedWidth = sourceSize.width * scale;
  const renderedHeight = sourceSize.height * scale;
  const offsetX = (stageRect.width - renderedWidth) / 2;
  const offsetY = (stageRect.height - renderedHeight) / 2;

  return {
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  };
}

function resizeScene(): void {
  const rect = feedLayer.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (sceneCanvas.width !== Math.round(width * renderer.getPixelRatio()) || sceneCanvas.height !== Math.round(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  }
}

function updateStatusFromTrack(track: TrackState | null): void {
  if (!track) {
    setStatus('Searching for QR');
    if (!demoMode) {
      hintText.textContent = 'Keep the full QR code in frame.';
    }
    return;
  }

  setStatus('QR locked');
  const url = safelyParseUrl(track.code);
  const cardId = url?.searchParams.get('card') ?? expectedCardId;
  hintText.textContent = `Tracking card: ${cardId}`;
}

function smoothTrack(previous: TrackState, next: TrackState): TrackState {
  const factor = 0.24;
  return {
    center: {
      x: lerp(previous.center.x, next.center.x, factor),
      y: lerp(previous.center.y, next.center.y, factor),
    },
    size: lerp(previous.size, next.size, factor),
    rotation: lerpAngle(previous.rotation, next.rotation, factor),
    code: next.code,
  };
}

function averagePoint(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerDistance(events: PointerEvent[]): number {
  if (events.length < 2) {
    return 0;
  }

  return distance(events[0], events[1]);
}

function lerp(a: number, b: number, factor: number): number {
  return a + (b - a) * factor;
}

function lerpAngle(a: number, b: number, factor: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safelyParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function setStatus(value: string): void {
  statusText.textContent = value;
}

function clearFeed(): void {
  feedLayer.replaceChildren();
}

function stopCamera(): void {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
  }
}
