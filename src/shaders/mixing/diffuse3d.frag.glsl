// One Jacobi iteration of implicit 3-D diffusion on the slice atlas:
//   x = (x_old + αh (xL + xR + xF + xB) + αv (xDown + xUp)) / (1 + 4αh + 2αv)
// with Neumann conditions at the wall, the floor and the free surface.
uniform sampler2D uField;      // current iterate
uniform sampler2D uSource;     // x_old
uniform float uAlphaH;         // D dt / dx²
uniform float uAlphaV;         // D dt / dz²
uniform float uTileTexel;
uniform float uRadiusTop;
uniform float uRadiusBottom;
in vec2 vUv;
out vec4 fragColor;

float neighbour(vec2 tileUv, float k, float w, float centre) {
  bool inTile = all(greaterThanEqual(tileUv, vec2(0.0))) && all(lessThanEqual(tileUv, vec2(1.0)));
  if (!inTile || inVolume(tileUv, w, uRadiusBottom, uRadiusTop) < 0.5) return centre;
  return texture(uField, sliceToAtlas(tileUv, k, uTileTexel)).x;
}

void main() {
  vec3 slice = atlasToSlice(vUv);
  float k = slice.z;
  float w = sliceCentreW(k);
  float inside = inVolume(slice.xy, w, uRadiusBottom, uRadiusTop);
  float c = texture(uField, vUv).x;
  float l = neighbour(slice.xy - vec2(uTileTexel, 0.0), k, w, c);
  float r = neighbour(slice.xy + vec2(uTileTexel, 0.0), k, w, c);
  float f = neighbour(slice.xy - vec2(0.0, uTileTexel), k, w, c);
  float b = neighbour(slice.xy + vec2(0.0, uTileTexel), k, w, c);
  float dn = k > 0.5 ? texture(uField, sliceToAtlas(slice.xy, k - 1.0, uTileTexel)).x : c;
  float up = k < float(VOL_SLICES) - 1.5 ? texture(uField, sliceToAtlas(slice.xy, k + 1.0, uTileTexel)).x : c;
  float src = texture(uSource, vUv).x;
  float x = (src + uAlphaH * (l + r + f + b) + uAlphaV * (dn + up)) / (1.0 + 4.0 * uAlphaH + 2.0 * uAlphaV);
  fragColor = vec4(x * inside, 0.0, 0.0, 1.0);
}
