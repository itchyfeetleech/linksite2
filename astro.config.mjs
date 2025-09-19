// @ts-check
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';

const wgslTernaryGuard = () => ({
  name: 'wgsl-ternary-guard',
  enforce: 'pre',
  /**
   * @param {string} id
   */
  async load(id) {
    if (!id.includes('.wgsl')) {
      return undefined;
    }

    const [filepath] = id.split('?');
    if (!filepath || !filepath.endsWith('.wgsl')) {
      return undefined;
    }

    const source = await readFile(filepath, 'utf8');
    if (source.includes('?')) {
      throw new Error(
        `WGSL shader "${filepath}" contains "?"; use select() or if/else instead.`
      );
    }

    return undefined;
  }
});

const repository = process.env.GITHUB_REPOSITORY ?? '';
const [owner = '', repoName = ''] = repository.split('/');
const fallbackSite = 'https://biolink.example.com';
const isProjectPage =
  owner !== '' &&
  repoName !== '' &&
  repoName.toLowerCase() !== `${owner.toLowerCase()}.github.io`;

const site = owner ? `https://${owner}.github.io` : fallbackSite;
const base = isProjectPage ? `/${repoName}` : '';

// https://astro.build/config
export default defineConfig({
  site,
  base,
  output: 'static',
  integrations: [
    svelte(),
    tailwind({
      configFile: 'tailwind.config.ts',
    }),
  ],
  vite: {
    plugins: [
      /** @type {any} */ (wgslTernaryGuard()),
    ],
  },
});
