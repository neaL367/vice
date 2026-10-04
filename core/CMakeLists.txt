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
  src/color.cpp
  src/project.cpp
  src/tile.cpp
  src/png.cpp
  src/api.cpp
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

add_executable(vice_eval ../tools/eval/eval.cpp ../tools/eval/stb_impl.cpp)
target_link_libraries(vice_eval PRIVATE vice_core)
target_include_directories(vice_eval PRIVATE ../tools/eval)
if(MSVC)
  # stb_image is third-party: no warnings-as-errors there.
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "/w")
else()
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "-w")
endif()

add_executable(vice_lab ../tools/lab/vice_lab.cpp ../tools/eval/stb_impl.cpp)
target_link_libraries(vice_lab PRIVATE vice_core)
target_include_directories(vice_lab PRIVATE ../tools/eval)
if(MSVC)
  target_compile_options(vice_lab PRIVATE /WX- /O2)
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "/w")
else()
  target_compile_options(vice_lab PRIVATE -Wno-error -O2)
  set_source_files_properties(../tools/eval/stb_impl.cpp PROPERTIES COMPILE_OPTIONS "-w")
endif()

enable_testing()
add_test(NAME vice_tests COMMAND vice_tests)
add_test(NAME vice_eval COMMAND vice_eval)
