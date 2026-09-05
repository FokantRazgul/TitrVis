// 3-D semi-Lagrangian advection of the volumetric mixing scalar with relaxation towards the bulk.
//
// Velocity = depth-uniform horizontal flow from the 2-D Stable-Fluids solver (with a no-slip
// layer at the floor) + analytic vortex rings of recent drop impacts (with floor images)
// + settling of the denser titrant-rich fluid. A midpoint back-trace keeps the fast, small
// rings accurate; the scalar inside a growing ring is diluted at 3 (da/dt) / a.
#define MAX_RINGS 8
uniform sampler2D uVelocity;     // 2-D fluid velocity, surface-disc UV/s
uniform sampler2D uSource;       // volume atlas
uniform float uDt;
uniform float uDecayRate;        // relaxation towards the bulk, 1/s
uniform float uTileTexel;        // 1 / tile resolution
uniform float uRadiusTop;        // free-surface radius / reference radius
uniform float uRadiusBottom;     // floor radius / reference radius
uniform float uHeight;           // liquid height (m)
uniform float uRefRadius;        // reference radius (m)
uniform float uSettling;         // downward drift at scalar = 1 (m/s)
uniform int   uRingCount;
uniform vec3  uRingCentre[MAX_RINGS];
uniform float uRingRadius[MAX_RINGS];
uniform float uRingSpeed[MAX_RINGS];
uniform float uRingDilution[MAX_RINGS];
in vec2 vUv;
out vec4 fragColor;

// Velocity in volume coordinates per second at volume position p carrying scalar s.
vec3 volumeVelocity(vec3 p, float s, out float dilution) {
  // Horizontal: sample the 2-D solver at the matching surface-disc UV (clamped to its disc).
  vec2 d = (p.xy - 0.5) / uRadiusTop;
  float len = length(d);
  if (len > 0.485) d *= 0.485 / len;
  vec2 vf = texture(uVelocity, 0.5 + d).xy * uRadiusTop;   // surface UV/s → volume UV/s
  vf *= smoothstep(0.0, 0.12, p.z);                          // no-slip floor layer
  vec3 m = volumeToMetres(p, uRefRadius, uHeight);
  vec3 vm = vec3(0.0);
  dilution = 0.0;
  for (int i = 0; i < MAX_RINGS; i++) {
    if (i >= uRingCount) break;
    vec3 c = uRingCentre[i];
    float a = uRingRadius[i];
    vm += ringVelocity(m, c, a, uRingSpeed[i]);
    dilution += uRingDilution[i] * (1.0 - smoothstep(0.8 * a, 1.1 * a, length(m - c)));
  }
  vm.y -= uSettling * s;
  return vec3(vf.x + vm.x / (2.0 * uRefRadius), vf.y - vm.z / (2.0 * uRefRadius), vm.y / uHeight);
}

void main() {
  vec3 slice = atlasToSlice(vUv);
  vec3 p = vec3(slice.xy, sliceCentreW(slice.z));
  float inside = inVolume(slice.xy, p.z, uRadiusBottom, uRadiusTop);
  float s = texture(uSource, vUv).x;
  float dil;
  vec3 v1 = volumeVelocity(p, s, dil);
  float dilMid;
  vec3 v2 = volumeVelocity(p - 0.5 * uDt * v1, s, dilMid);
  vec3 back = p - uDt * v2;
  back.z = clamp(back.z, 0.0, 1.0);
  back.xy = clampToSlice(back.xy, back.z, uRadiusBottom, uRadiusTop);
  float q = sampleVolume(uSource, back, uTileTexel);
  float decay = exp(-(uDecayRate + dil) * uDt);
  fragColor = vec4(q * decay * inside, 0.0, 0.0, 1.0);
}
