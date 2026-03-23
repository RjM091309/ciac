# CIAC System - developed by 3CORE

## Firebase Phone OTP setup

Add these frontend env values (Vite):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Add one backend env value for Firebase Admin:

- `FIREBASE_SERVICE_ACCOUNT_JSON` (stringified service account JSON)
  - or `FIREBASE_SERVICE_ACCOUNT_BASE64` (base64-encoded service account JSON)

Notes:

- Users must have `phone` values stored in the `users` table in E.164 format (example: `+639171234567`).
- OTP login endpoint is `POST /api/auth/firebase-phone-login` and returns the same JWT-cookie session behavior as password login.
