// Projection: subtract the pressure gradient so that the velocity field becomes divergence-free.
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
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
  vec2 grad = 0.5 * vec2((r - l) / uTexel.x, (u - d) / uTexel.y);
  vec2 v = texture(uVelocity, vUv).xy - grad;
  fragColor = vec4(v * inDomain(vUv), 0.0, 1.0);
}
