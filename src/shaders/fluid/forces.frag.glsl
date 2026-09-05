// External forces: stirring drive (relaxation towards rigid rotation, plus the orbital
// sloshing acceleration of the flask) and up to MAX_SPLATS radial impulses from drop impacts.
#define MAX_SPLATS 8
uniform sampler2D uVelocity;
uniform float uDt;
uniform float uStirDrive;      // 0..1
uniform float uStirOmega;      // target angular speed, rad/s
uniform float uStirGain;       // 1/s relaxation gain towards rigid rotation
uniform vec2  uSloshAccel;     // orbital acceleration direction × magnitude (UV/s²)
uniform int   uSplatCount;
uniform vec2  uSplatPos[MAX_SPLATS];
uniform float uSplatRadius[MAX_SPLATS];
uniform float uSplatStrength[MAX_SPLATS];
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  vec2 r = vUv - 0.5;
  // Rigid rotation target: v_t = ω × r (counter-clockwise), in UV units per second.
  vec2 vTarget = uStirOmega * vec2(-r.y, r.x);
  float gain = uStirGain * uStirDrive;
  v += (vTarget - v) * (1.0 - exp(-gain * uDt));
  // Sloshing: the flask's orbital acceleration pushes the liquid opposite to the acceleration.
  v += uSloshAccel * uStirDrive * uDt;
  for (int i = 0; i < MAX_SPLATS; i++) {
    if (i >= uSplatCount) break;
    vec2 d = vUv - uSplatPos[i];
    float dist = length(d);
    float w = exp(-(dist * dist) / (uSplatRadius[i] * uSplatRadius[i]));
    vec2 dir = dist > 1e-5 ? d / dist : vec2(0.0);
    v += dir * uSplatStrength[i] * w;
  }
  fragColor = vec4(v * inDomain(vUv), 0.0, 1.0);
}
