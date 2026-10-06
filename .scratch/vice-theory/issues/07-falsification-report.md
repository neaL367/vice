# 07: Falsification report + iter-2 decision

**What to build:** `research/falsification.md` stating for each hypothesis (adaptive-λ, LRC, frequency-loop, error-bounded sharpening): survived / dead / equivalent-to-prior-art, with numbers; plus a go/no-go for the C++/WASM port against the spec gate (>0.3 dB PSNR or >0.005 SSIM on ≥2 sets, residual ≤1e-5).

**Blocked by:** 03, 04, 05, 06.

**Status:** ready-for-agent

- [ ] Per-hypothesis verdict with benchmark deltas + adversarial failures explained mathematically
- [ ] Explicit equivalence statements where measured (e.g. "w+Π ≡ TV-IBP within 0.05 dB")
- [ ] Iter-2 recommendation: port scope or stop; code-review + retro scheduled
