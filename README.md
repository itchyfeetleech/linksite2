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

## Plugin system

Desktop apps can now be extended via JSON manifests and Svelte modules. Drop files into `public/plugins/` and `src/plugins/` and they appear in the faux taskbar automatically. See [docs/plugins.md](docs/plugins.md) for the schema, sandbox contract, and sample implementations.

## Accessibility

Playwright integrates `@axe-core/playwright` to keep the homepage free of WCAG 2.1 A/AA violations. Run `pnpm test:e2e` locally to validate before shipping.

---

Built with Astro and plenty of green glow.

