import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'verification');
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173/?demo=1&verify=1&card=default';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sampleModelPath = path.join(outputDir, 'sample-character.gltf');

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(sampleModelPath, createSampleGltf(), 'utf8');

const launchOptions = { headless: true };

if (await exists(chromePath)) {
  launchOptions.executablePath = chromePath;
}

const browser = await chromium.launch(launchOptions);
const results = [];
const baseOrigin = new URL(baseUrl).origin;

for (const viewport of [
  { name: 'desktop', width: 1280, height: 820 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
]) {
  const page = await browser.newPage({
    viewport,
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Start (AR|Demo)$/i }).click();
  await page.waitForFunction(
    () => document.querySelector('#statusText')?.textContent === 'QR locked',
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('#sceneCanvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Scene canvas was not found.');
    }

    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) {
      throw new Error('WebGL context was not available.');
    }

    const image = new Uint8Array(canvas.width * canvas.height * 4);
    context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, image);
    let nonTransparent = 0;
    let bright = 0;

    for (let index = 3; index < image.length; index += 4) {
      if (image[index] > 0) {
        nonTransparent += 1;
        if (image[index - 3] + image[index - 2] + image[index - 1] > 120) {
          bright += 1;
        }
      }
    }

    return {
      status: document.querySelector('#statusText')?.textContent,
      hint: document.querySelector('#hintText')?.textContent,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      nonTransparent,
      bright,
    };
  });

  const screenshotPath = path.join(outputDir, `demo-${viewport.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const result = { viewport: viewport.name, screenshot: path.relative(root, screenshotPath), ...metrics };

  if (metrics.nonTransparent < 1000 || metrics.bright < 500) {
    throw new Error(`${viewport.name} canvas did not contain enough rendered pixels: ${JSON.stringify(metrics)}`);
  }

  if (viewport.name === 'desktop') {
    await page.evaluate(() => {
      const canvas = document.querySelector('#sceneCanvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Scene canvas was not found.');
      }

      const dispatch = (type, pointerId, clientX, clientY) => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId,
            pointerType: 'touch',
            clientX,
            clientY,
          }),
        );
      };

      dispatch('pointerdown', 1, 540, 420);
      dispatch('pointerdown', 2, 740, 420);
      dispatch('pointermove', 1, 570, 355);
      dispatch('pointermove', 2, 710, 485);
      dispatch('pointerup', 1, 570, 355);
      dispatch('pointerup', 2, 710, 485);
    });
    await page.waitForFunction(() => Math.abs(Number(document.documentElement.dataset.characterRotation ?? '0')) > 0.2, null, {
      timeout: 5000,
    });
    result.rotationAfterGesture = await page.evaluate(() => document.documentElement.dataset.characterRotation ?? '0');

    await page.evaluate(() => {
      const image = document.querySelector('.camera-feed');
      if (image instanceof HTMLImageElement) {
        image.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221050%22 height=%22638%22%3E%3Crect width=%221050%22 height=%22638%22 fill=%22white%22/%3E%3C/svg%3E';
      }
    });
    await page.waitForTimeout(650);

    const heldStatus = await page.evaluate(() => document.querySelector('#statusText')?.textContent);
    if (heldStatus !== 'QR locked') {
      throw new Error(`Expected QR lock to be held through a short detection miss, got ${heldStatus}`);
    }

    await page.waitForTimeout(3000);
    const lostStatus = await page.evaluate(() => document.querySelector('#statusText')?.textContent);
    if (lostStatus !== 'Searching for QR') {
      throw new Error(`Expected QR lock to release after the hold window, got ${lostStatus}`);
    }

    result.holdStatus = heldStatus;
    result.lostStatus = lostStatus;
  }

  results.push(result);
  await page.close();
}

const adminPage = await browser.newPage({ viewport: { width: 1024, height: 760 } });
await adminPage.goto(`${baseOrigin}/admin`, { waitUntil: 'networkidle' });
await adminPage.waitForSelector('text=キャラクター管理', { timeout: 10000 });
const adminStatus = await adminPage.locator('#modelStatus').textContent();
await adminPage.locator('#modelInput').setInputFiles(sampleModelPath);
await adminPage.waitForFunction(() => document.querySelector('#modelStatus')?.textContent === '現在のモデル: sample-character.gltf', null, {
  timeout: 10000,
});
const uploadedStatus = await adminPage.locator('#modelStatus').textContent();
await adminPage.goto(`${baseOrigin}/?demo=1&verify=1&card=default`, { waitUntil: 'networkidle' });
await adminPage.waitForFunction(() => document.documentElement.dataset.activeModel === 'sample-character.gltf', null, {
  timeout: 10000,
});
const arModelName = await adminPage.evaluate(() => document.documentElement.dataset.activeModel ?? '');
await adminPage.getByRole('button', { name: /^Start (AR|Demo)$/i }).click();
await adminPage.waitForFunction(
  () => document.querySelector('#statusText')?.textContent === 'QR locked',
  null,
  { timeout: 15000 },
);
await adminPage.goto(`${baseOrigin}/admin`, { waitUntil: 'networkidle' });
await adminPage.getByRole('button', { name: 'デフォルトに戻す' }).click();
await adminPage.waitForFunction(() => document.querySelector('#modelStatus')?.textContent === '現在のモデル: デフォルト', null, {
  timeout: 10000,
});
const resetStatus = await adminPage.locator('#modelStatus').textContent();
const adminScreenshotPath = path.join(outputDir, 'admin.png');
await adminPage.screenshot({ path: adminScreenshotPath, fullPage: true });
results.push({
  viewport: 'admin',
  screenshot: path.relative(root, adminScreenshotPath),
  status: adminStatus?.trim() ?? '',
  uploadedStatus: uploadedStatus?.trim() ?? '',
  arModelName,
  resetStatus: resetStatus?.trim() ?? '',
});
await adminPage.close();

await browser.close();
await fs.writeFile(path.join(outputDir, 'demo-results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

async function exists(filePath) {
  try {
    await fs.access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function createSampleGltf() {
  const floats = new Float32Array([
    0, 0.75, 0,
    -0.55, -0.45, 0,
    0.55, -0.45, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const padding = new Uint8Array(2);
  const binary = Buffer.concat([
    Buffer.from(floats.buffer),
    Buffer.from(indices.buffer),
    Buffer.from(padding.buffer),
  ]);

  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
          },
        ],
      },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.12, 0.54, 0.44, 1], roughnessFactor: 0.5 } }],
    buffers: [{ uri: `data:application/octet-stream;base64,${binary.toString('base64')}`, byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: floats.byteLength, target: 34962 },
      { buffer: 0, byteOffset: floats.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.55, -0.45, 0],
        max: [0.55, 0.75, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
  });
}
