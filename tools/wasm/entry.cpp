// Emscripten entry: empty main so the JS glue links without a program.
// The public surface is the C ABI in core/include/vice.h, exported via
// -sEXPORTED_FUNCTIONS in core/wasm-build.sh.
int main() { return 0; }
