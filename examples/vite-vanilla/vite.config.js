import { defineConfig } from 'vite';
import gradier from 'gradier/vite';

export default defineConfig({
  plugins: [gradier({ file: 'src/gradients.json' })],
});
