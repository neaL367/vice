# 02: Adversarial battery generators

**What to build:** zero-dependency synthetic image generators (15 families from spec) producing float grayscale fixtures in-memory, each with a documented property under test (spectrum, edge, noise, transparency).

**Blocked by:** 01 (needs image buffer + metrics conventions).

**Status:** ready-for-agent

- [ ] `research/ref/adversarial.ts` generates all 15 families at parameterized sizes
- [ ] Each family documents its falsification target (e.g. Nyquist: no method may claim recovery; checkerboard: aliasing probe)
- [ ] Tests assert generator properties (e.g. sine sweep DFT peak location, step edge amplitude)
- [ ] Runs in <10 s, deterministic across runs
