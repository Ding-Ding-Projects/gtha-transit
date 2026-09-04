import { sites } from '@openai/sites-vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [vinext(), sites()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/tiles': 'http://127.0.0.1:8788',
    },
  },
});
