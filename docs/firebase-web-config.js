// Browser push for the admin dashboard (OPTIONAL). Fill these in from the Firebase console to turn on instant
// notifications in a normal web browser. Leave them blank to keep browser push off (the dashboard still works and
// refreshes normally). The Android apps don't use this file. Full steps are in FCM-SETUP.md.
//
// Where each value comes from (Firebase console → Project settings):
//   apiKey, authDomain, projectId, messagingSenderId, appId  → General → Your apps → the Web app's config
//   vapidKey  → Cloud Messaging → Web configuration → "Web Push certificates" → Key pair
//
// These values are NOT secret (they only identify your Firebase project to the browser).
self.FIREBASE_WEB = {
  apiKey: "AIzaSyCB33xq9cW6Y-zVllg7PTGfc7cpS-hOd60",
  authDomain: "lazerlock-browser.firebaseapp.com",
  projectId: "lazerlock-browser",
  messagingSenderId: "380909673708",
  appId: "1:380909673708:web:d6fd586d97e9742d2f19c9",
  vapidKey: "BDkCeOpN0q1KMePEtX-q4x7VWyTgzaIJBu8s1b0dM9d07LY_6Dk9BqjhVEBTcG56jbXuhzlMacZNDp-tDJJc60E"
};
