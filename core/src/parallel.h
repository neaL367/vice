#pragma once
#include "parallel_runtime.h"
#include <utility>

// Backward-compatible inline wrapper
template <typename Fn>
inline void vice_parallel_for(int begin, int end, Fn&& fn) {
  vice_parallel_for_rows(begin, end, std::forward<Fn>(fn));
}
