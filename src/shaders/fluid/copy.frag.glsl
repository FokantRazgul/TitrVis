// Copy / resample a texture (used when the simulation resolution changes).
uniform sampler2D uSource;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = texture(uSource, vUv);
}
