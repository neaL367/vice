#include "vice.h"

#ifdef VICE_THREADS
#include <thread>
#include <vector>
#ifdef __EMSCRIPTEN__
#include <emscripten/threading.h>
#endif
#endif

int vice_worker_count(int n) {
#ifdef VICE_THREADS
  int cores = 1;
#ifdef __EMSCRIPTEN__
  cores = emscripten_num_logical_cores();
#else
  unsigned hc = std::thread::hardware_concurrency();
  cores = hc ? (int)hc : 1;
#endif
  if (cores < 1) cores = 1;
  if (cores > 4) cores = 4;
  if (n < 32 || cores < 2) return 1;
  return cores;
#else
  (void)n;
  return 1;
#endif
}

int vice_thread_workers(void) {
  return vice_worker_count(1024);
}

void vice_parallel_for_rows_impl(int begin, int end, void (*fn)(void*, int), void* user) {
#ifdef VICE_THREADS
  int n = end - begin;
  int cores = vice_worker_count(n);
  if (cores < 2) {
    for (int y = begin; y < end; ++y) fn(user, y);
    return;
  }
  std::vector<std::thread> workers;
  workers.reserve((size_t)(cores - 1));
  int chunk = (n + cores - 1) / cores;
  for (int t = 1; t < cores; ++t) {
    int lo = begin + t * chunk;
    int hi = lo + chunk < end ? lo + chunk : end;
    if (lo >= end) break;
    workers.emplace_back([lo, hi, fn, user]() {
      for (int y = lo; y < hi; ++y) fn(user, y);
    });
  }
  int hi0 = begin + chunk < end ? begin + chunk : end;
  for (int y = begin; y < hi0; ++y) fn(user, y);
  for (auto& th : workers) th.join();
#else
  for (int y = begin; y < end; ++y) fn(user, y);
#endif
}
