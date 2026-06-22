import jsQR, { type QRCode } from 'jsqr';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './styles.css';

type Point = {
  x: number;
  y: number;
};

type TrackState = {
  center: Point;
  anchor: Point;
  size: number;
  rotation: number;
  code: string;
};

type MediaSourceElement = HTMLVideoElement | HTMLImageElement;

type StoredModel = {
  file: Blob;
  name: string;
  updatedAt: number;
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root was not found.');
}

const params = new URLSearchParams(window.location.search);
const adminMode = window.location.pathname === '/admin' || params.get('admin') === '1';

app.innerHTML = `
  <main class="ar-shell ${adminMode ? 'is-hidden' : ''}">
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
  <main class="admin-shell ${adminMode ? '' : 'is-hidden'}">
    <section class="admin-layout">
      <header class="admin-header">
        <div>
          <p class="eyebrow">3D Bizcard</p>
          <h1>キャラクター管理</h1>
        </div>
        <a class="text-button" href="/?card=default">ARを開く</a>
      </header>

      <section class="admin-panel">
        <h2>表示キャラクター</h2>
        <p id="modelStatus" class="admin-status">現在のモデルを確認しています...</p>
        <p class="admin-note">
          現在のアップロードはこの端末・このブラウザ内に保存されます。別のスマホや別ブラウザには共有されません。
        </p>
        <label class="file-picker">
          <span>3Dファイルを選択</span>
          <input id="modelInput" type="file" accept=".glb,.gltf,.blend,model/gltf-binary,model/gltf+json" />
        </label>
        <div class="admin-actions">
          <button class="primary-button admin-button" id="resetModelButton" type="button">デフォルトに戻す</button>
          <a class="text-button" href="/?demo=1&card=default">デモで確認</a>
        </div>
      </section>

      <section class="admin-panel">
        <h2>Blenderからの書き出し</h2>
        <p>
          BlenderのglTF 2.0 exporterでGLB形式を書き出してください。.blendは編集用プロジェクトファイルなので、ブラウザのWebGLでは直接読み込めません。
        </p>
        <ul>
          <li>Format: GLB Binary</li>
          <li>テクスチャはGLB内に含める</li>
          <li>推奨サイズは5MB以下</li>
          <li>キャラクターは直立、原点付近に配置</li>
        </ul>
      </section>
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
const modelInput = document.querySelector<HTMLInputElement>('#modelInput')!;
const modelStatus = document.querySelector<HTMLParagraphElement>('#modelStatus')!;
const resetModelButton = document.querySelector<HTMLButtonElement>('#resetModelButton')!;

const demoMode = params.get('demo') === '1';
const verifyMode = params.get('verify') === '1';
const expectedCardId = params.get('card') ?? 'default';
const trackHoldMs = 2500;
const defaultModelUrl = '/models/dice-character.glb';
const defaultModelName = 'dice-character.glb';
const dbName = '3d-bizcard';
const dbVersion = 1;
const modelStoreName = 'settings';
const activeModelKey = 'active-model-dice-v1';
const autoRotationDurationMs = 10000;
const modelSyncChannelName = '3d-bizcard-model-sync';
const modelUpdatedStorageKey = '3d-bizcard-model-updated';
const cameraDepth = 2000;
const cameraFarDepth = 5000;

let mediaElement: MediaSourceElement | null = null;
let cameraStream: MediaStream | null = null;
let running = false;
let latestTrack: TrackState | null = null;
let smoothedTrack: TrackState | null = null;
let lastDetectedAt = 0;
let consecutiveMisses = 0;
let userScale = 1;
let displayedScale = userScale;
let animationFrame = 0;
let detectionFrame = 0;
let lastRenderAt = 0;

const detectorCanvas = document.createElement('canvas');
const detectorContext = createDetectorContext(detectorCanvas);
const modelSyncChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(modelSyncChannelName);

const renderer = new THREE.WebGLRenderer({
  canvas: sceneCanvas,
  alpha: true,
  antialias: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: verifyMode,
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, cameraFarDepth);
camera.position.z = cameraDepth;

const root = new THREE.Group();
root.visible = false;
scene.add(root);

const characterPivot = new THREE.Group();
root.add(characterPivot);

let character = createDefaultCharacter();
setActiveModelName('default');
characterPivot.add(character);

const ambient = new THREE.AmbientLight(0xffffff, 1.7);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(1, 2, 3);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x5fd9ff, 1.4);
rimLight.position.set(-2, 1, 2);
scene.add(rimLight);

setupGestures();
setupAdmin();
setupModelSync();
resizeScene();
void loadStoredCharacter();
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

function createDefaultCharacter(): THREE.Group {
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
  prepareCharacterForAr(group);
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
      const shouldHoldTrack = latestTrack && elapsedSinceDetection <= trackHoldMs;

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
  const minY = Math.min(...points.map((point) => point.y));
  const anchor = {
    x: center.x,
    y: minY - size * 0.45,
  };

  return {
    center,
    anchor,
    size,
    rotation,
    code: code.data,
  };
}

function renderLoop(time = 0): void {
  resizeScene();
  updateDisplayedGesture(time);

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
  const stageX = track.anchor.x - stageRect.width / 2;
  const stageY = stageRect.height / 2 - track.anchor.y;
  const baseScale = Math.max(48, track.size * 0.24) * displayedScale;
  const autoRotation = getAutoRotation(time);

  root.position.set(stageX, stageY, 0);
  root.scale.setScalar(baseScale);
  root.rotation.set(0, 0, 0);
  characterPivot.rotation.set(0, autoRotation, 0);
  document.documentElement.dataset.characterScale = displayedScale.toFixed(4);
  document.documentElement.dataset.characterRotation = autoRotation.toFixed(4);

  if (verifyMode) {
    updateDepthDiagnostics();
  }
}

function setupAdmin(): void {
  refreshModelStatus();

  modelInput.addEventListener('change', () => {
    const file = modelInput.files?.[0];
    if (!file) {
      return;
    }

    void saveSelectedModel(file);
  });

  resetModelButton.addEventListener('click', () => {
    void resetStoredModel();
  });
}

async function saveSelectedModel(file: File): Promise<void> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'blend') {
    modelStatus.textContent = '.blendは直接読み込めません。BlenderからGLB形式で書き出して、.glbファイルをアップロードしてください。';
    modelInput.value = '';
    return;
  }

  if (extension !== 'glb' && extension !== 'gltf') {
    modelStatus.textContent = '未対応のファイルです。.glb または自己完結した .gltf をアップロードしてください。';
    modelInput.value = '';
    return;
  }

  try {
    modelStatus.textContent = `${file.name} を読み込んでいます...`;
    const model = await parseModelBlob(file);
    await writeStoredModel({
      file,
      name: file.name,
      updatedAt: Date.now(),
    });
    replaceCharacter(model);
    setActiveModelName(file.name);
    announceModelChange(file.name);
    modelStatus.textContent = `現在のモデル: ${file.name}`;
    modelInput.value = '';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model could not be loaded.';
    modelStatus.textContent = `このモデルは使用できません: ${message}`;
    modelInput.value = '';
  }
}

async function resetStoredModel(): Promise<void> {
  await deleteStoredModel();
  try {
    replaceCharacter(await loadDefaultCharacterModel());
  } catch {
    replaceCharacter(createDefaultCharacter());
  }
  setActiveModelName('default');
  announceModelChange('default');
  modelStatus.textContent = '現在のモデル: デフォルト';
}

async function loadStoredCharacter(): Promise<void> {
  const storedModel = await readStoredModel();

  if (!storedModel) {
    try {
      replaceCharacter(await loadDefaultCharacterModel());
    } catch {
      replaceCharacter(createDefaultCharacter());
    }
    setActiveModelName('default');
    modelStatus.textContent = '現在のモデル: デフォルト';
    return;
  }

  try {
    const model = await parseModelBlob(storedModel.file);
    replaceCharacter(model);
    setActiveModelName(storedModel.name);
    modelStatus.textContent = `現在のモデル: ${storedModel.name}`;
  } catch {
    setActiveModelName('default');
    modelStatus.textContent = '保存済みモデルを読み込めませんでした。デフォルトを使用します。';
  }
}

function refreshModelStatus(): void {
  void readStoredModel().then((storedModel) => {
    modelStatus.textContent = storedModel ? `現在のモデル: ${storedModel.name}` : '現在のモデル: デフォルト';
  });
}

async function loadDefaultCharacterModel(): Promise<THREE.Group> {
  const response = await fetch(defaultModelUrl, { cache: 'force-cache' });

  if (!response.ok) {
    throw new Error(`Default model could not be loaded: ${response.status}`);
  }

  const blob = await response.blob();
  const model = await parseModelBlob(blob);
  addDiceSolidCore(model);
  model.userData.modelName = defaultModelName;
  return model;
}

async function parseModelBlob(blob: Blob): Promise<THREE.Group> {
  const buffer = await blob.arrayBuffer();
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => {
        const model = new THREE.Group();
        model.add(gltf.scene);
        normalizeModel(model);
        resolve(model);
      },
      (error) => reject(error instanceof Error ? error : new Error('GLTF parsing failed.')),
    );
  });
}

function normalizeModel(model: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const largestAxis = Math.max(size.x, size.y, size.z);

  if (!Number.isFinite(largestAxis) || largestAxis <= 0) {
    throw new Error('The model has no measurable geometry.');
  }

  model.position.sub(center);
  model.scale.setScalar(1.75 / largestAxis);
  model.rotation.x = -0.35;
  prepareCharacterForAr(model);
}

function prepareCharacterForAr(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;

    if (!mesh.isMesh) {
      return;
    }

    mesh.frustumCulled = false;
    mesh.renderOrder = 10;

    if (mesh.geometry && !mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      material.transparent = false;
      material.opacity = 1;
      material.depthTest = true;
      material.depthWrite = true;
      material.side = THREE.DoubleSide;
      material.blending = THREE.NormalBlending;
      material.colorWrite = true;
      material.needsUpdate = true;
    }
  });
}

function addDiceSolidCore(model: THREE.Group): void {
  const diceNode = findFirstMeshParent(model) ?? model;
  const box = new THREE.Box3();

  diceNode.traverse((child) => {
    const mesh = child as THREE.Mesh;

    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }

    const geometryBox = mesh.geometry.boundingBox?.clone();
    if (geometryBox) {
      geometryBox.applyMatrix4(mesh.matrix);
      box.union(geometryBox);
    }
  });

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  if (!Number.isFinite(size.x) || size.x <= 0 || !Number.isFinite(size.y) || size.y <= 0 || !Number.isFinite(size.z) || size.z <= 0) {
    return;
  }

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(size.x * 0.985, size.y * 0.985, size.z * 0.985),
    new THREE.MeshStandardMaterial({
      color: 0xf2f7f8,
      roughness: 0.55,
      metalness: 0,
    }),
  );

  core.name = 'dice-solid-core';
  core.position.copy(center);
  core.renderOrder = 9;
  core.frustumCulled = false;
  core.material.depthTest = true;
  core.material.depthWrite = true;
  core.material.transparent = false;
  core.material.opacity = 1;
  diceNode.add(core);
}

function findFirstMeshParent(object: THREE.Object3D): THREE.Object3D | null {
  let parent: THREE.Object3D | null = null;

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!parent && mesh.isMesh) {
      parent = child.parent;
    }
  });

  return parent;
}

function updateDepthDiagnostics(): void {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(characterPivot);
  const nearPlaneZ = camera.position.z - camera.near;
  const farPlaneZ = camera.position.z - camera.far;
  const clippedNear = box.max.z > nearPlaneZ;
  const clippedFar = box.min.z < farPlaneZ;

  document.documentElement.dataset.characterWorldMinZ = box.min.z.toFixed(2);
  document.documentElement.dataset.characterWorldMaxZ = box.max.z.toFixed(2);
  document.documentElement.dataset.cameraNearPlaneZ = nearPlaneZ.toFixed(2);
  document.documentElement.dataset.cameraFarPlaneZ = farPlaneZ.toFixed(2);
  document.documentElement.dataset.characterDepthClipped = String(clippedNear || clippedFar);
}

function replaceCharacter(nextCharacter: THREE.Group): void {
  characterPivot.remove(character);
  disposeObject(character);
  character = nextCharacter;
  characterPivot.add(character);
}

function setActiveModelName(name: string): void {
  document.documentElement.dataset.activeModel = name;
}

function setupModelSync(): void {
  modelSyncChannel?.addEventListener('message', (event) => {
    if (event.data?.type === 'model-updated') {
      void loadStoredCharacter();
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === modelUpdatedStorageKey) {
      void loadStoredCharacter();
    }
  });
}

function announceModelChange(name: string): void {
  const message = { type: 'model-updated', name, updatedAt: Date.now() };
  modelSyncChannel?.postMessage(message);

  try {
    localStorage.setItem(modelUpdatedStorageKey, JSON.stringify(message));
  } catch {
    // Private browsing can block localStorage; BroadcastChannel still covers modern browsers.
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) {
        item.dispose();
      }
    } else if (material) {
      material.dispose();
    }
  });
}

function setupGestures(): void {
  const pointers = new Map<number, PointerEvent>();
  let pinchStartDistance = 0;
  let pinchStartScale = userScale;
  let touchStartDistance = 0;
  let touchStartScale = userScale;

  sceneCanvas.addEventListener('pointerdown', (event) => {
    try {
      sceneCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events may not be eligible for pointer capture.
    }
    pointers.set(event.pointerId, event);

    if (pointers.size === 2) {
      const activePointers = [...pointers.values()];
      pinchStartDistance = pointerDistance(activePointers);
      pinchStartScale = userScale;
    }
  });

  sceneCanvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    pointers.set(event.pointerId, event);

    if (pointers.size === 2 && pinchStartDistance > 0) {
      const activePointers = [...pointers.values()];
      const currentDistance = pointerDistance(activePointers);
      userScale = clamp(pinchStartScale * (currentDistance / pinchStartDistance), 0.5, 3);
      hintText.textContent = `Scale ${userScale.toFixed(2)}x / Auto rotate 10s`;
    }
  });

  const releasePointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchStartDistance = 0;
    } else {
      const activePointers = [...pointers.values()];
      pinchStartDistance = pointerDistance(activePointers);
      pinchStartScale = userScale;
    }
  };

  sceneCanvas.addEventListener('pointerup', releasePointer);
  sceneCanvas.addEventListener('pointercancel', releasePointer);

  sceneCanvas.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const touches = [...event.touches];
        touchStartDistance = touchDistance(touches);
        touchStartScale = userScale;
      }
    },
    { passive: false },
  );

  sceneCanvas.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 2 || touchStartDistance <= 0) {
        return;
      }

      event.preventDefault();
      const touches = [...event.touches];
      const currentDistance = touchDistance(touches);
      userScale = clamp(touchStartScale * (currentDistance / touchStartDistance), 0.5, 3);
      hintText.textContent = `Scale ${userScale.toFixed(2)}x / Auto rotate 10s`;
    },
    { passive: false },
  );

  const releaseTouch = (event: TouchEvent) => {
    if (event.touches.length < 2) {
      touchStartDistance = 0;
      return;
    }

    const touches = [...event.touches];
    touchStartDistance = touchDistance(touches);
    touchStartScale = userScale;
  };

  sceneCanvas.addEventListener('touchend', releaseTouch);
  sceneCanvas.addEventListener('touchcancel', releaseTouch);
}

function updateDisplayedGesture(time: number): void {
  const deltaMs = lastRenderAt > 0 ? Math.min(48, time - lastRenderAt) : 16.7;
  lastRenderAt = time;

  displayedScale = damp(displayedScale, userScale, 26, deltaMs);
}

function getAutoRotation(time: number): number {
  const progress = (time % autoRotationDurationMs) / autoRotationDurationMs;
  return normalizeAngle(-progress * Math.PI * 2);
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
    anchor: {
      x: lerp(previous.anchor.x, next.anchor.x, factor),
      y: lerp(previous.anchor.y, next.anchor.y, factor),
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

function touchDistance(touches: Touch[]): number {
  if (touches.length < 2) {
    return 0;
  }

  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function lerp(a: number, b: number, factor: number): number {
  return a + (b - a) * factor;
}

function lerpAngle(a: number, b: number, factor: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * factor;
}

function damp(current: number, target: number, lambda: number, deltaMs: number): number {
  const factor = 1 - Math.exp(-lambda * (deltaMs / 1000));
  return lerp(current, target, factor);
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

async function readStoredModel(): Promise<StoredModel | null> {
  const db = await openModelDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(modelStoreName, 'readonly');
    const store = transaction.objectStore(modelStoreName);
    const request = store.get(activeModelKey);

    request.addEventListener('success', () => {
      resolve((request.result as StoredModel | undefined) ?? null);
      db.close();
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Stored model could not be read.'));
      db.close();
    });
  });
}

async function writeStoredModel(model: StoredModel): Promise<void> {
  const db = await openModelDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(modelStoreName, 'readwrite');
    const store = transaction.objectStore(modelStoreName);
    const request = store.put(model, activeModelKey);

    request.addEventListener('success', () => {
      resolve();
      db.close();
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Model could not be saved.'));
      db.close();
    });
  });
}

async function deleteStoredModel(): Promise<void> {
  const db = await openModelDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(modelStoreName, 'readwrite');
    const store = transaction.objectStore(modelStoreName);
    const request = store.delete(activeModelKey);

    request.addEventListener('success', () => {
      resolve();
      db.close();
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Stored model could not be deleted.'));
      db.close();
    });
  });
}

function openModelDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(modelStoreName)) {
        db.createObjectStore(modelStoreName);
      }
    });

    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('Model database could not be opened.')));
  });
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
