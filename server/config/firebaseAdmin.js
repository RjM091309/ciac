const admin = require("firebase-admin");

function getServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (rawJson) {
    return JSON.parse(rawJson);
  }
  if (rawBase64) {
    const decoded = Buffer.from(rawBase64, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  return null;
}

function getFirebaseAdminApp() {
  if (admin.apps.length > 0) return admin.app();

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error("Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64.");
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function verifyFirebaseIdToken(idToken) {
  const app = getFirebaseAdminApp();
  const auth = admin.auth(app);
  return await auth.verifyIdToken(String(idToken || "").trim(), true);
}

module.exports = {
  verifyFirebaseIdToken,
};
