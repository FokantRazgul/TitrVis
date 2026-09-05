// Divergence of the velocity field with no-slip walls (velocity zero outside the domain).
uniform sampler2D uVelocity;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;

vec2 vel(vec2 uv) {
  return texture(uVelocity, uv).xy * inDomain(uv);
}

void main() {
  float l = vel(vUv - vec2(uTexel.x, 0.0)).x;
  float r = vel(vUv + vec2(uTexel.x, 0.0)).x;
  float d = vel(vUv - vec2(0.0, uTexel.y)).y;
  float u = vel(vUv + vec2(0.0, uTexel.y)).y;
  // Central differences on the unit-square grid: dx = texel size.
  float div = 0.5 * ((r - l) / uTexel.x + (u - d) / uTexel.y);
  fragColor = vec4(div * inDomain(vUv), 0.0, 0.0, 1.0);
}
