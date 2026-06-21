import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'verification');
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173/?demo=1&verify=1&card=default';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

await fs.mkdir(outputDir, { recursive: true });

const launchOptions = { headless: true };

if (await exists(chromePath)) {
  launchOptions.executablePath = chromePath;
}

const browser = await chromium.launch(launchOptions);
const results = [];

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

    await page.waitForTimeout(1400);
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
