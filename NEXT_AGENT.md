# Next Agent Notes

## Current State
- GPU renderers now expect forward/inverse LUTs. WebGPU computes them via `crtLut.wgsl`; WebGL2 consumes worker-generated LUTs and uploads them as RG16F textures.
- `CRTPostFX.svelte` integrates the LUT controller, event proxy, synthetic cursor uniforms, and adaptive capture throttling. Capture stats and logging hooks are in place but not yet validated against performance targets.
- Event proxy dispatches hit-tested pointer, wheel, click, and context-menu events back into the DOM, updating cursor uniforms and pointer activity callbacks.

## Follow-ups / Validation
- Exercise both WebGPU and WebGL2 paths in a browser to ensure shaders compile, LUT generation produces correct distortion, and pointer remapping error stays within spec (≤0.3 px mean / ≤0.8 px P95). Pay special attention to DPR > 1.
- Confirm CSS fallback remains visually correct when GPU modes are disabled (`crtEffects.applyDocumentEffects`). Ensure overlays stay inert while GPU modes are active.
- Verify the synthetic cursor rendering matches expected pointer types and button states, and that bloom attenuation via `cursorMeta.y` behaves correctly when dragging.
- Measure capture and render performance: drag interactions should throttle captures to ~30–45 FPS (`getDragThrottle`), idle mode should coast at low FPS, and bloom taps stay within budget. Adjust throttles or bloom taps if frame pacing misses the targets.
- Test event proxy focus handling, multi-touch, wheel, double click, and context menu routing (especially when canvas toggles pointer-events during hit-tests).
- Check worker bundling in the build (Vite) so `lutWorker.ts` loads correctly in production.

## Known Gaps
- No automated tests or manual validation have been run since the renderer refactor; run a smoke test across supported browsers/devices before shipping.
- Logging (`logger.debug/info`) is wired but thresholds for aggregation (e.g., 15 captures, 30 proxy samples) may need tuning once real metrics are observed.
