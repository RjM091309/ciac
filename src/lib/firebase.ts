import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY as string,
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID as string,
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID as string,
};

function validateFirebaseConfig() {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing Firebase config: ${missing.join(', ')}`);
  }
}

validateFirebaseConfig();

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(app);

const rawPhoneAuthTestMode = String((import.meta as any).env?.VITE_FIREBASE_PHONE_AUTH_TEST_MODE || '').toLowerCase();
export const isFirebasePhoneAuthTestMode = rawPhoneAuthTestMode === '1' || rawPhoneAuthTestMode === 'true';
