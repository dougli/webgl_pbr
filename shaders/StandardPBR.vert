#version 300 es

varying vec2 vUV;
varying mat3 vTBN;
varying vec3 vViewPosition;

attribute vec3 tangent;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  vUV = uv;

  vec3 N = normalize(normalMatrix * normal);
  vec3 T = normalize(normalMatrix * tangent);
  vec3 B = cross(N, T);
  vTBN = mat3(T, B, N);

  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
