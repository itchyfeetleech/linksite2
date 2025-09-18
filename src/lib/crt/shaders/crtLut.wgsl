struct LutUniforms {
  size: vec4<f32>; // x=width, y=height, z=invWidth, w=invHeight
  factors: vec4<f32>; // x=aspect, y=k1, z=k2, w=unused
};

@group(0) @binding(0) var<uniform> params: LutUniforms;
@group(0) @binding(1) var forwardLut: texture_storage_2d<rg16float, write>;
@group(0) @binding(2) var inverseLut: texture_storage_2d<rg16float, write>;

fn clampPoint(value: vec2<f32>) -> vec2<f32> {
  let width = params.size.x;
  let height = params.size.y;
  return vec2<f32>(
    clamp(value.x, 0.0, width),
    clamp(value.y, 0.0, height)
  );
}

fn normalizeCoord(coord: vec2<f32>) -> vec2<f32> {
  let invSize = params.size.zw;
  return coord * invSize * 2.0 - vec2<f32>(1.0, 1.0);
}

fn denormalizeCoord(coord: vec2<f32>) -> vec2<f32> {
  return (coord * 0.5 + vec2<f32>(0.5, 0.5)) * params.size.xy;
}

fn mapForward(coord: vec2<f32>) -> vec2<f32> {
  let aspect = params.factors.x;
  let norm = normalizeCoord(coord);
  var p = vec2<f32>(norm.x * aspect, norm.y);
  let r2 = dot(p, p);
  let r4 = r2 * r2;
  let factor = 1.0 + params.factors.y * r2 + params.factors.z * r4;
  p = p * factor;
  let distorted = vec2<f32>(p.x / aspect, p.y);
  return clampPoint(denormalizeCoord(distorted));
}

fn solveRadius(distorted: f32) -> f32 {
  if (distorted == 0.0) {
    return 0.0;
  }
  var radius = distorted;
  for (var i = 0; i < 8; i = i + 1) {
    let r2 = radius * radius;
    let r4 = r2 * r2;
    let value = radius + params.factors.y * radius * r2 + params.factors.z * radius * r4 - distorted;
    let derivative = 1.0 + 3.0 * params.factors.y * r2 + 5.0 * params.factors.z * r4;
    if (abs(derivative) < 1e-6) {
      break;
    }
    radius = radius - value / derivative;
  }
  return radius;
}

fn mapInverse(coord: vec2<f32>) -> vec2<f32> {
  let aspect = params.factors.x;
  let norm = normalizeCoord(coord);
  var p = vec2<f32>(norm.x * aspect, norm.y);
  let radiusPrime = length(p);
  if (radiusPrime == 0.0) {
    return vec2<f32>(0.5, 0.5) * params.size.xy;
  }
  let radius = solveRadius(radiusPrime);
  let scale = radius / radiusPrime;
  p = p * scale;
  let undistorted = vec2<f32>(p.x / aspect, p.y);
  return clampPoint(denormalizeCoord(undistorted));
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = u32(params.size.x + 0.5);
  let height = u32(params.size.y + 0.5);
  if (id.x >= width || id.y >= height) {
    return;
  }

  let pixel = vec2<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5);
  let forward = mapForward(pixel);
  let inverse = mapInverse(pixel);
  textureStore(forwardLut, vec2<i32>(i32(id.x), i32(id.y)), vec4<f32>(forward, 0.0, 1.0));
  textureStore(inverseLut, vec2<i32>(i32(id.x), i32(id.y)), vec4<f32>(inverse, 0.0, 1.0));
}
