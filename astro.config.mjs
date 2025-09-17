// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';

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
});
