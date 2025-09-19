#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 positions[3];
  positions[0] = vec2(-1.0, -1.0);
  positions[1] = vec2(-1.0, 3.0);
  positions[2] = vec2(3.0, -1.0);

  vec2 position = positions[gl_VertexID];
  gl_Position = vec4(position, 0.0, 1.0);
  vec2 uv = position * 0.5 + vec2(0.5);
  vUv = uv;
}

