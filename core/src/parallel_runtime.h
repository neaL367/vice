#pragma once
#include <type_traits>

int vice_worker_count(int n);

void vice_parallel_for_rows_impl(int begin, int end, void (*fn)(void*, int), void* user);

template <typename Fn>
inline void vice_parallel_for_rows(int begin, int end, Fn&& fn) {
  auto trampoline = [](void* user, int y) {
    (*static_cast<typename std::remove_reference<Fn>::type*>(user))(y);
  };
  vice_parallel_for_rows_impl(begin, end, trampoline, const_cast<void*>(static_cast<const void*>(&fn)));
}
