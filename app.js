/* ===== 1) Firebase config — REPLACE with your values (Phase 3 step 6) ===== */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

/* ===== 2) Init Firebase ===== */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

/* ===== 3) UI refs ===== */
const signinBtn = document.getElementById('signinBtn');
const signoutBtn = document.getElementById('signoutBtn');
const uploadLabel = document.getElementById('uploadLabel');
const fileInput = document.getElementById('fileInput');
const board = document.getElementById('board');

/* ===== 4) Auth actions ===== */
signinBtn.onclick = async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
};
signoutBtn.onclick = () => auth.signOut();

/* ===== 5) Auth state → toggle UI ===== */
auth.onAuthStateChanged(user => {
  const signedIn = !!user;
  signinBtn.style.display = signedIn ? 'none' : '';
  signoutBtn.style.display = signedIn ? '' : 'none';
  uploadLabel.style.display = signedIn ? '' : 'none';
});

/* ===== 6) Live feed (most recent first) ===== */
const q = db.collection('items').orderBy('createdAt', 'desc').limit(400);
q.onSnapshot(snap => {
  // Simple re-render for clarity
  board.innerHTML = '';
  if (snap.empty) {
    board.innerHTML = `<div class="hint">No uploads yet. Sign in and add a photo or video.</div>`;
    return;
  }
  snap.forEach(doc => {
    const it = doc.data();
    const el = document.createElement('figure');
    el.className = 'item';
    if (it.type === 'video') {
      el.innerHTML = `
        <video src="${it.url}" controls playsinline preload="metadata" poster="${it.poster || ''}"></video>
        <figcaption class="meta">${it.ownerEmail || ''} • ${it.createdAt?.toDate?.().toLocaleString?.() || ''}</figcaption>
      `;
    } else {
      el.innerHTML = `
        <img src="${it.url}" loading="lazy" alt="" />
        <figcaption class="meta">${it.ownerEmail || ''} • ${it.createdAt?.toDate?.().toLocaleString?.() || ''}</figcaption>
      `;
    }
    board.appendChild(el);
  });
});

/* ===== 4.2) Invite-only uploads: allowlist check ===== */
async function isAllowedToUpload(email) {
  // Firestore: collection 'allowedUsers' with doc IDs equal to emails
  // Example doc path: allowedUsers/alice@example.com
  const docRef = db.collection('allowedUsers').doc(email);
  const snap = await docRef.get();
  return snap.exists; // exists = allowed
}

/* ===== 7) Upload flow ===== */
fileInput.onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset input

  // Basic client-side checks
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) return alert('Only images or videos are allowed.');
  if (file.size > 20 * 1024 * 1024) return alert('Max file size is 20MB for now.');

  const user = auth.currentUser;
  if (!user) return alert('Please sign in first.');

  /* >>> Invite-only gate (4.2) — block if email not on the list <<< */
  const ok = await isAllowedToUpload(user.email);
  if (!ok) {
    alert('You are not allowed to upload yet. Ask the board owner to add your email.');
    return;
  }

  // Storage path
  const safeName = `${Date.now()}-${file.name.replace(/[^\w.-]+/g,'_')}`;
  const ref = storage.ref().child(`uploads/${user.uid}/${safeName}`);

  // Upload
  await ref.put(file);
  const url = await ref.getDownloadURL();

  // (Optional) you could generate a poster for videos server-side later
  const doc = {
    url,
    type: isVideo ? 'video' : 'image',
    ownerId: user.uid,
    ownerEmail: user.email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('items').add(doc);
};

/* ===== 8) Pan/Zoom setup ===== */
const panContainer = document.getElementById('pan-container');
const panContent = document.getElementById('pan-content');

const pz = Panzoom(panContent, {
  maxScale: 4,
  minScale: 0.5,
  step: 0.08,
  contain: 'outside', // allow panning outside container
});
panContainer.addEventListener('wheel', pz.zoomWithWheel);

/* Hint: two-finger pinch and drag work on touch devices because we set touch-action: none */
