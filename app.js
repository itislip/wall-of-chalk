/* ===== 1) Firebase config — YOUR real values ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCD_alWS3Ema1psjirtGtTOPNRIZ4gq2Rc",
  authDomain: "artifactsofus-wall.firebaseapp.com",
  projectId: "artifactsofus-wall",
  storageBucket: "artifactsofus-wall.appspot.com", // verify in Firebase Console
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
const signinBtn   = document.getElementById('signinBtn');
const signoutBtn  = document.getElementById('signoutBtn');
const uploadLabel = document.getElementById('uploadLabel');
const fileInput   = document.getElementById('fileInput');
const board       = document.getElementById('board');

/* ===== Admin config ===== */
const ADMIN_EMAILS = ["12gagegibson@gmail.com"];

/* ===== Admin UI refs ===== */
const adminPanel    = document.getElementById('adminPanel');
const addEmailInput = document.getElementById('addEmail');
const addEmailBtn   = document.getElementById('addEmailBtn');
const allowList     = document.getElementById('allowList');

/* ===== 4) Auth actions ===== */
if (signinBtn) {
  signinBtn.onclick = async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (err) {
      console.error('Sign-in failed:', err);
      alert(`Sign-in failed: ${err?.message || err}`);
    }
  };
}
if (signoutBtn) signoutBtn.onclick = () => auth.signOut();

/* ===== 5) Auth state → toggle UI (and admin panel) ===== */
auth.onAuthStateChanged(async (user) => {
  const signedIn = !!user;
  if (signinBtn)   signinBtn.style.display   = signedIn ? 'none' : '';
  if (signoutBtn)  signoutBtn.style.display  = signedIn ? '' : 'none';
  if (uploadLabel) uploadLabel.style.display = signedIn ? '' : 'none';

  // Show admin panel only for admins
  const isAdmin = signedIn && ADMIN_EMAILS.includes(user.email);
  if (adminPanel) adminPanel.style.display = isAdmin ? '' : 'none';
  if (isAdmin) refreshAllowlist();
});

/* ===== 6) Live feed (most recent first) ===== */
const q = db.collection('items').orderBy('createdAt', 'desc').limit(400);
q.onSnapshot((snap) => {
  if (!board) return;                // guard against missing DOM
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

/* ===== Admin helpers ===== */
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
    console.error('Allowlist load error:', e);
    const msg = (e && e.code === 'permission-denied')
      ? 'Access denied. Check Firestore rules and that you are signed in as the admin email.'
      : 'Error loading list.';
    allowList.innerHTML = `<li class="hint">${msg}</li>`;
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

/* ===== 7) Upload flow (progress + precise error messages) ===== */
if (fileInput) {
  fileInput.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset

    // Basic checks
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) { alert('Only images or videos are allowed.'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('Max file size is 20MB for now.'); return; }

    const user = auth.currentUser;
    if (!user) { alert('Please sign in first.'); return; }

    // UI helpers
    const originalLabel = uploadLabel.textContent;
    const setLabel  = (t) => { uploadLabel.textContent = t; uploadLabel.style.opacity = 0.6; uploadLabel.style.pointerEvents = 'none'; };
    const resetLabel = () => { uploadLabel.textContent = originalLabel || 'Upload'; uploadLabel.style.opacity = 1; uploadLabel.style.pointerEvents = ''; };

    try {
      const safeName = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
      const ref = storage.ref().child(`uploads/${user.uid}/${safeName}`);

      // Start upload with explicit metadata so contentType is preserved
      const task = ref.put(file, { contentType: file.type });
      setLabel('Uploading 0%…');

      await new Promise((resolve, reject) => {
        task.on(
          'state_changed',
          (snap) => {
            const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
            setLabel(`Uploading ${pct.toFixed(0)}%…`);
          },
          (err) => reject(err),
          () => resolve()
        );
      });

      // Get URL
      const url = await ref.getDownloadURL();

      // Firestore item (rules enforce allowlist/admin on create)
      await db.collection('items').add({
        url,
        type: isVideo ? 'video' : 'image',
        ownerId: user.uid,
        ownerEmail: user.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      resetLabel();
    } catch (err) {
      console.error('Upload failed:', err);
      const msg = String(err?.code || err?.message || err);

      if (msg.includes('storage/unauthorized') || /permission|unauthorized/i.test(msg)) {
        alert('Storage permission error. Enable Storage and verify rules. New projects may require Blaze billing to use Storage.');
      } else if (msg.includes('storage/bucket-not-found') || /No bucket/i.test(msg)) {
        alert('Bucket not found. In app.js, storageBucket must exactly match Project settings → Storage bucket.');
      } else if (msg.includes('storage/quota-exceeded')) {
        alert('Storage quota exceeded.');
      } else if (msg.includes('permission-denied')) {
        alert('Not allowed to create item. Add your email to the allowlist (Admin panel) or sign in as the admin email.');
      } else {
        alert(`Upload failed: ${msg}`);
      }
    } finally {
      resetLabel();
    }
  };
}

/* ===== 8) Pan/Zoom setup ===== */
const panContainer = document.getElementById('pan-container');
const panContent   = document.getElementById('pan-content');

if (panContainer && panContent) {
  const pz = Panzoom(panContent, {
    maxScale: 4,
    minScale: 0.5,
    step: 0.08,
    contain: 'outside',
  });
  panContainer.addEventListener('wheel', pz.zoomWithWheel);
}

/* ===== 9) Optional: quick smoke tests (run from DevTools Console) ===== */
window.smokeStorage = async () => {
  try {
    const u = auth.currentUser;
    if (!u) return console.log('Sign in first');
    console.log('Bucket in code:', firebase.app().options.storageBucket);
    const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';
    const blob = await (await fetch(dataURL)).blob();
    const name = `smoke-${Date.now()}.png`;
    const ref = storage.ref().child(`uploads/${u.uid}/${name}`);
    await ref.put(blob, { contentType: 'image/png' });
    const url = await ref.getDownloadURL();
    console.log('Storage OK. URL:', url);
    return url;
  } catch (e) {
    console.error('smokeStorage error:', e);
  }
};

window.smokeFirestore = async () => {
  try {
    const u = auth.currentUser;
    if (!u) return console.log('Sign in first');
    await db.collection('items').add({
      url: 'https://via.placeholder.com/800x500.png?text=Hello',
      type: 'image',
      ownerId: u.uid,
      ownerEmail: u.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Firestore OK — check the board for a placeholder card.');
  } catch (e) {
    console.error('smokeFirestore error:', e);
  }
};

