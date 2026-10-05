cmake_minimum_required(VERSION 3.20)
project(vice_core C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 99)
if(MSVC)
  add_compile_options(/W4 /WX /EHsc)
else()
  add_compile_options(-Wall -Wextra -Werror)
endif()

add_library(vice_core STATIC
  src/abi.cpp
  src/color.cpp
  src/project.cpp
  src/png_filters.cpp
  src/png_writer.cpp
  src/png.cpp
  src/stream_renderer.cpp
  src/fused_4x.cpp
  src/parallel_runtime.cpp
  src/upscale.cpp
  src/metrics.cpp
  src/miniz.c
  src/miniz_tdef.c
  src/miniz_tinfl.c
)
target_include_directories(vice_core PUBLIC include PRIVATE src)
if(MSVC)
  # miniz + stb are third-party: no warnings-as-errors there.
  set_source_files_properties(src/miniz.c src/miniz_tdef.c src/miniz_tinfl.c PROPERTIES COMPILE_OPTIONS "/w")
else()
  set_source_files_properties(src/miniz.c src/miniz_tdef.c src/miniz_tinfl.c PROPERTIES COMPILE_OPTIONS "-w")
endif()

add_executable(vice_tests tests/test_all.cpp)
target_link_libraries(vice_tests PRIVATE vice_core)
target_include_directories(vice_tests PRIVATE src)
if(NOT MSVC)
  # miniz.h declares static helpers the test decoder doesn't call;
  # -Werror would fail the build on GCC/Clang otherwise.
  target_compile_options(vice_tests PRIVATE -Wno-unused-function)
endif()

add_executable(vice_eval ../tools/eval/eval.cpp ../tools/eval/stb_impl.cpp)
target_link_libraries(vice_eval PRIVATE vice_core)
target_include_directories(vice_eval PRIVATE ../tools/eval)
if(MSVC)
  # stb_image is third-party: no warnings-as-errors there.
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "/w")
else()
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "-w")
endif()

add_executable(vice_bench4x ../tools/bench4x/bench4x.cpp ../tools/eval/stb_impl.cpp)
target_link_libraries(vice_bench4x PRIVATE vice_core)
target_include_directories(vice_bench4x PRIVATE ../tools/eval)
if(MSVC)
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "/w")
else()
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "-w")
endif()

enable_testing()
add_test(NAME vice_tests COMMAND vice_tests)

# Deterministic hostile-input driver (no libFuzzer needed). Set
# VICE_SANITIZE=address,undefined for a sanitized run (GCC/Clang CI).
add_executable(vice_fuzz tests/fuzz_stream.cpp)
target_link_libraries(vice_fuzz PRIVATE vice_core)
if(DEFINED VICE_SANITIZE)
  target_compile_options(vice_fuzz PRIVATE -fsanitize=${VICE_SANITIZE} -g)
  target_link_options(vice_fuzz PRIVATE -fsanitize=${VICE_SANITIZE})
endif()
add_test(NAME vice_fuzz COMMAND vice_fuzz)
add_test(NAME vice_eval COMMAND vice_eval)
