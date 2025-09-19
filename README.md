# Analog Signals – CRT Biolink

A static CRT-inspired biolink site built with Astro 4, Svelte 5 islands, and Tailwind CSS. The interface embraces analog glow, scanlines, and type-forward visuals while staying fast and accessible.

## Stack

- [Astro 4](https://astro.build/) with [Svelte 5](https://svelte.dev/) islands
- TypeScript (strict mode) and pnpm
- Tailwind CSS + PostCSS tokens scaffold
- Biome for linting/formatting
- Vitest for component tests
- Playwright + axe-core for accessibility regression checks
- GitHub Actions for CI and GitHub Pages deployment

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:4321 to explore the local preview.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Astro in dev mode with hot reloading |
| `pnpm build` | Generate the static production build in `dist/` |
| `pnpm preview` | Preview the built site locally |
| `pnpm lint` | Run Biome linting on TypeScript/JS files |
| `pnpm format` | Format supported files with Biome |
| `pnpm typecheck` | Run `astro check` for type safety |
| `pnpm test` | Execute Vitest component suite |
| `pnpm test:e2e` | Run Playwright tests with axe-core scan |
| `pnpm check` | Convenience chain for lint -> typecheck -> tests |

## Project structure

```
src/
  components/       Svelte islands
  data/             Link metadata
  layouts/          Shared Astro layouts
  pages/            Astro pages
  styles/           Tailwind and design tokens
```

GitHub Actions workflows live in `.github/workflows/`:
- `ci.yml` covers linting, type checking, unit tests, and Playwright.
- `pages.yml` builds and deploys to GitHub Pages.

## CRT rendering pipeline

The screen simulation now renders through a dedicated `<CRTPostFX>` overlay. The component captures the DOM with `html2canvas`,
uploads the frame to WebGPU (or WebGL2 via PicoGL), and applies scanlines, slot mask, vignette, noise, and optional bloom in
real time. Pointer events remain routed to the underlying DOM, so links and controls behave identically to the unprocessed view.

- Mode detection prefers WebGPU, falls back to WebGL2, then gracefully disables the GPU canvas and reuses the existing CSS/SVG
  overlays when neither API is available.
- Capture frequency throttles automatically and honours `prefers-reduced-motion`, capping the render loop to 30 FPS and
  disabling temporal noise for motion-sensitive users or hidden tabs.
- All CRT toggles live in a single Svelte store, which feeds uniforms for the shaders or CSS custom properties. The Debug
  overlay now surfaces the active render mode and exposes the same controls regardless of backend.
- A dedicated `CoordSpace` helper keeps CSS, texture, and UV coordinates in sync. html2canvas captures stay unflipped; WebGPU
  flips UVs in the vertex stage while WebGL2 relies on `UNPACK_FLIP_Y_WEBGL`. The Orientation panel in `<CRTPostFX>` previews
  the matrices, DPR, and flip flags alongside a numbered checkerboard to verify top/bottom/left/right alignment after resizes
  or DPR changes.
- LUT generation now writes to `rgba16float` textures for both forward and inverse maps. WebGPU enables linear sampling only
  when the adapter advertises float16 filtering, otherwise the fragment shader falls back to a manual four-tap bilinear lookup.
  The same RGBA16F packing feeds the PicoGL fallback through `OES_texture_half_float` so both pipelines agree on the data
  layout.
- Pointer events are proxied through a guarded dispatcher that ignores untrusted events, tracks active pointer IDs to avoid
  reentrancy, and performs microtask-based hit-tests (temporarily disabling canvas pointer events) before redispatching to the
  underlying DOM. Synthetic wheel/mouse events inherit the same guard to prevent recursive bubbling loops.

## Plugin system

Desktop apps can now be extended via JSON manifests and Svelte modules. Drop files into `public/plugins/` and `src/plugins/` and they appear in the faux taskbar automatically. See [docs/plugins.md](docs/plugins.md) for the schema, sandbox contract, and sample implementations.

## Accessibility

Playwright integrates `@axe-core/playwright` to keep the homepage free of WCAG 2.1 A/AA violations. Run `pnpm test:e2e` locally to validate before shipping.

---

Built with Astro and plenty of green glow.

