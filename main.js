/**
 * WebGL Text Trail — 타이핑한 텍스트가 색이 순환하며 세로로 흘러내림
 */

import {
  initGL, getFBOs, createFBOPair,
  swapFBOs, renderToFBO, renderToScreen,
  getFeedbackSize, setFeedbackViewport, setDisplayViewport,
} from './renderer.js';

import {
  vertexShaderSource,
  feedbackMRTFragmentSource,
  screenFragmentSource,
  displayFragmentSource,
} from './shaders.js';

import { createTextLayer, renderText, getCanvas, resize as resizeTextLayer } from './text-layer.js';
import { initInputHandler, getCurrentText } from './input-handler.js';

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

// --- Color cycle (Catmull-Rom) ---

const COLORS = [
  [1.0, 1.0, 1.0],    // white-blue flash
  [0.45, 0.7, 0.95],  // sky blue
  [0.0, 0.0, 0.0],    // black
  [1.0, 0.35, 0.0],   // red-orange
  [0.5, 0.12, 0.0],   // dark red-orange
  [0.0, 0.0, 0.0],    // black
];
const COLOR_CYCLE_MS = 2051 / 1.5 / 0.8 / 1.12;
const FRAME_MS = 1000 / 60;

// --- Hue rotation on click (25% = 90° per click, 0.6s transition) ---
let hueAngleCurrent = 0;   // 현재 보간된 각도 (radians)
let hueAngleFrom = 0;
let hueAngleTo = 0;
let hueTransitionStart = -Infinity;
const HUE_TRANSITION_MS = 600;
const HUE_STEP = Math.PI * 0.5; // 90° = 25% of 360°

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function updateHueAngle(now) {
  const elapsed = now - hueTransitionStart;
  if (elapsed >= HUE_TRANSITION_MS) {
    hueAngleCurrent = hueAngleTo;
  } else {
    const t = easeInOutCubic(elapsed / HUE_TRANSITION_MS);
    hueAngleCurrent = hueAngleFrom + (hueAngleTo - hueAngleFrom) * t;
  }
}

function advanceHueAngle(now) {
  updateHueAngle(now);
  hueAngleFrom = hueAngleCurrent;
  hueAngleTo += HUE_STEP;
  hueTransitionStart = now;
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
  const phase = ((((timeMs % COLOR_CYCLE_MS) + COLOR_CYCLE_MS) % COLOR_CYCLE_MS) / COLOR_CYCLE_MS) * n;
  const i = Math.floor(phase);
  const rawT = phase - i;

  const p0 = COLORS[((i - 1) % n + n) % n];
  const p1 = COLORS[i % n];

  const p2 = COLORS[(i + 1) % n];
  const p3 = COLORS[(i + 2) % n];

  // 블랙/레드 진입은 뚝 끊기듯 즉시 전환
  const isEnteringBlack = (p2[0] + p2[1] + p2[2]) < 0.01;
  const isEnteringRed = p2[0] > 0.8 && p2[1] < 0.2 && p2[2] < 0.3;
  if ((isEnteringBlack || isEnteringRed) && rawT > 0.5) {
    return [...p2];
  }

  return [
    Math.max(0, Math.min(1, catmullRom(p0[0], p1[0], p2[0], p3[0], rawT))),
    Math.max(0, Math.min(1, catmullRom(p0[1], p1[1], p2[1], p3[1], rawT))),
    Math.max(0, Math.min(1, catmullRom(p0[2], p1[2], p2[2], p3[2], rawT))),
  ];
}

// --- Stamp (text-layer → WebGL texture) ---

let stampTexture;

function initStamp(gl, w, h) {
  createTextLayer(w, h);

  stampTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, stampTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

// 프레임당 1번만 텍스트 래스터 + 텍스처 업로드 (흰색 마스크)
function uploadStampMask(gl) {
  const text = getCurrentText();
  renderText(text ? [text] : [], 0);

  gl.bindTexture(gl.TEXTURE_2D, stampTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, getCanvas());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

// --- Init & frame loop ---

function init() {
  const canvas = document.getElementById('main-canvas');
  const gl = initGL(canvas);

  initStamp(gl, gl.drawingBufferWidth, gl.drawingBufferHeight);

  const fbSize = getFeedbackSize();
  let upFbos = createFBOPair(fbSize.width, fbSize.height);

  const vao = gl.createVertexArray();

  // Programs
  const feedbackMRTProg = createProgram(gl, vertexShaderSource, feedbackMRTFragmentSource);
  const screenProg      = createProgram(gl, vertexShaderSource, screenFragmentSource);
  const displayProg     = createProgram(gl, vertexShaderSource, displayFragmentSource);

  // MRT Feedback uniform locations
  const uPrevDown       = gl.getUniformLocation(feedbackMRTProg, 'uPrevDown');
  const uPrevUp         = gl.getUniformLocation(feedbackMRTProg, 'uPrevUp');
  const uFeedbackOffset = gl.getUniformLocation(feedbackMRTProg, 'uFeedbackOffset');
  const uTimeDown       = gl.getUniformLocation(feedbackMRTProg, 'uTimeDown');
  const uTimeUp         = gl.getUniformLocation(feedbackMRTProg, 'uTimeUp');
  const uFeedbackRes    = gl.getUniformLocation(feedbackMRTProg, 'uResolution');

  // Screen (stamp) uniform locations
  const uScreenTex      = gl.getUniformLocation(screenProg, 'uTex');
  const uTint           = gl.getUniformLocation(screenProg, 'uTint');

  // Display uniform locations
  const uDisplayTex     = gl.getUniformLocation(displayProg, 'uTex');
  const uResolution     = gl.getUniformLocation(displayProg, 'uResolution');
  const uDisplayTime    = gl.getUniformLocation(displayProg, 'uTime');
  const uHueShift       = gl.getUniformLocation(displayProg, 'uHueShift');

  // Sampler uniforms — 1회만 설정
  gl.useProgram(feedbackMRTProg);
  gl.uniform1i(uPrevDown, 0);  // TEXTURE0
  gl.uniform1i(uPrevUp, 1);    // TEXTURE1
  gl.useProgram(screenProg);
  gl.uniform1i(uScreenTex, 0);
  gl.useProgram(displayProg);
  gl.uniform1i(uDisplayTex, 0);

  // MRT framebuffer (텍스처는 매 스텝 re-attach)
  const mrtFB = gl.createFramebuffer();

  // Trail parameters
  const STEPS = 24;
  const TOTAL_OFFSET = 0.0135 * 2 * 0.8 * 1.4;
  const stepOffset = TOTAL_OFFSET / STEPS;

  // 유휴 감지 — 4초 무입력 시 피드백 스킵
  const IDLE_TIMEOUT_MS = 4000;
  let lastActiveTime = -Infinity;

  // 텍스트 입력
  const inputEl = document.getElementById('hidden-input');
  initInputHandler(inputEl, () => {});
  canvas.addEventListener('click', () => {
    advanceHueAngle(performance.now());
    inputEl.focus();
  });
  inputEl.focus();

  // Resize
  window.addEventListener('resize', () => {
    resizeTextLayer(gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindTexture(gl.TEXTURE_2D, stampTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.deleteTexture(upFbos.read.texture);
    gl.deleteFramebuffer(upFbos.read.framebuffer);
    gl.deleteTexture(upFbos.write.texture);
    gl.deleteFramebuffer(upFbos.write.framebuffer);
    const newFbSize = getFeedbackSize();
    upFbos = createFBOPair(newFbSize.width, newFbSize.height);
  });

  // Stamp draw helper (init 스코프에서 1회 생성)
  const TRAIL_DIM = 0.96;
  const drawStampTinted = (color, dim = TRAIL_DIM) => {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(screenProg);
    gl.uniform3f(uTint, color[0] * dim, color[1] * dim, color[2] * dim);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stampTexture);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  };

  // Frame loop
  function frame() {
    const now = performance.now();
    updateHueAngle(now);
    const fbos = getFBOs();
    const hasText = getCurrentText().length > 0;

    // 유휴 감지: 텍스트가 있으면 활성 시간 갱신
    if (hasText) lastActiveTime = now;
    const isIdle = (now - lastActiveTime) > IDLE_TIMEOUT_MS;

    // 피드백 루프는 유휴 상태가 아닐 때만 실행
    if (!isIdle) {
      // 텍스트 마스크는 프레임당 1번만 업로드 (풀해상도 텍스처)
      if (hasText) uploadStampMask(gl);

      // 피드백 FBO는 반해상도 — 뷰포트 전환
      const curFbSize = getFeedbackSize();
      setFeedbackViewport();

      // MRT 피드백 셰이더 불변 유니폼을 루프 밖에서 1회만 설정
      gl.useProgram(feedbackMRTProg);
      gl.uniform2f(uFeedbackRes, curFbSize.width, curFbSize.height);
      gl.uniform1f(uFeedbackOffset, stepOffset);

      const nowSec = now * 0.001;

      const STAMP_EVERY = 2; // 2스텝마다 stamp
      for (let s = 0; s <= STEPS; s++) {
        if (hasText && s % STAMP_EVERY === 0) {
          const subTime = now - FRAME_MS + (s / STEPS) * FRAME_MS;

          // 아래 트레일: 정방향 사이클
          const downColor = getCycleColor(subTime);
          renderToFBO(fbos.read, () => drawStampTinted(downColor));

          // 위 트레일: 역방향 사이클
          const upColor = getCycleColor(-subTime);
          renderToFBO(upFbos.read, () => drawStampTinted(upColor));
        }

        if (s < STEPS) {
          // MRT 피드백: down + up 동시 처리
          gl.bindFramebuffer(gl.FRAMEBUFFER, mrtFB);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbos.write.texture, 0);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, upFbos.write.texture, 0);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

          gl.useProgram(feedbackMRTProg);
          gl.uniform1f(uTimeDown, nowSec + s * 0.1);
          gl.uniform1f(uTimeUp, nowSec + s * 0.1 + 50.0);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fbos.read.texture);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, upFbos.read.texture);

          gl.bindVertexArray(vao);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);

          // 양쪽 FBO 스왑
          swapFBOs();
          const tmp = upFbos.read;
          upFbos.read = upFbos.write;
          upFbos.write = tmp;
        }
      }
    }

    // 디스플레이는 풀해상도로 전환
    setDisplayViewport();

    // Display: 아래 + 위 트레일 (MAX 합성) — 반해상도 FBO를 바이리니어 업샘플
    renderToScreen(() => {
      gl.useProgram(displayProg);
      gl.uniform2f(uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(uDisplayTime, now * 0.001);
      gl.uniform1f(uHueShift, hueAngleCurrent);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(vao);

      gl.bindTexture(gl.TEXTURE_2D, fbos.read.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindTexture(gl.TEXTURE_2D, upFbos.read.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
    });

    // 원본 텍스트를 최상단에 풀 밝기로 오버레이
    if (hasText) {
      const overlayColor = getCycleColor(now);
      drawStampTinted(overlayColor, 1.0);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init();
