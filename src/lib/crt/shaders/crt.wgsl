struct Uniforms {
  resolution: vec2<f32>,
  invResolution: vec2<f32>,
  time: f32,
  scanlineIntensity: f32,
  slotMaskIntensity: f32,
  vignetteStrength: f32,
  baseBloomIntensity: f32,
  aberrationStrength: f32,
  noiseIntensity: f32,
  devicePixelRatio: f32,
  bloomThreshold: f32,
  bloomSoftness: f32,
  k1: f32,
  k2: f32,
  cssSize: vec2<f32>,
  invCssSize: vec2<f32>,
  cursorState: vec4<f32>,
  cursorMeta: vec4<f32>,
};

@group(0) @binding(0) var<uniform> ubo: Uniforms;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var sceneTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn clampUv(value: vec2<f32>) -> vec2<f32> {
  return clamp(value, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
}

fn clampCss(value: vec2<f32>, size: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    clamp(value.x, 0.0, size.x),
    clamp(value.y, 0.0, size.y)
  );
}

fn cssToSceneUv(css: vec2<f32>, dpr: f32, invResolution: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(css.x * dpr * invResolution.x, css.y * dpr * invResolution.y);
}

fn safe_aspect(res: vec2<f32>) -> f32 {
  return select(1.0, res.x / res.y, res.y > 0.0);
}

fn flip_uv_if_needed(uv: vec2<f32>, doFlip: bool) -> vec2<f32> {
  return vec2<f32>(uv.x, select(uv.y, 1.0 - uv.y, doFlip));
}

fn warp_brown_conrady(uv: vec2<f32>, aspect: f32, k1: f32, k2: f32) -> vec2<f32> {
  var p = uv * 2.0 - vec2<f32>(1.0, 1.0);
  p.x *= aspect;
  let r2 = dot(p, p);
  let scale = 1.0 + k1 * r2 + k2 * r2 * r2;
  var q = p * scale;
  q.x /= aspect;
  return q * 0.5 + vec2<f32>(0.5, 0.5);
}

fn vignetteMask(css: vec2<f32>, invCss: vec2<f32>) -> f32 {
  let normalized = css * invCss - vec2<f32>(0.5, 0.5);
  let distance = length(normalized);
  return smoothstep(0.85, 0.55, distance);
}

fn cursorRadius(cursorType: f32) -> f32 {
  if (cursorType > 1.5) {
    return 16.0;
  }
  if (cursorType > 0.5) {
    return 22.0;
  }
  return 12.0;
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0, 3.0),
    vec2<f32>(3.0, -1.0)
  );

  var output: VertexOutput;
  let position = positions[vertexIndex];
  output.position = vec4<f32>(position, 0.0, 1.0);
  let uv = position * 0.5 + vec2<f32>(0.5, 0.5);
  output.uv = flip_uv_if_needed(uv, false);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv0 = flip_uv_if_needed(input.uv, true);
  let uv = clampUv(uv0);
  let aspect = safe_aspect(ubo.resolution);
  let warpedUv = warp_brown_conrady(uv, aspect, ubo.k1, ubo.k2);
  let outside =
    warpedUv.x < 0.0 || warpedUv.x > 1.0 ||
    warpedUv.y < 0.0 || warpedUv.y > 1.0;
  let clampedWarp = clampUv(warpedUv);
  let cssCoord = clampCss(clampedWarp * ubo.cssSize, ubo.cssSize);
  let sceneUv = clampUv(cssToSceneUv(cssCoord, ubo.devicePixelRatio, ubo.invResolution));
  var color = textureSampleLevel(sceneTexture, sceneSampler, sceneUv, 0.0).rgb;

  let bloomIntensity = ubo.baseBloomIntensity * ubo.cursorMeta.y;

  if (ubo.aberrationStrength > 0.0001) {
    let center = cssCoord - ubo.cssSize * 0.5;
    let magnitude = max(length(center), 1e-3);
    let direction = center / magnitude;
    let offsetAmount = ubo.aberrationStrength * 6.0;
    let redCss = clampCss(cssCoord + direction * offsetAmount, ubo.cssSize);
    let blueCss = clampCss(cssCoord - direction * offsetAmount, ubo.cssSize);
    let redUv = clampUv(cssToSceneUv(redCss, ubo.devicePixelRatio, ubo.invResolution));
    let blueUv = clampUv(cssToSceneUv(blueCss, ubo.devicePixelRatio, ubo.invResolution));
    let redSample = textureSampleLevel(sceneTexture, sceneSampler, redUv, 0.0).r;
    let blueSample = textureSampleLevel(sceneTexture, sceneSampler, blueUv, 0.0).b;
    color.r = mix(color.r, redSample, min(0.85, ubo.aberrationStrength * 0.85));
    color.b = mix(color.b, blueSample, min(0.85, ubo.aberrationStrength * 0.85));
  }

  if (ubo.scanlineIntensity > 0.0001) {
    let line = sin(cssCoord.y * ubo.devicePixelRatio * 3.14159265);
    let mask = mix(1.0, 0.55 + 0.45 * line * line, ubo.scanlineIntensity);
    color = color * mask;
  }

  if (ubo.slotMaskIntensity > 0.0001) {
    let triad = i32(floor(cssCoord.x * ubo.devicePixelRatio)) % 3;
    var slotMask = vec3<f32>(0.35, 0.35, 0.35);
    if (triad == 0) {
      slotMask.x = 1.0;
    } else if (triad == 1) {
      slotMask.y = 1.0;
    } else {
      slotMask.z = 1.0;
    }
    color = color * mix(vec3<f32>(1.0, 1.0, 1.0), slotMask, ubo.slotMaskIntensity);
  }

  if (bloomIntensity > 0.0001) {
    var accum = vec3<f32>(0.0, 0.0, 0.0);
    let taps = array<vec2<f32>, 5>(
      vec2<f32>(0.0, 0.0),
      vec2<f32>(ubo.invResolution.x * 2.0, 0.0),
      vec2<f32>(-ubo.invResolution.x * 2.0, 0.0),
      vec2<f32>(0.0, ubo.invResolution.y * 2.0),
      vec2<f32>(0.0, -ubo.invResolution.y * 2.0)
    );
    for (var i = 0u; i < 5u; i = i + 1u) {
      let sampleUv = clampUv(sceneUv + taps[i]);
      accum = accum + textureSampleLevel(sceneTexture, sceneSampler, sampleUv, 0.0).rgb;
    }
    accum = accum / 5.0;
    let luminance = dot(accum, vec3<f32>(0.2126, 0.7152, 0.0722));
    let weight = smoothstep(ubo.bloomThreshold, 1.0, luminance);
    color = mix(color, accum, weight * bloomIntensity * ubo.bloomSoftness);
  }

  var vignetteWeight = ubo.vignetteStrength;
  if (outside) {
    vignetteWeight = 1.0;
  }
  if (vignetteWeight > 0.0001) {
    let vig = vignetteMask(cssCoord, ubo.invCssSize);
    color = color * mix(1.0, vig, clamp(vignetteWeight, 0.0, 1.0));
  }

  if (ubo.noiseIntensity > 0.0001) {
    let noise = fract(sin(dot(cssCoord, vec2<f32>(12.9898, 78.233)) + ubo.time * 12.345) * 43758.5453);
    let grain = (noise - 0.5) * ubo.noiseIntensity;
    color = color + vec3<f32>(grain, grain, grain);
  }

  if (ubo.cursorState.z > 0.5) {
    let cursorUv = clampUv(cssToSceneUv(ubo.cursorState.xy, ubo.devicePixelRatio, ubo.invResolution));
    let diff = vec2<f32>((uv.x - cursorUv.x) * ubo.resolution.x, (uv.y - cursorUv.y) * ubo.resolution.y);
    let radius = cursorRadius(ubo.cursorMeta.x) * ubo.devicePixelRatio;
    let dist = length(diff);
    let ring = smoothstep(radius + 1.5, radius - 1.5, dist);
    let fill = smoothstep(radius * 0.4, radius * 0.1, dist);
    let alpha = max(ring, fill * 0.4);
    let pressed = step(0.5, ubo.cursorState.w);
    let tint = mix(vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.85, 1.0, 0.85), pressed);
    color = mix(color, tint, alpha);
  }

  color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
  return vec4<f32>(color, 1.0);
}
