import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { INDICATORS } from './chemistry/indicators';
import { SUBSTANCES } from './chemistry/substances';
import { assertDatabasesValid } from './chemistry/validation';
import './index.css';

// Static data is validated at startup: invalid chemistry data must fail loudly, never silently.
assertDatabasesValid(SUBSTANCES, INDICATORS);

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
