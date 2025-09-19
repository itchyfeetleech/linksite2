#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec2 uInvResolution;
uniform float uTime;
uniform float uScanlineIntensity;
uniform float uSlotMaskIntensity;
uniform float uVignetteStrength;
uniform float uBaseBloomIntensity;
uniform float uAberrationStrength;
uniform float uNoiseIntensity;
uniform float uDevicePixelRatio;
uniform float uBloomThreshold;
uniform float uBloomSoftness;
uniform float uK1;
uniform float uK2;
uniform vec2 uCssSize;
uniform vec2 uInvCssSize;
uniform vec4 uCursorState;
uniform vec4 uCursorMeta;

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

float safeAspect(vec2 res) {
  float aspect = 1.0;
  if (res.y > 0.0) {
    aspect = res.x / res.y;
  }
  return aspect;
}

vec2 undistort(vec2 p, float k1, float k2) {
  vec2 u = p;
  for (int i = 0; i < 3; i++) {
    float r2 = dot(u, u);
    float f = max(1.0 + k1 * r2 + k2 * r2 * r2, 1e-3);
    u = p / f;
  }
  return u;
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
  vec2 uvDisplay = clampUv(vUv);
  float aspect = safeAspect(uResolution);
  vec2 p = uvDisplay * 2.0 - vec2(1.0);
  p.x *= aspect;
  vec2 u = undistort(p, uK1, uK2);
  u.x /= aspect;
  vec2 uvSample = u * 0.5 + vec2(0.5);
  bool outside = any(lessThan(uvSample, vec2(0.0))) || any(greaterThan(uvSample, vec2(1.0)));
  vec2 clampedSample = clampUv(uvSample);
  vec2 cssCoord = clampCss(clampedSample * uCssSize, uCssSize);
  vec2 sceneUv = clampUv(cssToSceneUv(cssCoord, uDevicePixelRatio, uInvResolution));
  vec3 color = outside ? vec3(0.0) : texture(uScene, sceneUv).rgb;

  float bloomIntensity = uBaseBloomIntensity * uCursorMeta.y;

  if (uAberrationStrength > 0.0001) {
    vec2 center = cssCoord - uCssSize * 0.5;
    float magnitude = max(length(center), 0.001);
    vec2 direction = center / magnitude;
    float offsetAmount = uAberrationStrength * 6.0;
    vec2 redCss = clampCss(cssCoord + direction * offsetAmount, uCssSize);
    vec2 blueCss = clampCss(cssCoord - direction * offsetAmount, uCssSize);
    vec2 redUv = clampUv(cssToSceneUv(redCss, uDevicePixelRatio, uInvResolution));
    vec2 blueUv = clampUv(cssToSceneUv(blueCss, uDevicePixelRatio, uInvResolution));
    float redSample = texture(uScene, redUv).r;
    float blueSample = texture(uScene, blueUv).b;
    color.r = mix(color.r, redSample, min(0.85, uAberrationStrength * 0.85));
    color.b = mix(color.b, blueSample, min(0.85, uAberrationStrength * 0.85));
  }

  if (uScanlineIntensity > 0.0001) {
    float line = sin(cssCoord.y * uDevicePixelRatio * 3.14159265);
    float mask = mix(1.0, 0.55 + 0.45 * line * line, uScanlineIntensity);
    color *= mask;
  }

  if (uSlotMaskIntensity > 0.0001) {
    int triad = int(floor(cssCoord.x * uDevicePixelRatio)) % 3;
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

  if (bloomIntensity > 0.0001) {
    vec3 accum = vec3(0.0);
    vec2 taps[5];
    taps[0] = vec2(0.0);
    taps[1] = vec2(uInvResolution.x * 2.0, 0.0);
    taps[2] = vec2(-uInvResolution.x * 2.0, 0.0);
    taps[3] = vec2(0.0, uInvResolution.y * 2.0);
    taps[4] = vec2(0.0, -uInvResolution.y * 2.0);
    for (int i = 0; i < 5; i++) {
      vec2 sampleUv = clampUv(sceneUv + taps[i]);
      accum += texture(uScene, sampleUv).rgb;
    }
    accum /= 5.0;
    float luminance = dot(accum, vec3(0.2126, 0.7152, 0.0722));
    float weight = smoothstep(uBloomThreshold, 1.0, luminance);
    color = mix(color, accum, weight * bloomIntensity * uBloomSoftness);
  }

  float vignetteWeight = uVignetteStrength;
  if (outside) {
    vignetteWeight = 1.0;
  }
  if (vignetteWeight > 0.0001) {
    float vig = vignetteMask(cssCoord, uInvCssSize);
    color *= mix(1.0, vig, clamp(vignetteWeight, 0.0, 1.0));
  }

  if (uNoiseIntensity > 0.0001) {
    float noise = fract(sin(dot(cssCoord, vec2(12.9898, 78.233)) + uTime * 12.345) * 43758.5453);
    float grain = (noise - 0.5) * uNoiseIntensity;
    color += vec3(grain);
  }

  if (uCursorState.z > 0.5) {
    vec2 cursorUv = clampUv(cssToSceneUv(uCursorState.xy, uDevicePixelRatio, uInvResolution));
    vec2 diff = vec2((uvDisplay.x - cursorUv.x) * uResolution.x, (uvDisplay.y - cursorUv.y) * uResolution.y);
    float radius = cursorRadius(uCursorMeta.x) * uDevicePixelRatio;
    float dist = length(diff);
    float ring = smoothstep(radius + 1.5, radius - 1.5, dist);
    float fill = smoothstep(radius * 0.4, radius * 0.1, dist);
    float alpha = max(ring, fill * 0.4);
    float pressed = step(0.5, uCursorState.w);
    vec3 tint = mix(vec3(1.0), vec3(0.85, 1.0, 0.85), pressed);
    color = mix(color, tint, alpha);
  }

  color = clamp(color, 0.0, 1.0);
  fragColor = vec4(color, 1.0);
}
