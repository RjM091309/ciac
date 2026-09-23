import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { GlobalDateProvider } from './state/GlobalDateContext';
import { installFetchLoadingBar } from './lib/loadingBar';

installFetchLoadingBar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <GlobalDateProvider>
        <App />
      </GlobalDateProvider>
    </LocalizationProvider>
  </StrictMode>,
);
