// Liquid fragment shader.
//
// Colour model: the bulk transmittance colour comes from the spectral pipeline (CPU) as a
// per-channel linear-RGB absorbance at the reference optical path. The local mixing scalar
// selects a colour from the LUT of chemically computed excess-titrant states; the shader
// then applies Beer–Lambert scaling of that channel absorbance with the estimated optical
// path through the liquid (a documented rendering approximation of the spectral integral).
// Lighting: Fresnel-weighted reflection of a procedural environment, Blinn–Phong highlights
// from two lights, screen-space refraction of the background render target, and a small
// single-scattering term.
uniform sampler2D uBackground;     // scene without liquid/glass, screen-space
uniform sampler2D uMixing;         // GPU mixing scalar (r channel), UV over the surface disc
uniform sampler2D uLut;            // 8×1 linear-RGB colours: bulk → excess titrant
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

vec3 environment(vec3 dir) {
  float t = clamp(dir.y, -1.0, 1.0);
  vec3 up = mix(uHorizonColour, uSkyColour, smoothstep(0.0, 0.6, t));
  vec3 down = mix(uHorizonColour, uGroundColour, smoothstep(0.0, 0.5, -t));
  return t >= 0.0 ? up : down;
}

vec3 lutColour(float mixValue) {
  // 8 texels; sample at texel centres so that mix = 0 returns the exact bulk colour.
  float u = (clamp(mixValue, 0.0, 1.0) * 7.0 + 0.5) / 8.0;
  return texture2D(uLut, vec2(u, 0.5)).rgb;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  float f0 = pow((IOR_WATER - 1.0) / (IOR_WATER + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

  // Local mixing: sample the scalar at the (x, z) column of this fragment.
  vec2 disc = vLocalPos.xz / (2.0 * uSurfaceRadius);
  vec2 mixUv = vec2(0.5 + disc.x, 0.5 - disc.y);
  float mixValue = texture2D(uMixing, mixUv).r;
  vec3 localColour = lutColour(mixValue);
  // Channel absorbance of the local state at the reference path.
  vec3 absorbanceRef = -log(max(localColour, vec3(1e-4))) / log(10.0);
  // Bulk absorbance is what the LUT's first texel encodes; keep the exact CPU value for mix = 0.
  absorbanceRef = mix(uBulkAbsorbance, absorbanceRef, smoothstep(0.0, 0.05, mixValue));

  // Estimate the optical path through the liquid along the refracted ray (cm).
  vec3 R = refract(-V, N, 1.0 / IOR_WATER);
  vec3 localR = normalize(mat3(uInverseModel) * R);
  float depth = max(uLiquidTop - uFloorY, 1e-4);
  float pathM;
  if (uIsSurface == 1) {
    // Ray from the surface down to the floor (or across to the wall).
    float toFloor = localR.y < -1e-3 ? depth / (-localR.y) : 4.0 * uSurfaceRadius;
    pathM = min(toFloor, 2.0 * uSurfaceRadius / max(length(localR.xz), 0.2));
  } else {
    // Side wall: chord across the body, shortened at grazing angles.
    pathM = 2.0 * uSurfaceRadius * max(cosTheta, 0.15);
  }
  float pathCm = pathM * 100.0;
  vec3 absorbance = absorbanceRef * (pathCm / max(uReferencePathCm, 0.1));
  vec3 transmittance = pow(vec3(10.0), -absorbance);

  // Screen-space refraction of the background.
  vec2 screenUv = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;
  vec2 offset = R.xy * uRefractionStrength * (uIsSurface == 1 ? 0.6 : 1.0);
  vec3 background = texture2D(uBackground, clamp(screenUv + offset, 0.001, 0.999)).rgb;

  // Single scattering: absorbed light re-emerges slightly as a milky tint of the liquid colour.
  vec3 tint = pow(vec3(10.0), -absorbanceRef);
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
