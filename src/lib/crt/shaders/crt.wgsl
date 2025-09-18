struct Uniforms {
  resolution: vec4<f32>;
  timing: vec4<f32>;
  effects: vec4<f32>;
  bloomParams: vec4<f32>;
  cssMetrics: vec4<f32>;
  cursorState: vec4<f32>;
  cursorMeta: vec4<f32>;
};

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var forwardLut: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>;
  @location(0) uv: vec2<f32>;
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0, 3.0),
    vec2<f32>(3.0, -1.0)
  );

  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 2.0),
    vec2<f32>(2.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = clampUv(input.uv);
  let resolution = uniforms.resolution.xy;
  let invResolution = uniforms.resolution.zw;
  let time = uniforms.timing.x;
  let scanlineIntensity = uniforms.timing.y;
  let slotMaskIntensity = uniforms.timing.z;
  let vignetteStrength = uniforms.timing.w;
  let baseBloomIntensity = uniforms.effects.x;
  let aberrationStrength = uniforms.effects.y;
  let noiseIntensity = uniforms.effects.z;
  let devicePixelRatio = uniforms.effects.w;
  let bloomThreshold = uniforms.bloomParams.x;
  let bloomSoftness = uniforms.bloomParams.y;
  let cssSize = uniforms.cssMetrics.xy;
  let invCss = uniforms.cssMetrics.zw;
  let cursor = uniforms.cursorState;
  let cursorMeta = uniforms.cursorMeta;

  let bloomIntensity = baseBloomIntensity * cursorMeta.y;

  let cssCoordRaw = textureSampleLevel(forwardLut, linearSampler, uv, 0.0).xy;
  let cssCoord = clampCss(cssCoordRaw, cssSize);
  let sceneUv = clampUv(cssToSceneUv(cssCoord, devicePixelRatio, invResolution));
  var color = textureSampleLevel(sceneTexture, linearSampler, sceneUv, 0.0).rgb;

  if (aberrationStrength > 0.0001) {
    let center = cssCoord - cssSize * 0.5;
    let magnitude = max(length(center), 1e-3);
    let direction = center / magnitude;
    let offsetAmount = aberrationStrength * 6.0;
    let redCss = clampCss(cssCoord + direction * offsetAmount, cssSize);
    let blueCss = clampCss(cssCoord - direction * offsetAmount, cssSize);
    let redUv = clampUv(cssToSceneUv(redCss, devicePixelRatio, invResolution));
    let blueUv = clampUv(cssToSceneUv(blueCss, devicePixelRatio, invResolution));
    let redSample = textureSampleLevel(sceneTexture, linearSampler, redUv, 0.0).r;
    let blueSample = textureSampleLevel(sceneTexture, linearSampler, blueUv, 0.0).b;
    color.r = mix(color.r, redSample, min(0.85, aberrationStrength * 0.85));
    color.b = mix(color.b, blueSample, min(0.85, aberrationStrength * 0.85));
  }

  if (scanlineIntensity > 0.0001) {
    let line = sin(cssCoord.y * devicePixelRatio * 3.14159265);
    let mask = mix(1.0, 0.55 + 0.45 * line * line, scanlineIntensity);
    color = color * mask;
  }

  if (slotMaskIntensity > 0.0001) {
    let triad = i32(floor(cssCoord.x * devicePixelRatio)) % 3;
    var slotMask = vec3<f32>(0.35, 0.35, 0.35);
    if (triad == 0) {
      slotMask.x = 1.0;
    } else if (triad == 1) {
      slotMask.y = 1.0;
    } else {
      slotMask.z = 1.0;
    }
    color = color * mix(vec3<f32>(1.0, 1.0, 1.0), slotMask, slotMaskIntensity);
  }

  if (bloomIntensity > 0.0001) {
    var accum = vec3<f32>(0.0, 0.0, 0.0);
    let taps = array<vec2<f32>, 5>(
      vec2<f32>(0.0, 0.0),
      vec2<f32>(invResolution.x * 2.0, 0.0),
      vec2<f32>(-invResolution.x * 2.0, 0.0),
      vec2<f32>(0.0, invResolution.y * 2.0),
      vec2<f32>(0.0, -invResolution.y * 2.0)
    );
    for (var i = 0u; i < 5u; i = i + 1u) {
      let sampleUv = clampUv(sceneUv + taps[i]);
      accum = accum + textureSampleLevel(sceneTexture, linearSampler, sampleUv, 0.0).rgb;
    }
    accum = accum / 5.0;
    let luminance = dot(accum, vec3<f32>(0.2126, 0.7152, 0.0722));
    let weight = smoothstep(bloomThreshold, 1.0, luminance);
    color = mix(color, accum, weight * bloomIntensity * bloomSoftness);
  }

  if (vignetteStrength > 0.0001) {
    let vig = vignetteMask(cssCoord, invCss);
    color = color * mix(1.0, vig, vignetteStrength);
  }

  if (noiseIntensity > 0.0001) {
    let noise = fract(sin(dot(cssCoord, vec2<f32>(12.9898, 78.233)) + time * 12.345) * 43758.5453);
    let grain = (noise - 0.5) * noiseIntensity;
    color = color + vec3<f32>(grain, grain, grain);
  }

  if (cursor.z > 0.5) {
    let cursorUv = clampUv(cssToSceneUv(cursor.xy, devicePixelRatio, invResolution));
    let diff = vec2<f32>((uv.x - cursorUv.x) * resolution.x, (uv.y - cursorUv.y) * resolution.y);
    let radius = cursorRadius(cursorMeta.x) * devicePixelRatio;
    let dist = length(diff);
    let ring = smoothstep(radius + 1.5, radius - 1.5, dist);
    let fill = smoothstep(radius * 0.4, radius * 0.1, dist);
    let alpha = max(ring, fill * 0.4);
    let pressed = step(0.5, cursor.w);
    let tint = mix(vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.85, 1.0, 0.85), pressed);
    color = mix(color, tint, alpha);
  }

  color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
  return vec4<f32>(color, 1.0);
}
