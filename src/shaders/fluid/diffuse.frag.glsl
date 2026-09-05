// One Jacobi iteration of implicit diffusion: (I − ν dt ∇²) x_new = x_old
//   x = (x_old + a (xL + xR + xU + xD)) / (1 + 4a),  a = ν dt / dx²
uniform sampler2D uField;      // current iterate
uniform sampler2D uSource;     // x_old
uniform float uAlpha;          // a
uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;

vec4 sampleNeighbour(vec2 uv, vec4 centre) {
  return inDomain(uv) > 0.5 ? texture(uField, uv) : centre;
}

void main() {
  vec4 c = texture(uField, vUv);
  vec4 l = sampleNeighbour(vUv - vec2(uTexel.x, 0.0), c);
  vec4 r = sampleNeighbour(vUv + vec2(uTexel.x, 0.0), c);
  vec4 d = sampleNeighbour(vUv - vec2(0.0, uTexel.y), c);
  vec4 u = sampleNeighbour(vUv + vec2(0.0, uTexel.y), c);
  vec4 src = texture(uSource, vUv);
  fragColor = ((src + uAlpha * (l + r + d + u)) / (1.0 + 4.0 * uAlpha)) * inDomain(vUv);
}
