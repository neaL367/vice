# WASM build for Windows PowerShell using emsdk
$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot
$OUT = Join-Path $ROOT "web/public/wasm"

if (-not (Test-Path $OUT)) {
    New-Item -ItemType Directory -Path $OUT -Force | Out-Null
}

if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {
    if (Test-Path "D:\emsdk\emsdk_env.ps1") {
        . "D:\emsdk\emsdk_env.ps1"
    } elseif (Test-Path "D:\emsdk") {
        $env:PATH = "D:\emsdk;D:\emsdk\upstream\emscripten;D:\emsdk\node\24.19.0_64bit;D:\emsdk\python\3.13.3_64bit;" + $env:PATH
        $env:EMSDK = "D:/emsdk"
        $env:EMSDK_NODE = "D:\emsdk\node\24.19.0_64bit\node.exe"
        $env:EMSDK_PYTHON = "D:\emsdk\python\3.13.3_64bit\python.exe"
    }
}

$sources = @(
    (Join-Path $ROOT "core/src/kernels.cpp"),
    (Join-Path $ROOT "core/src/forward.cpp"),
    (Join-Path $ROOT "core/src/descriptors.cpp"),
    (Join-Path $ROOT "core/src/regularization.cpp"),
    (Join-Path $ROOT "core/src/ibp.cpp"),
    (Join-Path $ROOT "core/src/progressive.cpp"),
    (Join-Path $ROOT "core/src/burst.cpp"),
    (Join-Path $ROOT "core/src/color.cpp"),
    (Join-Path $ROOT "core/src/api.cpp"),
    (Join-Path $ROOT "tools/wasm/entry.cpp")
)

$includeDir = Join-Path $ROOT "core/include"
$outFile = Join-Path $OUT "core.js"

Write-Host "Compiling WASM core to $outFile..."
em++ -O3 -msimd128 -flto -std=c++20 `
    -I "$includeDir" `
    @sources `
    -s MODULARIZE=1 `
    -s EXPORT_ES6=1 `
    -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' `
    -s EXPORTED_FUNCTIONS='["_vice_abi_version","_vice_upscale","_vice_upscale_progressive","_vice_upscale_ranged","_vice_upscale_burst","_vice_last_residual","_vice_build_info","_malloc","_free"]' `
    -s ALLOW_MEMORY_GROWTH=1 `
    -s INITIAL_MEMORY=67108864 `
    -s FILESYSTEM=0 `
    -s ENVIRONMENT=web,worker,node `
    -s ASSERTIONS=0 `
    -o "$outFile"

Write-Host "Build complete:"
Get-ChildItem -Path $OUT
