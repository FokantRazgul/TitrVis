// Liquid fragment shader.
//
// Colour model: the bulk transmittance colour comes from the spectral pipeline (CPU) as a
// per-channel linear-RGB absorbance at the reference optical path. The ray refracted into the
// liquid is marched through the volumetric mixing field; at every step the local scalar selects
// a colour from the LUT of chemically computed excess-titrant states and its channel absorbance
// is accumulated with the step length (Beer–Lambert along the actual optical path — a documented
// rendering approximation of the spectral integral). Lighting: Fresnel-weighted reflection of a
// procedural environment, Blinn–Phong highlights from two lights, screen-space refraction of the
// background render target, and a small single-scattering term.
//
// The helpers from shaders/mixing/volume.glsl (sampleVolume, metresToVolume, sliceRadius) are
// prepended to this source by Liquid.tsx.
uniform sampler2D uBackground;     // scene without liquid/glass, screen-space
uniform sampler2D uVolume;         // volumetric mixing scalar atlas (r channel)
uniform float uVolumeTexel;        // 1 / tile resolution of the atlas
uniform float uRefRadius;          // reference radius of the volume (m)
uniform float uRadiusTop;          // free-surface radius / reference radius
uniform float uRadiusBottom;       // floor radius / reference radius
uniform sampler2D uLut;            // 8×1 linear-RGB colours: bulk, then 0.1 % … 100 % extra titrant (log-spaced)
uniform int   uMarchSteps;         // ray-march steps through the volume (quality dependent)
uniform vec3  uBulkAbsorbance;     // −log10 T per channel at the reference path (from chemistry)
uniform float uReferencePathCm;    // optical path (cm) at which the absorbance was computed
uniform float uSurfaceRadius;      // metres
uniform float uLiquidTop;          // local y of the free surface
uniform float uFloorY;             // local y of the flask floor (0)
uniform vec3  uSkyColour;          // procedural environment (linear)
uniform vec3  uHorizonColour;
uniform vec3  uGroundColour;
uniform vec3  uLight0Dir;          // world-space directions towards the lights
uniform vec3  uLight0Colour;
uniform vec3  uLight1Dir;
uniform vec3  uLight1Colour;
uniform float uScatter;            // in-scatter strength
uniform float uOpacityFloor;       // minimum visibility of the liquid body (meniscus/edges)
uniform mat4  uInverseModel;       // world → flask-local
uniform int   uIsSurface;          // 1 for the top surface mesh
uniform float uRefractionStrength;
uniform float uEnvIntensity;       // scales the procedural environment to the scene's HDR range

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec4 vClipPos;

const float IOR_WATER = 1.333;
const int MAX_MARCH_STEPS = 16;
const float LUT_ENTRIES = 8.0;
const float LOCAL_EXCESS_MIN = 1e-3;   // fraction represented by LUT entry 1 (see visualState.ts)

vec3 environment(vec3 dir) {
  float t = clamp(dir.y, -1.0, 1.0);
  vec3 up = mix(uHorizonColour, uSkyColour, smoothstep(0.0, 0.6, t));
  vec3 down = mix(uHorizonColour, uGroundColour, smoothstep(0.0, 0.5, -t));
  return t >= 0.0 ? up : down;
}

// LUT position for a fresh-titrant fraction m: linear below LOCAL_EXCESS_MIN, logarithmic above
// (mirrors mixingLutPosition in visualState.ts).
float lutPosition(float m) {
  float n = LUT_ENTRIES - 1.0;
  if (m <= 0.0) return 0.0;
  float decades = -log(LOCAL_EXCESS_MIN) / log(10.0);
  float linear = m / LOCAL_EXCESS_MIN / n;
  float logarithmic = (1.0 + (n - 1.0) * (log(max(m, LOCAL_EXCESS_MIN)) / log(10.0) + decades) / decades) / n;
  return min(1.0, m < LOCAL_EXCESS_MIN ? linear : logarithmic);
}

vec3 lutColour(float mixValue) {
  // Sample at texel centres so that mix = 0 returns the exact bulk colour.
  float u = (lutPosition(mixValue) * (LUT_ENTRIES - 1.0) + 0.5) / LUT_ENTRIES;
  return texture2D(uLut, vec2(u, 0.5)).rgb;
}

// Mixing scalar at a flask-local point (0 in the glass or outside the liquid).
float mixingAt(vec3 local) {
  vec3 p = metresToVolume(local, uRefRadius, uLiquidTop);
  vec2 d = p.xy - 0.5;
  float r = 0.49 * sliceRadius(p.z, uRadiusBottom, uRadiusTop);
  if (dot(d, d) > r * r || p.z < -0.02 || p.z > 1.02) return 0.0;
  return sampleVolume(uVolume, p, uVolumeTexel);
}

// Channel absorbance at the reference path for a local mixing value; exact CPU bulk value at 0.
vec3 absorbanceFor(float mixValue) {
  vec3 local = -log(max(lutColour(mixValue), vec3(1e-4))) / log(10.0);
  return mix(uBulkAbsorbance, local, smoothstep(0.0, 0.25 * LOCAL_EXCESS_MIN, mixValue));
}

// Distance along the refracted ray until it leaves the liquid (floor, free surface or wall).
float exitDistance(vec3 origin, vec3 dir) {
  float t = 4.0 * uRefRadius;
  if (dir.y < -1e-4) t = min(t, (uFloorY - origin.y) / dir.y);
  else if (dir.y > 1e-4) t = min(t, (uLiquidTop - origin.y) / dir.y);
  vec2 o = origin.xz;
  vec2 d = dir.xz;
  float A = dot(d, d);
  if (A > 1e-8) {
    float B = 2.0 * dot(o, d);
    float C = dot(o, o) - uRefRadius * uRefRadius;
    float disc = B * B - 4.0 * A * C;
    if (disc > 0.0) {
      float tw = (-B + sqrt(disc)) / (2.0 * A);
      if (tw > 0.0) t = min(t, tw);
    }
  }
  return max(t, 1e-4);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  float f0 = pow((IOR_WATER - 1.0) / (IOR_WATER + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

  // Refracted ray in flask-local space, marched through the volumetric mixing field.
  vec3 R = refract(-V, N, 1.0 / IOR_WATER);
  vec3 localR = normalize(mat3(uInverseModel) * R);
  vec3 origin = vLocalPos + localR * 1e-4;
  float pathM = exitDistance(origin, localR);
  float steps = float(clamp(uMarchSteps, 1, MAX_MARCH_STEPS));
  float stepCm = (pathM * 100.0) / steps;
  vec3 absorbance = vec3(0.0);
  vec3 absorbanceEntry = absorbanceFor(mixingAt(origin));
  for (int i = 0; i < MAX_MARCH_STEPS; i++) {
    if (i >= uMarchSteps) break;
    vec3 p = origin + localR * (pathM * (float(i) + 0.5) / steps);
    absorbance += absorbanceFor(mixingAt(p)) * (stepCm / max(uReferencePathCm, 0.1));
  }
  vec3 transmittance = pow(vec3(10.0), -absorbance);

  // Screen-space refraction of the background.
  vec2 screenUv = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;
  vec2 offset = R.xy * uRefractionStrength * (uIsSurface == 1 ? 0.6 : 1.0);
  vec3 background = texture2D(uBackground, clamp(screenUv + offset, 0.001, 0.999)).rgb;

  // Single scattering: absorbed light re-emerges slightly as a milky tint of the liquid colour.
  vec3 tint = pow(vec3(10.0), -absorbanceEntry);
  vec3 scatter = uScatter * (1.0 - transmittance) * tint * (0.6 + 0.4 * environment(N).g) * uEnvIntensity;

  // Specular highlights (Blinn–Phong) from the two main lights.
  vec3 H0 = normalize(uLight0Dir + V);
  vec3 H1 = normalize(uLight1Dir + V);
  vec3 specular = (uLight0Colour * pow(max(dot(N, H0), 0.0), 220.0) * 1.2 + uLight1Colour * pow(max(dot(N, H1), 0.0), 120.0) * 0.5) * uEnvIntensity;

  vec3 reflection = environment(reflect(-V, N)) * uEnvIntensity;
  // Water surfaces are read through their environment reflection; boost the (tiny) dielectric
  // Fresnel term so the free surface and the wetted wall stay legible, and darken grazing edges
  // (light lost to the glass–liquid interface), which outlines the liquid volume.
  float reflectWeight = clamp(fresnel * 2.5 + 0.06, 0.0, 1.0);
  float edgeDarkening = 1.0 - 0.35 * pow(1.0 - cosTheta, 2.0);
  vec3 colour = (1.0 - reflectWeight) * (background * transmittance * edgeDarkening + scatter) + reflectWeight * reflection + specular;
  // A faint body tint keeps the liquid readable even against a background identical to it.
  colour = mix(colour, tint * 0.92 * uEnvIntensity, uOpacityFloor * (1.0 - reflectWeight) * 0.12);
  gl_FragColor = vec4(colour, 1.0);
  // The background sample is linear HDR scene radiance: apply the renderer's tone mapping and
  // output colour space exactly as the built-in materials do.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
