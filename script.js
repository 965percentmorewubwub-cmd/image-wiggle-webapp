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

const softMaskCanvas = document.createElement("canvas");
const softMaskCtx = softMaskCanvas.getContext("2d");

const baseCanvas = document.createElement("canvas");
const baseCtx = baseCanvas.getContext("2d");

const selectedCanvas = document.createElement("canvas");
const selectedCtx = selectedCanvas.getContext("2d");

let hasImage = false;
let hasPainted = false;
let isPainting = false;
let isPlaying = false;

let selectionBounds = null;
let selectionCenter = null;
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
    softMaskCanvas,
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
  clearCanvas(softMaskCtx, softMaskCanvas);
  clearCanvas(baseCtx, baseCanvas);
  clearCanvas(selectedCtx, selectedCanvas);
  clearCanvas(overlayCtx, overlayCanvas);

  overlayCanvas.style.opacity = "1";

  hasPainted = false;
  selectionBounds = null;
  selectionCenter = null;
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
    16,
    Math.round(Math.min(overlayCanvas.width, overlayCanvas.height) * 0.035)
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
  overlayCtx.fillStyle = "rgba(255, 80, 120, 0.28)";
  overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.restore();
}

function createSoftMask() {
  clearCanvas(softMaskCtx, softMaskCanvas);

  if (!hasPainted) return;

  const blurAmount = Math.max(
    8,
    Math.round(Math.min(maskCanvas.width, maskCanvas.height) * 0.018)
  );

  softMaskCtx.save();
  softMaskCtx.filter = `blur(${blurAmount}px)`;
  softMaskCtx.drawImage(maskCanvas, 0, 0);
  softMaskCtx.restore();

  softMaskCtx.save();
  softMaskCtx.globalCompositeOperation = "source-over";
  softMaskCtx.globalAlpha = 0.9;
  softMaskCtx.drawImage(maskCanvas, 0, 0);
  softMaskCtx.restore();
}

function rebuildMaskedLayers() {
  if (!hasImage || !hasPainted) {
    selectionBounds = null;
    selectionCenter = null;
    return;
  }

  createSoftMask();

  clearCanvas(baseCtx, baseCanvas);
  baseCtx.drawImage(imageCanvas, 0, 0);

  clearCanvas(selectedCtx, selectedCanvas);
  selectedCtx.drawImage(imageCanvas, 0, 0);
  selectedCtx.globalCompositeOperation = "destination-in";
  selectedCtx.drawImage(softMaskCanvas, 0, 0);
  selectedCtx.globalCompositeOperation = "source-over";

  selectionBounds = getSelectionBounds();
  selectionCenter = getSelectionCenter();
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

  const padding = Math.max(20, Math.round(Math.min(width, height) * 0.035));

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

function getSelectionCenter() {
  if (!selectionBounds) return null;

  const { width, height } = maskCanvas;
  const data = maskCtx.getImageData(0, 0, width, height).data;

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = selectionBounds.top; y < selectionBounds.bottom; y += 2) {
    for (let x = selectionBounds.left; x < selectionBounds.right; x += 2) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha > 10) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  if (count === 0) {
    return {
      x: selectionBounds.left + selectionBounds.width / 2,
      y: selectionBounds.top + selectionBounds.height / 2
    };
  }

  return {
    x: sumX / count,
    y: sumY / count
  };
}

function finalizeSelection() {
  rebuildMaskedLayers();
  renderStatic();

  if (selectionBounds) {
    setStatus("範囲を選択しました。再生を押すと、選んだ場所だけが自然にぷるっと揺れます。");
  } else {
    setStatus("選択範囲が見つかりませんでした。もう一度なぞってください。");
  }
}

function renderStatic() {
  clearCanvas(mainCtx, mainCanvas);

  if (!hasImage) return;

  mainCtx.drawImage(imageCanvas, 0, 0);

  if (!isPlaying) {
    drawOverlayPreview();
  } else {
    hideOverlayLayer();
  }
}

function smoothStep(edge0, edge1, value) {
  const x = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return x * x * (3 - 2 * x);
}

function drawAnimatedSelection(time) {
  if (!selectionBounds || !selectionCenter) return;

  const b = selectionBounds;
  const c = selectionCenter;

  const strength = Number(strengthRange.value);
  const speed = Number(speedRange.value);

  const dt = Math.min((time - lastTime) / 1000, 0.04) || 0.016;
  lastTime = time;

  phase += dt * (1.05 + speed * 0.28);

  const baseSize = Math.max(40, Math.min(b.width, b.height));
  const amplitude = Math.max(1.8, baseSize * 0.010 * (0.7 + strength * 0.08));

  const slow = Math.sin(phase) * amplitude;
  const rebound = Math.sin(phase * 1.9 - 0.8) * amplitude * 0.42;
  const micro = Math.sin(phase * 3.1 + 0.4) * amplitude * 0.16;

  const verticalBounce = slow + rebound + micro;
  const horizontalLag = Math.sin(phase - 0.6) * amplitude * 0.24;

  const squash = Math.sin(phase - 0.35) * (0.010 + strength * 0.0012);
  const breathe = Math.sin(phase * 1.35 + 0.8) * (0.006 + strength * 0.0008);

  const stripHeight = 2;

  for (let y = b.top; y < b.bottom; y += stripHeight) {
    const srcY = y;
    const srcH = Math.min(stripHeight + 1, b.bottom - y);

    const verticalProgress = (y - b.top) / Math.max(1, b.height);
    const edgeFadeY = Math.sin(verticalProgress * Math.PI);

    const distanceFromCenterY = Math.abs(y - c.y) / Math.max(1, b.height / 2);
    const centerWeightY = 1 - smoothStep(0.15, 1.0, distanceFromCenterY);

    const bottomWeight = smoothStep(0.1, 1.0, verticalProgress);
    const topAnchor = smoothStep(0.0, 0.28, verticalProgress);

    const softWeight = Math.max(0, edgeFadeY) * (0.35 + centerWeightY * 0.65);
    const anchoredWeight = softWeight * topAnchor;

    const localDelay = Math.sin(phase * 1.7 + verticalProgress * 2.2) * amplitude * 0.16;

    const yOffset =
      verticalBounce * anchoredWeight * (0.22 + bottomWeight * 0.42) +
      localDelay * anchoredWeight;

    const xOffset =
      horizontalLag * anchoredWeight * 0.55 +
      Math.sin(phase * 2.3 + verticalProgress * 4.0) * amplitude * 0.035 * anchoredWeight;

    const widthScale =
      1 +
      squash * anchoredWeight +
      breathe * centerWeightY * edgeFadeY -
      (verticalBounce / Math.max(80, baseSize * 3.0)) * anchoredWeight * 0.08;

    const extraWidth = b.width * (widthScale - 1);

    const drawX = b.left - extraWidth / 2 + xOffset;
    const drawY = srcY + yOffset;
    const drawW = b.width + extraWidth;
    const drawH = srcH + 0.6;

    mainCtx.save();

    mainCtx.globalAlpha = 0.94;

    mainCtx.drawImage(
      selectedCanvas,
      b.left,
      srcY,
      b.width,
      srcH,
      drawX,
      drawY,
      drawW,
      drawH
    );

    mainCtx.restore();
  }

  addSubtleBlendAtEdges();
}

function addSubtleBlendAtEdges() {
  if (!selectionBounds) return;

  const b = selectionBounds;

  mainCtx.save();
  mainCtx.globalAlpha = 0.18;
  mainCtx.globalCompositeOperation = "source-over";

  mainCtx.drawImage(
    imageCanvas,
    b.left,
    b.top,
    b.width,
    b.height,
    b.left,
    b.top,
    b.width,
    b.height
  );

  mainCtx.restore();

  mainCtx.save();
  mainCtx.globalAlpha = 0.78;
  mainCtx.globalCompositeOperation = "source-over";
  mainCtx.drawImage(selectedCanvas, 0, 0);
  mainCtx.restore();
}

function renderAnimatedFrame(time) {
  clearCanvas(mainCtx, mainCanvas);

  mainCtx.drawImage(imageCanvas, 0, 0);
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

  setStatus("再生中です。赤い選択表示は非表示になっています。");
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
