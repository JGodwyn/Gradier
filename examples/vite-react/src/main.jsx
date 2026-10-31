import { createRoot } from 'react-dom/client';
import { Gradient, registerGradients } from 'gradier/react';
import gradients from './gradients.json';

registerGradients(gradients);

function App() {
  return (
    <>
      <Gradient name="hero" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <h1 style={{ fontSize: 72, letterSpacing: '-0.03em' }}>Hello, gradients</h1>
      </Gradient>
      <div style={{ display: 'flex', gap: 16, padding: 32 }}>
        <Gradient name="pill" style={{ flex: 1, height: 160, borderRadius: 24 }} />
        <Gradient name="pill" style={{ flex: 1, height: 160, borderRadius: 24 }} />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
