# Firebase Setup for Vinage Cloud Sharing

Follow these steps once. It takes about 10 minutes.

---

## Step 1 — Create a Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"**
3. Name it `vinage` (or anything you like)
4. Disable Google Analytics (not needed) → **Create project**

---

## Step 2 — Enable Google Sign-In

1. In the left sidebar → **Build → Authentication**
2. Click **"Get started"**
3. Under "Sign-in method", click **Google** → toggle **Enable** → Save
4. Set your support email (your Gmail address)

---

## Step 3 — Create a Firestore database

1. Left sidebar → **Build → Firestore Database**
2. Click **"Create database"**
3. Choose **Production mode** (we'll set rules below) → **Next**
4. Pick a region close to you — e.g. `europe-west1` (Belgium/Netherlands) → **Enable**

---

## Step 4 — Set Firestore security rules

1. In Firestore → click the **Rules** tab
2. Replace everything with the following rules and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can read/write their own user doc
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // Household doc: any authenticated user may read (to look up an invite code)
    // Only members of the household may write
    match /households/{hid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        !resource.data.keys().hasAny(['members']) ||
        resource.data.members.keys().hasAny([request.auth.uid]) ||
        request.resource.data.createdBy == request.auth.uid
      );

      // Wines and cellars sub-collections — members only
      match /wines/{wineId} {
        allow read, write: if request.auth != null &&
          get(/databases/$(database)/documents/households/$(hid))
            .data.members.keys().hasAny([request.auth.uid]);
      }
      match /cellars/{cellarId} {
        allow read, write: if request.auth != null &&
          get(/databases/$(database)/documents/households/$(hid))
            .data.members.keys().hasAny([request.auth.uid]);
      }
    }
  }
}
```

---

## Step 5 — Register your web app and copy the config

1. Left sidebar → ⚙️ **Project settings** (gear icon, top-left)
2. Scroll to **"Your apps"** → click the **`</>`** (Web) icon
3. App nickname: `Vinage Web` — do **not** enable Firebase Hosting
4. Click **"Register app"**
5. You'll see a config block like this — copy it:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "vinage-XXXXX.firebaseapp.com",
  projectId:         "vinage-XXXXX",
  storageBucket:     "vinage-XXXXX.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abcdef123456"
};
```

---

## Step 6 — Paste the config into index.html

Open `index.html` in your editor and find this section near the bottom:

```js
window.FIREBASE_CONFIG = {
  // apiKey:            "AIzaSy...",
  // authDomain:        "vinage-XXXXX.firebaseapp.com",
  // ...
};
```

Replace it with your actual values (uncomment and fill in):

```js
window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "vinage-XXXXX.firebaseapp.com",
  projectId:         "vinage-XXXXX",
  storageBucket:     "vinage-XXXXX.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abcdef123456"
};
```

---

## Step 6b — Set Firebase Storage security rules

1. Left sidebar → **Build → Storage**
2. Click **"Get started"** → choose **Production mode** → same region as Firestore → Done
3. Click the **Rules** tab and replace with:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /households/{hid}/wines/{wineId} {
      allow read:  if request.auth != null;
      allow write: if request.auth != null
        && firestore.get(/databases/(default)/documents/households/$(hid))
             .data.members.keys().hasAny([request.auth.uid]);
    }
  }
}
```

4. Click **Publish**

---

## Step 7 — Add your domain to the Authorised Domains list

1. Firebase Console → **Authentication → Settings → Authorised domains**
2. Add your GitHub Pages domain: `vinage.arnoldruijterit.nl`
   (It's already there if you use firebaseapp.com, but your custom domain needs to be added.)
3. Click **Add domain**

---

## Step 8 — Deploy

```bash
git add index.html
git commit -m "Add Firebase config"
git push
```

---

## Step 9 — Using Cloud Sharing in the app

### You (first device)
1. Open the app → **Settings → Cloud Sharing**
2. Tap **"Sign in with Google"** (uses your personal Google account)
3. Tap **"Create shared cellar"**
4. A 6-character code appears (e.g. `XK4R2M`) — note it down

### Your wife (or second device)
1. Open the app → **Settings → Cloud Sharing**
2. Tap **"Sign in with Google"**
3. Enter the 6-character code → tap **"Join"**
4. Her app now shows the same wines and cellar — live sync active 🟢

---

## Notes

- **Images/thumbnails are local only** — label photos are stored on the device that scanned them (they are too large for Firestore). All other wine data syncs.
- **Offline works fine** — changes made offline are saved locally and pushed when back online.
- **Firebase free tier (Spark)** is plenty for personal use: 50K reads/day, 20K writes/day, 1 GB storage.
- If you ever want to revoke access, delete the household document in Firestore Console.
