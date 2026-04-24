const imageInput = document.getElementById("imageInput");
const strengthRange = document.getElementById("strengthRange");
const speedRange = document.getElementById("speedRange");
const strengthValue = document.getElementById("strengthValue");
const speedValue = document.getElementById("speedValue");
const playButton = document.getElementById("playButton");
const resetButton = document.getElementById("resetButton");
const statusText = document.getElementById("statusText");

const mainCanvas = document.getElementById("mainCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const mainCtx = mainCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

const imageCanvas = document.createElement("canvas");
const imageCtx = imageCanvas.getContext("2d");

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d");

const baseCanvas = document.createElement("canvas");
const baseCtx = baseCanvas.getContext("2d");

const selectedCanvas = document.createElement("canvas");
const selectedCtx = selectedCanvas.getContext("2d");

let hasImage = false;
let hasPainted = false;
let isPainting = false;
let isPlaying = false;
let selectionBounds = null;
let lastPoint = null;
let animationId = null;
let phase = 0;
let lastTime = 0;

function setStatus(text) {
  statusText.textContent = text;
}

function updateRangeLabels() {
  strengthValue.textContent = strengthRange.value;
  speedValue.textContent = speedRange.value;
}

updateRangeLabels();

strengthRange.addEventListener("input", updateRangeLabels);
speedRange.addEventListener("input", updateRangeLabels);

function showOverlayLayer() {
  overlayCanvas.style.opacity = "1";
}

function hideOverlayLayer() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCanvas.style.opacity = "0";
}

function setCanvasSize(width, height) {
  [
    mainCanvas,
    overlayCanvas,
    imageCanvas,
    maskCanvas,
    baseCanvas,
    selectedCanvas
  ].forEach((canvas) => {
    canvas.width = width;
    canvas.height = height;
  });

  overlayCanvas.style.opacity = "1";
}

function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function fitImageSize(img) {
  const maxSide = 1200;
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > maxSide || height > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  return { width, height };
}

function loadImage(file) {
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    const img = new Image();

    img.onload = () => {
      const { width, height } = fitImageSize(img);
      setCanvasSize(width, height);

      clearCanvas(imageCtx, imageCanvas);
      imageCtx.drawImage(img, 0, 0, width, height);

      clearSelectionOnly();
      hasImage = true;
      renderStatic();
      setStatus("画像を読み込みました。画像の上を指でなぞって範囲を選んでください。");
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
}

imageInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const isValid =
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.name.toLowerCase().endsWith(".jpg") ||
    file.name.toLowerCase().endsWith(".jpeg") ||
    file.name.toLowerCase().endsWith(".png");

  if (!isValid) {
    alert("JPG または PNG を選んでください。");
    return;
  }

  stopAnimation();
  loadImage(file);
});

function clearSelectionOnly() {
  clearCanvas(maskCtx, maskCanvas);
  clearCanvas(baseCtx, baseCanvas);
  clearCanvas(selectedCtx, selectedCanvas);
  clearCanvas(overlayCtx, overlayCanvas);

  overlayCanvas.style.opacity = "1";

  hasPainted = false;
  selectionBounds = null;
  lastPoint = null;
}

function resetAll() {
  stopAnimation();
  clearSelectionOnly();
  renderStatic();
  setStatus(
    hasImage
      ? "選択をリセットしました。もう一度なぞって範囲を選んでください。"
      : "まずは画像を選んでください。"
  );
}

resetButton.addEventListener("click", resetAll);

function getPointFromEvent(event) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width / rect.width;
  const scaleY = overlayCanvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function getBrushRadius() {
  return Math.max(
    14,
    Math.round(Math.min(overlayCanvas.width, overlayCanvas.height) * 0.03)
  );
}

function paintMaskLine(from, to) {
  const radius = getBrushRadius();

  maskCtx.save();
  maskCtx.strokeStyle = "rgba(255,255,255,1)";
  maskCtx.lineWidth = radius * 2;
  maskCtx.lineCap = "round";
  maskCtx.lineJoin = "round";
  maskCtx.beginPath();
  maskCtx.moveTo(from.x, from.y);
  maskCtx.lineTo(to.x, to.y);
  maskCtx.stroke();
  maskCtx.restore();

  hasPainted = true;

  if (!isPlaying) {
    drawOverlayPreview();
  }
}

function drawOverlayPreview() {
  if (isPlaying) {
    hideOverlayLayer();
    return;
  }

  showOverlayLayer();
  clearCanvas(overlayCtx, overlayCanvas);

  if (!hasPainted) return;

  overlayCtx.save();
  overlayCtx.drawImage(maskCanvas, 0, 0);
  overlayCtx.globalCompositeOperation = "source-in";
  overlayCtx.fillStyle = "rgba(255, 105, 180, 0.30)";
  overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.restore();
}

function rebuildMaskedLayers() {
  if (!hasImage || !hasPainted) {
    selectionBounds = null;
    return;
  }

  clearCanvas(baseCtx, baseCanvas);
  baseCtx.drawImage(imageCanvas, 0, 0);
  baseCtx.globalCompositeOperation = "destination-out";
  baseCtx.drawImage(maskCanvas, 0, 0);
  baseCtx.globalCompositeOperation = "source-over";

  clearCanvas(selectedCtx, selectedCanvas);
  selectedCtx.drawImage(imageCanvas, 0, 0);
  selectedCtx.globalCompositeOperation = "destination-in";
  selectedCtx.drawImage(maskCanvas, 0, 0);
  selectedCtx.globalCompositeOperation = "source-over";

  selectionBounds = getSelectionBounds();
}

function getSelectionBounds() {
  const { width, height } = maskCanvas;
  const data = maskCtx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  const padding = Math.max(6, Math.round(Math.min(width, height) * 0.01));

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + padding);
  const bottom = Math.min(height, maxY + padding);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function finalizeSelection() {
  rebuildMaskedLayers();
  renderStatic();

  if (selectionBounds) {
    setStatus("範囲を選択しました。再生を押すと、選んだ場所だけがやわらかく揺れます。");
  } else {
    setStatus("選択範囲が見つかりませんでした。もう一度なぞってください。");
  }
}

function renderStatic() {
  clearCanvas(mainCtx, mainCanvas);

  if (!hasImage) {
    return;
  }

  mainCtx.drawImage(imageCanvas, 0, 0);

  if (!isPlaying) {
    drawOverlayPreview();
  } else {
    hideOverlayLayer();
  }
}

function drawAnimatedSelection(time) {
  if (!selectionBounds) return;

  const b = selectionBounds;
  const strength = Number(strengthRange.value);
  const speed = Number(speedRange.value);

  const dt = Math.min((time - lastTime) / 1000, 0.04) || 0.016;
  lastTime = time;

  phase += dt * (1.2 + speed * 0.35);

  const baseSize = Math.min(b.width, b.height);
  const amplitude = Math.max(4, baseSize * 0.018 * (0.8 + strength * 0.11));

  const primaryBounce = Math.sin(phase) * amplitude;
  const secondaryBounce = Math.sin(phase * 2 - 0.9) * amplitude * 0.42;
  const sidewaysSway = Math.sin(phase - 0.35) * amplitude * 0.30;
  const squashWave = Math.sin(phase - 0.55) * (0.025 + strength * 0.0025);

  const stripHeight = 3;

  for (let y = b.top; y < b.bottom; y += stripHeight) {
    const srcY = y;
    const srcH = Math.min(stripHeight + 1, b.bottom - y);

    const progress = (y - b.top) / Math.max(1, b.height);
    const centerWeight = Math.sin(progress * Math.PI);
    const lowerWeight = 0.25 + progress * 0.75;

    const xOffset =
      sidewaysSway * centerWeight +
      Math.sin(phase * 2.15 + progress * 5.8) *
        amplitude *
        0.06 *
        centerWeight;

    const yOffset =
      primaryBounce * lowerWeight * 0.30 +
      secondaryBounce * centerWeight * 0.45;

    const widthScale =
      1 +
      squashWave * (0.35 + centerWeight * 0.65) -
      (primaryBounce / Math.max(60, baseSize * 2.2)) * 0.10;

    const extraWidth = b.width * (widthScale - 1);

    mainCtx.drawImage(
      selectedCanvas,
      b.left,
      srcY,
      b.width,
      srcH,
      b.left - extraWidth / 2 + xOffset,
      srcY + yOffset,
      b.width + extraWidth,
      srcH + 0.8
    );
  }
}

function renderAnimatedFrame(time) {
  clearCanvas(mainCtx, mainCanvas);

  mainCtx.drawImage(baseCanvas, 0, 0);
  drawAnimatedSelection(time);

  hideOverlayLayer();

  if (isPlaying) {
    animationId = requestAnimationFrame(renderAnimatedFrame);
  }
}

function stopAnimation() {
  isPlaying = false;
  playButton.textContent = "再生";

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  overlayCanvas.style.opacity = "1";
  renderStatic();
}

function startAnimation() {
  if (!hasImage) {
    alert("先に画像を選んでください。");
    return;
  }

  if (!hasPainted) {
    alert("先に画像の上をなぞって範囲を選んでください。");
    return;
  }

  rebuildMaskedLayers();

  if (!selectionBounds) {
    alert("選択範囲がありません。もう一度なぞってください。");
    return;
  }

  isPlaying = true;
  playButton.textContent = "停止";
  phase = 0;
  lastTime = performance.now();

  hideOverlayLayer();

  setStatus("再生中です。選んだ場所だけがやわらかく揺れます。");
  animationId = requestAnimationFrame(renderAnimatedFrame);
}

playButton.addEventListener("click", () => {
  if (isPlaying) {
    stopAnimation();
  } else {
    startAnimation();
  }
});

overlayCanvas.addEventListener("pointerdown", (event) => {
  if (!hasImage) return;

  event.preventDefault();
  stopAnimation();

  showOverlayLayer();

  isPainting = true;
  overlayCanvas.setPointerCapture(event.pointerId);

  const point = getPointFromEvent(event);
  lastPoint = point;
  paintMaskLine(point, point);
});

overlayCanvas.addEventListener("pointermove", (event) => {
  if (!isPainting || !hasImage) return;

  event.preventDefault();

  const point = getPointFromEvent(event);
  paintMaskLine(lastPoint, point);
  lastPoint = point;
});

function finishPainting(event) {
  if (!isPainting) return;

  if (event) {
    event.preventDefault();
  }

  isPainting = false;
  lastPoint = null;
  finalizeSelection();
}

overlayCanvas.addEventListener("pointerup", finishPainting);
overlayCanvas.addEventListener("pointercancel", finishPainting);

overlayCanvas.addEventListener("pointerleave", (event) => {
  if (isPainting) finishPainting(event);
});

overlayCanvas.addEventListener(
  "touchmove",
  (event) => {
    if (isPainting) {
      event.preventDefault();
    }
  },
  { passive: false }
);
