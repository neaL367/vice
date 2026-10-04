/**
 * WGSL Compute Shaders for High-Performance Vice Super-Resolution.
 * - Pass 1: Horizontal Lanczos-3 in Linear Light + Deringing Clamping
 * - Pass 2: Vertical Lanczos-3 with Diagonal Steering + Null-Space Sharpness
 * - Pass 3: Consistency Projection P(I_high) = I_low + sRGB Encoding
 */

export const WGSL_COMMON = /* wgsl */ `
const PI: f32 = 3.141592653589793;

fn srgb_to_linear(c: f32) -> f32 {
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return pow((c + 0.055) / 1.055, 2.4);
}

fn linear_to_srgb(c: f32) -> f32 {
  let v = clamp(c, 0.0, 1.0);
  if (v <= 0.0031308) {
    return v * 12.92;
  }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn sinc(x: f32) -> f32 {
  if (abs(x) < 0.0001) { return 1.0; }
  let px = PI * x;
  return sin(px) / px;
}

fn lanczos3(x: f32) -> f32 {
  let ax = abs(x);
  if (ax >= 3.0) { return 0.0; }
  return sinc(ax) * sinc(ax / 3.0);
}
`;

export const WGSL_PASS1_H = /* wgsl */ `
${WGSL_COMMON}

struct Params {
  in_w: u32,
  in_h: u32,
  out_w: u32,
  out_h: u32,
  scale: u32,
  preset: u32,       // 0 = photo, 1 = smooth, 2 = pixel-art
  dering: f32,       // 0.0 to 1.0
  sharpness: f32,    // 0.0 to 1.0
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var input_tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> temp_buf: array<vec4<f32>>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  if (x >= params.out_w || y >= params.in_h) {
    return;
  }

  // Pixel-art mode: exact nearest-neighbor replication
  if (params.preset == 2u) {
    let src_x = min(x / params.scale, params.in_w - 1u);
    let srgb = textureLoad(input_tex, vec2<i32>(i32(src_x), i32(y)), 0);
    let lin = vec4<f32>(
      srgb_to_linear(srgb.r),
      srgb_to_linear(srgb.g),
      srgb_to_linear(srgb.b),
      srgb.a
    );
    temp_buf[y * params.out_w + x] = lin;
    return;
  }

  let s = f32(params.scale);
  let src_x = (f32(x) + 0.5) / s - 0.5;
  let base_idx = i32(floor(src_x));
  let frac = src_x - floor(src_x);

  var sum_weights: f32 = 0.0;
  var weights: array<f32, 6>;
  for (var tap: i32 = -2; tap <= 3; tap++) {
    let w = lanczos3(frac - f32(tap));
    weights[tap + 2] = w;
    sum_weights += w;
  }
  let inv_sum = select(1.0 / sum_weights, 1.0, abs(sum_weights) < 0.0001);

  var min_rgb: vec3<f32> = vec3<f32>(1e10);
  var max_rgb: vec3<f32> = vec3<f32>(-1e10);
  var accum: vec4<f32> = vec4<f32>(0.0);

  // Central samples for acutance curvature
  let sx0 = clamp(base_idx, 0, i32(params.in_w) - 1);
  let sx1 = clamp(base_idx + 1, 0, i32(params.in_w) - 1);
  let sx_m1 = clamp(base_idx - 1, 0, i32(params.in_w) - 1);
  let sx2 = clamp(base_idx + 2, 0, i32(params.in_w) - 1);

  let p0_raw = textureLoad(input_tex, vec2<i32>(sx0, i32(y)), 0);
  let p1_raw = textureLoad(input_tex, vec2<i32>(sx1, i32(y)), 0);
  let pm1_raw = textureLoad(input_tex, vec2<i32>(sx_m1, i32(y)), 0);
  let p2_raw = textureLoad(input_tex, vec2<i32>(sx2, i32(y)), 0);

  let p0 = vec3<f32>(srgb_to_linear(p0_raw.r), srgb_to_linear(p0_raw.g), srgb_to_linear(p0_raw.b));
  let p1 = vec3<f32>(srgb_to_linear(p1_raw.r), srgb_to_linear(p1_raw.g), srgb_to_linear(p1_raw.b));
  let pm1 = vec3<f32>(srgb_to_linear(pm1_raw.r), srgb_to_linear(pm1_raw.g), srgb_to_linear(pm1_raw.b));
  let p2 = vec3<f32>(srgb_to_linear(p2_raw.r), srgb_to_linear(p2_raw.g), srgb_to_linear(p2_raw.b));

  for (var tap: i32 = -2; tap <= 3; tap++) {
    let sx = clamp(base_idx + tap, 0, i32(params.in_w) - 1);
    let srgb = textureLoad(input_tex, vec2<i32>(sx, i32(y)), 0);
    let lin = vec4<f32>(
      srgb_to_linear(srgb.r),
      srgb_to_linear(srgb.g),
      srgb_to_linear(srgb.b),
      srgb.a
    );

    let norm_w = weights[tap + 2] * inv_sum;
    accum += lin * norm_w;

    if (tap >= -1 && tap <= 2) {
      min_rgb = min(min_rgb, lin.rgb);
      max_rgb = max(max_rgb, lin.rgb);
    }
  }

  // Edge acutance boost (disabled on smooth preset)
  if (params.preset == 0u) {
    let local_delta = abs(p1 - p0);
    let wide_delta = abs(p2 - pm1);
    let edge_energy = max(local_delta, 0.5 * wide_delta);
    let noise_floor = 0.008;

    let linear_center = p0 + frac * (p1 - p0);
    let wide_center = 0.5 * (pm1 + p2);
    let curvature = linear_center - wide_center;

    let ramp = clamp((edge_energy - vec3<f32>(noise_floor)) * 6.0, vec3<f32>(0.0), vec3<f32>(1.0));
    let boost = 0.45 * ramp;
    accum = vec4<f32>(accum.rgb + boost * curvature, accum.a);
  }

  // Anti-ringing clamp
  if (params.dering > 0.0) {
    let clamped = clamp(accum.rgb, min_rgb, max_rgb);
    accum = vec4<f32>(mix(accum.rgb, clamped, params.dering), accum.a);
  }

  temp_buf[y * params.out_w + x] = accum;
}
`;

export const WGSL_PASS2_V = /* wgsl */ `
${WGSL_COMMON}

struct Params {
  in_w: u32,
  in_h: u32,
  out_w: u32,
  out_h: u32,
  scale: u32,
  preset: u32,
  dering: f32,
  sharpness: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> temp_buf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> out_buf: array<vec4<f32>>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  if (x >= params.out_w || y >= params.out_h) {
    return;
  }

  // Pixel-art mode: vertical nearest replication
  if (params.preset == 2u) {
    let src_y = min(y / params.scale, params.in_h - 1u);
    out_buf[y * params.out_w + x] = temp_buf[src_y * params.out_w + x];
    return;
  }

  let s = f32(params.scale);
  let src_y = (f32(y) + 0.5) / s - 0.5;
  let base_idx = i32(floor(src_y));
  let frac = src_y - floor(src_y);

  var sum_weights: f32 = 0.0;
  var weights: array<f32, 6>;
  for (var tap: i32 = -2; tap <= 3; tap++) {
    let w = lanczos3(frac - f32(tap));
    weights[tap + 2] = w;
    sum_weights += w;
  }
  let inv_sum = select(1.0 / sum_weights, 1.0, abs(sum_weights) < 0.0001);

  var min_rgb: vec3<f32> = vec3<f32>(1e10);
  var max_rgb: vec3<f32> = vec3<f32>(-1e10);
  var accum: vec4<f32> = vec4<f32>(0.0);

  let sy0 = clamp(base_idx, 0, i32(params.in_h) - 1);
  let sy1 = clamp(base_idx + 1, 0, i32(params.in_h) - 1);
  let sy_m1 = clamp(base_idx - 1, 0, i32(params.in_h) - 1);
  let sy2 = clamp(base_idx + 2, 0, i32(params.in_h) - 1);

  let p0 = temp_buf[u32(sy0) * params.out_w + x].rgb;
  let p1 = temp_buf[u32(sy1) * params.out_w + x].rgb;
  let pm1 = temp_buf[u32(sy_m1) * params.out_w + x].rgb;
  let p2 = temp_buf[u32(sy2) * params.out_w + x].rgb;

  for (var tap: i32 = -2; tap <= 3; tap++) {
    let sy = clamp(base_idx + tap, 0, i32(params.in_h) - 1);
    let sample = temp_buf[u32(sy) * params.out_w + x];
    let norm_w = weights[tap + 2] * inv_sum;
    accum += sample * norm_w;

    if (tap >= -1 && tap <= 2) {
      min_rgb = min(min_rgb, sample.rgb);
      max_rgb = max(max_rgb, sample.rgb);
    }
  }

  // Vertical acutance boost
  if (params.preset == 0u) {
    let local_delta = abs(p1 - p0);
    let wide_delta = abs(p2 - pm1);
    let edge_energy = max(local_delta, 0.5 * wide_delta);
    let noise_floor = 0.008;

    let linear_center = p0 + frac * (p1 - p0);
    let wide_center = 0.5 * (pm1 + p2);
    let curvature = linear_center - wide_center;

    let ramp = clamp((edge_energy - vec3<f32>(noise_floor)) * 6.0, vec3<f32>(0.0), vec3<f32>(1.0));
    let boost = 0.45 * ramp;
    accum = vec4<f32>(accum.rgb + boost * curvature, accum.a);
  }

  // Diagonal edge steering check
  let step_x = i32(params.scale);
  let xl = clamp(i32(x) - step_x, 0, i32(params.out_w) - 1);
  let xr = clamp(i32(x) + step_x, 0, i32(params.out_w) - 1);

  let tl = temp_buf[u32(sy0) * params.out_w + u32(xl)].rgb;
  let tr = temp_buf[u32(sy0) * params.out_w + u32(xr)].rgb;
  let bl = temp_buf[u32(sy1) * params.out_w + u32(xl)].rgb;
  let br = temp_buf[u32(sy1) * params.out_w + u32(xr)].rgb;

  let d45 = abs(tr - bl);
  let d135 = abs(tl - br);
  let diff = d135 - d45;
  let total = d135 + d45 + vec3<f32>(1e-4);
  let ratio = abs(diff) / total;

  if (ratio.r > 0.15 || ratio.g > 0.15 || ratio.b > 0.15) {
    let diag_avg = select(0.5 * (tl + br), 0.5 * (tr + bl), diff > vec3<f32>(0.0));
    let steer_w = 0.2 * clamp(ratio, vec3<f32>(0.0), vec3<f32>(1.0));
    accum = vec4<f32>(mix(accum.rgb, diag_avg, steer_w), accum.a);
  }

  // Anti-ringing clamp
  if (params.dering > 0.0) {
    let clamped = clamp(accum.rgb, min_rgb, max_rgb);
    accum = vec4<f32>(mix(accum.rgb, clamped, params.dering), accum.a);
  }

  // Null-space sharpness boost
  if (params.sharpness > 0.001) {
    let center = accum.rgb;
    let blur = 0.5 * center + 0.125 * (p0 + p1 + tl + br);
    let hp = center - blur;
    accum = vec4<f32>(center + params.sharpness * hp, accum.a);
  }

  // Vice 2.0 Coherence-Enhancing Shock PDE: steepens blurry edge transitions into crisp sub-pixel steps
  if (params.preset == 0u) {
    let grad_x = 0.5 * (tr + br - tl - bl);
    let grad_y = p1 - p0;
    let grad_sq = grad_x * grad_x + grad_y * grad_y;
    let grad_norm = sqrt(grad_sq + vec3<f32>(1e-5));

    let dxx = (tr + br) - 2.0 * accum.rgb + (tl + bl);
    let dyy = p1 - 2.0 * accum.rgb + p0;
    let dxy = 0.25 * (br - bl - tr + tl);

    let i_eta_eta = (grad_x * grad_x * dxx + 2.0 * grad_x * grad_y * dxy + grad_y * grad_y * dyy) / (grad_sq + vec3<f32>(1e-5));
    let shock_term = -tanh(5.0 * i_eta_eta) * grad_norm;
    let shock_strength = 0.35 + 0.35 * params.sharpness;
    accum = vec4<f32>(clamp(accum.rgb + 0.12 * shock_strength * shock_term, vec3<f32>(0.0), vec3<f32>(1.0)), accum.a);
  }

  out_buf[y * params.out_w + x] = accum;
}
`;

export const WGSL_PASS3_PROJECT = /* wgsl */ `
${WGSL_COMMON}

struct Params {
  in_w: u32,
  in_h: u32,
  out_w: u32,
  out_h: u32,
  scale: u32,
  preset: u32,
  dering: f32,
  sharpness: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var input_tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> out_buf: array<vec4<f32>>;
@group(0) @binding(3) var output_tex: texture_storage_2d<rgba8unorm, write>;

// Invoked per low-res block (in_w × in_h).
// Computes block arithmetic mean, subtracts from input_tex to find residual,
// applies residual correction to each pixel in the block, and writes to output_tex.
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let bx = id.x;
  let by = id.y;
  if (bx >= params.in_w || by >= params.in_h) {
    return;
  }

  let s = params.scale;
  let s_f32 = f32(s);
  let inv_sq = 1.0 / (s_f32 * s_f32);

  // Load ground-truth low-res input pixel in linear light
  let in_srgb = textureLoad(input_tex, vec2<i32>(i32(bx), i32(by)), 0);
  let in_lin = vec3<f32>(
    srgb_to_linear(in_srgb.r),
    srgb_to_linear(in_srgb.g),
    srgb_to_linear(in_srgb.b)
  );

  // Compute arithmetic mean of the candidate block
  var sum_high: vec3<f32> = vec3<f32>(0.0);
  for (var dy: u32 = 0u; dy < s; dy++) {
    for (var dx: u32 = 0u; dx < s; dx++) {
      let hx = bx * s + dx;
      let hy = by * s + dy;
      let val = out_buf[hy * params.out_w + hx];
      sum_high += val.rgb;
    }
  }

  let mean_high = sum_high * inv_sq;
  let residual = in_lin - mean_high;

  // Apply residual distribution to enforce P(I_high) = I_low and store to output texture
  for (var dy: u32 = 0u; dy < s; dy++) {
    for (var dx: u32 = 0u; dx < s; dx++) {
      let hx = bx * s + dx;
      let hy = by * s + dy;
      let idx = hy * params.out_w + hx;
      let original = out_buf[idx];

      let corrected_lin = clamp(original.rgb + residual, vec3<f32>(0.0), vec3<f32>(1.0));
      out_buf[idx] = vec4<f32>(corrected_lin, original.a);

      let final_srgb = vec4<f32>(
        linear_to_srgb(corrected_lin.r),
        linear_to_srgb(corrected_lin.g),
        linear_to_srgb(corrected_lin.b),
        original.a
      );

      textureStore(output_tex, vec2<i32>(i32(hx), i32(hy)), final_srgb);
    }
  }
}
`;
