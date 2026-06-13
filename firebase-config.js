/* ============================================================
   BaglekhanScore — live sync configuration
   ------------------------------------------------------------
   Paste your Firebase web config below to turn on live
   cross-device scoring (one writer, many watchers).

   Leave it as `null` and the app runs 100% offline / local-only,
   exactly as before — every other feature still works.

   How to get this:
   1. console.firebase.google.com  →  Add project (no credit card)
   2. Build → Realtime Database → Create Database → Start in test mode
   3. Project settings (gear) → Your apps → Web (</>) → register
   4. Copy the `firebaseConfig` object and paste it here.
      The important field is `databaseURL`.
   ============================================================ */
window.FIREBASE_CONFIG = null;

/*  Example of what it should look like once filled in:

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "baglekhanscore.firebaseapp.com",
  databaseURL: "https://baglekhanscore-default-rtdb.firebaseio.com",
  projectId: "baglekhanscore",
  storageBucket: "baglekhanscore.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx"
};
*/
