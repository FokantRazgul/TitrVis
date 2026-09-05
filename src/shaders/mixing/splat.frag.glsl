// Inject titrant into the mixing scalar: Gaussian blobs saturating at 1.
#define MAX_SPLATS 8
uniform sampler2D uTarget;
uniform int   uSplatCount;
uniform vec2  uSplatPos[MAX_SPLATS];
uniform float uSplatRadius[MAX_SPLATS];
uniform float uSplatAmount[MAX_SPLATS];
in vec2 vUv;
out vec4 fragColor;

void main() {
  float s = texture(uTarget, vUv).x;
  for (int i = 0; i < MAX_SPLATS; i++) {
    if (i >= uSplatCount) break;
    vec2 d = vUv - uSplatPos[i];
    float w = exp(-dot(d, d) / (uSplatRadius[i] * uSplatRadius[i]));
    s += uSplatAmount[i] * w;
  }
  fragColor = vec4(clamp(s, 0.0, 1.0) * inDomain(vUv), 0.0, 0.0, 1.0);
}
