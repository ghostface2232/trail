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

/** Feedback fragment shader — y오프셋만, x 불변 */
export const feedbackFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uPrevFrame;
uniform float uFeedbackOffset;
out vec4 fragColor;
void main() {
  fragColor = texture(uPrevFrame, vec2(vUV.x, vUV.y + uFeedbackOffset));
}
`;

/** Passthrough fragment shader — FBO 내부 합성용 */
export const screenFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  fragColor = texture(uTex, vUV);
}
`;

/** Display fragment shader — 상하단 비네트 */
export const displayFragmentSource = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float bottom = smoothstep(0.0, 0.25, vUV.y);
  float top = smoothstep(0.0, 0.15, 1.0 - vUV.y);
  fragColor = vec4(c * bottom * top, 1.0);
}
`;
