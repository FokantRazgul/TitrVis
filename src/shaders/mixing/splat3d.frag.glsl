// Inject titrant into the volume: the drop fluid fills the initial vortex sphere (soft edge).
#define MAX_SPLATS 8
uniform sampler2D uTarget;
uniform int   uSplatCount;
uniform vec3  uSplatPos[MAX_SPLATS];      // flask-local metres
uniform float uSplatRadius[MAX_SPLATS];   // metres
uniform float uSplatAmount[MAX_SPLATS];
uniform float uHeight;
uniform float uRefRadius;
uniform float uRadiusTop;
uniform float uRadiusBottom;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec3 slice = atlasToSlice(vUv);
  vec3 p = vec3(slice.xy, sliceCentreW(slice.z));
  float inside = inVolume(slice.xy, p.z, uRadiusBottom, uRadiusTop);
  vec3 m = volumeToMetres(p, uRefRadius, uHeight);
  float s = texture(uTarget, vUv).x;
  for (int i = 0; i < MAX_SPLATS; i++) {
    if (i >= uSplatCount) break;
    float a = uSplatRadius[i];
    s += uSplatAmount[i] * (1.0 - smoothstep(0.7 * a, 1.05 * a, length(m - uSplatPos[i])));
  }
  fragColor = vec4(clamp(s, 0.0, 1.0) * inside, 0.0, 0.0, 1.0);
}
