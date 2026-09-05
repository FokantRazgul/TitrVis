// One Jacobi iteration of the pressure Poisson equation ∇²p = div, Neumann walls.
//   p = (pL + pR + pU + pD − dx² div) / 4
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;

float pAt(vec2 uv, float centre) {
  return inDomain(uv) > 0.5 ? texture(uPressure, uv).x : centre;
}

void main() {
  float c = texture(uPressure, vUv).x;
  float l = pAt(vUv - vec2(uTexel.x, 0.0), c);
  float r = pAt(vUv + vec2(uTexel.x, 0.0), c);
  float d = pAt(vUv - vec2(0.0, uTexel.y), c);
  float u = pAt(vUv + vec2(0.0, uTexel.y), c);
  float div = texture(uDivergence, vUv).x;
  float dx2 = uTexel.x * uTexel.x;
  fragColor = vec4(0.25 * (l + r + d + u - dx2 * div) * inDomain(vUv), 0.0, 0.0, 1.0);
}
