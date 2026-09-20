#version 300 es

// A single oversized triangle rather than a quad: no vertex buffer, no shared
// edge down the middle of the screen, and the GPU clips it to the viewport.
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
