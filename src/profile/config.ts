// Firebase web config. Public by design (it only names the project); security comes from firestore.rules.
// Spark (free) plan. Set to null to run without Firebase: progress then stays on this device.
import type { FirebaseOptions } from 'firebase/app';

export const firebaseConfig: FirebaseOptions | null = {
  apiKey: 'AIzaSyAfxAfmjYVm7dQVnTWHuoL4LmYMBBZ1408',
  authDomain: 'red-vs-blue-skies.firebaseapp.com',
  projectId: 'red-vs-blue-skies',
  storageBucket: 'red-vs-blue-skies.firebasestorage.app',
  messagingSenderId: '742289024643',
  appId: '1:742289024643:web:36f531d37de639f96d5db6',
};

/** The local emulators (tests): any project id starting with demo- needs no real project. */
export const EMULATOR_CONFIG: FirebaseOptions = { apiKey: 'demo-key', authDomain: 'demo-rvbs.firebaseapp.com', projectId: 'demo-rvbs', appId: 'demo-app' };
export const EMULATOR_PORTS = { auth: 9199, firestore: 8187 };
