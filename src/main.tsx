// LifeOS — entry
import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/index.css';
import { AppProvider } from './app/store';
import { App } from './app/App';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
