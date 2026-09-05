// Shared helpers for the fluid passes. Injected at the top of each fragment shader.
precision highp float;
precision highp sampler2D;

// Radius (in UV units) of the circular liquid domain centred at (0.5, 0.5).
const float DOMAIN_RADIUS = 0.49;

// 1.0 inside the liquid disc, 0.0 outside (solid wall).
float inDomain(vec2 uv) {
  vec2 d = uv - 0.5;
  return step(dot(d, d), DOMAIN_RADIUS * DOMAIN_RADIUS);
}
