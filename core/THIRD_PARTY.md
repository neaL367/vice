# Third-party code in core/ (all compiled in, all permissive)

- `src/miniz.{h,c}`, `src/miniz_{common,tdef,tinfl,zip}.h`, `src/miniz_{tdef,tinfl}.c`,
  `src/miniz_export.h` (stub): miniz DEFLATE/zlib, MIT (Rich Geldreich /
  RAD Game Tools / Valve). Upstream: https://github.com/richgel999/miniz
- `tools/eval/stb_image.h`: stb_image v2.30 image decoder, public domain
  (Sean Barrett). Eval-only dep, never ships in the app bundle.
