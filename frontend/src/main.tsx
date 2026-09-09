import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register service worker for PWA
// In dev, vite-plugin-pwa injects its own SW registration into index.html,
// so manual registration here would race it with an invalid URL. Register only in prod.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('SW registered:', registration);
      },
      (error) => {
        console.log('SW registration failed:', error);
      }
    );
  });
}

// Log PWA install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('PWA install prompt available', e);
  // Could store e for later use
});

console.log('🚀 Buja Auto Spa ERP - Offline-First Foundation Loaded');
console.log('📱 PWA Ready • IndexedDB • Sync Engine • RBAC');
