/**
 * WebGL2 초기화, FBO 핑퐁 관리
 */

let gl = null;
let fbos = null;
let useHalfFloat = false;
let fbWidth = 0, fbHeight = 0; // 피드백 FBO 해상도 (디스플레이의 절반)

export function getFBOs() {
  return fbos;
}

export function initGL(canvas) {
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#fff;font:24px sans-serif;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;';
    msg.textContent = 'WebGL2를 지원하지 않는 브라우저입니다.';
    document.body.appendChild(msg);
    throw new Error('WebGL2 not supported');
  }

  // RGBA16F FBO로 양자화 잔상 방지 — 곱셈 감쇠가 8비트 반올림에 갇히지 않음
  useHalfFloat = !!gl.getExtension('EXT_color_buffer_half_float');

  applyCanvasSize(canvas);
  fbWidth = Math.max(1, gl.drawingBufferWidth >> 1);
  fbHeight = Math.max(1, gl.drawingBufferHeight >> 1);
  fbos = createFBOPair(fbWidth, fbHeight);

  window.addEventListener('resize', () => {
    applyCanvasSize(canvas);
    fbWidth = Math.max(1, gl.drawingBufferWidth >> 1);
    fbHeight = Math.max(1, gl.drawingBufferHeight >> 1);
    resizeFBOs(fbWidth, fbHeight);
  });

  return gl;
}

function applyCanvasSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
}

function createFBO(width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (useHalfFloat) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { framebuffer: fb, texture: tex };
}

export function createFBOPair(width, height) {
  return {
    read: createFBO(width, height),
    write: createFBO(width, height),
  };
}

export function swapFBOs() {
  const tmp = fbos.read;
  fbos.read = fbos.write;
  fbos.write = tmp;
}

function resizeFBOs(width, height) {
  gl.deleteTexture(fbos.read.texture);
  gl.deleteFramebuffer(fbos.read.framebuffer);
  gl.deleteTexture(fbos.write.texture);
  gl.deleteFramebuffer(fbos.write.framebuffer);
  fbos = createFBOPair(width, height);
}

/** 피드백 FBO 해상도 반환 */
export function getFeedbackSize() {
  return { width: fbWidth, height: fbHeight };
}

/** 피드백 FBO 렌더링용 뷰포트 (반해상도) */
export function setFeedbackViewport() {
  gl.viewport(0, 0, fbWidth, fbHeight);
}

/** 디스플레이/스크린 렌더링용 뷰포트 (풀해상도) */
export function setDisplayViewport() {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

export function renderToFBO(fbo, drawCall) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
  drawCall();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function renderToScreen(drawCall) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  drawCall();
}
