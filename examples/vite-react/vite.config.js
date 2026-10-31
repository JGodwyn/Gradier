import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import gradier from 'gradier/vite';
import { cloudOrigins, cloudServer } from '../cloud-origins.js';

export default defineConfig({
  plugins: [react(), gradier({ file: 'src/gradients.json', allowedOrigins: cloudOrigins })],
  server: cloudServer,
});
