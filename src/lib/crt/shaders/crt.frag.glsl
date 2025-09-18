#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec2 uInvResolution;
uniform float uTime;
uniform float uScanlineIntensity;
uniform float uSlotMaskIntensity;
uniform float uVignetteStrength;
uniform float uBloomIntensity;
uniform float uAberrationStrength;
uniform float uNoiseIntensity;
uniform float uDevicePixelRatio;
uniform float uBloomThreshold;
uniform float uBloomSoftness;

in vec2 vUv;
out vec4 fragColor;

vec2 clampUv(vec2 value) {
  return clamp(value, vec2(0.0), vec2(1.0));
}

void main() {
  vec2 uv = vUv;
  vec3 color = texture(uScene, clampUv(uv)).rgb;

  if (uAberrationStrength > 0.0001) {
    vec2 center = uv - vec2(0.5);
    vec2 offset = center * uAberrationStrength * 1.35;
    float redSample = texture(uScene, clampUv(uv + offset)).r;
    float blueSample = texture(uScene, clampUv(uv - offset)).b;
    color.r = mix(color.r, redSample, min(0.85, uAberrationStrength * 0.85));
    color.b = mix(color.b, blueSample, min(0.85, uAberrationStrength * 0.85));
  }

  if (uScanlineIntensity > 0.0001) {
    float line = sin((uv.y * uResolution.y) / uDevicePixelRatio * 3.14159265);
    float mask = mix(1.0, 0.55 + 0.45 * line * line, uScanlineIntensity);
    color *= mask;
  }

  if (uSlotMaskIntensity > 0.0001) {
    int triad = int(floor((uv.x * uResolution.x) / uDevicePixelRatio)) % 3;
    vec3 slotMask = vec3(0.35);
    if (triad == 0) {
      slotMask.r = 1.0;
    } else if (triad == 1) {
      slotMask.g = 1.0;
    } else {
      slotMask.b = 1.0;
    }
    color *= mix(vec3(1.0), slotMask, uSlotMaskIntensity);
  }

  if (uBloomIntensity > 0.0001) {
    vec3 accum = vec3(0.0);
    vec2 taps[5];
    taps[0] = vec2(0.0);
    taps[1] = vec2(uInvResolution.x * 2.0, 0.0);
    taps[2] = vec2(-uInvResolution.x * 2.0, 0.0);
    taps[3] = vec2(0.0, uInvResolution.y * 2.0);
    taps[4] = vec2(0.0, -uInvResolution.y * 2.0);

    for (int i = 0; i < 5; i++) {
      vec2 sampleUv = clampUv(uv + taps[i]);
      accum += texture(uScene, sampleUv).rgb;
    }
    accum /= 5.0;
    float luminance = dot(accum, vec3(0.2126, 0.7152, 0.0722));
    float weight = smoothstep(uBloomThreshold, 1.0, luminance);
    color = mix(color, accum, weight * uBloomIntensity * uBloomSoftness);
  }

  if (uVignetteStrength > 0.0001) {
    float dist = distance(uv, vec2(0.5));
    float vig = smoothstep(0.75, 0.45, dist);
    color *= mix(1.0, vig, uVignetteStrength);
  }

  if (uNoiseIntensity > 0.0001) {
    float noise = fract(sin(dot(uv * uResolution, vec2(12.9898, 78.233)) + uTime * 12.345) * 43758.5453);
    float grain = (noise - 0.5) * uNoiseIntensity;
    color += vec3(grain);
  }

  color = clamp(color, 0.0, 1.0);
  fragColor = vec4(color, 1.0);
}

