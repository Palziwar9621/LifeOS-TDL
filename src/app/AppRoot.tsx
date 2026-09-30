// Lazy entry for the APP route (/app). Keeping this in its own module lets
// main.tsx code-split: public-site visitors never download the app bundle.
import React from 'react';
import { AppProvider } from './store';
import { App } from './App';

export default function AppRoot() {
  return (
    <AppProvider>
      <App />
    </AppProvider>
  );
}
