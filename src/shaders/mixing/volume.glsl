// Volumetric mixing field helpers, shared by the mixing passes and the liquid shader.
//
// The liquid volume is discretised into VOL_SLICES horizontal slices (w = 0 floor … 1 free
// surface), each a square tile of one 2-D atlas texture laid out VOL_TILES_X × VOL_TILES_Y.
// Horizontal volume coordinates (u, v) span 2 × the reference (largest) liquid radius:
//   x = (u − 0.5) · 2R_ref,   z = −(v − 0.5) · 2R_ref,   y = w · h.
const int   VOL_SLICES  = 12;
const float VOL_TILES_X = 4.0;
const float VOL_TILES_Y = 3.0;

// Atlas UV → (tile UV, slice index).
vec3 atlasToSlice(vec2 atlasUv) {
  vec2 scaled = atlasUv * vec2(VOL_TILES_X, VOL_TILES_Y);
  vec2 cell = floor(scaled);
  return vec3(scaled - cell, cell.y * VOL_TILES_X + cell.x);
}

// (tile UV, slice) → atlas UV. The tile UV is inset by half a texel so that bilinear
// filtering never reads across a tile border.
vec2 sliceToAtlas(vec2 tileUv, float k, float tileTexel) {
  float col = mod(k, VOL_TILES_X);
  float row = floor(k / VOL_TILES_X);
  vec2 inset = clamp(tileUv, vec2(0.5 * tileTexel), vec2(1.0 - 0.5 * tileTexel));
  return (vec2(col, row) + inset) / vec2(VOL_TILES_X, VOL_TILES_Y);
}

float sliceCentreW(float k) {
  return (k + 0.5) / float(VOL_SLICES);
}

// Trilinear sample of the scalar at volume coordinates p = (u, v, w).
float sampleVolume(sampler2D atlas, vec3 p, float tileTexel) {
  float kf = clamp(p.z, 0.0, 1.0) * float(VOL_SLICES) - 0.5;
  float k0 = clamp(floor(kf), 0.0, float(VOL_SLICES) - 1.0);
  float k1 = min(k0 + 1.0, float(VOL_SLICES) - 1.0);
  float f = clamp(kf - k0, 0.0, 1.0);
  float s0 = texture(atlas, sliceToAtlas(p.xy, k0, tileTexel)).x;
  float s1 = texture(atlas, sliceToAtlas(p.xy, k1, tileTexel)).x;
  return mix(s0, s1, f);
}

// Liquid cross-section radius at depth w, normalised by the reference radius (linear cone
// between the floor radius and the free-surface radius).
float sliceRadius(float w, float radiusBottom, float radiusTop) {
  return mix(radiusBottom, radiusTop, clamp(w, 0.0, 1.0));
}

// 1.0 inside the liquid at this slice, 0.0 in the glass wall.
float inVolume(vec2 tileUv, float w, float radiusBottom, float radiusTop) {
  vec2 d = tileUv - 0.5;
  float r = 0.49 * sliceRadius(w, radiusBottom, radiusTop);
  return step(dot(d, d), r * r);
}

// Clamp a horizontal position onto the liquid disc of its slice (Neumann wall for back-traces).
vec2 clampToSlice(vec2 tileUv, float w, float radiusBottom, float radiusTop) {
  vec2 d = tileUv - 0.5;
  float r = 0.49 * sliceRadius(w, radiusBottom, radiusTop);
  float len = length(d);
  return len > r ? 0.5 + d * (r / len) : tileUv;
}

// Volume coordinates → flask-local metres.
vec3 volumeToMetres(vec3 p, float refRadius, float height) {
  return vec3((p.x - 0.5) * 2.0 * refRadius, p.z * height, -(p.y - 0.5) * 2.0 * refRadius);
}

// Flask-local metres → volume coordinates.
vec3 metresToVolume(vec3 m, float refRadius, float height) {
  return vec3(0.5 + m.x / (2.0 * refRadius), 0.5 - m.z / (2.0 * refRadius), m.y / max(height, 1e-5));
}

// Lab-frame velocity (m/s) of a Hill spherical vortex of radius a translating along y in
// direction dir (−1 downward, +1 upward) at speed U, centred at c. See vortexRing.ts.
vec3 hillVelocity(vec3 p, vec3 c, float a, float U, float dir) {
  vec3 d = p - c;
  float zeta = dir * d.y;
  vec2 rho = d.xz;
  float rho2 = dot(rho, rho);
  float R2 = rho2 + zeta * zeta;
  float a2 = a * a;
  if (R2 > 16.0 * a2) return vec3(0.0);
  float uZeta;
  float uRhoOverRho;
  if (R2 < a2) {
    float k = 1.5 * U / a2;
    uZeta = k * (a2 - 2.0 * rho2 - zeta * zeta) + U;
    uRhoOverRho = k * zeta;
  } else {
    float R = sqrt(R2);
    float R3 = R2 * R;
    float R5 = R3 * R2;
    float ka = 0.5 * U * a2 * a;
    uZeta = -ka * (1.0 / R3 - 3.0 * zeta * zeta / R5);
    uRhoOverRho = 3.0 * ka * zeta / R5;
  }
  return vec3(uRhoOverRho * rho.x, dir * uZeta, uRhoOverRho * rho.y);
}

// Ring plus its image in the floor plane y = 0: no flow through the floor, doubled spreading.
vec3 ringVelocity(vec3 p, vec3 c, float a, float U) {
  return hillVelocity(p, c, a, U, -1.0) + hillVelocity(p, vec3(c.x, -c.y, c.z), a, U, 1.0);
}
