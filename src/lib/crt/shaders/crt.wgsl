struct Uniforms {
  resolution: vec4<f32>,
  factorsA: vec4<f32>,
  factorsB: vec4<f32>,
  factorsC: vec4<f32>,
};

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let resolution = uniforms.resolution.xy;
  let invResolution = uniforms.resolution.zw;
  let time = uniforms.factorsA.x;
  let scanlineIntensity = uniforms.factorsA.y;
  let slotMaskIntensity = uniforms.factorsA.z;
  let vignetteStrength = uniforms.factorsA.w;
  let bloomIntensity = uniforms.factorsB.x;
  let aberrationStrength = uniforms.factorsB.y;
  let noiseIntensity = uniforms.factorsB.z;
  let devicePixelRatio = uniforms.factorsB.w;
  let bloomThreshold = uniforms.factorsC.x;
  let bloomSoftness = uniforms.factorsC.y;

  var color = textureSampleLevel(sceneTexture, linearSampler, clampUv(uv), 0.0).rgb;

  if (aberrationStrength > 0.0001) {
    let center = uv - vec2<f32>(0.5, 0.5);
    let offset = center * aberrationStrength * 1.35;
    let redUv = clampUv(uv + offset);
    let blueUv = clampUv(uv - offset);
    let redSample = textureSampleLevel(sceneTexture, linearSampler, redUv, 0.0).r;
    let blueSample = textureSampleLevel(sceneTexture, linearSampler, blueUv, 0.0).b;
    color.r = mix(color.r, redSample, min(0.85, aberrationStrength * 0.85));
    color.b = mix(color.b, blueSample, min(0.85, aberrationStrength * 0.85));
  }

  if (scanlineIntensity > 0.0001) {
    let line = sin((uv.y * resolution.y) / devicePixelRatio * 3.14159265);
    let mask = mix(1.0, 0.55 + 0.45 * line * line, scanlineIntensity);
    color = color * mask;
  }

  if (slotMaskIntensity > 0.0001) {
    let triad = i32(floor((uv.x * resolution.x) / devicePixelRatio)) % 3;
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
    let tapCount: u32 = 5u;
    let taps = array<vec2<f32>, 5>(
      vec2<f32>(0.0, 0.0),
      vec2<f32>(invResolution.x * 2.0, 0.0),
      vec2<f32>(-invResolution.x * 2.0, 0.0),
      vec2<f32>(0.0, invResolution.y * 2.0),
      vec2<f32>(0.0, -invResolution.y * 2.0)
    );
    for (var i = 0u; i < tapCount; i = i + 1u) {
      let sampleUv = clampUv(uv + taps[i]);
      accum = accum + textureSampleLevel(sceneTexture, linearSampler, sampleUv, 0.0).rgb;
    }
    accum = accum / f32(tapCount);
    let luminance = dot(accum, vec3<f32>(0.2126, 0.7152, 0.0722));
    let weight = smoothstep(bloomThreshold, 1.0, luminance);
    color = mix(color, accum, weight * bloomIntensity * bloomSoftness);
  }

  if (vignetteStrength > 0.0001) {
    let dist = distance(uv, vec2<f32>(0.5, 0.5));
    let vig = smoothstep(0.75, 0.45, dist);
    color = color * mix(1.0, vig, vignetteStrength);
  }

  if (noiseIntensity > 0.0001) {
    let noise = fract(sin(dot(uv * resolution.xy, vec2<f32>(12.9898, 78.233)) + time * 12.345) * 43758.5453);
    let grain = (noise - 0.5) * noiseIntensity;
    color = color + vec3<f32>(grain, grain, grain);
  }

  color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
  return vec4<f32>(color, 1.0);
}

