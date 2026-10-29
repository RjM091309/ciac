// Store links for the authenticator app, shown on both 2FA setup screens
// (first sign-in on LoginPage, and My Profile). CIAC standardises on Google
// Authenticator; any TOTP app still works with the QR / setup key.
const APP_STORE_URL = 'https://apps.apple.com/app/google-authenticator/id388497605';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';

export function AuthenticatorStoreLinks() {
  const link = 'font-semibold underline';
  return (
    <>
      No app yet? Get Google Authenticator from the{' '}
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className={link} style={{ color: 'var(--text)' }}>
        App Store
      </a>{' '}
      (iPhone) or{' '}
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className={link} style={{ color: 'var(--text)' }}>
        Google Play
      </a>{' '}
      (Android).
    </>
  );
}
