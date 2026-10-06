# 06: Color-correct + noise/JPEG probes at 2×/4×

**What to build:** linear-light energy path (sRGB EOTF), exact-alpha handling, chroma-subsample probe, deterministic noise estimator + JPEG-block detector, each with a probe proving it changes reconstruction in the right direction (or a report that it doesn't).

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] `research/ref/color.ts`: linear-light ops, alpha-exact path, chroma 4:2:0 round-trip probe
- [ ] `research/ref/degradation.ts`: noise σ̂ + JPEG-block detectors with ROC-on-synthetics test
- [ ] Conservative-in-noise behavior test: noisy flat must not gain HF energy vs input
- [ ] No luminance/chroma regression vs grayscale path on battery
