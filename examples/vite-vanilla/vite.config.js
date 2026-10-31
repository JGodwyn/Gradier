import { defineConfig } from 'vite';
import gradier from 'gradier/vite';
import { cloudOrigins, cloudServer } from '../cloud-origins.js';

export default defineConfig({
  plugins: [gradier({ file: 'src/gradients.json', allowedOrigins: cloudOrigins })],
  server: cloudServer,
});
