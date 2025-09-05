/* ===== 1) Firebase config — YOUR real values ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCD_alWS3Ema1psjirtGtTOPNRIZ4gq2Rc",
  authDomain: "artifactsofus-wall.firebaseapp.com",
  projectId: "artifactsofus-wall",
  storageBucket: "artifactsofus-wall.appspot.com", // <- verify in Firebase Console
  messagingSenderId: "452027716585",
  appId: "1:452027716585:web:cba1656f9b8e09080cf178",
  // measurementId is optional
};

/* ===== 2) Init Firebase (compat SDK) ===== */
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

/* ===== Admin config (CHANGE ONLY IF NEEDED) ===== */
const ADMIN_EMAILS = ["12gagegibson@gmail.com"];

/* ===== Admin UI refs ===== */
const adminPanel = document.getElementById('adminPanel');
const addEmailInput = document.getElementById('addEmail');
const addEmailBtn = document.getElementById('addEmailBtn');
const allowList = document.getElementById('allowList');

/* ===== 4) Auth actions ===== */
signinBtn.onclick = async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
};
signoutBtn.onclick = () => auth.signOut();

/* ===== 5) Auth state → toggle UI (and admin panel) ===== */
auth.onAuthStateChanged(async (user) => {
  const signedIn = !!user;
  signinBtn.style.display = signedIn ? 'none' : '';
  signoutBtn.style.display = signedIn ? '' : 'none';
  uploadLabel.style.display = signedIn ? '' : 'none';

  // Show admin panel only for admins
  const isAdmin = signedIn && ADMIN_EMAILS.includes(user.email);
  if (adminPanel) adminPanel.style.display = isAdmin ? '' : 'none';
  if (isAdmin) refreshAllowlist();
});

/* ===== 6) Live feed (most recent first) ===== */
const q = db.collection('items').orderBy('createdAt', 'desc').limit(400);
q.onSnapshot((snap) => {
  board.innerHTML = '';
  if (snap.empty) {
    board.innerHTML = `<div class="hint">No uploads yet. Sign in and add a photo or video.</div>`;
    return;
  }
  snap.forEach((doc) => {
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
  // Firestore collection 'allowedUsers' with doc IDs equal to emails
  const docRef = db.collection('allowedUsers').doc(email);
  const snap = await docRef.get();
  return snap.exists; // exists = allowed
}

/* ===== 4.2 Admin helpers ===== */
async function refreshAllowlist() {
  if (!allowList) return;
  allowList.innerHTML = '<li class="hint">Loading…</li>';
  try {
    const snap = await db.collection('allowedUsers').get();
    if (snap.empty) {
      allowList.innerHTML = '<li class="hint">No allowed users yet.</li>';
      return;
    }
    allowList.innerHTML = '';
    snap.forEach((doc) => {
      const email = doc.id;
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${email}</span>
        <button class="btn btn-ghost" data-email="${email}">Remove</button>
      `;
      allowList.appendChild(li);
    });

    // Remove buttons
    allowList.querySelectorAll('button[data-email]').forEach((btn) => {
      btn.onclick = async () => {
        const email = btn.getAttribute('data-email');
        if (!confirm(`Remove ${email} from allowlist?`)) return;
        await db.collection('allowedUsers').doc(email).delete();
        refreshAllowlist();
      };
    });
  } catch (e) {
    allowList.innerHTML = `<li class="hint">Error loading list</li>`;
    console.error(e);
  }
}

if (addEmailBtn) {
  addEmailBtn.onclick = async () => {
    const email = (addEmailInput.value || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return alert('Enter a valid email');
    await db.collection('allowedUsers').doc(email).set({
      invited: true,
      by: auth.currentUser?.email || null,
      at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    addEmailInput.value = '';
    refreshAllowlist();
  };
}

/* ===== 7) Upload flow (with progress + error surfacing) ===== */
fileInput.onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset input

  // Basic client-side checks
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) { alert('Only images or videos are allowed.'); return; }
  if (file.size > 20 * 1024 * 1024) { alert('Max file size is 20MB for now.'); return; }

  const user = auth.currentUser;
  if (!user) { alert('Please sign in first.'); return; }

  // Invite-only gate
  try {
    const ok = await isAllowedToUpload(user.email);
    if (!ok) { alert('You are not allowed to upload yet. Ask the board owner to add your email.'); return; }
  } catch (err) {
    console.error('Allowlist check failed:', err);
    alert('Could not verify permissions. Try again in a moment.');
    return;
  }

  // UI feedback
  const originalLabel = uploadLabel.textContent;
  uploadLabel.textContent = 'Uploading…';
  uploadLabel.style.opacity = 0.6;
  uploadLabel.style.pointerEvents = 'none';

  try {
    // Storage path
    const safeName = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
    const ref = storage.ref().child(`uploads/${user.uid}/${safeName}`);

    // Upload
    await ref.put(file);
    const url = await ref.getDownloadURL();

    // Save metadata
    await db.collection('items').add({
      url,
      type: isVideo ? 'video' : 'image',
      ownerId: user.uid,
      ownerEmail: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Upload failed:', err);
    alert(`Upload failed: ${err?.message || err}`);
  } finally {
    uploadLabel.style.opacity = 1;
    uploadLabel.style.pointerEvents = '';
    uploadLabel.textContent = originalLabel || 'Upload';
  }
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

