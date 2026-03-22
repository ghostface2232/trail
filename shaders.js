/** Vertex shader — fullscreen quad via gl_VertexID */
export const vertexShaderSource = `#version 300 es
out vec2 vUV;
void main() {
  float x = float((gl_VertexID & 1) << 1) - 1.0;
  float y = float((gl_VertexID & 2) - 1);
  vUV = vec2(x, y) * 0.5 + 0.5;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

/** MRT Feedback fragment shader — down+up 트레일을 단일 패스로 처리 */
export const feedbackMRTFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uPrevDown;
uniform sampler2D uPrevUp;
uniform float uFeedbackOffset;
uniform float uTimeDown;
uniform float uTimeUp;
uniform vec2 uResolution;
layout(location = 0) out vec4 fragDown;
layout(location = 1) out vec4 fragUp;

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

void main() {
  // === 공통 계산 (down/up 모두 vUV.y에만 의존) ===
  float distFromCenter = abs(vUV.y - 0.5) * 2.0;
  float slow = 1.0 - distFromCenter * distFromCenter;

  float edgeDist = max(smoothstep(0.3, 0.0, vUV.y), smoothstep(0.3, 0.0, 1.0 - vUV.y));
  float zoomAmt = edgeDist * edgeDist * 0.005;
  vec2 zoomCenter = vec2(0.5, vUV.y > 0.5 ? 1.0 : 0.0);

  float edgeBlur = max(smoothstep(0.3, 0.0, vUV.y), smoothstep(0.27, 0.0, 1.0 - vUV.y));
  float blurRadius = edgeBlur * 6.0;

  float darken = 1.0 - max((1.0 - vUV.y) * 0.003, 0.001);

  const mat3 hueRot = mat3(
    0.99958, 0.00186, -0.00103,
   -0.00103, 0.99958,  0.00186,
    0.00186, -0.00103, 0.99958
  );

  // === Down trail (+offset) ===
  vec2 hDown = hash2(vUV * 1000.0 + fract(uTimeDown * 3333.0));
  float jitterDown = (hDown.x - 0.5) / uResolution.y;
  vec2 downUV = vec2(vUV.x, vUV.y + uFeedbackOffset * slow + jitterDown);
  downUV = mix(downUV, zoomCenter, zoomAmt);

  vec4 cDown;
  if (blurRadius < 0.5) {
    cDown = texture(uPrevDown, downUV);
  } else {
    // 스토캐스틱 2-tap 블러: 피드백 루프가 시간적 누적기이므로 수 프레임에 걸쳐 가우시안과 동등하게 수렴
    float texelX = 1.0 / uResolution.x;
    vec2 blurHash = hash2(vUV * 777.0 + fract(uTimeDown * 5555.0));
    float off1 = (blurHash.x - 0.5) * 2.0 * blurRadius;
    float off2 = (blurHash.y - 0.5) * 2.0 * blurRadius;
    cDown = (texture(uPrevDown, downUV + vec2(off1 * texelX, 0.0))
           + texture(uPrevDown, downUV + vec2(off2 * texelX, 0.0))) * 0.5;
  }
  vec4 aheadDown = texture(uPrevDown, vec2(vUV.x, downUV.y + uFeedbackOffset * 4.0));
  cDown.rgb = mix(cDown.rgb, aheadDown.rgb, 0.015);
  cDown.rgb = clamp(hueRot * cDown.rgb, 0.0, 1.0);
  cDown *= darken;
  cDown.rgb += (hDown.y - 0.5) * 0.025 * cDown.a;
  cDown *= step(2.0 / 255.0, cDown.a);

  // === Up trail (-offset) ===
  vec2 hUp = hash2(vUV * 1000.0 + fract(uTimeUp * 3333.0));
  float jitterUp = (hUp.x - 0.5) / uResolution.y;
  vec2 upUV = vec2(vUV.x, vUV.y - uFeedbackOffset * slow + jitterUp);
  upUV = mix(upUV, zoomCenter, zoomAmt);

  vec4 cUp;
  if (blurRadius < 0.5) {
    cUp = texture(uPrevUp, upUV);
  } else {
    // 스토캐스틱 2-tap 블러 (up trail)
    float texelX = 1.0 / uResolution.x;
    vec2 blurHash = hash2(vUV * 777.0 + fract(uTimeUp * 5555.0));
    float off1 = (blurHash.x - 0.5) * 2.0 * blurRadius;
    float off2 = (blurHash.y - 0.5) * 2.0 * blurRadius;
    cUp = (texture(uPrevUp, upUV + vec2(off1 * texelX, 0.0))
         + texture(uPrevUp, upUV + vec2(off2 * texelX, 0.0))) * 0.5;
  }
  vec4 aheadUp = texture(uPrevUp, vec2(vUV.x, upUV.y - uFeedbackOffset * 4.0));
  cUp.rgb = mix(cUp.rgb, aheadUp.rgb, 0.015);
  cUp.rgb = clamp(hueRot * cUp.rgb, 0.0, 1.0);
  cUp *= darken;
  cUp.rgb += (hUp.y - 0.5) * 0.025 * cUp.a;
  cUp *= step(2.0 / 255.0, cUp.a);

  fragDown = cDown;
  fragUp = cUp;
}
`;

/** Tinted stamp fragment shader — 흰색 마스크에 컬러 적용 */
export const screenFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec3 uTint;
out vec4 fragColor;
void main() {
  vec4 s = texture(uTex, vUV);
  fragColor = vec4(uTint * s.rgb, s.a);
}
`;

/** Display fragment shader — 색수차 + 그레인 + 상하단 블러·비네트 + hue rotation */
export const displayFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uHueShift;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 rotateHue(vec3 c, float angle) {
  float cosA = cos(angle);
  float sinA = sin(angle);
  // Rodrigues rotation around (1,1,1)/sqrt(3) axis
  float k = (1.0 - cosA) / 3.0;
  float s = sinA * 0.57735026919; // 1/sqrt(3)
  mat3 m = mat3(
    k + cosA,     k - s,        k + s,
    k + s,        k + cosA,     k - s,
    k - s,        k + s,        k + cosA
  );
  return clamp(m * c, 0.0, 1.0);
}

void main() {
  vec2 texel = 1.0 / uResolution;

  // 전역 색수차 — 중심에서 멀수록 강하게
  vec2 center = vUV - 0.5;
  float dist = length(center);
  float caStrength = dist * 30.0; // 색수차
  vec2 caOffset = center * caStrength * texel;

  float edge = max(smoothstep(0.25, 0.0, vUV.y), smoothstep(0.22, 0.0, 1.0 - vUV.y));
  float radius = edge * 28.0;

  vec3 c;
  float a;
  if (radius < 0.5) {
    float r = texture(uTex, vUV + caOffset).r;
    vec4 gSample = texture(uTex, vUV);
    float b = texture(uTex, vUV - caOffset).b;
    c = vec3(r, gSample.g, b);
    a = gSample.a;
  } else {
    vec3 sum = vec3(0.0);
    float alphaSum = 0.0;
    float total = 0.0;
    float chromaSpread = radius * 0.5;
    for (float i = -6.0; i <= 6.0; i += 1.0) {
      float w = exp(-0.5 * i * i / (radius * radius * 0.12));
      vec2 off = vec2(0.0, i * texel.y * radius);
      float r = texture(uTex, clamp(vUV + off + caOffset + vec2(0.0, chromaSpread * texel.y), 0.0, 1.0)).r;
      vec4 gSample = texture(uTex, clamp(vUV + off, 0.0, 1.0));
      float b = texture(uTex, clamp(vUV + off - caOffset - vec2(0.0, chromaSpread * texel.y), 0.0, 1.0)).b;
      sum += vec3(r, gSample.g, b) * w;
      alphaSum += gSample.a * w;
      total += w;
    }
    c = sum / total;
    a = alphaSum / total;
  }

  // 필름 그레인
  float grain = (hash(vUV * uResolution + fract(uTime * 1000.0)) - 0.5) * 0.06;
  c += grain;

  float bottom = smoothstep(0.0, 0.3, vUV.y);
  float top = smoothstep(0.0, 0.28, 1.0 - vUV.y);
  vec3 finalColor = clamp(c * bottom * top, 0.0, 1.0);
  finalColor = rotateHue(finalColor, uHueShift);
  fragColor = vec4(finalColor, a);
}
`;
