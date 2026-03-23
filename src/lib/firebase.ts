import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY as string,
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID as string,
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID as string,
};

export const isFirebaseClientConfigured = Object.values(firebaseConfig).every((v) =>
  String(v || '').trim(),
);

let appInstance: FirebaseApp | undefined;
let authInstance: Auth | undefined;

/**
 * Returns Firebase Auth when VITE_FIREBASE_* env vars are set; otherwise throws.
 * Phone/OTP login requires these values from the Firebase console (Project settings → Your apps).
 */
export function getFirebaseAuth(): Auth {
  if (!isFirebaseClientConfigured) {
    throw new Error(
      'Firebase client is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID in .env (see .env.example).',
    );
  }
  if (!authInstance) {
    appInstance = getApps().length ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(appInstance);
  }
  return authInstance;
}

const rawPhoneAuthTestMode = String((import.meta as any).env?.VITE_FIREBASE_PHONE_AUTH_TEST_MODE || '').toLowerCase();
export const isFirebasePhoneAuthTestMode = rawPhoneAuthTestMode === '1' || rawPhoneAuthTestMode === 'true';
