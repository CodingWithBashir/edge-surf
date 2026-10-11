/**
 * Shared GLSL chunks.
 *
 * The wave field and the sky gradient must be identical on the CPU (player
 * bobbing, hazard placement) and the GPU (water surface, reflections), so the
 * constant table lives here and `Ocean.waveHeight()` mirrors it exactly.
 */

/** Wave constants — mirrors WAVE_TABLE in Ocean.js. */
export const GLSL_WAVES = /* glsl */ `
const int WAVE_COUNT = 5;

// dir.xy (normalised), wavelength, amplitude, translation speed
const vec4 WAVE_A = vec4(0.000, 1.000, 27.0, 0.62);
const vec4 WAVE_B = vec4(0.722, 0.692, 15.0, 0.30);
const vec4 WAVE_C = vec4(-0.622, 0.783, 8.6, 0.15);
const vec4 WAVE_D = vec4(0.924, -0.382, 4.4, 0.065);
const vec4 WAVE_E = vec4(0.860, 0.510, 2.3, 0.030);

vec4 waveAt(int i) {
  if (i == 0) return WAVE_A;
  if (i == 1) return WAVE_B;
  if (i == 2) return WAVE_C;
  if (i == 3) return WAVE_D;
  return WAVE_E;
}

/**
 * Sum of directional sine waves.
 * @param pos    world XZ
 * @param travel distance the player has surfed (waves stream toward +Z)
 * @param time   seconds (only the smallest ripple uses it)
 * @returns vec3(height, dH/dx, dH/dz)
 */
vec3 waveField(vec2 pos, float travel, float time, float scale) {
  float h = 0.0;
  float dx = 0.0;
  float dz = 0.0;

  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 w = waveAt(i);
    vec2 dir = w.xy;
    float len = w.z;
    float amp = w.w * scale;
    float k = 6.28318530718 / len;
    float coord;
    if (i < 4) {
      // Sampling the static field at (z - travel * speed) streams the wave
      // toward +Z, which is exactly how water moves relative to the surfer.
      float speed = 1.0 + float(i) * 0.14;
      coord = dot(dir, vec2(pos.x, pos.y - travel * speed));
    } else {
      // Small wind ripple driven by time so the sea never looks frozen.
      coord = dot(dir, pos) + time * 2.4;
    }
    float s = sin(k * coord);
    float c = cos(k * coord);
    h += amp * s;
    dx += amp * k * dir.x * c;
    dz += amp * k * dir.y * c;
  }
  return vec3(h, dx, dz);
}
`;

/** Cheap hash noise used for foam breakup. */
export const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm21(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise21(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
`;

/** Analytic sky — reused by the sky dome and the water reflection. */
export const GLSL_SKY = /* glsl */ `
vec3 skyGradient(vec3 dir, vec3 sunDir, vec3 zenith, vec3 horizon, vec3 sunTint, float sunSize) {
  float up = clamp(dir.y, -1.0, 1.0);
  float t = pow(clamp(up, 0.0, 1.0), 0.55);
  vec3 col = mix(horizon, zenith, t);
  // Below the horizon fade to a deep water haze.
  col = mix(col, horizon * 0.55, clamp(-up * 3.0, 0.0, 1.0));

  float sun = max(dot(normalize(dir), normalize(sunDir)), 0.0);
  col += sunTint * pow(sun, 1400.0 / sunSize) * 3.2;        // disc
  col += sunTint * pow(sun, 26.0) * 0.42;                    // tight glow
  col += sunTint * pow(sun, 5.0) * 0.10;                     // wide haze
  return col;
}
`;

/** Linear fog applied manually inside custom shaders. */
export const GLSL_FOG = /* glsl */ `
vec3 applyFog(vec3 color, float dist, vec3 fogColor, float near, float far) {
  float f = clamp((dist - near) / max(far - near, 0.001), 0.0, 1.0);
  return mix(color, fogColor, f);
}
`;
