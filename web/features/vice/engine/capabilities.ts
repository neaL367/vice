// Capability detection for the Vice WASM core.

import type { ViceCoreInstance } from "./wasm-module";
export interface EngineCapabilities {
  hasNative: boolean;
  hasStream: boolean;
  hasInfinite: boolean;
  maxFullPixels: number;
  maxStreamPixels: number;
}
import { maxOutputPixels, maxStreamPixels } from "../../../lib/limits";

export function hasFullSupport(core: ViceCoreInstance | null): boolean {
  if (!core) return false;
  return (
    typeof core._vice_create === "function" &&
    typeof core._vice_set_input === "function" &&
    typeof core._vice_submit_raw_tile === "function" &&
    typeof core._vice_project === "function" &&
    typeof core._vice_finish_png === "function" &&
    typeof core._vice_destroy === "function"
  );
}

export function hasNativeUpscale(core: ViceCoreInstance | null): boolean {
  if (!core) return false;
  return typeof core._vice_upscale === "function";
}

export function hasStreamSupport(core: ViceCoreInstance | null): boolean {
  if (!core) return false;
  return (
    typeof core._vice_stream_create === "function" &&
    typeof core._vice_stream_set_icc_profile === "function" &&
    typeof core._vice_stream_push_input_rows === "function" &&
    typeof core._vice_stream_has_next_band === "function" &&
    typeof core._vice_stream_pull_band === "function" &&
    typeof core._vice_stream_finish_png === "function" &&
    typeof core._vice_stream_last_residual === "function" &&
    typeof core._vice_stream_destroy === "function"
  );
}

export function hasInfiniteSupport(core: ViceCoreInstance | null): boolean {
  if (!core) return false;
  return (
    hasStreamSupport(core) &&
    typeof core._vice_stream_set_fused === "function" &&
    typeof core._vice_png_open === "function" &&
    typeof core._vice_png_write_rows === "function" &&
    typeof core._vice_png_drain === "function" &&
    typeof core._vice_png_close === "function" &&
    typeof core._vice_png_destroy === "function"
  );
}

export function getThreadWorkers(core: ViceCoreInstance | null): number {
  if (!core) return 1;
  try {
    return core._vice_thread_workers?.() ?? 1;
  } catch {
    return 1;
  }
}

export function queryEngineCapabilities(
  core: ViceCoreInstance | null,
  options?: { maxFullPixels?: number; maxStreamPixels?: number },
): EngineCapabilities {
  return {
    hasNative: hasFullSupport(core) && hasNativeUpscale(core),
    hasStream: hasStreamSupport(core),
    hasInfinite: hasInfiniteSupport(core),
    maxFullPixels: options?.maxFullPixels ?? maxOutputPixels(),
    maxStreamPixels: options?.maxStreamPixels ?? maxStreamPixels(),
  };
}
