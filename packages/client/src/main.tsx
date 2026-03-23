import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';

// React 19 + Vite CJS interop: createRoot may be on the module directly or on .default
const mod: any = ReactDOM;
const createRoot: typeof ReactDOM.createRoot = mod.createRoot ?? mod.default?.createRoot;

try {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  );
} catch (err) {
  console.error('[main] render failed:', err);
  document.getElementById('root')!.innerHTML = '<pre style="color:red">' + String(err) + '</pre>';
}
