// Liquid vertex shader (ShaderMaterial, GLSL ES 3.00 via Three.js prefix).
// Vertex positions and normals are in flask-local space; the surface mesh gets its normals
// from the CPU wave simulation, the side wall from the lathe geometry.
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec4 vClipPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vLocalPos = position;
  vClipPos = projectionMatrix * viewMatrix * worldPos;
  gl_Position = vClipPos;
}
