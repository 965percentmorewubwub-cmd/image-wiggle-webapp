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
const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
const maskDataCanvas = document.createElement('canvas');
const maskDataCtx = maskDataCanvas.getContext('2d', { willReadFrequently: true });

let loadedImage = null;
let drawing = false;
let isPlaying = false;
let rafId = null;
let phase = 0;
let drawWidth = 0;
let drawHeight = 0;
let offsetX = 0;
let offsetY = 0;

const MAX_EDGE = 1200;
const BRUSH_RADIUS = 24;
const MASK_ALPHA = 90;

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
  drawWidth = Math.round(imgWidth * scale);
  drawHeight = Math.round(imgHeight * scale);
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

  imageCtx.fillStyle = '#d3dbe5';
  imageCtx.fillRect(0, 0, targetW, targetH);
  imageCtx.drawImage(baseCanvas, offsetX, offsetY);
  redrawMaskOverlay();
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

    const maxCurrentEdge = Math.max(width, height);
    if (maxCurrentEdge > MAX_EDGE) {
      const ratio = MAX_EDGE / maxCurrentEdge;
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
  isPlaying = false;
  playPauseButton.textContent = '再生';
  fitImageSize(loadedImage.naturalWidth, loadedImage.naturalHeight);
  statusText.textContent = '画像上を指でなぞって揺らしたい範囲を選んでください。';
}

function redrawMaskOverlay() {
  const w = maskCanvas.clientWidth;
  const h = maskCanvas.clientHeight;
  maskCtx.clearRect(0, 0, w, h);
  if (!loadedImage) return;

  maskCtx.fillStyle = 'rgba(42, 159, 255, 0.35)';
  maskCtx.drawImage(maskDataCanvas, offsetX, offsetY);

  const imageData = maskCtx.getImageData(0, 0, w, h);
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (imageData.data[i + 3] > 0) {
      imageData.data[i] = 42;
      imageData.data[i + 1] = 159;
      imageData.data[i + 2] = 255;
      imageData.data[i + 3] = MASK_ALPHA;
    }
  }
  maskCtx.putImageData(imageData, 0, 0);
}

function clientToImagePoint(clientX, clientY) {
  const rect = maskCanvas.getBoundingClientRect();
  const x = clientX - rect.left - offsetX;
  const y = clientY - rect.top - offsetY;
  return {
    x,
    y,
    inside: x >= 0 && y >= 0 && x < drawWidth && y < drawHeight,
  };
}

function brushAt(point) {
  if (!point.inside || !loadedImage) return;
  maskDataCtx.fillStyle = '#fff';
  maskDataCtx.beginPath();
  maskDataCtx.arc(point.x, point.y, BRUSH_RADIUS, 0, Math.PI * 2);
  maskDataCtx.fill();
  redrawMaskOverlay();
}

function resetMask() {
  maskDataCtx.clearRect(0, 0, drawWidth, drawHeight);
  redrawMaskOverlay();
}

function renderFrame(timestamp) {
  if (!isPlaying || !loadedImage) return;
  const speed = Number(speedRange.value) / 18;
  const strength = Number(strengthRange.value);
  phase += 0.05 * speed;

  const w = imageCanvas.clientWidth;
  const h = imageCanvas.clientHeight;
  imageCtx.fillStyle = '#d3dbe5';
  imageCtx.fillRect(0, 0, w, h);

  imageCtx.drawImage(baseCanvas, offsetX, offsetY);

  const slice = 2;
  for (let y = 0; y < drawHeight; y += slice) {
    let hasMask = false;
    for (let x = 0; x < drawWidth; x += 8) {
      const a = maskDataCtx.getImageData(x, y, 1, 1).data[3];
      if (a > 0) {
        hasMask = true;
        break;
      }
    }

    if (!hasMask) continue;

    const horizontalShift = Math.sin(phase + y * 0.06) * strength;
    imageCtx.drawImage(
      baseCanvas,
      0,
      y,
      drawWidth,
      slice,
      offsetX + horizontalShift,
      offsetY + y,
      drawWidth,
      slice
    );
  }

  redrawMaskOverlay();
  rafId = requestAnimationFrame(renderFrame);
}

function startAnimation() {
  if (!loadedImage || isPlaying) return;
  isPlaying = true;
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

  if (loadedImage) {
    imageCtx.fillStyle = '#d3dbe5';
    imageCtx.fillRect(0, 0, imageCanvas.clientWidth, imageCanvas.clientHeight);
    imageCtx.drawImage(baseCanvas, offsetX, offsetY);
    redrawMaskOverlay();
  }
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
  if (isPlaying) {
    stopAnimation();
  } else {
    startAnimation();
  }
});

resetMaskButton.addEventListener('click', () => {
  if (!loadedImage) return;
  resetMask();
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
  if (loadedImage) {
    fitImageSize(loadedImage.naturalWidth, loadedImage.naturalHeight);
  }
});
