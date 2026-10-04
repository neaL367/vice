#pragma once
// Row-parallel for. Only the VICE_THREADS build (threaded WASM) shards work
// across up to 4 threads; every other build runs the loop serially, so the
// native gates and the single-threaded WASM core never see a thread.
// Shard bodies must write disjoint rows and read shared inputs only.
#ifdef VICE_THREADS
#include <thread>
#include <utility>
#include <vector>
#ifdef __EMSCRIPTEN__
#include <emscripten/threading.h>
#endif
#endif

// Workers that would be used for n rows (1 = serial). Exported for telemetry.
inline int vice_worker_count(int n) {
#ifdef VICE_THREADS
  int cores = 1;
#ifdef __EMSCRIPTEN__
  cores = emscripten_num_logical_cores();
#else
  unsigned hc = std::thread::hardware_concurrency();
  cores = hc ? (int)hc : 1;
#endif
  if (cores < 1) cores = 1;
  if (cores > 4) cores = 4; // min(4, hc): bands stay small, spawn cost matters
  if (n < 32 || cores < 2) return 1;
  return cores;
#else
  (void)n;
  return 1;
#endif
}

template <typename Fn> inline void vice_parallel_for(int begin, int end, Fn&& fn) {
#ifdef VICE_THREADS
  int n = end - begin;
  int cores = vice_worker_count(n);
  if (cores < 2) {
    for (int y = begin; y < end; ++y) fn(y);
    return;
  }
  std::vector<std::thread> workers;
  workers.reserve((size_t)(cores - 1));
  int chunk = (n + cores - 1) / cores;
  for (int t = 1; t < cores; ++t) {
    int lo = begin + t * chunk;
    int hi = lo + chunk < end ? lo + chunk : end;
    if (lo >= end) break;
    workers.emplace_back([lo, hi, &fn]() {
      for (int y = lo; y < hi; ++y) fn(y);
    });
  }
  int hi0 = begin + chunk < end ? begin + chunk : end;
  for (int y = begin; y < hi0; ++y) fn(y);
  for (auto& th : workers) th.join();
#else
  for (int y = begin; y < end; ++y) fn(y);
#endif
}
