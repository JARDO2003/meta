// ═══════════════════════════════════════════════════════════════════════════
// COMEO AI v4 — MODULE COLLABORATION
// Fichier : collab.js  (à charger APRÈS as.js dans index.html)
// Fonctionnalités :
//   • Sessions de collaboration (code invite 6 caractères, max 5 collaborateurs)
//   • Temps-réel Firestore (Presence, Journal partagé, Chat textuel)
//   • Appel vidéo WebRTC via Firebase Realtime Database (signaling)
//   • Vue dédiée "Espace Collaborateur" dans la sidebar
// ═══════════════════════════════════════════════════════════════════════════

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  getDatabase,
  ref,
  set,
  onValue,
  push,
  remove,
  onDisconnect,
  off,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ─────────────────────────────────────────────────────────
// 0. ATTENDRE QUE FIREBASE SOIT PRÊT (as.js l'initialise)
// ─────────────────────────────────────────────────────────
function waitCollab() {
  return new Promise((resolve) => {
    if (window._fbReady && window._collabFirebaseApp) return resolve();
    const iv = setInterval(() => {
      if (window._fbReady && window._collabFirebaseApp) {
        clearInterval(iv);
        resolve();
      }
    }, 100);
  });
}

// ─────────────────────────────────────────────────────────
// 1. INIT FIREBASE REALTIME DB (pour WebRTC signaling + presence)
//    On réutilise le même projet Firebase principal
// ─────────────────────────────────────────────────────────
async function initCollabFirebase() {
  // Attendre que as.js expose son app Firebase
  await new Promise((r) => {
    if (window._fbReady) return r();
    document.addEventListener('firebase-ready', r, { once: true });
  });

  // Importer getApp depuis firebase
  const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  try {
    window._collabFirebaseApp = getApp(); // app principale initialisée par as.js
    window._rtdb = getDatabase(window._collabFirebaseApp);
    window._collabDb = window._db; // Firestore déjà prêt
    console.log('[COLLAB] Firebase Realtime DB + Firestore prêts');
  } catch (e) {
    console.error('[COLLAB] Erreur init Firebase:', e);
  }
}

// ─────────────────────────────────────────────────────────
// 2. ÉTAT GLOBAL COLLABORATION
// ─────────────────────────────────────────────────────────
const COLLAB = {
  sessionId: null,        // ID de la session active
  sessionCode: null,      // Code d'invitation (6 chars)
  role: null,             // 'host' | 'guest'
  members: [],            // Liste des membres connectés
  unsubJournal: null,     // Listener Firestore journal partagé
  unsubChat: null,        // Listener Firestore chat
  unsubPresence: null,    // Listener Firestore presence
  myPresenceRef: null,    // Ref RTDB presence perso
  // WebRTC
  peerConnections: {},    // { uid: RTCPeerConnection }
  localStream: null,
  isVideoOpen: false,
  MAX_MEMBERS: 5,
};

// ─────────────────────────────────────────────────────────
// 3. GÉNÉRATION CODE & CRÉATION SESSION
// ─────────────────────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function creerSession() {
  if (!window.currentProfile?.id) {
    toast('Connectez-vous d\'abord', 'error');
    return;
  }
  if (COLLAB.sessionId) {
    toast('Vous êtes déjà dans une session', 'info');
    return;
  }

  const code = genCode();
  const sessionId = 'sess_' + Date.now() + '_' + window.currentProfile.id.substring(0, 8);
  const now = new Date().toISOString();

  await setDoc(doc(window._collabDb, 'collab_sessions', sessionId), {
    code,
    hostId: window.currentProfile.id,
    hostName: window.currentProfile.company || 'Hôte',
    hostEmail: window.currentProfile.email || '',
    members: [window.currentProfile.id],
    memberNames: { [window.currentProfile.id]: window.currentProfile.company },
    createdAt: now,
    active: true,
    exercice: window.currentProfile.exercice || '2024',
  });

  COLLAB.sessionId = sessionId;
  COLLAB.sessionCode = code;
  COLLAB.role = 'host';

  await setupPresence(sessionId);
  subscribeJournal(sessionId);
  subscribeChat(sessionId);
  subscribePresence(sessionId);

  renderCollabView();
  navigate('collaboration');
  afficherCodeInvitation(code);
  toast('✓ Session créée ! Code : ' + code, 'success');
}

function afficherCodeInvitation(code) {
  const el = document.getElementById('collab-code-display');
  if (el) {
    el.textContent = code;
    el.classList.add('pulse-code');
  }
  const wrap = document.getElementById('collab-invite-section');
  if (wrap) wrap.style.display = 'block';
}

// ─────────────────────────────────────────────────────────
// 4. REJOINDRE UNE SESSION (côté invité)
// ─────────────────────────────────────────────────────────
async function rejoindreSession(code) {
  if (!code) code = (document.getElementById('collab-join-code')?.value || '').trim().toUpperCase();
  if (!code || code.length !== 6) {
    toast('Code invalide (6 caractères)', 'error');
    return;
  }
  if (!window.currentProfile?.id) {
    toast('Connectez-vous d\'abord', 'error');
    return;
  }

  // Chercher la session par code
  const sessCol = collection(window._collabDb, 'collab_sessions');
  const snap = await getDocs(sessCol);
  let found = null;
  snap.forEach((d) => {
    if (d.data().code === code && d.data().active) found = { id: d.id, ...d.data() };
  });

  if (!found) {
    toast('Session introuvable ou expirée', 'error');
    return;
  }
  if (found.members.length >= COLLAB.MAX_MEMBERS + 1) {
    toast('Session complète (5 collaborateurs max)', 'error');
    return;
  }
  if (found.members.includes(window.currentProfile.id)) {
    // Déjà membre, simplement rejoindre
  } else {
    await updateDoc(doc(window._collabDb, 'collab_sessions', found.id), {
      members: arrayUnion(window.currentProfile.id),
      [`memberNames.${window.currentProfile.id}`]: window.currentProfile.company || 'Invité',
    });
  }

  COLLAB.sessionId = found.id;
  COLLAB.sessionCode = found.code;
  COLLAB.role = found.hostId === window.currentProfile.id ? 'host' : 'guest';

  await setupPresence(found.id);
  subscribeJournal(found.id);
  subscribeChat(found.id);
  subscribePresence(found.id);

  renderCollabView();
  navigate('collaboration');

  // Envoyer message système dans le chat
  await envoyerMessageChat(`👋 ${window.currentProfile.company || 'Un collaborateur'} a rejoint la session.`, true);
  toast('✓ Connecté à la session de ' + found.hostName, 'success');
}

// ─────────────────────────────────────────────────────────
// 5. PRESENCE (qui est en ligne)
// ─────────────────────────────────────────────────────────
async function setupPresence(sessionId) {
  if (!window._rtdb || !window.currentProfile?.id) return;
  const uid = window.currentProfile.id;
  const presRef = ref(window._rtdb, `collab_presence/${sessionId}/${uid}`);
  COLLAB.myPresenceRef = presRef;

  const presData = {
    uid,
    name: window.currentProfile.company || 'Utilisateur',
    email: window.currentProfile.email || '',
    online: true,
    joinedAt: new Date().toISOString(),
  };
  await set(presRef, presData);
  onDisconnect(presRef).remove();
}

function subscribePresence(sessionId) {
  const presRef = ref(window._rtdb, `collab_presence/${sessionId}`);
  onValue(presRef, (snap) => {
    COLLAB.members = [];
    snap.forEach((child) => {
      COLLAB.members.push(child.val());
    });
    renderPresenceBar();
  });
}

function renderPresenceBar() {
  const bar = document.getElementById('collab-presence-bar');
  if (!bar) return;
  bar.innerHTML = COLLAB.members.map((m) => `
    <div class="collab-member-pill" title="${m.email || m.name}">
      <span class="collab-dot"></span>
      <span>${m.name?.substring(0, 12) || 'Invité'}</span>
      ${m.uid === window.currentProfile?.id ? '<span class="collab-you">(vous)</span>' : ''}
    </div>
  `).join('');

  const countEl = document.getElementById('collab-member-count');
  if (countEl) countEl.textContent = COLLAB.members.length + ' / ' + (COLLAB.MAX_MEMBERS + 1) + ' en ligne';
}

// ─────────────────────────────────────────────────────────
// 6. JOURNAL PARTAGÉ — Synchronisation temps-réel
// ─────────────────────────────────────────────────────────
function subscribeJournal(sessionId) {
  if (COLLAB.unsubJournal) COLLAB.unsubJournal();
  const col = collection(window._collabDb, 'collab_sessions', sessionId, 'journal_partage');
  const q = query(col, orderBy('savedAt', 'asc'));
  COLLAB.unsubJournal = onSnapshot(q, (snap) => {
    const ecrs = [];
    snap.forEach((d) => ecrs.push({ ...d.data(), _docId: d.id }));
    renderJournalPartage(ecrs);
  });
}

function renderJournalPartage(ecritures) {
  const tbody = document.getElementById('collab-journal-body');
  if (!tbody) return;
  if (!ecritures.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">Aucune écriture partagée. Envoyez une écriture depuis la Saisie.</td></tr>`;
    return;
  }
  tbody.innerHTML = ecritures.map((e) => {
    const lignesHTML = (e.lignes || []).map((l) => `
      <div class="collab-ligne">
        <span class="compte">${l.compte}</span>
        <span class="lib">${l.libelle || ''}</span>
        <span class="deb">${l.debit ? fn(l.debit) : ''}</span>
        <span class="cre">${l.credit ? fn(l.credit) : ''}</span>
      </div>
    `).join('');
    const auteur = e.auteurNom || 'Inconnu';
    const isMe = e.auteurId === window.currentProfile?.id;
    return `
      <tr class="${isMe ? 'collab-mine' : ''}">
        <td>${e.date || ''}</td>
        <td><span class="jnl-badge">${e.journal || ''}</span></td>
        <td>${e.piece || ''}</td>
        <td>${e.libelle || ''}</td>
        <td><div class="collab-lignes-mini">${lignesHTML}</div></td>
        <td><span class="collab-author-tag ${isMe ? 'me' : ''}">${auteur}</span></td>
        <td>
          <div class="action-group">
            ${COLLAB.role === 'host' || isMe ? `<button class="btn-collab-action" onclick="supprimerEcriturePartagee('${e._docId}')">🗑</button>` : ''}
            <button class="btn-collab-action" onclick="importerEcriturePartagee('${e._docId}')">⬇ Importer</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function envoyerEcritureVersSession(ecriture) {
  if (!COLLAB.sessionId) {
    toast('Rejoignez une session de collaboration d\'abord', 'info');
    return;
  }
  const col = collection(window._collabDb, 'collab_sessions', COLLAB.sessionId, 'journal_partage');
  await addDoc(col, {
    ...ecriture,
    auteurId: window.currentProfile.id,
    auteurNom: window.currentProfile.company || 'Moi',
    savedAt: new Date().toISOString(),
  });
  await envoyerMessageChat(`📝 ${window.currentProfile.company} a partagé une écriture [${ecriture.journal}] — ${ecriture.libelle}`, true);
  toast('✓ Écriture envoyée à la session', 'success');
}

async function supprimerEcriturePartagee(docId) {
  if (!COLLAB.sessionId) return;
  if (!confirm('Supprimer cette écriture partagée ?')) return;
  await deleteDoc(doc(window._collabDb, 'collab_sessions', COLLAB.sessionId, 'journal_partage', docId));
  toast('Écriture supprimée du journal partagé', 'info');
}

async function importerEcriturePartagee(docId) {
  if (!COLLAB.sessionId) return;
  const snap = await getDoc(doc(window._collabDb, 'collab_sessions', COLLAB.sessionId, 'journal_partage', docId));
  if (!snap.exists()) return;
  const ecr = snap.data();
  // Importer dans le journal personnel via saveEcritureToFirestore (exposé par as.js)
  if (typeof window.saveEcritureToFirestore === 'function') {
    await window.saveEcritureToFirestore(ecr);
  } else {
    const col = collection(window._db, 'profiles', window.currentProfile.id, 'ecritures');
    await addDoc(col, { ...ecr, importedFromCollab: true, importedAt: new Date().toISOString() });
  }
  toast('✓ Écriture importée dans votre journal', 'success');
  if (typeof window.loadEcrituresFromFirestore === 'function') await window.loadEcrituresFromFirestore();
  if (typeof window.updateStats === 'function') window.updateStats();
}

// ─────────────────────────────────────────────────────────
// 7. CHAT TEXTUEL TEMPS-RÉEL
// ─────────────────────────────────────────────────────────
function subscribeChat(sessionId) {
  if (COLLAB.unsubChat) COLLAB.unsubChat();
  const col = collection(window._collabDb, 'collab_sessions', sessionId, 'chat');
  const q = query(col, orderBy('sentAt', 'asc'));
  COLLAB.unsubChat = onSnapshot(q, (snap) => {
    const msgs = [];
    snap.forEach((d) => msgs.push({ ...d.data(), id: d.id }));
    renderChat(msgs);
  });
}

function renderChat(msgs) {
  const container = document.getElementById('collab-chat-messages');
  if (!container) return;
  container.innerHTML = msgs.map((m) => {
    const isMe = m.authorId === window.currentProfile?.id;
    const isSystem = m.system === true;
    if (isSystem) {
      return `<div class="chat-system">${m.text}</div>`;
    }
    return `
      <div class="chat-msg ${isMe ? 'me' : 'them'}">
        ${!isMe ? `<div class="chat-author">${m.authorName || 'Invité'}</div>` : ''}
        <div class="chat-bubble">${escapeHtml(m.text)}</div>
        <div class="chat-time">${formatChatTime(m.sentAt)}</div>
      </div>
    `;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function envoyerMessageChat(text, system = false) {
  if (!COLLAB.sessionId) return;
  if (!text?.trim() && !system) return;
  const col = collection(window._collabDb, 'collab_sessions', COLLAB.sessionId, 'chat');
  await addDoc(col, {
    text: text.trim(),
    authorId: window.currentProfile?.id || 'anon',
    authorName: window.currentProfile?.company || 'Utilisateur',
    sentAt: new Date().toISOString(),
    system,
  });
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

async function sendChatMessage() {
  const inp = document.getElementById('collab-chat-input');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  await envoyerMessageChat(text);
}

function formatChatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────
// 8. APPEL VIDÉO — WebRTC + Firebase Realtime DB signaling
// ─────────────────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

async function demarrerAppelVideo() {
  if (!COLLAB.sessionId) {
    toast('Rejoignez une session d\'abord', 'error');
    return;
  }
  if (COLLAB.isVideoOpen) {
    toast('Appel déjà en cours', 'info');
    return;
  }

  try {
    COLLAB.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    toast('Accès caméra refusé : ' + e.message, 'error');
    return;
  }

  COLLAB.isVideoOpen = true;
  afficherVideoUI();

  // Afficher la vidéo locale
  const localVid = document.getElementById('local-video');
  if (localVid) {
    localVid.srcObject = COLLAB.localStream;
    localVid.muted = true;
  }

  // Écouter les signaux des autres membres
  const sigRef = ref(window._rtdb, `collab_rtc/${COLLAB.sessionId}/signals/${window.currentProfile.id}`);
  onValue(sigRef, async (snap) => {
    if (!snap.exists()) return;
    const signal = snap.val();
    await traiterSignal(signal);
    await remove(sigRef);
  });

  // Notifier les autres membres (offre)
  await signalerMembres();
  await envoyerMessageChat('📹 ' + (window.currentProfile.company || 'Un membre') + ' a démarré un appel vidéo.', true);
}

async function signalerMembres() {
  for (const member of COLLAB.members) {
    if (member.uid === window.currentProfile.id) continue;
    await envoyerOffer(member.uid);
  }
}

async function envoyerOffer(targetUid) {
  const pc = creerPeerConnection(targetUid);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sigRef = ref(window._rtdb, `collab_rtc/${COLLAB.sessionId}/signals/${targetUid}`);
  await set(sigRef, {
    type: 'offer',
    sdp: offer.sdp,
    fromUid: window.currentProfile.id,
    fromName: window.currentProfile.company || 'Hôte',
  });
}

async function traiterSignal(signal) {
  if (!signal || !signal.fromUid) return;
  const fromUid = signal.fromUid;

  if (signal.type === 'offer') {
    if (!COLLAB.localStream) {
      try {
        COLLAB.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        COLLAB.isVideoOpen = true;
        afficherVideoUI();
        const lv = document.getElementById('local-video');
        if (lv) { lv.srcObject = COLLAB.localStream; lv.muted = true; }
      } catch (e) {
        console.warn('[COLLAB RTC] Pas de caméra:', e.message);
        return;
      }
    }
    const pc = creerPeerConnection(fromUid);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const sigRef = ref(window._rtdb, `collab_rtc/${COLLAB.sessionId}/signals/${fromUid}`);
    await set(sigRef, {
      type: 'answer',
      sdp: answer.sdp,
      fromUid: window.currentProfile.id,
    });
  } else if (signal.type === 'answer') {
    const pc = COLLAB.peerConnections[fromUid];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
  } else if (signal.type === 'ice') {
    const pc = COLLAB.peerConnections[fromUid];
    if (pc && signal.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) {}
    }
  }
}

function creerPeerConnection(uid) {
  if (COLLAB.peerConnections[uid]) return COLLAB.peerConnections[uid];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  COLLAB.peerConnections[uid] = pc;

  // Ajouter les tracks locaux
  if (COLLAB.localStream) {
    COLLAB.localStream.getTracks().forEach((t) => pc.addTrack(t, COLLAB.localStream));
  }

  // ICE candidates
  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    const sigRef = ref(window._rtdb, `collab_rtc/${COLLAB.sessionId}/signals/${uid}`);
    await set(sigRef, {
      type: 'ice',
      candidate: e.candidate.toJSON(),
      fromUid: window.currentProfile.id,
    });
  };

  // Track distant
  pc.ontrack = (e) => {
    afficherVideoDistant(uid, e.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    console.log('[COLLAB RTC] State:', uid, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      supprimerVideoDistant(uid);
    }
  };

  return pc;
}

function afficherVideoDistant(uid, stream) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  let existing = document.getElementById('vid-' + uid);
  if (!existing) {
    const wrap = document.createElement('div');
    wrap.className = 'video-tile';
    wrap.id = 'vid-' + uid;
    const name = COLLAB.members.find((m) => m.uid === uid)?.name || 'Invité';
    wrap.innerHTML = `
      <video autoplay playsinline></video>
      <div class="vid-label">${escapeHtml(name)}</div>
    `;
    grid.appendChild(wrap);
    existing = wrap;
  }
  const vid = existing.querySelector('video');
  if (vid) vid.srcObject = stream;
}

function supprimerVideoDistant(uid) {
  document.getElementById('vid-' + uid)?.remove();
  if (COLLAB.peerConnections[uid]) {
    COLLAB.peerConnections[uid].close();
    delete COLLAB.peerConnections[uid];
  }
}

function afficherVideoUI() {
  const panel = document.getElementById('video-panel');
  if (panel) panel.style.display = 'flex';
}

async function terminerAppel() {
  COLLAB.isVideoOpen = false;
  if (COLLAB.localStream) {
    COLLAB.localStream.getTracks().forEach((t) => t.stop());
    COLLAB.localStream = null;
  }
  Object.values(COLLAB.peerConnections).forEach((pc) => pc.close());
  COLLAB.peerConnections = {};

  // Nettoyer signaux RTDB
  if (window._rtdb && COLLAB.sessionId && window.currentProfile?.id) {
    const sigRef = ref(window._rtdb, `collab_rtc/${COLLAB.sessionId}/signals/${window.currentProfile.id}`);
    await remove(sigRef);
  }

  const panel = document.getElementById('video-panel');
  if (panel) panel.style.display = 'none';
  toast('Appel terminé', 'info');
}

function toggleMicro() {
  if (!COLLAB.localStream) return;
  const track = COLLAB.localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = document.getElementById('btn-toggle-mic');
  if (btn) btn.textContent = track.enabled ? '🎤 Micro ON' : '🔇 Micro OFF';
}

function toggleCamera() {
  if (!COLLAB.localStream) return;
  const track = COLLAB.localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = document.getElementById('btn-toggle-cam');
  if (btn) btn.textContent = track.enabled ? '📷 Caméra ON' : '📷 Caméra OFF';
}

// ─────────────────────────────────────────────────────────
// 9. QUITTER / FERMER SESSION
// ─────────────────────────────────────────────────────────
async function quitterSession() {
  if (!COLLAB.sessionId) return;
  if (!confirm('Quitter la session de collaboration ?')) return;

  // Terminer appel si en cours
  if (COLLAB.isVideoOpen) await terminerAppel();

  // Retirer de la presence
  if (COLLAB.myPresenceRef) await remove(COLLAB.myPresenceRef);

  // Se retirer des membres
  try {
    await updateDoc(doc(window._collabDb, 'collab_sessions', COLLAB.sessionId), {
      members: arrayRemove(window.currentProfile.id),
    });
  } catch (e) {}

  // Si hôte, fermer la session
  if (COLLAB.role === 'host') {
    await updateDoc(doc(window._collabDb, 'collab_sessions', COLLAB.sessionId), { active: false });
  }

  // Désabonnements
  if (COLLAB.unsubJournal) COLLAB.unsubJournal();
  if (COLLAB.unsubChat) COLLAB.unsubChat();
  if (window._rtdb && COLLAB.sessionId) {
    const presRef = ref(window._rtdb, `collab_presence/${COLLAB.sessionId}`);
    off(presRef);
  }

  COLLAB.sessionId = null;
  COLLAB.sessionCode = null;
  COLLAB.role = null;
  COLLAB.members = [];

  navigate('dashboard');
  toast('Session quittée', 'info');
  renderCollabView();
}

// ─────────────────────────────────────────────────────────
// 10. RENDU DE LA VUE COLLABORATION
// ─────────────────────────────────────────────────────────
function renderCollabView() {
  const view = document.getElementById('view-collaboration');
  if (!view) return;

  const inSession = !!COLLAB.sessionId;
  const isHost = COLLAB.role === 'host';

  view.innerHTML = `
    <!-- VIDEO PANEL (masqué par défaut) -->
    <div id="video-panel" class="video-panel" style="display:none">
      <div class="video-panel-header">
        <span class="video-title">📹 Appel vidéo COMEO</span>
        <div class="video-controls">
          <button class="btn-vid-ctrl" id="btn-toggle-mic" onclick="window.toggleMicro()">🎤 Micro ON</button>
          <button class="btn-vid-ctrl" id="btn-toggle-cam" onclick="window.toggleCamera()">📷 Caméra ON</button>
          <button class="btn-vid-ctrl btn-vid-end" onclick="window.terminerAppel()">⬛ Terminer</button>
        </div>
      </div>
      <div class="video-grid" id="video-grid">
        <div class="video-tile local-tile">
          <video id="local-video" autoplay muted playsinline></video>
          <div class="vid-label">${escapeHtml(window.currentProfile?.company || 'Vous')} (vous)</div>
        </div>
      </div>
    </div>

    <!-- HEADER PAGE -->
    <div class="ph">
      <div>
        <h1>Espace Collaborateur</h1>
        <p>Travaillez ensemble sur un journal en temps réel · jusqu'à 5 collaborateurs</p>
      </div>
      <div class="ph-actions">
        ${inSession ? `
          <button class="btn btn-sm-wire" onclick="window.demarrerAppelVideo()">📹 Appel vidéo</button>
          <button class="btn btn-danger-outline" onclick="window.quitterSession()">⏻ Quitter</button>
        ` : ''}
      </div>
    </div>

    ${!inSession ? `
    <!-- PAS DE SESSION -->
    <div class="collab-onboarding">
      <div class="collab-cards-row">

        <!-- Créer session -->
        <div class="collab-onboard-card">
          <div class="colob-icon">🚀</div>
          <h3>Créer une session</h3>
          <p>Vous obtenez un code à 6 caractères à partager avec vos collaborateurs.</p>
          <button class="btn btn-ink btn-block" onclick="window.creerSession()">+ Créer ma session</button>
        </div>

        <!-- Rejoindre -->
        <div class="collab-onboard-card">
          <div class="colob-icon">🔗</div>
          <h3>Rejoindre une session</h3>
          <p>Entrez le code reçu de votre collaborateur pour travailler ensemble.</p>
          <input type="text" id="collab-join-code" class="collab-code-input"
            placeholder="Ex : AB3X7Z" maxlength="6"
            style="text-transform:uppercase"
            onkeydown="if(event.key==='Enter') window.rejoindreSession()">
          <button class="btn btn-outline btn-block" style="margin-top:10px" onclick="window.rejoindreSession()">→ Rejoindre</button>
        </div>

      </div>

      <div class="collab-how">
        <h4>Comment ça marche ?</h4>
        <div class="collab-steps">
          <div class="collab-step"><span class="step-num">1</span><span>L'hôte crée une session → code généré automatiquement</span></div>
          <div class="collab-step"><span class="step-num">2</span><span>Il partage le code par WhatsApp / SMS avec ses collaborateurs</span></div>
          <div class="collab-step"><span class="step-num">3</span><span>Chaque invité entre le code dans son COMEO (depuis chez lui)</span></div>
          <div class="collab-step"><span class="step-num">4</span><span>Tout le monde voit et modifie le journal partagé en temps réel</span></div>
          <div class="collab-step"><span class="step-num">5</span><span>Appel vidéo intégré pour travailler ensemble à distance</span></div>
        </div>
      </div>
    </div>
    ` : `
    <!-- SESSION ACTIVE -->
    <div class="collab-session-layout">

      <!-- PARTIE GAUCHE : Journal partagé + Chat -->
      <div class="collab-main">

        <!-- Barre session -->
        <div class="collab-session-bar">
          <div class="collab-session-info">
            <span class="sess-role-badge ${isHost ? 'host' : 'guest'}">${isHost ? '👑 Hôte' : '👤 Collaborateur'}</span>
            <span class="sess-code">Code : <strong>${COLLAB.sessionCode}</strong></span>
            ${isHost ? `<button class="btn-copy-code" onclick="navigator.clipboard.writeText('${COLLAB.sessionCode}');toast('Code copié !','success')" title="Copier le code">📋</button>` : ''}
          </div>
          <div id="collab-presence-bar" class="collab-presence-bar"></div>
          <div id="collab-member-count" class="collab-member-count">0 en ligne</div>
        </div>

        ${isHost ? `
        <!-- SECTION CODE INVITATION (hôte uniquement) -->
        <div class="collab-invite-box" id="collab-invite-section">
          <div class="inv-icon">🔑</div>
          <div class="inv-text">
            <strong>Code d'invitation</strong>
            <p>Partagez ce code avec vos collaborateurs (max 5)</p>
          </div>
          <div class="inv-code" id="collab-code-display">${COLLAB.sessionCode}</div>
          <button class="btn btn-sm-wire" onclick="navigator.clipboard.writeText('${COLLAB.sessionCode}');toast('Code copié !','success')">📋 Copier</button>
        </div>
        ` : ''}

        <!-- JOURNAL PARTAGÉ -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-title" style="margin-bottom:12px">
            📋 Journal partagé — Temps réel
            <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:8px">Toutes les écritures envoyées par les membres</span>
          </div>

          <!-- Bouton envoyer depuis saisie -->
          <div style="margin-bottom:12px">
            <button class="btn btn-ink btn-sm" onclick="window.ouvrirModalEnvoiEcriture()">
              ⬆ Envoyer une écriture vers la session
            </button>
          </div>

          <div style="overflow-x:auto">
            <table class="dt collab-journal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Journal</th>
                  <th>Pièce</th>
                  <th>Libellé</th>
                  <th>Lignes</th>
                  <th>Auteur</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="collab-journal-body">
                <tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">En attente d'écritures…</td></tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- PARTIE DROITE : Chat -->
      <div class="collab-sidebar-chat">
        <div class="chat-header">
          <span>💬 Chat d'équipe</span>
          <span style="font-size:10px;color:var(--muted)">Temps réel</span>
        </div>
        <div class="chat-messages" id="collab-chat-messages"></div>
        <div class="chat-input-row">
          <textarea id="collab-chat-input" class="chat-textarea"
            placeholder="Message…" rows="2"
            onkeydown="window.handleChatKeydown(event)"></textarea>
          <button class="btn-chat-send" onclick="window.sendChatMessage()">➤</button>
        </div>
      </div>

    </div>
    `}
  `;

  // Modal envoi écriture
  renderModalEnvoiEcriture();
}

// ─────────────────────────────────────────────────────────
// 11. MODAL : Sélectionner une écriture à envoyer
// ─────────────────────────────────────────────────────────
function ouvrirModalEnvoiEcriture() {
  const modal = document.getElementById('collab-send-modal');
  if (modal) {
    modal.style.display = 'flex';
    remplirListeEcritures();
  }
}

function fermerModalEnvoiEcriture() {
  const modal = document.getElementById('collab-send-modal');
  if (modal) modal.style.display = 'none';
}

function renderModalEnvoiEcriture() {
  // Créer le modal s'il n'existe pas
  if (document.getElementById('collab-send-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'collab-send-modal';
  modal.className = 'modal-overlay';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal-box" style="width:640px;max-height:80vh;overflow-y:auto">
      <div class="modal-title">⬆ Envoyer une écriture vers la session</div>
      <div class="modal-sub">Sélectionnez une écriture de votre journal à partager avec la session</div>
      <div id="collab-ecr-list" style="margin:16px 0"></div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-modal-cancel" onclick="window.fermerModalEnvoiEcriture()">Annuler</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function remplirListeEcritures() {
  const container = document.getElementById('collab-ecr-list');
  if (!container) return;
  const ecrs = window.ecritures || [];
  if (!ecrs.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center">Aucune écriture dans votre journal.</p>';
    return;
  }
  container.innerHTML = ecrs.slice(-30).reverse().map((e, i) => `
    <div class="collab-ecr-select-row" onclick="window.envoyerEcritureChoisie(${i})">
      <span class="jnl-badge">${e.journal}</span>
      <span>${e.date || ''}</span>
      <span style="flex:1">${e.libelle || 'Sans libellé'}</span>
      <span>${e.piece || ''}</span>
      <button class="btn btn-sm-wire" onclick="event.stopPropagation();window.envoyerEcritureChoisie(${i})">Envoyer</button>
    </div>
  `).join('');
}

async function envoyerEcritureChoisie(idx) {
  const ecrs = (window.ecritures || []).slice(-30).reverse();
  const ecr = ecrs[idx];
  if (!ecr) return;
  fermerModalEnvoiEcriture();
  await envoyerEcritureVersSession(ecr);
}

// ─────────────────────────────────────────────────────────
// 12. EXPOSITIONS GLOBALES
// ─────────────────────────────────────────────────────────
window.creerSession = creerSession;
window.rejoindreSession = rejoindreSession;
window.quitterSession = quitterSession;
window.demarrerAppelVideo = demarrerAppelVideo;
window.terminerAppel = terminerAppel;
window.toggleMicro = toggleMicro;
window.toggleCamera = toggleCamera;
window.sendChatMessage = sendChatMessage;
window.handleChatKeydown = handleChatKeydown;
window.envoyerEcritureVersSession = envoyerEcritureVersSession;
window.supprimerEcriturePartagee = supprimerEcriturePartagee;
window.importerEcriturePartagee = importerEcriturePartagee;
window.ouvrirModalEnvoiEcriture = ouvrirModalEnvoiEcriture;
window.fermerModalEnvoiEcriture = fermerModalEnvoiEcriture;
window.envoyerEcritureChoisie = envoyerEcritureChoisie;
window.renderCollabView = renderCollabView;

// Raccourci fn (si as.js ne l'a pas encore exposé)
function fn(n) {
  return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

// ─────────────────────────────────────────────────────────
// 13. PATCH navigate() — Ajouter la vue collaboration
// ─────────────────────────────────────────────────────────
document.addEventListener('firebase-ready', async () => {
  await initCollabFirebase();

  // Patcher navigate pour supporter 'collaboration'
  const _origNavigate = window.navigate;
  window.navigate = function(view) {
    if (view === 'collaboration') {
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      const v = document.getElementById('view-collaboration');
      if (v) v.classList.add('active');
      document.querySelectorAll('.nav-item').forEach((n) => {
        if (n.textContent.toLowerCase().includes('collab')) n.classList.add('active');
      });
      renderCollabView();
    } else {
      _origNavigate(view);
    }
  };
});