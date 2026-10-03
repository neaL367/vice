// Minimal stand-in for upstream's generated miniz_export.h (defines empty
// export macros; we build miniz statically into vice_core, no DLL needed).
#pragma once
#define MINIZ_EXPORT
