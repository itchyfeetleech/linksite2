// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://biolink.example.com',
  base: '',
  output: 'static',
  integrations: [
    svelte(),
    tailwind({
      configFile: 'tailwind.config.ts',
    }),
  ],
});

