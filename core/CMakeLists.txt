cmake_minimum_required(VERSION 3.20)
project(vice_core CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(vice STATIC
  src/kernels.cpp
  src/forward.cpp
  src/ibp.cpp
  src/color.cpp
  src/api.cpp
)
target_include_directories(vice PUBLIC include PRIVATE src)
if (MSVC)
  target_compile_options(vice PRIVATE /W4)
  add_definitions(-D_USE_MATH_DEFINES)
else()
  target_compile_options(vice PRIVATE -Wall -Wextra)
endif()

add_executable(vice_tests tests/test_all.cpp)
target_link_libraries(vice_tests PRIVATE vice)

add_executable(vice_upscale apps/vice_upscale.cpp)
target_link_libraries(vice_upscale PRIVATE vice)
