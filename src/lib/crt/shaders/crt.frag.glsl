#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec4 uResolution; // width, height, invWidth, invHeight
uniform vec4 uTiming; // time, scanline, slotMask, vignette
uniform vec4 uEffects; // bloom, aberration, noise, dpr
uniform vec4 uBloomParams; // threshold, softness, k1, k2
uniform vec4 uCssMetrics; // cssWidth, cssHeight, invCssWidth, invCssHeight
uniform vec4 uCursorState; // x, y, visible, buttons
uniform vec4 uCursorMeta; // type, bloomAttenuation, reserved

in vec2 vUv;
out vec4 fragColor;

vec2 clampUv(vec2 value) {
  return clamp(value, vec2(0.0), vec2(1.0));
}

vec2 clampCss(vec2 value, vec2 size) {
  return vec2(clamp(value.x, 0.0, size.x), clamp(value.y, 0.0, size.y));
}

vec2 cssToSceneUv(vec2 css, float dpr, vec2 invResolution) {
  return vec2(css.x * dpr * invResolution.x, css.y * dpr * invResolution.y);
}

vec2 warpSampleUv(vec2 uv, float aspect, float k1, float k2) {
  vec2 p = uv * 2.0 - vec2(1.0);
  p.x *= aspect;
  float r2 = dot(p, p);
  float scale = 1.0 + k1 * r2 + k2 * r2 * r2;
  p *= scale;
  p.x /= aspect;
  return p * 0.5 + vec2(0.5);
}

float vignetteMask(vec2 css, vec2 invCss) {
  vec2 normalized = css * invCss - vec2(0.5);
  float distance = length(normalized);
  return smoothstep(0.85, 0.55, distance);
}

float cursorRadius(float cursorType) {
  if (cursorType > 1.5) {
    return 16.0;
  }
  if (cursorType > 0.5) {
    return 22.0;
  }
  return 12.0;
}

void main() {
  vec2 uv = clampUv(vUv);
  vec2 resolution = uResolution.xy;
  vec2 invResolution = uResolution.zw;
  float time = uTiming.x;
  float scanlineIntensity = uTiming.y;
  float slotMaskIntensity = uTiming.z;
  float vignetteStrength = uTiming.w;
  float baseBloomIntensity = uEffects.x;
  float aberrationStrength = uEffects.y;
  float noiseIntensity = uEffects.z;
  float devicePixelRatio = uEffects.w;
  float bloomThreshold = uBloomParams.x;
  float bloomSoftness = uBloomParams.y;
  float k1 = uBloomParams.z;
  float k2 = uBloomParams.w;
  vec2 cssSize = uCssMetrics.xy;
  vec2 invCss = uCssMetrics.zw;
  vec4 cursor = uCursorState;
  vec4 cursorMeta = uCursorMeta;

  float bloomIntensity = baseBloomIntensity * cursorMeta.y;

  float aspect = uResolution.y > 0.0 ? uResolution.x / uResolution.y : 1.0;
  vec2 warpedUv = warpSampleUv(uv, aspect, k1, k2);
  bool outside = warpedUv.x < 0.0 || warpedUv.x > 1.0 || warpedUv.y < 0.0 || warpedUv.y > 1.0;
  vec2 clampedWarp = clampUv(warpedUv);
  vec2 cssCoord = clampCss(clampedWarp * cssSize, cssSize);
  vec2 sceneUv = clampUv(cssToSceneUv(cssCoord, devicePixelRatio, invResolution));
  vec3 color = texture(uScene, sceneUv).rgb;

  if (aberrationStrength > 0.0001) {
    vec2 center = cssCoord - cssSize * 0.5;
    float magnitude = max(length(center), 0.001);
    vec2 direction = center / magnitude;
    float offsetAmount = aberrationStrength * 6.0;
    vec2 redCss = clampCss(cssCoord + direction * offsetAmount, cssSize);
    vec2 blueCss = clampCss(cssCoord - direction * offsetAmount, cssSize);
    vec2 redUv = clampUv(cssToSceneUv(redCss, devicePixelRatio, invResolution));
    vec2 blueUv = clampUv(cssToSceneUv(blueCss, devicePixelRatio, invResolution));
    float redSample = texture(uScene, redUv).r;
    float blueSample = texture(uScene, blueUv).b;
    color.r = mix(color.r, redSample, min(0.85, aberrationStrength * 0.85));
    color.b = mix(color.b, blueSample, min(0.85, aberrationStrength * 0.85));
  }

  if (scanlineIntensity > 0.0001) {
    float line = sin(cssCoord.y * devicePixelRatio * 3.14159265);
    float mask = mix(1.0, 0.55 + 0.45 * line * line, scanlineIntensity);
    color *= mask;
  }

  if (slotMaskIntensity > 0.0001) {
    int triad = int(floor(cssCoord.x * devicePixelRatio)) % 3;
    vec3 slotMask = vec3(0.35);
    if (triad == 0) {
      slotMask.r = 1.0;
    } else if (triad == 1) {
      slotMask.g = 1.0;
    } else {
      slotMask.b = 1.0;
    }
    color *= mix(vec3(1.0), slotMask, slotMaskIntensity);
  }

  if (bloomIntensity > 0.0001) {
    vec3 accum = vec3(0.0);
    vec2 taps[5];
    taps[0] = vec2(0.0);
    taps[1] = vec2(invResolution.x * 2.0, 0.0);
    taps[2] = vec2(-invResolution.x * 2.0, 0.0);
    taps[3] = vec2(0.0, invResolution.y * 2.0);
    taps[4] = vec2(0.0, -invResolution.y * 2.0);
    for (int i = 0; i < 5; i++) {
      vec2 sampleUv = clampUv(sceneUv + taps[i]);
      accum += texture(uScene, sampleUv).rgb;
    }
    accum /= 5.0;
    float luminance = dot(accum, vec3(0.2126, 0.7152, 0.0722));
    float weight = smoothstep(bloomThreshold, 1.0, luminance);
    color = mix(color, accum, weight * bloomIntensity * bloomSoftness);
  }

  float vignetteWeight = outside ? 1.0 : vignetteStrength;
  if (vignetteWeight > 0.0001) {
    float vig = vignetteMask(cssCoord, invCss);
    color *= mix(1.0, vig, clamp(vignetteWeight, 0.0, 1.0));
  }

  if (noiseIntensity > 0.0001) {
    float noise = fract(sin(dot(cssCoord, vec2(12.9898, 78.233)) + time * 12.345) * 43758.5453);
    float grain = (noise - 0.5) * noiseIntensity;
    color += vec3(grain);
  }

  if (cursor.z > 0.5) {
    vec2 cursorUv = clampUv(cssToSceneUv(cursor.xy, devicePixelRatio, invResolution));
    vec2 diff = vec2((uv.x - cursorUv.x) * resolution.x, (uv.y - cursorUv.y) * resolution.y);
    float radius = cursorRadius(cursorMeta.x) * devicePixelRatio;
    float dist = length(diff);
    float ring = smoothstep(radius + 1.5, radius - 1.5, dist);
    float fill = smoothstep(radius * 0.4, radius * 0.1, dist);
    float alpha = max(ring, fill * 0.4);
    float pressed = step(0.5, cursor.w);
    vec3 tint = mix(vec3(1.0), vec3(0.85, 1.0, 0.85), pressed);
    color = mix(color, tint, alpha);
  }

  color = clamp(color, 0.0, 1.0);
  fragColor = vec4(color, 1.0);
}
