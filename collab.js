import {
  getDatabase,
  ref,
  set,
  onValue,
  remove,
  onDisconnect,
  off,
  push,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  onSnapshot,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─────────────────────────────────────────────────────────
// 0. ATTENDRE FIREBASE (as.js dispatch "firebase-ready")
// ─────────────────────────────────────────────────────────
function waitFB() {
  return new Promise((r) => {
    if (window._fbReady) return r();
    document.addEventListener('firebase-ready', r, { once: true });
  });
}

// ─────────────────────────────────────────────────────────
// 1. VARIABLES GLOBALES
// ─────────────────────────────────────────────────────────
let _rtdb = null;

const C = {
  sessionId: null,
  sessionCode: null,
  role: null,         // 'host' | 'guest'
  members: [],
  unsubJournal: null,
  unsubChat: null,
  myPresRef: null,
  peerConnections: {},
  localStream: null,
  isVideoOpen: false,
  MAX_MEMBERS: 5,
};

// helpers Firestore (réutilisent ce qu'as.js expose)
function col(...args)   { return window._fbCollection(window._db, ...args); }
function docRef(...args){ return window._fbDoc(window._db, ...args); }
function addD(colRef, data) { return window._fbAddDoc(colRef, data); }
function getD(docR)     { return window._fbGetDoc(docR); }
function getDs(colR)    { return window._fbGetDocs(colR); }
function setD(docR, data, opts) { return window._fbSetDoc(docR, data, opts); }
function delD(docR)     { return window._fbDeleteDoc(docR); }
function q(colR, ...constraints){ return window._fbQuery(colR, ...constraints); }
function orderBy(f, d)  { return window._fbOrderBy(f, d); }

function fn(n) {
  return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }
  catch(e){ return ''; }
}
function toast(msg, type) {
  if (typeof window.toast === 'function') window.toast(msg, type);
  else console.log('[COLLAB]', msg);
}

// ─────────────────────────────────────────────────────────
// 2. INIT REALTIME DB
// ─────────────────────────────────────────────────────────
async function initRTDB() {
  await waitFB();
  try {
    const app = getApp();
    _rtdb = getDatabase(app);
  } catch(e) {
    console.error('[COLLAB] RTDB init error:', e);
  }
}

// ─────────────────────────────────────────────────────────
// 3. GÉNÉRER CODE & CRÉER SESSION
// ─────────────────────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

async function creerSession() {
  if (!window.currentProfile?.id) { toast('Connectez-vous d\'abord','error'); return; }
  if (C.sessionId) { toast('Déjà dans une session','info'); return; }

  const code = genCode();
  const sid  = 'sess_' + Date.now() + '_' + window.currentProfile.id.slice(0,8);

  await setD(docRef('collab_sessions', sid), {
    code,
    hostId:   window.currentProfile.id,
    hostName: window.currentProfile.company || 'Hôte',
    members:  [window.currentProfile.id],
    memberNames: { [window.currentProfile.id]: window.currentProfile.company || 'Hôte' },
    createdAt: new Date().toISOString(),
    active: true,
  });

  C.sessionId   = sid;
  C.sessionCode = code;
  C.role        = 'host';

  await setupPresence(sid);
  subscribeJournal(sid);
  subscribeChat(sid);
  renderCollabView();
  window.navigate('collaboration');
  toast('✓ Session créée ! Code : ' + code, 'success');
}

// ─────────────────────────────────────────────────────────
// 4. REJOINDRE SESSION
// ─────────────────────────────────────────────────────────
async function rejoindreSession(code) {
  if (!code) code = (document.getElementById('collab-join-code')?.value||'').trim().toUpperCase();
  if (!code || code.length !== 6) { toast('Code invalide (6 caractères)','error'); return; }
  if (!window.currentProfile?.id) { toast('Connectez-vous d\'abord','error'); return; }

  const snap = await getDs(col('collab_sessions'));
  let found = null;
  snap.forEach(d => { if (d.data().code===code && d.data().active) found={id:d.id,...d.data()}; });

  if (!found) { toast('Session introuvable ou expirée','error'); return; }
  if (found.members.length > C.MAX_MEMBERS) { toast('Session complète (5 max)','error'); return; }

  if (!found.members.includes(window.currentProfile.id)) {
    await updateDoc(docRef('collab_sessions', found.id), {
      members: arrayUnion(window.currentProfile.id),
      [`memberNames.${window.currentProfile.id}`]: window.currentProfile.company || 'Invité',
    });
  }

  C.sessionId   = found.id;
  C.sessionCode = found.code;
  C.role        = found.hostId === window.currentProfile.id ? 'host' : 'guest';

  await setupPresence(found.id);
  subscribeJournal(found.id);
  subscribeChat(found.id);

  renderCollabView();
  window.navigate('collaboration');
  await envoyerMsgChat(`👋 ${window.currentProfile.company||'Un membre'} a rejoint la session.`, true);
  toast('✓ Connecté à la session de ' + found.hostName, 'success');
}

// ─────────────────────────────────────────────────────────
// 5. PRESENCE (Realtime DB)
// ─────────────────────────────────────────────────────────
async function setupPresence(sid) {
  if (!_rtdb || !window.currentProfile?.id) return;
  const uid = window.currentProfile.id;
  const presRef = ref(_rtdb, `collab_presence/${sid}/${uid}`);
  C.myPresRef = presRef;
  await set(presRef, {
    uid,
    name:  window.currentProfile.company || 'Utilisateur',
    email: window.currentProfile.email || '',
    online: true,
    joinedAt: new Date().toISOString(),
  });
  onDisconnect(presRef).remove();

  // Écouter tous les membres
  const allRef = ref(_rtdb, `collab_presence/${sid}`);
  onValue(allRef, snap => {
    C.members = [];
    snap.forEach(child => C.members.push(child.val()));
    renderPresenceBar();
  });
}

function renderPresenceBar() {
  const bar = document.getElementById('collab-presence-bar');
  if (!bar) return;
  bar.innerHTML = C.members.map(m => `
    <div class="collab-member-pill" title="${esc(m.email||m.name)}">
      <span class="collab-dot"></span>
      <span>${esc((m.name||'Invité').substring(0,14))}</span>
      ${m.uid===window.currentProfile?.id ? '<span class="collab-you">(vous)</span>' : ''}
    </div>
  `).join('');
  const cnt = document.getElementById('collab-member-count');
  if (cnt) cnt.textContent = C.members.length + ' en ligne';
}

// ─────────────────────────────────────────────────────────
// 6. JOURNAL PARTAGÉ (Firestore onSnapshot)
// ─────────────────────────────────────────────────────────
function subscribeJournal(sid) {
  if (C.unsubJournal) C.unsubJournal();
  const cRef = q(col('collab_sessions', sid, 'journal_partage'), orderBy('savedAt','asc'));
  C.unsubJournal = onSnapshot(cRef, snap => {
    const ecrs = [];
    snap.forEach(d => ecrs.push({...d.data(), _docId: d.id}));
    renderJournalPartage(ecrs);
  });
}

function renderJournalPartage(ecritures) {
  const tbody = document.getElementById('collab-journal-body');
  if (!tbody) return;
  if (!ecritures.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">
      Aucune écriture partagée — envoyez une écriture depuis la Saisie.
    </td></tr>`;
    return;
  }
  tbody.innerHTML = ecritures.map(e => {
    const isMe = e.auteurId === window.currentProfile?.id;
    const lignesHTML = (e.lignes||[]).map(l => `
      <div class="collab-ligne">
        <span class="compte">${esc(l.compte)}</span>
        <span class="lib">${esc((l.libelle||'').substring(0,20))}</span>
        <span class="deb">${l.debit ? fn(l.debit) : ''}</span>
        <span class="cre">${l.credit ? fn(l.credit) : ''}</span>
      </div>`).join('');
    return `<tr class="${isMe?'collab-mine':''}">
      <td>${esc(e.date||'')}</td>
      <td><span class="jnl-badge">${esc(e.journal||'')}</span></td>
      <td>${esc(e.piece||'')}</td>
      <td>${esc(e.libelle||'')}</td>
      <td><div class="collab-lignes-mini">${lignesHTML}</div></td>
      <td><span class="collab-author-tag ${isMe?'me':''}">${esc(e.auteurNom||'?')}</span></td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${C.role==='host'||isMe ? `<button class="btn-collab-action" onclick="window._collabSupprimerEcr('${e._docId}')">🗑</button>` : ''}
          <button class="btn-collab-action" onclick="window._collabImporterEcr('${e._docId}')">⬇ Importer</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function envoyerEcritureVersSession(ecriture) {
  if (!C.sessionId) { toast('Rejoignez une session d\'abord','info'); return; }
  await addD(col('collab_sessions', C.sessionId, 'journal_partage'), {
    ...ecriture,
    auteurId:  window.currentProfile.id,
    auteurNom: window.currentProfile.company || 'Moi',
    savedAt:   new Date().toISOString(),
  });
  await envoyerMsgChat(`📝 ${window.currentProfile.company} a partagé [${ecriture.journal}] — ${ecriture.libelle}`, true);
  toast('✓ Écriture envoyée à la session','success');
}

window._collabSupprimerEcr = async function(docId) {
  if (!C.sessionId) return;
  if (!confirm('Supprimer cette écriture du journal partagé ?')) return;
  await delD(docRef('collab_sessions', C.sessionId, 'journal_partage', docId));
  toast('Écriture supprimée','info');
};

window._collabImporterEcr = async function(docId) {
  if (!C.sessionId) return;
  const snap = await getD(docRef('collab_sessions', C.sessionId, 'journal_partage', docId));
  if (!snap.exists()) return;
  const ecr = snap.data();
  const cRef = col('profiles', window.currentProfile.id, 'ecritures');
  await addD(cRef, {...ecr, importedFromCollab:true, importedAt: new Date().toISOString()});
  toast('✓ Écriture importée dans votre journal','success');
  if (typeof window.loadEcrituresFromFirestore==='function') await window.loadEcrituresFromFirestore();
  if (typeof window.updateStats==='function') window.updateStats();
};

// ─────────────────────────────────────────────────────────
// 7. CHAT TEMPS-RÉEL (Firestore onSnapshot)
// ─────────────────────────────────────────────────────────
function subscribeChat(sid) {
  if (C.unsubChat) C.unsubChat();
  const cRef = q(col('collab_sessions', sid, 'chat'), orderBy('sentAt','asc'));
  C.unsubChat = onSnapshot(cRef, snap => {
    const msgs = [];
    snap.forEach(d => msgs.push({...d.data(), id:d.id}));
    renderChat(msgs);
  });
}

function renderChat(msgs) {
  const box = document.getElementById('collab-chat-messages');
  if (!box) return;
  box.innerHTML = msgs.map(m => {
    const isMe = m.authorId === window.currentProfile?.id;
    if (m.system) return `<div class="chat-system">${esc(m.text)}</div>`;
    return `<div class="chat-msg ${isMe?'me':'them'}">
      ${!isMe ? `<div class="chat-author">${esc(m.authorName||'Invité')}</div>` : ''}
      <div class="chat-bubble">${esc(m.text)}</div>
      <div class="chat-time">${fmtTime(m.sentAt)}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function envoyerMsgChat(text, system=false) {
  if (!C.sessionId || (!text?.trim() && !system)) return;
  await addD(col('collab_sessions', C.sessionId, 'chat'), {
    text: text.trim(),
    authorId:   window.currentProfile?.id || 'anon',
    authorName: window.currentProfile?.company || 'Utilisateur',
    sentAt:     new Date().toISOString(),
    system,
  });
}

window._collabChatKeydown = function(e) {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); window._collabSendMsg(); }
};

window._collabSendMsg = async function() {
  const inp = document.getElementById('collab-chat-input');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  await envoyerMsgChat(text);
};

// ─────────────────────────────────────────────────────────
// 8. APPEL VIDÉO — WebRTC + Firebase RTDB signaling
// ─────────────────────────────────────────────────────────
const RTC_CFG = { iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}] };

window._collabDemarrerVideo = async function() {
  if (!C.sessionId) { toast('Rejoignez une session d\'abord','error'); return; }
  if (C.isVideoOpen) { toast('Appel déjà en cours','info'); return; }
  try {
    C.localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
  } catch(e) { toast('Accès caméra refusé : '+e.message,'error'); return; }

  C.isVideoOpen = true;
  const panel = document.getElementById('video-panel');
  if (panel) panel.style.display = 'flex';
  const lv = document.getElementById('local-video');
  if (lv) { lv.srcObject = C.localStream; lv.muted = true; }

  // Écouter les signaux entrants (RTDB)
  if (_rtdb && window.currentProfile?.id) {
    const sigRef = ref(_rtdb, `collab_rtc/${C.sessionId}/signals/${window.currentProfile.id}`);
    onValue(sigRef, async snap => {
      if (!snap.exists()) return;
      await _traiterSignal(snap.val());
      await remove(sigRef);
    });
  }

  // Envoyer offres aux membres déjà là
  for (const m of C.members) {
    if (m.uid !== window.currentProfile.id) await _envoyerOffer(m.uid);
  }
  await envoyerMsgChat('📹 ' + (window.currentProfile.company||'Un membre') + ' a démarré un appel vidéo.', true);
};

async function _envoyerOffer(targetUid) {
  const pc = _getPeer(targetUid);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sigRef = ref(_rtdb, `collab_rtc/${C.sessionId}/signals/${targetUid}`);
  await set(sigRef, { type:'offer', sdp:offer.sdp, fromUid:window.currentProfile.id, fromName:window.currentProfile.company||'Hôte' });
}

async function _traiterSignal(signal) {
  if (!signal?.fromUid) return;
  const from = signal.fromUid;
  if (signal.type==='offer') {
    if (!C.localStream) {
      try { C.localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); C.isVideoOpen=true; const p=document.getElementById('video-panel'); if(p)p.style.display='flex'; const lv=document.getElementById('local-video'); if(lv){lv.srcObject=C.localStream;lv.muted=true;} }
      catch(e){ console.warn('[COLLAB RTC] cam:', e.message); return; }
    }
    const pc = _getPeer(from);
    await pc.setRemoteDescription(new RTCSessionDescription({type:'offer',sdp:signal.sdp}));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const sigRef = ref(_rtdb, `collab_rtc/${C.sessionId}/signals/${from}`);
    await set(sigRef, { type:'answer', sdp:answer.sdp, fromUid:window.currentProfile.id });
  } else if (signal.type==='answer') {
    const pc = C.peerConnections[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription({type:'answer',sdp:signal.sdp}));
  } else if (signal.type==='ice') {
    const pc = C.peerConnections[from];
    if (pc&&signal.candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch(e){} }
  }
}

function _getPeer(uid) {
  if (C.peerConnections[uid]) return C.peerConnections[uid];
  const pc = new RTCPeerConnection(RTC_CFG);
  C.peerConnections[uid] = pc;
  if (C.localStream) C.localStream.getTracks().forEach(t => pc.addTrack(t, C.localStream));
  pc.onicecandidate = async e => {
    if (!e.candidate) return;
    const sigRef = ref(_rtdb, `collab_rtc/${C.sessionId}/signals/${uid}`);
    await set(sigRef, { type:'ice', candidate:e.candidate.toJSON(), fromUid:window.currentProfile.id });
  };
  pc.ontrack = e => _afficherVideoDistant(uid, e.streams[0]);
  pc.onconnectionstatechange = () => {
    if (['disconnected','failed'].includes(pc.connectionState)) _supprimerVideoDistant(uid);
  };
  return pc;
}

function _afficherVideoDistant(uid, stream) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  let tile = document.getElementById('vid-'+uid);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'vid-'+uid;
    const name = C.members.find(m=>m.uid===uid)?.name||'Invité';
    tile.innerHTML = `<video autoplay playsinline></video><div class="vid-label">${esc(name)}</div>`;
    grid.appendChild(tile);
  }
  const vid = tile.querySelector('video');
  if (vid) vid.srcObject = stream;
}

function _supprimerVideoDistant(uid) {
  document.getElementById('vid-'+uid)?.remove();
  if (C.peerConnections[uid]) { C.peerConnections[uid].close(); delete C.peerConnections[uid]; }
}

window._collabTerminerAppel = async function() {
  C.isVideoOpen = false;
  if (C.localStream) { C.localStream.getTracks().forEach(t=>t.stop()); C.localStream=null; }
  Object.values(C.peerConnections).forEach(pc=>pc.close());
  C.peerConnections = {};
  if (_rtdb&&C.sessionId&&window.currentProfile?.id) {
    await remove(ref(_rtdb, `collab_rtc/${C.sessionId}/signals/${window.currentProfile.id}`));
  }
  const panel = document.getElementById('video-panel');
  if (panel) panel.style.display = 'none';
  toast('Appel terminé','info');
};

window._collabToggleMic = function() {
  if (!C.localStream) return;
  const t = C.localStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  const btn = document.getElementById('btn-toggle-mic');
  if (btn) btn.textContent = t.enabled ? '🎤 Micro ON' : '🔇 Micro OFF';
};

window._collabToggleCam = function() {
  if (!C.localStream) return;
  const t = C.localStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  const btn = document.getElementById('btn-toggle-cam');
  if (btn) btn.textContent = t.enabled ? '📷 Caméra ON' : '📷 Caméra OFF';
};

// ─────────────────────────────────────────────────────────
// 9. QUITTER SESSION
// ─────────────────────────────────────────────────────────
window._collabQuitter = async function() {
  if (!C.sessionId) return;
  if (!confirm('Quitter la session de collaboration ?')) return;
  if (C.isVideoOpen) await window._collabTerminerAppel();
  if (C.myPresRef) await remove(C.myPresRef);
  try {
    await updateDoc(docRef('collab_sessions', C.sessionId), {
      members: arrayRemove(window.currentProfile.id),
    });
    if (C.role==='host') {
      await updateDoc(docRef('collab_sessions', C.sessionId), { active:false });
    }
  } catch(e){}
  if (C.unsubJournal) C.unsubJournal();
  if (C.unsubChat)    C.unsubChat();
  if (_rtdb && C.sessionId) {
    off(ref(_rtdb, `collab_presence/${C.sessionId}`));
  }
  C.sessionId=null; C.sessionCode=null; C.role=null; C.members=[];
  renderCollabView();
  window.navigate('dashboard');
  toast('Session quittée','info');
};

// ─────────────────────────────────────────────────────────
// 10. MODAL ENVOI ÉCRITURE
// ─────────────────────────────────────────────────────────
window._collabOuvrirModal = function() {
  let modal = document.getElementById('collab-send-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'collab-send-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:640px;max-height:80vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="modal-title">⬆ Envoyer une écriture vers la session</div>
          <button class="btn-modal-cancel" onclick="document.getElementById('collab-send-modal').style.display='none'">✕</button>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Sélectionnez une écriture de votre journal à partager avec l'équipe.</p>
        <div id="collab-ecr-list"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  // Remplir liste
  const ecrs = (window.ecritures||[]).slice(-30).reverse();
  const listEl = document.getElementById('collab-ecr-list');
  if (!listEl) return;
  if (!ecrs.length) {
    listEl.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">Aucune écriture dans votre journal.</p>';
    return;
  }
  listEl.innerHTML = ecrs.map((e,i) => `
    <div class="collab-ecr-select-row">
      <span class="jnl-badge">${esc(e.journal||'')}</span>
      <span style="color:var(--muted);font-size:11px">${esc(e.date||'')}</span>
      <span style="flex:1">${esc(e.libelle||'Sans libellé')}</span>
      <button class="btn btn-sm-wire" onclick="window._collabEnvoyerEcr(${i});document.getElementById('collab-send-modal').style.display='none'">Envoyer</button>
    </div>`).join('');
};

window._collabEnvoyerEcr = async function(idx) {
  const ecrs = (window.ecritures||[]).slice(-30).reverse();
  const ecr = ecrs[idx];
  if (!ecr) return;
  await envoyerEcritureVersSession(ecr);
};

// ─────────────────────────────────────────────────────────
// 11. RENDER VUE PRINCIPALE
// ─────────────────────────────────────────────────────────
function renderCollabView() {
  const view = document.getElementById('view-collaboration');
  if (!view) return;
  const inSession = !!C.sessionId;
  const isHost = C.role === 'host';

  view.innerHTML = `

    <!-- VIDEO PANEL (overlay plein écran) -->
    <div id="video-panel" class="video-panel" style="display:none">
      <div class="video-panel-header">
        <span class="video-title">📹 Appel vidéo COMEO</span>
        <div class="video-controls">
          <button class="btn-vid-ctrl" id="btn-toggle-mic" onclick="window._collabToggleMic()">🎤 Micro ON</button>
          <button class="btn-vid-ctrl" id="btn-toggle-cam" onclick="window._collabToggleCam()">📷 Caméra ON</button>
          <button class="btn-vid-ctrl btn-vid-end" onclick="window._collabTerminerAppel()">⬛ Terminer</button>
        </div>
      </div>
      <div class="video-grid" id="video-grid">
        <div class="video-tile local-tile">
          <video id="local-video" autoplay muted playsinline></video>
          <div class="vid-label">${esc(window.currentProfile?.company||'Vous')} (vous)</div>
        </div>
      </div>
    </div>

    <!-- PAGE HEADER -->
    <div class="ph">
      <div><h1>Espace Collaborateur</h1><p>Travaillez à distance sur un journal en temps réel · max ${C.MAX_MEMBERS} collaborateurs</p></div>
      <div class="ph-actions">
        ${inSession ? `
          <button class="btn btn-sm-wire" onclick="window._collabDemarrerVideo()">📹 Appel vidéo</button>
          <button class="btn btn-danger-outline" onclick="window._collabQuitter()">⏻ Quitter</button>
        ` : ''}
      </div>
    </div>

    ${!inSession ? `
    <!-- ──── PAS DE SESSION ──── -->
    <div class="collab-onboarding">
      <div class="collab-cards-row">

        <div class="collab-onboard-card">
          <div class="colob-icon">🚀</div>
          <h3>Créer une session</h3>
          <p>Un code à 6 lettres est généré. Partagez-le à vos collaborateurs par WhatsApp ou SMS.</p>
          <button class="btn btn-ink btn-block" onclick="window._collabCreer()">+ Créer ma session</button>
        </div>

        <div class="collab-onboard-card">
          <div class="colob-icon">🔗</div>
          <h3>Rejoindre une session</h3>
          <p>Entrez le code reçu de votre collaborateur pour travailler ensemble en temps réel.</p>
          <input type="text" id="collab-join-code" class="collab-code-input"
            placeholder="Ex : AB3X7Z" maxlength="6" style="text-transform:uppercase"
            onkeydown="if(event.key==='Enter')window._collabRejoindre()">
          <button class="btn btn-outline btn-block" style="margin-top:10px" onclick="window._collabRejoindre()">→ Rejoindre</button>
        </div>

      </div>

      <div class="collab-how">
        <h4>Comment ça marche ?</h4>
        <div class="collab-steps">
          <div class="collab-step"><span class="step-num">1</span><span>L'hôte clique "Créer ma session" → code généré automatiquement</span></div>
          <div class="collab-step"><span class="step-num">2</span><span>Il envoie le code par WhatsApp / SMS à ses collaborateurs</span></div>
          <div class="collab-step"><span class="step-num">3</span><span>Chaque invité se connecte sur son COMEO et entre le code</span></div>
          <div class="collab-step"><span class="step-num">4</span><span>Tout le monde voit les écritures partagées en temps réel</span></div>
          <div class="collab-step"><span class="step-num">5</span><span>Appel vidéo intégré pour travailler ensemble à distance</span></div>
        </div>
      </div>
    </div>

    ` : `
    <!-- ──── SESSION ACTIVE ──── -->
    <div class="collab-session-layout">

      <div class="collab-main">

        <!-- Barre session -->
        <div class="collab-session-bar">
          <div class="collab-session-info">
            <span class="sess-role-badge ${isHost?'host':'guest'}">${isHost?'👑 Hôte':'👤 Invité'}</span>
            <span class="sess-code">Code : <strong>${esc(C.sessionCode)}</strong></span>
            <button class="btn-copy-code" onclick="navigator.clipboard.writeText('${C.sessionCode}');toast('Code copié !','success')" title="Copier">📋</button>
          </div>
          <div id="collab-presence-bar" class="collab-presence-bar"></div>
          <span id="collab-member-count" class="collab-member-count">0 en ligne</span>
        </div>

        ${isHost ? `
        <div class="collab-invite-box">
          <div class="inv-icon">🔑</div>
          <div class="inv-text">
            <strong>Code d'invitation</strong>
            <p>Partagez ce code avec vos collaborateurs (max ${C.MAX_MEMBERS})</p>
          </div>
          <div class="inv-code">${esc(C.sessionCode)}</div>
          <button class="btn btn-sm-wire" onclick="navigator.clipboard.writeText('${C.sessionCode}');toast('Code copié !','success')">📋 Copier</button>
        </div>` : ''}

        <!-- Journal partagé -->
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">
            📋 Journal partagé — Temps réel
          </div>
          <div style="margin-bottom:12px">
            <button class="btn btn-ink btn-sm" onclick="window._collabOuvrirModal()">⬆ Envoyer une écriture vers la session</button>
          </div>
          <div style="overflow-x:auto">
            <table class="dt collab-journal-table">
              <thead><tr>
                <th>Date</th><th>Journal</th><th>Pièce</th>
                <th>Libellé</th><th>Lignes</th><th>Auteur</th><th>Actions</th>
              </tr></thead>
              <tbody id="collab-journal-body">
                <tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">En attente d'écritures…</td></tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- Chat -->
      <div class="collab-sidebar-chat">
        <div class="chat-header">
          <span>💬 Chat d'équipe</span>
          <span style="font-size:10px;color:rgba(212,168,83,.6)">Temps réel</span>
        </div>
        <div class="chat-messages" id="collab-chat-messages"></div>
        <div class="chat-input-row">
          <textarea id="collab-chat-input" class="chat-textarea"
            placeholder="Votre message… (Entrée pour envoyer)" rows="2"
            onkeydown="window._collabChatKeydown(event)"></textarea>
          <button class="btn-chat-send" onclick="window._collabSendMsg()">➤</button>
        </div>
      </div>

    </div>
    `}
  `;

  // Re-render presence si déjà des membres
  if (inSession) renderPresenceBar();
}

// ─────────────────────────────────────────────────────────
// 12. EXPOSITIONS WINDOW (appelées depuis HTML onclick)
// ─────────────────────────────────────────────────────────
window._collabCreer    = creerSession;
window._collabRejoindre = () => rejoindreSession();
window.renderCollabView = renderCollabView;

// ─────────────────────────────────────────────────────────
// 13. PATCH navigate() — supporter 'collaboration'
// ─────────────────────────────────────────────────────────
await waitFB();
await initRTDB();

const _origNav = window.navigate;
window.navigate = function(view) {
  if (view === 'collaboration') {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const vEl = document.getElementById('view-collaboration');
    if (vEl) vEl.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.textContent.toLowerCase().includes('collab')) n.classList.add('active');
    });
    renderCollabView();
  } else {
    _origNav(view);
  }
};

// Rendre la vue au démarrage si déjà sur collaboration
renderCollabView();
console.log('[COLLAB] Module chargé ✓');
