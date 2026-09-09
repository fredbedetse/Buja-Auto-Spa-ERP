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
if ('serviceWorker' in navigator) {
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
