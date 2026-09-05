// Semi-Lagrangian advection of an arbitrary field by the velocity field, with
// frame-rate independent exponential decay:  q(x, t+dt) = q(x − v dt, t) · exp(−k dt)
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform float uDecayRate;   // k, 1/s
uniform vec2 uTexel;        // 1 / resolution
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  vec2 back = vUv - uDt * v;
  vec4 q = texture(uSource, back);
  float decay = exp(-uDecayRate * uDt);
  fragColor = q * decay * inDomain(vUv);
}
