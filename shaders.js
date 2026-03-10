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

/** Feedback fragment shader — y오프셋, 상하단 감속, hue drift, grain */
export const feedbackFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uPrevFrame;
uniform float uFeedbackOffset;
uniform float uTime;
uniform vec2 uResolution;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // 중앙(0.5)=풀스피드, 상하단(0/1)=거의 정지
  float distFromCenter = abs(vUV.y - 0.5) * 2.0;
  float slow = 1.0 - distFromCenter * distFromCenter;
  vec2 offsetUV = vec2(vUV.x, vUV.y + uFeedbackOffset * slow);

  // 상하단 접근 시 서서히 확대 (60% 이상 구간부터 ease)
  float edgeDist = max(smoothstep(0.3, 0.0, vUV.y), smoothstep(0.3, 0.0, 1.0 - vUV.y));
  float zoomAmt = edgeDist * edgeDist * 0.005;
  vec2 zoomCenter = vec2(0.5, vUV.y > 0.5 ? 1.0 : 0.0);
  offsetUV = mix(offsetUV, zoomCenter, zoomAmt);

  // 상하단 접근 시 수평 블러로 퍼짐
  float edgeBlur = max(smoothstep(0.3, 0.0, vUV.y), smoothstep(0.27, 0.0, 1.0 - vUV.y));
  float blurRadius = edgeBlur * 6.0;
  vec4 c;
  if (blurRadius < 0.5) {
    c = texture(uPrevFrame, offsetUV);
  } else {
    float texelX = 1.0 / uResolution.x;
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (float i = -4.0; i <= 4.0; i += 1.0) {
      float w = exp(-0.5 * i * i / (blurRadius * blurRadius * 0.2));
      sum += texture(uPrevFrame, offsetUV + vec2(i * texelX * blurRadius, 0.0)) * w;
      total += w;
    }
    c = sum / total;
  }

  // 앞쪽(흐름 방향) 컬러를 살짝 따라가려는 shift
  vec4 ahead = texture(uPrevFrame, vec2(vUV.x, offsetUV.y + uFeedbackOffset * 4.0));
  c.rgb = mix(c.rgb, ahead.rgb, 0.015);

  // 미세한 hue rotation (프리컴파일된 상수 행렬, angle=0.005)
  const mat3 hueRot = mat3(
    0.99958, 0.00186, -0.00103,
   -0.00103, 0.99958,  0.00186,
    0.00186, -0.00103, 0.99958
  );
  c.rgb = clamp(hueRot * c.rgb, 0.0, 1.0);

  // 아래로 갈수록 미세하게 어두워짐
  float darken = 1.0 - (1.0 - vUV.y) * 0.003;
  c.rgb *= darken;

  // 매 서브스텝마다 다른 그레인
  float grain = (hash(vUV * 1000.0 + fract(uTime * 7777.0)) - 0.5) * 0.025;
  c.rgb += grain * c.a;

  fragColor = c;
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
  float caStrength = dist * 25.0; // 색수차
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
