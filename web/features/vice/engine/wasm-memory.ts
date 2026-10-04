// WASM memory manager: single source of truth for heap access.
// Strictly the ONLY module permitted to touch HEAPU8 and HEAPF32 directly.

import type { ViceCoreInstance } from "./wasm-module";

export class WasmMemory {
  constructor(readonly instance: ViceCoreInstance) {}

  malloc(bytes: number): number {
    const ptr = this.instance._malloc(bytes);
    if (!ptr) throw new Error(`wasm malloc failed (${bytes} bytes requested)`);
    return ptr;
  }

  free(ptr: number): void {
    if (ptr) {
      this.instance._free(ptr);
    }
  }

  writeFloats(data: Float32Array): number {
    const ptr = this.malloc(data.length * 4);
    this.instance.HEAPF32.set(data, ptr / 4);
    return ptr;
  }

  readFloats(ptr: number, count: number): Float32Array {
    return this.instance.HEAPF32.slice(ptr / 4, ptr / 4 + count);
  }

  writeBytes(data: Uint8Array): number {
    const ptr = this.malloc(data.length);
    this.instance.HEAPU8.set(data, ptr);
    return ptr;
  }

  readBytes(ptr: number, count: number): Uint8Array {
    return this.instance.HEAPU8.slice(ptr, ptr + count);
  }

  copyBytes(srcPtr: number, dstPtr: number, count: number): void {
    this.instance.HEAPU8.copyWithin(dstPtr, srcPtr, srcPtr + count);
  }

  readInt32(ptr: number, offset = 0): number {
    return new DataView(this.instance.HEAPU8.buffer, ptr + offset, 4).getInt32(0, true);
  }

  readUint32(ptr: number, offset = 0): number {
    // Refresh HEAPU8 buffer reference in case of memory growth
    return new DataView(this.instance.HEAPU8.buffer, ptr + offset, 4).getUint32(0, true);
  }
}
