import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import gradier from 'gradier/vite';

export default defineConfig({
  plugins: [react(), gradier({ file: 'src/gradients.json' })],
});
