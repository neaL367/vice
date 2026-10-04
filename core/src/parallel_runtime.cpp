#include "vice.h"

#ifdef VICE_THREADS
#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstdlib>
#include <mutex>
#include <thread>
#include <vector>
#ifdef __EMSCRIPTEN__
#include <emscripten/threading.h>
#endif
#endif

// Override: VICE_MAX_WORKERS=N caps the pool (0/negative = ignore).
#ifdef VICE_THREADS
static int max_workers_override() {
  static int cached = [] {
#ifdef _WIN32
    char* buf = nullptr;
    size_t len = 0;
    if (_dupenv_s(&buf, &len, "VICE_MAX_WORKERS") != 0 || !buf) return 0;
    int v = std::atoi(buf);
    free(buf);
    return v;
#else
    const char* e = std::getenv("VICE_MAX_WORKERS");
    if (!e || !*e) return 0;
    return std::atoi(e);
#endif
  }();
  return cached;
}
#endif

int vice_worker_count(int n) {
#ifdef VICE_THREADS
  if (n < 32) return 1;
  int cores = 1;
#ifdef __EMSCRIPTEN__
  cores = emscripten_num_logical_cores();
  if (cores < 1) cores = 1;
  if (cores > 4) cores = 4; // must match -sPTHREAD_POOL_SIZE=4 in wasm-build.sh
#else
  unsigned hc = std::thread::hardware_concurrency();
  cores = hc ? (int)hc : 1;
  if (cores > 64) cores = 64;
#endif
  int cap = max_workers_override();
  if (cap > 0 && cores > cap) cores = cap;
  if (cores < 2) return 1;
  if (cores > n) cores = n;
  return cores;
#else
  (void)n;
  return 1;
#endif
}

int vice_thread_workers(void) {
  return vice_worker_count(1024);
}

#ifdef VICE_THREADS
namespace {

// Persistent pool: threads are created once and parked on a condition
// variable between dispatches, so a row-parallel call pays no thread
// create/join cost. The caller always participates as one more worker.
// Re-entrant calls from inside a pool worker run serially (no nesting).
constexpr int kClaimChunk = 8;

struct ThreadPool {
  std::mutex mutex;
  std::condition_variable cv;       // dispatch-start + release channel
  std::condition_variable cv_done;  // dispatch-complete channel
  void (*fn)(void*, int) = nullptr;
  void* user = nullptr;
  int range_end = 0;
  std::atomic<int> next{0};
  int done = 0;                // workers finished for the current dispatch
  unsigned long gen = 0;       // bumped once per dispatch
  bool active = false;         // a dispatch is in flight (also the nesting guard)
  bool dead = false;
  std::vector<std::thread> threads;

  static thread_local bool in_worker;

  static ThreadPool& instance() {
    static ThreadPool pool;
    return pool;
  }

  void ensure(int want_workers) {
    std::lock_guard<std::mutex> lk(mutex);
    while ((int)threads.size() < want_workers)
      threads.emplace_back([this] { this->loop(); });
  }

  void loop() {
    std::unique_lock<std::mutex> lk(mutex);
    unsigned long seen = 0; // no dispatch joined yet; first gen is 1
    for (;;) {
      // Join only a dispatch that starts after we last joined: a thread
      // spawned mid-dispatch (active, gen != seen) joins it instead of
      // parking past it. There is deliberately no separate release wait:
      // returning straight here re-validates (active, gen) every time, so
      // a worker can never sleep through a dispatch in a release handshake
      // while the caller waits for its completion count. Completion
      // accounting stays exact because every joined worker must pass
      // done++ (below) before it can park here again.
      cv.wait(lk, [&] { return dead || (active && gen != seen); });
      if (dead) return;
      seen = gen;
      lk.unlock();
      in_worker = true;
      for (;;) {
        int y = next.fetch_add(kClaimChunk, std::memory_order_relaxed);
        if (y >= range_end) break;
        int hi = y + kClaimChunk < range_end ? y + kClaimChunk : range_end;
        for (int r = y; r < hi; ++r) fn(user, r);
      }
      in_worker = false;
      lk.lock();
      if (++done == (int)threads.size()) cv_done.notify_one();
    }
  }

  // Returns false when the call must run serially: from inside a pool
  // worker, or nested inside an in-flight dispatch on the caller thread.
  bool dispatch(int begin, int end, void (*f)(void*, int), void* u) {
    if (in_worker) return false;
    {
      std::lock_guard<std::mutex> lk(mutex);
      if (active) return false;
      fn = f;
      user = u;
      range_end = end;
      next.store(begin, std::memory_order_relaxed);
      done = 0;
      active = true;
      ++gen;
    }
    cv.notify_all();
    for (;;) {
      int y = next.fetch_add(kClaimChunk, std::memory_order_relaxed);
      if (y >= end) break;
      int hi = y + kClaimChunk < end ? y + kClaimChunk : end;
      for (int r = y; r < hi; ++r) f(u, r);
    }
    {
      std::unique_lock<std::mutex> lk(mutex);
      cv_done.wait(lk, [&] { return done == (int)threads.size(); });
      active = false;
    }
    cv.notify_all();
    return true;
  }

  ~ThreadPool() {
    {
      std::lock_guard<std::mutex> lk(mutex);
      dead = true;
    }
    cv.notify_all();
    for (auto& t : threads) t.join();
  }
};

thread_local bool ThreadPool::in_worker = false;

} // namespace
#endif

void vice_parallel_for_rows_impl(int begin, int end, void (*fn)(void*, int), void* user) {
#ifdef VICE_THREADS
  int n = end - begin;
  if (n <= 0) return;
  int cores = vice_worker_count(n);
  if (cores < 2) {
    for (int y = begin; y < end; ++y) fn(user, y);
    return;
  }
  ThreadPool::instance().ensure(cores - 1); // caller is the Nth worker
  if (!ThreadPool::instance().dispatch(begin, end, fn, user)) {
    // Re-entrant or nested: pool is busy with an outer dispatch; inline is safe.
    for (int y = begin; y < end; ++y) fn(user, y);
  }
#else
  for (int y = begin; y < end; ++y) fn(user, y);
#endif
}
