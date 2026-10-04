/**
 * WebGPU High-Performance Upscaler Pipeline.
 * Executes Lanczos-3 + Anti-Ringing + Null-Space Sharpness + Consistency Projection
 * entirely on GPU compute shaders.
 */

import { WGSL_PASS1_H, WGSL_PASS2_V, WGSL_PASS3_PROJECT } from "./shaders";
import { getWebGPUDevice } from "./webgpu-support";

export interface WebGPUUpscaleOptions {}

export interface WebGPUUpscaleResult {
  blob: Blob;
  outW: number;
  outH: number;
  residual: number;
  durationMs: number;
}

let cachedPipeline: {
  device: GPUDevice;
  pipelineH: GPUComputePipeline;
  pipelineV: GPUComputePipeline;
  pipelineProject: GPUComputePipeline;
} | null = null;

async function getPipelines(device: GPUDevice) {
  if (cachedPipeline && cachedPipeline.device === device) {
    return cachedPipeline;
  }

  const modH = device.createShaderModule({ code: WGSL_PASS1_H });
  const modV = device.createShaderModule({ code: WGSL_PASS2_V });
  const modProject = device.createShaderModule({ code: WGSL_PASS3_PROJECT });

  const [pipelineH, pipelineV, pipelineProject] = await Promise.all([
    device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: modH, entryPoint: "main" },
    }),
    device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: modV, entryPoint: "main" },
    }),
    device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: modProject, entryPoint: "main" },
    }),
  ]);

  cachedPipeline = { device, pipelineH, pipelineV, pipelineProject };
  return cachedPipeline;
}

export function warmupWebGPUPipelines(): void {
  if (typeof window === "undefined") return;
  const runWarmup = async () => {
    try {
      const device = await getWebGPUDevice();
      if (device) {
        await getPipelines(device);
      }
    } catch {}
  };

  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
      runWarmup,
    );
  } else {
    setTimeout(runWarmup, 100);
  }
}

export async function runWebGPUUpscale(
  imageSource: ImageBitmap | HTMLCanvasElement,
  scale: 2 | 3 | 4,
  options?: WebGPUUpscaleOptions,
): Promise<WebGPUUpscaleResult | null> {
  const device = await getWebGPUDevice();
  if (!device) return null;

  const startTime = performance.now();
  const inW = imageSource.width;
  const inH = imageSource.height;
  const outW = inW * scale;
  const outH = inH * scale;

  // Buffer and texture size pre-checks against device limits
  const tempBufSize = outW * inH * 16; // vec4<f32> = 16 bytes
  const outBufSize = outW * outH * 16;
  const bytesPerRow = Math.ceil((outW * 4) / 256) * 256;
  const readbackBufSize = bytesPerRow * outH;

  const limits = device.limits;
  const maxDim = limits.maxTextureDimension2D ?? 8192;
  const maxBuf = limits.maxBufferSize ?? 268435456;
  const maxBinding = limits.maxStorageBufferBindingSize ?? 134217728;

  if (
    inW > maxDim ||
    inH > maxDim ||
    outW > maxDim ||
    outH > maxDim ||
    tempBufSize > maxBinding ||
    outBufSize > maxBinding ||
    tempBufSize > maxBuf ||
    outBufSize > maxBuf ||
    readbackBufSize > maxBuf
  ) {
    console.info(
      `[Vice] Image dimensions (${outW}×${outH}) or buffer requirements (${Math.round(
        Math.max(tempBufSize, outBufSize) / (1024 * 1024),
      )} MB) exceed WebGPU hardware limits. Safely delegating to multi-threaded WASM core.`,
    );
    return null;
  }

  let inputTex: GPUTexture | null = null;
  let tempBuf: GPUBuffer | null = null;
  let outBuf: GPUBuffer | null = null;
  let outputTex: GPUTexture | null = null;
  let uniformBuf: GPUBuffer | null = null;
  let readbackBuf: GPUBuffer | null = null;
  let residualBuf: GPUBuffer | null = null;
  let residualReadbackBuf: GPUBuffer | null = null;

  try {
    const { pipelineH, pipelineV, pipelineProject } = await getPipelines(device);

    // 1. Create Input Texture and upload source
    inputTex = device.createTexture({
      size: [inW, inH, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source: imageSource },
      { texture: inputTex },
      [inW, inH],
    );

    // 2. Intermediate Buffers
    tempBuf = device.createBuffer({
      size: tempBufSize,
      usage: GPUBufferUsage.STORAGE,
    });

    outBuf = device.createBuffer({
      size: outBufSize,
      usage: GPUBufferUsage.STORAGE,
    });

    // 3. Output Texture
    outputTex = device.createTexture({
      size: [outW, outH, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    });

    // 4. Uniform Buffer (48 bytes: 6 u32 + dering/sharpness/shock + 3 pad)
    const uniformData = new ArrayBuffer(48);
    const u32View = new Uint32Array(uniformData);
    const f32View = new Float32Array(uniformData);

    u32View[0] = inW;
    u32View[1] = inH;
    u32View[2] = outW;
    u32View[3] = outH;
    u32View[4] = scale;
    u32View[5] = 0; // unified standard mode
    f32View[6] = 1.0;
    f32View[7] = 0.35;
    f32View[8] = 0.35;

    uniformBuf = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuf, 0, uniformData);

    residualBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(residualBuf, 0, new Uint32Array([0]));

    residualReadbackBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // 5. Bind Groups
    const bgH = device.createBindGroup({
      layout: pipelineH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: inputTex.createView() },
        { binding: 2, resource: { buffer: tempBuf } },
      ],
    });

    const bgV = device.createBindGroup({
      layout: pipelineV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: tempBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });

    const bgProject = device.createBindGroup({
      layout: pipelineProject.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: inputTex.createView() },
        { binding: 2, resource: { buffer: outBuf } },
        { binding: 3, resource: outputTex.createView() },
        { binding: 4, resource: { buffer: residualBuf } },
      ],
    });

    // 6. Encode and Dispatch Compute Passes
    const encoder = device.createCommandEncoder();

    // Pass 1: Horizontal Lanczos
    const passH = encoder.beginComputePass();
    passH.setPipeline(pipelineH);
    passH.setBindGroup(0, bgH);
    passH.dispatchWorkgroups(Math.ceil(outW / 16), Math.ceil(inH / 16));
    passH.end();

    // Pass 2: Vertical Lanczos + Dering + Sharpness
    const passV = encoder.beginComputePass();
    passV.setPipeline(pipelineV);
    passV.setBindGroup(0, bgV);
    passV.dispatchWorkgroups(Math.ceil(outW / 16), Math.ceil(outH / 16));
    passV.end();

    // Pass 3: Consistency Projection + sRGB Store
    const passProj = encoder.beginComputePass();
    passProj.setPipeline(pipelineProject);
    passProj.setBindGroup(0, bgProject);
    passProj.dispatchWorkgroups(Math.ceil(inW / 16), Math.ceil(inH / 16));
    passProj.end();

    // 7. Readback Staging Buffer (256-byte row aligned)
    readbackBuf = device.createBuffer({
      size: readbackBufSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    encoder.copyTextureToBuffer(
      { texture: outputTex },
      { buffer: readbackBuf, bytesPerRow, rowsPerImage: outH },
      [outW, outH, 1],
    );

    if (residualBuf && residualReadbackBuf) {
      encoder.copyBufferToBuffer(residualBuf, 0, residualReadbackBuf, 0, 4);
    }

    device.queue.submit([encoder.finish()]);

    // 8. Map buffer and extract pixel data and measured residual
    const mapPromises: Promise<void>[] = [readbackBuf.mapAsync(GPUMapMode.READ)];
    if (residualReadbackBuf) {
      mapPromises.push(residualReadbackBuf.mapAsync(GPUMapMode.READ));
    }
    await Promise.all(mapPromises);

    const mapped = readbackBuf.getMappedRange();
    const rawBytes = new Uint8Array(mapped);

    let measuredResidual = 0.0;
    if (residualReadbackBuf) {
      const resMapped = residualReadbackBuf.getMappedRange();
      measuredResidual = new Uint32Array(resMapped)[0] / 10000000.0;
      residualReadbackBuf.unmap();
    }

    // Strip row padding to tightly packed RGBA
    const tightlyPacked = new Uint8ClampedArray(outW * outH * 4);
    for (let r = 0; r < outH; r++) {
      const srcRow = rawBytes.subarray(r * bytesPerRow, r * bytesPerRow + outW * 4);
      tightlyPacked.set(srcRow, r * outW * 4);
    }

    readbackBuf.unmap();

    // Create Blob via OffscreenCanvas
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

    const imgData = new ImageData(tightlyPacked, outW, outH);
    ctx.putImageData(imgData, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });

    const durationMs = performance.now() - startTime;

    return {
      blob,
      outW,
      outH,
      residual: measuredResidual,
      durationMs,
    };
  } catch (err) {
    console.warn("[Vice] WebGPU compute pass encountered an error, falling back to WASM:", err);
    return null;
  } finally {
    // Clean up GPU objects
    try { inputTex?.destroy(); } catch {}
    try { tempBuf?.destroy(); } catch {}
    try { outBuf?.destroy(); } catch {}
    try { outputTex?.destroy(); } catch {}
    try { uniformBuf?.destroy(); } catch {}
    try { readbackBuf?.destroy(); } catch {}
    try { residualBuf?.destroy(); } catch {}
    try { residualReadbackBuf?.destroy(); } catch {}
  }
}
