import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://lattice.pub',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
