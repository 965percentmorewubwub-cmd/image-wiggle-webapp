(() => {
  "use strict";

  function pick(selectors) {
    const list = selectors.split(",");
    for (const selector of list) {
      const el = document.querySelector(selector.trim());
      if (el) return el;
    }
    return null;
  }

  function findButtonByText(words) {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.find((btn) =>
      words.some((word) => (btn.textContent || "").includes(word))
    );
  }

  const rangeInputs = [...document.querySelectorAll('input[type="range"]')];

  const fileInput =
    pick("#fileInput, #imageInput, input[type='file']");

  const strengthRange =
    pick("#strengthRange, #amplitudeRange, #wiggleStrength") ||
    rangeInputs[0] ||
    null;

  const speedRange =
    pick("#speedRange, #frequencyRange, #wiggleSpeed") ||
    rangeInputs[1] ||
    null;

  const strengthValue =
    pick("#strengthValue, #amplitudeValue, [data-role='strength-value']");

  const speedValue =
    pick("#speedValue, #frequencyValue, [data-role='speed-value']");

  const playButton =
    pick("#playButton, #toggleButton, button[data-action='play']") ||
    findButtonByText(["再生", "停止", "Play", "Stop"]);

  const resetButton =
    pick("#resetButton, #clearSelectionButton, button[data-action='reset']") ||
    findButtonByText(["リセット", "クリア", "Reset", "Clear"]);

  const canvas =
    pick("#previewCanvas, #mainCanvas, canvas");

  if (!fileInput || !canvas || !playButton || !resetButton) {
    console.error("必要なHTML要素が見つかりませんでした。");
    return;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const sourceCanvas = document.createElement("canvas");
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });

  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

  const softMaskCanvas = document.createElement("canvas");
  const softMaskCtx = softMaskCanvas.getContext("2d", { willReadFrequently: true });

  const overlayCanvas = document.createElement("canvas");
  const overlayCtx = overlayCanvas.getContext("2d");

  const liveOverlayCanvas = document.createElement("canvas");
  const liveOverlayCtx = liveOverlayCanvas.getContext("2d");

  const state = {
    imageLoaded: false,
    isPlaying: false,
    isDrawing: false,
    hasSelection: false,

    width: 0,
    height: 0,

    brushRadius: 24,

    lastPoint: null,
    sourceImageData: null,
    softMaskData: null,

    selection: {
      centerX: 0,
      centerY: 0,
      radiusX: 1,
      radiusY: 1,
      bounds: null,
      region: null,
      blurPx: 18
    },

    spring: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      polarity: 1,
      lastKickTime: 0
    },

    animationFrameId: 0,
    lastFrameTime: 0
  };

  canvas.style.touchAction = "none";

  function setCanvasSize(width, height) {
    state.width = width;
    state.height = height;

    canvas.width = width;
    canvas.height = height;

    sourceCanvas.width = width;
    sourceCanvas.height = height;

    maskCanvas.width = width;
    maskCanvas.height = height;

    softMaskCanvas.width = width;
    softMaskCanvas.height = height;

    overlayCanvas.width = width;
    overlayCanvas.height = height;

    liveOverlayCanvas.width = width;
    liveOverlayCanvas.height = height;

    state.brushRadius = Math.max(14, Math.round(Math.min(width, height) * 0.04));
  }

  function updateValueLabels() {
    if (strengthRange && strengthValue) {
      strengthValue.textContent = strengthRange.value;
    }
    if (speedRange && speedValue) {
      speedValue.textContent = speedRange.value;
    }
  }

  function updatePlayButtonLabel() {
    playButton.textContent = state.isPlaying ? "停止" : "再生";
  }

  function getStrengthValue() {
    if (!strengthRange) return 14;
    return Number(strengthRange.value || 14);
  }

  function getSpeedValue() {
    if (!speedRange) return 12;
    return Number(speedRange.value || 12);
  }

  function getStrengthNorm() {
    if (!strengthRange) return 0.5;
    const min = Number(strengthRange.min || 0);
    const max = Number(strengthRange.max || 20);
    const value = Number(strengthRange.value || 0);
    if (max === min) return 0.5;
    return (value - min) / (max - min);
  }

  function getSpeedNorm() {
    if (!speedRange) return 0.5;
    const min = Number(speedRange.min || 0);
    const max = Number(speedRange.max || 20);
    const value = Number(speedRange.value || 0);
    if (max === min) return 0.5;
    return (value - min) / (max - min);
  }

  function getMaxMotionPx() {
    return 4 + getStrengthNorm() * 18;
  }

  function resetMaskCanvases() {
    maskCtx.clearRect(0, 0, state.width, state.height);
    softMaskCtx.clearRect(0, 0, state.width, state.height);
    overlayCtx.clearRect(0, 0, state.width, state.height);
    liveOverlayCtx.clearRect(0, 0, state.width, state.height);
  }

  function clearSelection() {
    stopAnimation();
    resetMaskCanvases();
    state.hasSelection = false;
    state.softMaskData = null;
    state.selection = {
      centerX: 0,
      centerY: 0,
      radiusX: 1,
      radiusY: 1,
      bounds: null,
      region: null,
      blurPx: 18
    };
    render();
  }

  function stopAnimation() {
    state.isPlaying = false;
    updatePlayButtonLabel();

    if (state.animationFrameId) {
      cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = 0;
    }
  }

  function resetSpring() {
    state.spring.x = 0;
    state.spring.y = 0;
    state.spring.vx = 0;
    state.spring.vy = 0;
    state.spring.lastKickTime = 0;
  }

  function kickSpring(forceStrong = false) {
    const strengthPx = getMaxMotionPx();
    const amount = forceStrong ? strengthPx : strengthPx * 0.8;

    state.spring.vy += amount * (0.8 + Math.random() * 0.25) * state.spring.polarity;
    state.spring.vx += (Math.random() * 2 - 1) * amount * 0.22;

    state.spring.polarity *= -1;
    state.spring.lastKickTime = performance.now();
  }

  function startAnimation() {
    if (!state.imageLoaded || !state.hasSelection) return;

    stopAnimation();
    state.isPlaying = true;
    updatePlayButtonLabel();
    resetSpring();
    kickSpring(true);
    state.lastFrameTime = 0;
    render();
    state.animationFrameId = requestAnimationFrame(animate);
  }

  function toggleAnimation() {
    if (!state.imageLoaded || !state.hasSelection) return;
    if (state.isPlaying) {
      stopAnimation();
      render();
    } else {
      startAnimation();
    }
  }

  function animate(timestamp) {
    if (!state.isPlaying) return;

    if (!state.lastFrameTime) {
      state.lastFrameTime = timestamp;
    }

    const dt = Math.min(0.033, (timestamp - state.lastFrameTime) / 1000 || 0.016);
    state.lastFrameTime = timestamp;

    updateSpring(dt, timestamp);
    render();

    state.animationFrameId = requestAnimationFrame(animate);
  }

  function updateSpring(dt, timestamp) {
    const speedNorm = getSpeedNorm();

    const stiffness = 28 + speedNorm * 58;
    const damping = 7 + speedNorm * 6;

    const sx = state.spring.x;
    const sy = state.spring.y;
    const svx = state.spring.vx;
    const svy = state.spring.vy;

    const ax = -stiffness * sx - damping * svx;
    const ay = -stiffness * sy - damping * svy;

    state.spring.vx += ax * dt;
    state.spring.vy += ay * dt;

    state.spring.x += state.spring.vx * dt;
    state.spring.y += state.spring.vy * dt;

    const energy =
      Math.abs(state.spring.x) +
      Math.abs(state.spring.y) +
      Math.abs(state.spring.vx) * 0.03 +
      Math.abs(state.spring.vy) * 0.03;

    const kickInterval = 800 - speedNorm * 350;

    if (energy < 0.45 && timestamp - state.spring.lastKickTime > kickInterval) {
      kickSpring(false);
    }
  }

  function drawBaseImage() {
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.drawImage(sourceCanvas, 0, 0);
  }

  function drawOverlayFromCanvas(maskSourceCanvas, alpha = 0.35, targetCtx = ctx) {
    liveOverlayCtx.clearRect(0, 0, state.width, state.height);
    liveOverlayCtx.fillStyle = `rgba(255, 55, 55, ${alpha})`;
    liveOverlayCtx.fillRect(0, 0, state.width, state.height);
    liveOverlayCtx.globalCompositeOperation = "destination-in";
    liveOverlayCtx.drawImage(maskSourceCanvas, 0, 0);
    liveOverlayCtx.globalCompositeOperation = "source-over";
    targetCtx.drawImage(liveOverlayCanvas, 0, 0);
  }

  function buildSoftMask() {
    softMaskCtx.clearRect(0, 0, state.width, state.height);

    const blurPx = Math.max(10, Math.round(state.brushRadius * 0.9));
    state.selection.blurPx = blurPx;

    softMaskCtx.save();
    softMaskCtx.filter = `blur(${blurPx}px)`;
    softMaskCtx.drawImage(maskCanvas, 0, 0);
    softMaskCtx.restore();

    // 中央が弱くなりすぎないように、元マスクも重ねる
    softMaskCtx.drawImage(maskCanvas, 0, 0);

    const softImageData = softMaskCtx.getImageData(0, 0, state.width, state.height);
    state.softMaskData = softImageData.data;

    overlayCtx.clearRect(0, 0, state.width, state.height);
    overlayCtx.fillStyle = "rgba(255, 55, 55, 0.34)";
    overlayCtx.fillRect(0, 0, state.width, state.height);
    overlayCtx.globalCompositeOperation = "destination-in";
    overlayCtx.drawImage(softMaskCanvas, 0, 0);
    overlayCtx.globalCompositeOperation = "source-over";
  }

  function updateSelectionInfo() {
    const maskImageData = maskCtx.getImageData(0, 0, state.width, state.height);
    const data = maskImageData.data;

    let minX = state.width;
    let minY = state.height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const i = (y * state.width + x) * 4 + 3;
        if (data[i] > 10) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          count++;
          sumX += x;
          sumY += y;
        }
      }
    }

    if (count === 0) {
      state.hasSelection = false;
      state.softMaskData = null;
      state.selection.bounds = null;
      state.selection.region = null;
      overlayCtx.clearRect(0, 0, state.width, state.height);
      return;
    }

    const centerX = sumX / count;
    const centerY = sumY / count;
    const radiusX = Math.max(18, (maxX - minX + 1) * 0.5);
    const radiusY = Math.max(18, (maxY - minY + 1) * 0.5);

    buildSoftMask();

    const padding = Math.ceil(state.selection.blurPx * 2 + getMaxMotionPx() * 3 + 6);

    const regionX = Math.max(0, minX - padding);
    const regionY = Math.max(0, minY - padding);
    const regionW = Math.min(state.width - regionX, (maxX - minX + 1) + padding * 2);
    const regionH = Math.min(state.height - regionY, (maxY - minY + 1) + padding * 2);

    state.selection.centerX = centerX;
    state.selection.centerY = centerY;
    state.selection.radiusX = radiusX;
    state.selection.radiusY = radiusY;
    state.selection.bounds = { minX, minY, maxX, maxY };
    state.selection.region = { x: regionX, y: regionY, w: regionW, h: regionH };
    state.hasSelection = true;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function bilinearSample(data, width, height, x, y) {
    const clampedX = clamp(x, 0, width - 1.001);
    const clampedY = clamp(y, 0, height - 1.001);

    const x0 = Math.floor(clampedX);
    const y0 = Math.floor(clampedY);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);

    const fx = clampedX - x0;
    const fy = clampedY - y0;

    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;

    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;

    return [
      data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11,
      data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11,
      data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11,
      data[i00 + 3] * w00 + data[i10 + 3] * w10 + data[i01 + 3] * w01 + data[i11 + 3] * w11
    ];
  }

  function renderAnimatedSelection() {
    if (!state.hasSelection || !state.selection.region || !state.softMaskData) {
      drawBaseImage();
      return;
    }

    drawBaseImage();

    const { x: regionX, y: regionY, w: regionW, h: regionH } = state.selection.region;

    const output = sourceCtx.getImageData(regionX, regionY, regionW, regionH);
    const out = output.data;
    const source = state.sourceImageData.data;
    const softMask = state.softMaskData;

    const centerX = state.selection.centerX;
    const centerY = state.selection.centerY;
    const radiusX = Math.max(1, state.selection.radiusX);
    const radiusY = Math.max(1, state.selection.radiusY);

    const moveX = state.spring.x;
    const moveY = state.spring.y;

    for (let localY = 0; localY < regionH; localY++) {
      const globalY = regionY + localY;

      for (let localX = 0; localX < regionW; localX++) {
        const globalX = regionX + localX;

        const globalIndex = (globalY * state.width + globalX) * 4;
        const outIndex = (localY * regionW + localX) * 4;

        const alpha = softMask[globalIndex + 3] / 255;

        if (alpha < 0.02) continue;

        const nx = (globalX - centerX) / radiusX;
        const ny = (globalY - centerY) / radiusY;
        const distance = Math.sqrt(nx * nx + ny * ny);

        const centerFalloff = Math.max(0, 1 - distance);
        const centerWeight = centerFalloff * centerFalloff;
        const edgeWeight = Math.pow(alpha, 1.35);

        const localWeight = clamp(centerWeight * 1.2 + edgeWeight * 0.28, 0, 1) * edgeWeight;

        if (localWeight < 0.01) continue;

        // ただの平行移動感を減らすため、中心移動 + 伸び縮み + 少しの回り込みを混ぜる
        const translateX = moveX * localWeight;
        const translateY = moveY * localWeight;

        const squashByY = moveY * 0.11;
        const squashByX = moveX * 0.06;

        const deformX =
          -nx * squashByY * edgeWeight +
          nx * squashByX * 0.45 * centerWeight;

        const deformY =
          -ny * moveY * 0.18 * centerWeight +
          nx * moveX * 0.08 * centerWeight;

        const swirl =
          moveX * ny * 0.07 -
          moveY * nx * 0.05;

        const sampleX = globalX - translateX - deformX - swirl;
        const sampleY = globalY - translateY - deformY;

        const sampled = bilinearSample(source, state.width, state.height, sampleX, sampleY);

        const blend = clamp(edgeWeight * (0.20 + localWeight * 0.95), 0, 1);

        out[outIndex] = out[outIndex] * (1 - blend) + sampled[0] * blend;
        out[outIndex + 1] = out[outIndex + 1] * (1 - blend) + sampled[1] * blend;
        out[outIndex + 2] = out[outIndex + 2] * (1 - blend) + sampled[2] * blend;
        out[outIndex + 3] = out[outIndex + 3] * (1 - blend) + sampled[3] * blend;
      }
    }

    ctx.putImageData(output, regionX, regionY);
  }

  function render() {
    if (!state.imageLoaded) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (state.isPlaying && state.hasSelection) {
      renderAnimatedSelection();
      return;
    }

    drawBaseImage();

    if (state.isDrawing) {
      drawOverlayFromCanvas(maskCanvas, 0.30);
      return;
    }

    if (state.hasSelection) {
      ctx.drawImage(overlayCanvas, 0, 0);
    }
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;

    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function drawBrushDot(x, y) {
    maskCtx.save();
    maskCtx.fillStyle = "rgba(255,255,255,1)";
    maskCtx.beginPath();
    maskCtx.arc(x, y, state.brushRadius, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.restore();
  }

  function drawBrushStroke(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const step = Math.max(2, state.brushRadius * 0.33);

    for (let t = 0; t <= distance; t += step) {
      const ratio = t / distance;
      const x = from.x + dx * ratio;
      const y = from.y + dy * ratio;
      drawBrushDot(x, y);
    }

    drawBrushDot(to.x, to.y);
  }

  function startDrawing(point) {
    if (!state.imageLoaded) return;

    if (state.isPlaying) {
      stopAnimation();
      resetSpring();
    }

    state.isDrawing = true;
    state.lastPoint = point;
    drawBrushDot(point.x, point.y);
    render();
  }

  function moveDrawing(point) {
    if (!state.isDrawing || !state.lastPoint) return;
    drawBrushStroke(state.lastPoint, point);
    state.lastPoint = point;
    render();
  }

  function endDrawing() {
    if (!state.isDrawing) return;
    state.isDrawing = false;
    state.lastPoint = null;
    updateSelectionInfo();
    render();
  }

  function loadImageFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/i.test(file.type)) {
      alert("JPG または PNG を選んでください。");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const maxSide = 720;
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (Math.max(width, height) > maxSide) {
          const scale = maxSide / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        setCanvasSize(width, height);

        sourceCtx.clearRect(0, 0, width, height);
        sourceCtx.drawImage(img, 0, 0, width, height);

        state.sourceImageData = sourceCtx.getImageData(0, 0, width, height);
        state.imageLoaded = true;

        clearSelection();
        drawBaseImage();
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  }

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    loadImageFile(file);
  });

  if (strengthRange) {
    strengthRange.addEventListener("input", () => {
      updateValueLabels();
      if (!state.isPlaying) render();
    });
  }

  if (speedRange) {
    speedRange.addEventListener("input", () => {
      updateValueLabels();
      if (!state.isPlaying) render();
    });
  }

  playButton.addEventListener("click", () => {
    toggleAnimation();
  });

  resetButton.addEventListener("click", () => {
    clearSelection();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.imageLoaded) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    startDrawing(getCanvasPoint(event));
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.isDrawing) return;
    event.preventDefault();
    moveDrawing(getCanvasPoint(event));
  });

  canvas.addEventListener("pointerup", (event) => {
    event.preventDefault();
    endDrawing();
  });

  canvas.addEventListener("pointercancel", (event) => {
    event.preventDefault();
    endDrawing();
  });

  canvas.addEventListener("pointerleave", () => {
    if (state.isDrawing) {
      endDrawing();
    }
  });

  canvas.addEventListener(
    "touchmove",
    (event) => {
      if (state.isDrawing) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  updateValueLabels();
  updatePlayButtonLabel();
})();
