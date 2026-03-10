/**
 * WebGL Text Trail — 클릭 위치에서 색이 순환하며 세로로 흘러내림
 */

import {
  initGL, getFBOs,
  swapFBOs, renderToFBO, renderToScreen,
} from './renderer.js';

import {
  vertexShaderSource,
  feedbackFragmentSource,
  screenFragmentSource,
  displayFragmentSource,
} from './shaders.js';

// --- GL helpers ---

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

// --- Color cycle (Catmull-Rom + smootherstep) ---

const COLORS = [
  [0.15, 0.3, 1.0],   // blue
  [0.0, 0.0, 0.0],    // black
  [1.0, 0.1, 0.15],   // red
  [0.0, 0.0, 0.0],    // black
];
const COLOR_CYCLE_MS = 2051;
const FRAME_MS = 1000 / 60;

function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function getCycleColor(timeMs) {
  const n = COLORS.length;
  const phase = ((timeMs % COLOR_CYCLE_MS) / COLOR_CYCLE_MS) * n;
  const i = Math.floor(phase);
  const t = smootherstep(phase - i);

  const p0 = COLORS[((i - 1) % n + n) % n];
  const p1 = COLORS[i % n];
  const p2 = COLORS[(i + 1) % n];
  const p3 = COLORS[(i + 2) % n];

  return [
    Math.max(0, Math.min(1, catmullRom(p0[0], p1[0], p2[0], p3[0], t))),
    Math.max(0, Math.min(1, catmullRom(p0[1], p1[1], p2[1], p3[1], t))),
    Math.max(0, Math.min(1, catmullRom(p0[2], p1[2], p2[2], p3[2], t))),
  ];
}

// --- Stamp (offscreen Canvas 2D → WebGL texture) ---

let stampCanvas, stampCtx, stampTexture;
let emitters = [];

function initStamp(gl, w, h) {
  stampCanvas = document.createElement('canvas');
  stampCanvas.width = w;
  stampCanvas.height = h;
  stampCtx = stampCanvas.getContext('2d');

  stampTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, stampTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function stampEmitters(gl, timeMs) {
  const dpr = window.devicePixelRatio || 1;
  stampCtx.clearRect(0, 0, stampCanvas.width, stampCanvas.height);

  const [r, g, b] = getCycleColor(timeMs);
  const fontSize = Math.round(200 * dpr);
  stampCtx.font = `bold ${fontSize}px sans-serif`;
  stampCtx.textAlign = 'center';
  stampCtx.textBaseline = 'middle';
  stampCtx.fillStyle = `rgb(${r * 255}, ${g * 255}, ${b * 255})`;

  for (const e of emitters) {
    stampCtx.fillText('A', e.x * dpr, e.y * dpr);
  }

  gl.bindTexture(gl.TEXTURE_2D, stampTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, stampCanvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

// --- Init & frame loop ---

function init() {
  const canvas = document.getElementById('main-canvas');
  const gl = initGL(canvas);

  initStamp(gl, gl.drawingBufferWidth, gl.drawingBufferHeight);

  const vao = gl.createVertexArray();

  // Programs
  const feedbackProg = createProgram(gl, vertexShaderSource, feedbackFragmentSource);
  const screenProg   = createProgram(gl, vertexShaderSource, screenFragmentSource);
  const displayProg  = createProgram(gl, vertexShaderSource, displayFragmentSource);

  // Uniform locations
  const uPrevFrame      = gl.getUniformLocation(feedbackProg, 'uPrevFrame');
  const uFeedbackOffset = gl.getUniformLocation(feedbackProg, 'uFeedbackOffset');
  const uScreenTex      = gl.getUniformLocation(screenProg, 'uTex');
  const uDisplayTex     = gl.getUniformLocation(displayProg, 'uTex');

  // Trail parameters
  const STEPS = 15;
  const TOTAL_OFFSET = 0.0135;
  const stepOffset = TOTAL_OFFSET / STEPS;

  // Click → emitter
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    emitters.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  });

  // Resize
  window.addEventListener('resize', () => {
    stampCanvas.width = gl.drawingBufferWidth;
    stampCanvas.height = gl.drawingBufferHeight;
    gl.bindTexture(gl.TEXTURE_2D, stampTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  });

  // Frame loop
  function frame() {
    const now = performance.now();
    const fbos = getFBOs();
    const hasEmitters = emitters.length > 0;

    for (let s = 0; s <= STEPS; s++) {
      if (hasEmitters) {
        const subTime = now - FRAME_MS + (s / STEPS) * FRAME_MS;
        stampEmitters(gl, subTime);
        renderToFBO(fbos.read, () => {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.useProgram(screenProg);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, stampTexture);
          gl.uniform1i(uScreenTex, 0);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          gl.disable(gl.BLEND);
        });
      }

      // 마지막 스텝은 stamp만 (이미터 위치 채움)
      if (s < STEPS) {
        renderToFBO(fbos.write, () => {
          gl.useProgram(feedbackProg);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fbos.read.texture);
          gl.uniform1i(uPrevFrame, 0);
          gl.uniform1f(uFeedbackOffset, stepOffset);
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        });
        swapFBOs();
      }
    }

    // Display
    renderToScreen(() => {
      gl.useProgram(displayProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbos.read.texture);
      gl.uniform1i(uDisplayTex, 0);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init();
