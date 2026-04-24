const fileInput = document.getElementById('fileInput');
const imageCanvas = document.getElementById('imageCanvas');
const maskCanvas = document.getElementById('maskCanvas');
const viewer = document.getElementById('viewer');
const statusText = document.getElementById('statusText');
const playPauseButton = document.getElementById('playPauseButton');
const resetMaskButton = document.getElementById('resetMaskButton');
const strengthRange = document.getElementById('strengthRange');
const speedRange = document.getElementById('speedRange');
const strengthValue = document.getElementById('strengthValue');
const speedValue = document.getElementById('speedValue');

const imageCtx = imageCanvas.getContext('2d', { alpha: false });
const maskCtx = maskCanvas.getContext('2d');

const baseCanvas = document.createElement('canvas');
const baseCtx = baseCanvas.getContext('2d');
const maskDataCanvas = document.createElement('canvas');
const maskDataCtx = maskDataCanvas.getContext('2d');

let loadedImage = null;
let drawing = false;
let isPlaying = false;
let rafId = null;
let drawWidth = 0;
let drawHeight = 0;
let offsetX = 0;
let offsetY = 0;

// mask + deformation cache
let maskAlpha = null;
let softMask = null;
let baseImageData = null;
let deformedImageData = null;
let maskDirty = true;
let maskBounds = null;
let maskCentroid = { x: 0, y: 0 };
let maskRadius = 1;
let animStartTime = 0;
let warpCanvas = null;
let warpCtx = null;

const MAX_EDGE = 1100;
const BRUSH_RADIUS = 24;
const MASK_ALPHA = 95;

function setCanvasSize(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateSliderLabels() {
  strengthValue.textContent = strengthRange.value;
  speedValue.textContent = speedRange.value;
}

function fitImageSize(imgWidth, imgHeight) {
  const viewerRect = viewer.getBoundingClientRect();
  const targetW = viewerRect.width;
  const targetH = viewerRect.height;

  const scale = Math.min(targetW / imgWidth, targetH / imgHeight);
  drawWidth = Math.max(1, Math.round(imgWidth * scale));
  drawHeight = Math.max(1, Math.round(imgHeight * scale));
  offsetX = Math.round((targetW - drawWidth) / 2);
  offsetY = Math.round((targetH - drawHeight) / 2);

  setCanvasSize(imageCanvas, targetW, targetH);
  setCanvasSize(maskCanvas, targetW, targetH);

  baseCanvas.width = drawWidth;
  baseCanvas.height = drawHeight;
  maskDataCanvas.width = drawWidth;
  maskDataCanvas.height = drawHeight;

  baseCtx.clearRect(0, 0, drawWidth, drawHeight);
  maskDataCtx.clearRect(0, 0, drawWidth, drawHeight);
  baseCtx.drawImage(loadedImage, 0, 0, drawWidth, drawHeight);

  baseImageData = baseCtx.getImageData(0, 0, drawWidth, drawHeight);
  deformedImageData = new ImageData(
    new Uint8ClampedArray(baseImageData.data),
    drawWidth,
    drawHeight
  );

  maskAlpha = new Uint8Array(drawWidth * drawHeight);
  softMask = new Float32Array(drawWidth * drawHeight);
  warpCanvas = document.createElement('canvas');
  warpCanvas.width = drawWidth;
  warpCanvas.height = drawHeight;
  warpCtx = warpCanvas.getContext('2d');
  maskDirty = true;

  drawStaticFrame();
}

function loadImageFromFile(file) {
  if (!file) return;
  if (!/image\/(jpeg|png)/.test(file.type)) {
    statusText.textContent = 'JPG / PNGのみ対応です。';
    return;
  }

  const img = new Image();
  img.onload = () => {
    let width = img.naturalWidth;
    let height = img.naturalHeight;

    if (Math.max(width, height) > MAX_EDGE) {
      const ratio = MAX_EDGE / Math.max(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
      const shrinkCanvas = document.createElement('canvas');
      shrinkCanvas.width = width;
      shrinkCanvas.height = height;
      const shrinkCtx = shrinkCanvas.getContext('2d');
      shrinkCtx.drawImage(img, 0, 0, width, height);

      const scaled = new Image();
      scaled.onload = () => {
        loadedImage = scaled;
        finishImageLoad();
      };
      scaled.src = shrinkCanvas.toDataURL('image/jpeg', 0.92);
    } else {
      loadedImage = img;
      finishImageLoad();
    }
  };

  img.onerror = () => {
    statusText.textContent = '画像の読み込みに失敗しました。';
  };

  img.src = URL.createObjectURL(file);
}

function finishImageLoad() {
  stopAnimation();
  fitImageSize(loadedImage.naturalWidth, loadedImage.naturalHeight);
  statusText.textContent = '指でなぞって範囲を選択すると、その部分だけぷるぷる揺らせます。';
}

function drawStaticFrame() {
  const w = imageCanvas.clientWidth;
  const h = imageCanvas.clientHeight;
  imageCtx.fillStyle = '#d3dbe5';
  imageCtx.fillRect(0, 0, w, h);
  imageCtx.drawImage(baseCanvas, offsetX, offsetY);
  redrawMaskOverlay();
}

function redrawMaskOverlay() {
  const w = maskCanvas.clientWidth;
  const h = maskCanvas.clientHeight;
  maskCtx.clearRect(0, 0, w, h);
  if (!loadedImage) return;

  maskCtx.drawImage(maskDataCanvas, offsetX, offsetY);
  const imageData = maskCtx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) {
      d[i] = 42;
      d[i + 1] = 159;
      d[i + 2] = 255;
      d[i + 3] = MASK_ALPHA;
    }
  }
  maskCtx.putImageData(imageData, 0, 0);
}

function clientToImagePoint(clientX, clientY) {
  const rect = maskCanvas.getBoundingClientRect();
  const x = clientX - rect.left - offsetX;
  const y = clientY - rect.top - offsetY;
  return { x, y, inside: x >= 0 && y >= 0 && x < drawWidth && y < drawHeight };
}

function stampMask(x, y) {
  const minX = Math.max(0, Math.floor(x - BRUSH_RADIUS));
  const maxX = Math.min(drawWidth - 1, Math.ceil(x + BRUSH_RADIUS));
  const minY = Math.max(0, Math.floor(y - BRUSH_RADIUS));
  const maxY = Math.min(drawHeight - 1, Math.ceil(y + BRUSH_RADIUS));
  const r2 = BRUSH_RADIUS * BRUSH_RADIUS;

  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy <= r2) {
        maskAlpha[yy * drawWidth + xx] = 255;
      }
    }
  }
}

function rebuildMaskCanvasFromAlpha() {
  const img = maskDataCtx.createImageData(drawWidth, drawHeight);
  const d = img.data;
  for (let i = 0; i < maskAlpha.length; i++) {
    d[i * 4 + 3] = maskAlpha[i];
  }
  maskDataCtx.putImageData(img, 0, 0);
}

function blurMaskEdges() {
  // very small blur so edge is soft but movement stays local
  softMask.fill(0);
  for (let y = 1; y < drawHeight - 1; y++) {
    for (let x = 1; x < drawWidth - 1; x++) {
      const idx = y * drawWidth + x;
      if (!maskAlpha[idx]) continue;
      let sum = 0;
      let count = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += maskAlpha[(y + ky) * drawWidth + (x + kx)] > 0 ? 1 : 0;
          count++;
        }
      }
      softMask[idx] = sum / count;
    }
  }
}

function rebuildMaskStats() {
  if (!maskDirty) return;
  maskDirty = false;

  let minX = drawWidth;
  let minY = drawHeight;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < drawHeight; y++) {
    for (let x = 0; x < drawWidth; x++) {
      const idx = y * drawWidth + x;
      if (!maskAlpha[idx]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      count++;
    }
  }

  if (!count) {
    maskBounds = null;
    maskCentroid = { x: 0, y: 0 };
    maskRadius = 1;
    return;
  }

  maskBounds = { minX, minY, maxX, maxY };
  maskCentroid = { x: sumX / count, y: sumY / count };

  let maxDist2 = 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * drawWidth + x;
      if (!maskAlpha[idx]) continue;
      const dx = x - maskCentroid.x;
      const dy = y - maskCentroid.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxDist2) maxDist2 = d2;
    }
  }

  maskRadius = Math.sqrt(maxDist2);
  blurMaskEdges();
}

function sampleBaseNearest(x, y, out, outOffset) {
  const sx = Math.max(0, Math.min(drawWidth - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(drawHeight - 1, Math.round(y)));
  const srcOffset = (sy * drawWidth + sx) * 4;
  out[outOffset] = baseImageData.data[srcOffset];
  out[outOffset + 1] = baseImageData.data[srcOffset + 1];
  out[outOffset + 2] = baseImageData.data[srcOffset + 2];
  out[outOffset + 3] = baseImageData.data[srcOffset + 3];
}

function computeJellyOffset(x, y, elapsedSec) {
  const speed = Number(speedRange.value);
  const strength = Number(strengthRange.value);

  const f = 1.2 + speed * 0.06; // frequency
  const damping = 2.0 + (41 - speed) * 0.035; // slower setting = longer decay
  const cycle = 1.25; // periodic impulse to keep subtle ongoing jiggle
  const cycleTime = elapsedSec % cycle;
  const envelope = Math.exp(-damping * cycleTime);
  const osc = Math.sin(2 * Math.PI * f * cycleTime) * envelope;

  const dx = x - maskCentroid.x;
  const dy = y - maskCentroid.y;
  const dist = Math.hypot(dx, dy);
  const nr = Math.min(1, dist / (maskRadius + 0.0001));

  const local = Math.pow(1 - nr, 1.65);
  const edge = softMask[y * drawWidth + x];
  const weight = local * edge;

  const amp = (strength / 40) * 16 * weight;

  const dirX = dist > 0.001 ? dx / dist : 0;
  const dirY = dist > 0.001 ? dy / dist : 0;

  // jelly: radial squash + tiny tangential lag
  const radial = amp * osc;
  const tangential = amp * 0.22 * Math.sin(2 * Math.PI * f * cycleTime + Math.PI / 2) * envelope;

  return {
    ox: dirX * radial - dirY * tangential,
    oy: dirY * radial + dirX * tangential,
  };
}

function renderDeformedFrame(elapsedSec) {
  if (!maskBounds) {
    drawStaticFrame();
    return;
  }

  deformedImageData.data.set(baseImageData.data);

  const { minX, minY, maxX, maxY } = maskBounds;
  const out = deformedImageData.data;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * drawWidth + x;
      if (!maskAlpha[idx]) continue;

      const { ox, oy } = computeJellyOffset(x, y, elapsedSec);
      const outOffset = idx * 4;
      sampleBaseNearest(x - ox, y - oy, out, outOffset);
    }
  }

  const w = imageCanvas.clientWidth;
  const h = imageCanvas.clientHeight;
  imageCtx.fillStyle = '#d3dbe5';
  imageCtx.fillRect(0, 0, w, h);

  warpCtx.putImageData(deformedImageData, 0, 0);
  imageCtx.drawImage(warpCanvas, offsetX, offsetY);

  redrawMaskOverlay();
}

function renderFrame(now) {
  if (!isPlaying || !loadedImage) return;
  rebuildMaskStats();
  const elapsedSec = (now - animStartTime) / 1000;
  renderDeformedFrame(elapsedSec);
  rafId = requestAnimationFrame(renderFrame);
}

function startAnimation() {
  if (!loadedImage || isPlaying) return;
  rebuildMaskStats();
  if (!maskBounds) {
    statusText.textContent = '先に指で範囲を選択してください。';
    return;
  }

  isPlaying = true;
  animStartTime = performance.now();
  playPauseButton.textContent = '停止';
  rafId = requestAnimationFrame(renderFrame);
}

function stopAnimation() {
  isPlaying = false;
  playPauseButton.textContent = '再生';
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (loadedImage) drawStaticFrame();
}

function brushAt(point) {
  if (!loadedImage || !point.inside) return;
  stampMask(point.x, point.y);
  rebuildMaskCanvasFromAlpha();
  maskDirty = true;
  redrawMaskOverlay();
}

function resetMask() {
  if (!maskAlpha) return;
  maskAlpha.fill(0);
  softMask.fill(0);
  maskDataCtx.clearRect(0, 0, drawWidth, drawHeight);
  maskBounds = null;
  maskDirty = false;
  redrawMaskOverlay();
}

fileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  loadImageFromFile(file);
});

strengthRange.addEventListener('input', updateSliderLabels);
speedRange.addEventListener('input', updateSliderLabels);
updateSliderLabels();

playPauseButton.addEventListener('click', () => {
  if (!loadedImage) {
    statusText.textContent = '先に画像をアップロードしてください。';
    return;
  }
  if (isPlaying) stopAnimation();
  else startAnimation();
});

resetMaskButton.addEventListener('click', () => {
  if (!loadedImage) return;
  resetMask();
  drawStaticFrame();
});

maskCanvas.addEventListener('pointerdown', (event) => {
  if (!loadedImage) return;
  drawing = true;
  maskCanvas.setPointerCapture(event.pointerId);
  brushAt(clientToImagePoint(event.clientX, event.clientY));
});

maskCanvas.addEventListener('pointermove', (event) => {
  if (!drawing || !loadedImage) return;
  brushAt(clientToImagePoint(event.clientX, event.clientY));
});

function endDraw(event) {
  drawing = false;
  if (event?.pointerId !== undefined && maskCanvas.hasPointerCapture(event.pointerId)) {
    maskCanvas.releasePointerCapture(event.pointerId);
  }
}

maskCanvas.addEventListener('pointerup', endDraw);
maskCanvas.addEventListener('pointercancel', endDraw);

window.addEventListener('resize', () => {
  if (!loadedImage) return;
  fitImageSize(loadedImage.naturalWidth, loadedImage.naturalHeight);
});
