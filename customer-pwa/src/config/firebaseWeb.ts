export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
};

export function firebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = publicValue(import.meta.env.VITE_FIREBASE_API_KEY);
  const authDomain = publicValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = publicValue(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const messagingSenderId = publicValue(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID);
  const appId = publicValue(import.meta.env.VITE_FIREBASE_APP_ID);
  if (!apiKey || !authDomain || !projectId || !messagingSenderId || !appId) return null;
  return { apiKey, authDomain, projectId, messagingSenderId, appId };
}

export function firebaseVapidKey(): string {
  return publicValue(import.meta.env.VITE_FIREBASE_VAPID_KEY);
}

export function firebasePushConfigured(): boolean {
  return firebaseWebConfig() !== null && firebaseVapidKey().length > 0;
}

function publicValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
