import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Global unhandled error logging
window.addEventListener('error', (event) => {
  console.error('[GLOBAL] Unhandled error:', event.error?.message || event.message, event.error?.stack);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[GLOBAL] Unhandled promise rejection:', event.reason?.message || event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
