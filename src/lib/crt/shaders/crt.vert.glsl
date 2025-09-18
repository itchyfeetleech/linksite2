#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 positions[3];
  positions[0] = vec2(-1.0, -1.0);
  positions[1] = vec2(-1.0, 3.0);
  positions[2] = vec2(3.0, -1.0);

  vec2 uvs[3];
  uvs[0] = vec2(0.0, 0.0);
  uvs[1] = vec2(0.0, 2.0);
  uvs[2] = vec2(2.0, 0.0);

  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
  vUv = uvs[gl_VertexID];
}

