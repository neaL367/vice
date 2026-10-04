/**
 * WebGPU hardware acceleration detection and device acquisition.
 */

let cachedDevice: GPUDevice | null = null;
let probePromise: Promise<boolean> | null = null;

function getOptimalLimits(adapter: GPUAdapter): Record<string, number> {
  const limits: Record<string, number> = {};
  const al = adapter.limits;
  if (al.maxBufferSize) limits.maxBufferSize = al.maxBufferSize;
  if (al.maxStorageBufferBindingSize) limits.maxStorageBufferBindingSize = al.maxStorageBufferBindingSize;
  if (al.maxComputeWorkgroupStorageSize) limits.maxComputeWorkgroupStorageSize = al.maxComputeWorkgroupStorageSize;
  if (al.maxTextureDimension2D) limits.maxTextureDimension2D = al.maxTextureDimension2D;
  if (al.maxStorageBuffersPerShaderStage) limits.maxStorageBuffersPerShaderStage = al.maxStorageBuffersPerShaderStage;
  return limits;
}

async function requestDeviceWithFallback(adapter: GPUAdapter): Promise<GPUDevice> {
  let dev: GPUDevice;
  try {
    dev = await adapter.requestDevice({
      requiredLimits: getOptimalLimits(adapter),
    });
  } catch (err) {
    console.warn("[Vice] WebGPU requestDevice with optimal limits failed, trying defaults:", err);
    dev = await adapter.requestDevice();
  }

  dev.lost.then((info) => {
    console.warn(`[Vice] WebGPU device lost (${info.reason}): ${info.message}`);
    cachedDevice = null;
  });

  return dev;
}

export async function isWebGPUSupported(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    return false;
  }
  if (probePromise) return probePromise;

  probePromise = (async () => {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      const device = await requestDeviceWithFallback(adapter);
      cachedDevice = device;
      return true;
    } catch {
      return false;
    }
  })();

  return probePromise;
}

export async function getWebGPUDevice(): Promise<GPUDevice | null> {
  const supported = await isWebGPUSupported();
  if (!supported) return null;
  if (cachedDevice) return cachedDevice;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    cachedDevice = await requestDeviceWithFallback(adapter);
    return cachedDevice;
  } catch {
    return null;
  }
}

