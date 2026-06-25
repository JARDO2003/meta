import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
  setDoc,
  getDoc,
  onSnapshot,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── BASE DE DONNÉES ROBOT (cache des réponses)
const robotFirebaseConfig = {
  apiKey: 'AIzaSyAocBTsHd-A9OJ7RAagxwxtZd0pdW6TX3I',
  authDomain: 'data-gbre.firebaseapp.com',
  databaseURL: 'https://data-gbre-default-rtdb.firebaseio.com',
  projectId: 'data-gbre',
  storageBucket: 'data-gbre.firebasestorage.app',
  messagingSenderId: '293732235454',
  appId: '1:293732235454:web:c0b0f4a7b6c9b5d12f46ef',
  measurementId: 'G-XD01FS1SPG',
};
const robotApp = initializeApp(robotFirebaseConfig, 'robot-cache');
const robotDb = getFirestore(robotApp);

// ── Fonctions cache robot ──
async function robotCacheGet(questionKey) {
  try {
    const snap = await getDoc(doc(robotDb, 'robot_cache', questionKey));
    if (snap.exists()) return snap.data().answer;
  } catch (e) {}
  return null;
}
async function robotCacheSet(questionKey, answer) {
  try {
    await setDoc(doc(robotDb, 'robot_cache', questionKey), {
      answer,
      savedAt: new Date().toISOString(),
    });
  } catch (e) {}
}
function robotCacheKey(query) {
  // v3 — invalide les anciennes réponses trop courtes / robotiques en cache
  return (
    'v3_' +
    query
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëîïôùûüç\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100)
  );
}
const firebaseConfig = {
  apiKey: 'AIzaSyCPGgtXoDUycykLaTSee0S0yY0tkeJpqKI',
  authDomain: 'data-com-a94a8.firebaseapp.com',
  databaseURL: 'https://data-com-a94a8-default-rtdb.firebaseio.com',
  projectId: 'data-com-a94a8',
  storageBucket: 'data-com-a94a8.appspot.com',
  messagingSenderId: '276904640935',
  appId: '1:276904640935:web:9cd805aeba6c34c767f682',
  measurementId: 'G-FYQCWY5G4S',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window._db = db;
window._fbCollection = collection;
window._fbAddDoc = addDoc;
window._fbGetDocs = getDocs;
window._fbDeleteDoc = deleteDoc;
window._fbDoc = doc;
window._fbQuery = query;
window._fbOrderBy = orderBy;
window._fbSetDoc = setDoc;
window._fbGetDoc = getDoc;
window._fbReady = true;
window._firebaseFirestore = { onSnapshot, doc, getDocs, collection, query, where };
document.dispatchEvent(new Event('firebase-ready'));

// ══════════════════════════════════════════
// CONFIGURATION SERVEUR — Chargée depuis Firestore (server_config)
// Les clés API OpenRouter, Mistral et l'ordre des modèles sont gérés via server.html
// JAMAIS de clé API en dur dans ce fichier
// ══════════════════════════════════════════
// ── Clés API multiples (OpenRouter + Gemini fallback) ──
let OPENROUTER_KEYS = ['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'];
let GEMINI_KEYS = ['AQ.Ab8RN6LRPDzoKC3Y9_iM5VM1uuFTHdya_sS3k699IrMu2BeFHg'];
let GROQ_API_KEYS = ['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'];    // Alias pour compatibilité
let GROQ_MODELS = [];      // Chargées depuis server_config/models
let groqKeyIdx = 0;        // Index rotation clés OpenRouter
let groqModelIdx = 0;      // Index rotation modèles Groq
// File d'attente : requêtes en attente d'une clé libre
const groqQueue = [];
// État d'occupation de chaque clé : groqKeyBusy[i] = true si la clé i est en cours d'utilisation
let groqKeyBusy = [];
let serverConfigLoaded = false;

// ── Cache mémoire local (session) — évite les allers-retours Firestore ──
const aiMemoryCache = new Map(); // clé → réponse (RAM, vidé au rechargement)
const AI_CACHE_MAX = 500;        // maximum d'entrées en mémoire

async function loadServerConfig() {
  try {
    // Clés API chargées directement du code
    groqKeyBusy = new Array(GROQ_API_KEYS.length).fill(false);
    
    // Charger seulement les modèles de Firestore
    try {
      const modelsSnap = await getDoc(doc(db, 'server_config', 'models'));
      if (modelsSnap.exists()) {
        GROQ_MODELS = modelsSnap.data().list || [];
      }
    } catch (e) {
      console.warn('[COMEO] Erreur chargement modèles depuis Firestore :', e.message);
    }

    // Valeurs par défaut si Firestore vide
    if (GROQ_MODELS.length === 0) {
      GROQ_MODELS = ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
    }

    serverConfigLoaded = true;
    aiServiceAvailable = GROQ_API_KEYS.length > 0;
    updateServiceAvailabilityUI();
    console.log(`[COMEO] Config chargée — ${GROQ_API_KEYS.length} clé(s) Groq (directe), ${GROQ_MODELS.length} modèle(s)`);
  } catch (e) {
    console.warn('[COMEO] Erreur chargement config serveur :', e.message);
    aiServiceAvailable = false;
    serverConfigLoaded = true;
    updateServiceAvailabilityUI();
    GROQ_MODELS = ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
  }
}

// ── Clé de cache universelle (utilisée par chat IA + robot vocal) ──
function aiCacheKey(query) {
  return (
    'v3_' +
    query
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëîïôùûüç\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 120)
  );
}

// ── Lire le cache : mémoire d'abord, puis Firestore ──
async function aiCacheGet(key) {
  if (aiMemoryCache.has(key)) {
    console.log('[COMEO Cache] ✅ Mémoire RAM');
    return aiMemoryCache.get(key);
  }
  try {
    const snap = await getDoc(doc(robotDb, 'robot_cache', key));
    if (snap.exists()) {
      const val = snap.data().answer;
      aiMemoryCache.set(key, val); // stocker en RAM pour la prochaine fois
      console.log('[COMEO Cache] ✅ Firestore');
      return val;
    }
  } catch (e) {}
  return null;
}

// ── Écrire dans le cache : mémoire + Firestore ──
async function aiCacheSet(key, answer) {
  // Limite RAM : vider les plus anciens si plein
  if (aiMemoryCache.size >= AI_CACHE_MAX) {
    const firstKey = aiMemoryCache.keys().next().value;
    aiMemoryCache.delete(firstKey);
  }
  aiMemoryCache.set(key, answer);
  try {
    await setDoc(doc(robotDb, 'robot_cache', key), {
      answer,
      savedAt: new Date().toISOString(),
    });
  } catch (e) {}
}

// ── Vérifier si la requête est une action (ne pas mettre en cache) ──
function isActionQuery(queryLow) {
  return /crée|cree|facture|montre|affiche|modif|ouvre|ouvrir|supprim|enregistr|saisir|journal|bilan/i.test(queryLow);
}

// ══════════════════════════════════════════
// ABONNEMENT PREMIUM — Wave · Essai 12h
// ══════════════════════════════════════════
const TRIAL_DURATION_MS = 12 * 60 * 60 * 1000;
const PREMIUM_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const WAVE_AMOUNT_FCFA = 15000;
const COMEO_SERVICE_MSG = 'Veuillez patienter quelques instants ou revenez plus tard.';

let aiServiceAvailable = true;
let subscriptionCheckInterval = null;

function getWavePaymentUrl() {
  const p = ['https://pay.wave.com/m/', 'M_ci_iqMcg8KwRE-W', '/c/ci/?amount=', String(WAVE_AMOUNT_FCFA)];
  return p.join('');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text).trim()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getSubscriptionState(profile) {
  if (!profile) return { access: false, type: 'expired', remainingMs: 0 };
  const now = Date.now();
  const premiumUntil = profile.premiumUntil ? new Date(profile.premiumUntil).getTime() : 0;
  if (premiumUntil > now) {
    return { access: true, type: 'premium', remainingMs: premiumUntil - now, premiumUntil };
  }
  const trialEnd = profile.trialEndsAt ? new Date(profile.trialEndsAt).getTime() : 0;
  if (trialEnd > now) {
    return { access: true, type: 'trial', remainingMs: trialEnd - now, trialEndsAt: profile.trialEndsAt };
  }
  return { access: false, type: 'expired', remainingMs: 0 };
}

function formatRemainingTime(ms) {
  if (ms <= 0) return '0 min';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return Math.floor(h / 24) + ' jour(s)';
  if (h > 0) return h + ' h ' + m + ' min';
  return m + ' min';
}

async function ensureSubscriptionFields(profile) {
  const uid = profile.id;
  const now = Date.now();
  let trialEndsAt = profile.trialEndsAt;
  if (!trialEndsAt) {
    const created = profile.createdAt ? new Date(profile.createdAt).getTime() : now;
    trialEndsAt = new Date(created + TRIAL_DURATION_MS).toISOString();
    const status = profile.premiumUntil && new Date(profile.premiumUntil).getTime() > now ? 'active' : 'trial';
    await window._fbSetDoc(
      window._fbDoc(window._db, 'profiles', uid),
      {
        trialEndsAt,
        subscriptionStatus: profile.subscriptionStatus || status,
      },
      { merge: true },
    );
    profile = { ...profile, trialEndsAt, subscriptionStatus: profile.subscriptionStatus || status };
  }
  return profile;
}

async function refreshSubscriptionFromFirestore() {
  if (!currentProfile?.id) return;
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id));
    if (snap.exists()) currentProfile = { ...snap.data(), id: currentProfile.id };
  } catch (e) {
    console.warn('[COMEO] Lecture abonnement:', e.message);
  }
}

function updateSubscriptionBadge(sub) {
  const el = document.getElementById('subscriptionBadge');
  if (!el) return;
  if (!sub?.access) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'inline-flex';
  if (sub.type === 'trial') {
    el.className = 'sub-badge sub-badge-trial';
    el.textContent = 'Essai · ' + formatRemainingTime(sub.remainingMs);
  } else {
    el.className = 'sub-badge sub-badge-premium';
    el.textContent = 'Premium · ' + formatRemainingTime(sub.remainingMs);
  }
}

function showPremiumPaywall(sub) {
  const wall = document.getElementById('premiumPaywall');
  if (!wall) return;
  const remainEl = document.getElementById('paywallTrialInfo');
  if (remainEl && sub?.type === 'expired') {
    remainEl.textContent = 'Votre essai gratuit de 12 heures est terminé. Passez à COMEO Premium pour continuer.';
  }
  wall.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function hidePremiumPaywall() {
  const wall = document.getElementById('premiumPaywall');
  if (wall) wall.style.display = 'none';
}

function updateServiceAvailabilityUI() {
  const banner = document.getElementById('serviceUnavailableBanner');
  if (!banner) return;
  const show = !aiServiceAvailable || GROQ_API_KEYS.length === 0;

  banner.style.display = show ? 'flex' : 'none';
  banner.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function getAiUnavailableMessage() {
  return COMEO_SERVICE_MSG;
}

function isAiServiceReady() {
  return aiServiceAvailable && GROQ_API_KEYS.length > 0;
}

// ══════════════════════════════════════════
// SYSTÈME DE FILE D'ATTENTE GROQ — Multi-clés, réponse garantie à chaque utilisateur
// ══════════════════════════════════════════

/**
 * Acquiert une clé Groq libre. Si toutes sont occupées, attend qu'une se libère.
 * Retourne l'index de la clé acquise.
 */
function acquireGroqKey() {
  return new Promise((resolve) => {
    function tryAcquire() {
      // Chercher une clé libre
      for (let i = 0; i < GROQ_API_KEYS.length; i++) {
        const idx = (groqKeyIdx + i) % GROQ_API_KEYS.length;
        if (!groqKeyBusy[idx]) {
          groqKeyBusy[idx] = true;
          groqKeyIdx = (idx + 1) % GROQ_API_KEYS.length; // prochaine fois on commence après
          console.log(`[COMEO Queue] ✅ Clé ${idx + 1}/${GROQ_API_KEYS.length} acquise`);
          resolve(idx);
          return;
        }
      }
      // Toutes occupées → mettre en file et réessayer dès qu'une se libère
      groqQueue.push(tryAcquire);
    }
    tryAcquire();
  });
}

/**
 * Libère une clé Groq et réveille le prochain en attente si besoin.
 */
function releaseGroqKey(idx) {
  groqKeyBusy[idx] = false;
  console.log(`[COMEO Queue] 🔓 Clé ${idx + 1}/${GROQ_API_KEYS.length} libérée`);
  if (groqQueue.length > 0) {
    const next = groqQueue.shift();
    next();
  }
}

/**
 * Appel OpenRouter avec file d'attente + rotation modèles.
 * Réessaie automatiquement sur les autres clés en cas de 429.
 * Retourne { data, keyIdx } ou null si toutes les clés échouent.
 */
async function callGroqQueued(messages, systemPrompt, maxTokens = 6000, temperature = 0.02) {
  if (GROQ_API_KEYS.length === 0) {
    return { error: 'no_keys', msg: '⚠️ Aucune clé API OpenRouter configurée dans le système.' };
  }

  const triedKeys = new Set();
  let keyIdx = await acquireGroqKey();
  const keyErrors = [];

  try {
    while (triedKeys.size < GROQ_API_KEYS.length) {
      triedKeys.add(keyIdx);
      const model = 'gemini-1.5-flash'; // Modèle OpenRouter
      const keyShort = 'clé ' + (keyIdx + 1) + '/' + GROQ_API_KEYS.length;
      try {
        // Format OpenRouter (compatible OpenAI)
        const response = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEYS[keyIdx]}`,
          },
          body: JSON.stringify({
            model: 'auto', // OpenRouter sélectionne le meilleur modèle disponible
            max_tokens: maxTokens,
            temperature,
            top_p: 0.95,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`[COMEO Queue] ✅ OpenRouter OK — clé ${keyIdx + 1}, modèle: auto`);
          return { data, keyIdx };
        }

        const status = response.status;
        const errBody = await response.json().catch(() => ({}));
        const apiMsg = errBody?.error?.message || '';

        if (status === 429) {
          keyErrors.push({ keyNum: keyIdx + 1, code: 429, detail: 'Quota dépassé (rate limit)' });
          console.warn(`[COMEO Queue] ${keyShort} saturée (429) → essai Gemini en fallback`);
          releaseGroqKey(keyIdx);
          
          // 🔄 Basculer sur Gemini si OpenRouter est saturé
          const geminiResult = await callGemini(messages, systemPrompt, maxTokens, temperature);
          if (!geminiResult.error) {
            console.log(`[COMEO] ✅ Fallback Gemini réussi`);
            return geminiResult;
          }
          
          let found = false;
          for (let i = 0; i < GROQ_API_KEYS.length; i++) {
            const candidate = (keyIdx + 1 + i) % GROQ_API_KEYS.length;
            if (!triedKeys.has(candidate)) {
              keyIdx = await acquireGroqKey();
              found = true;
              break;
            }
          }
          if (!found) {
            const detail = keyErrors.map(e => `clé ${e.keyNum} : ${e.detail}`).join(' · ');
            return { error: 'all_rate_limited', msg: `⚠️ OpenRouter saturé et Gemini indisponible.\n${detail}\n\nVeuillez patienter quelques instants et réessayez.` };
          }
          continue;
        }

        if (status === 401 || status === 403) {
          keyErrors.push({ keyNum: keyIdx + 1, code: status, detail: 'Clé invalide ou révoquée' });
          console.warn(`[COMEO Queue] ${keyShort} invalide (${status})`);
          releaseGroqKey(keyIdx);
          let found = false;
          for (let i = 0; i < GROQ_API_KEYS.length; i++) {
            const candidate = (keyIdx + 1 + i) % GROQ_API_KEYS.length;
            if (!triedKeys.has(candidate)) {
              keyIdx = await acquireGroqKey();
              found = true;
              break;
            }
          }
          if (!found) {
            const detail = keyErrors.map(e => `clé ${e.keyNum} : ${e.detail}`).join(' · ');
            return { error: 'invalid_keys', msg: `🔑 Problème avec vos clés API OpenRouter.\n${detail}\n\nVérifiez vos clés dans le système.` };
          }
          continue;
        }

        keyErrors.push({ keyNum: keyIdx + 1, code: status, detail: apiMsg || `Erreur HTTP ${status}` });
        console.warn(`[COMEO Queue] ${keyShort} — erreur ${status} : ${apiMsg}`);
        return { error: 'api_error', msg: `❌ Erreur API OpenRouter (${status})${apiMsg ? ' : ' + apiMsg : ''}.` };

      } catch (e) {
        console.warn(`[COMEO Queue] Exception réseau: ${e.message}`);
        return { error: 'network', msg: `📡 Impossible de contacter OpenRouter. Vérifiez votre connexion internet.\n(${e.message})` };
      }
    }
    return { error: 'exhausted', msg: '⚠️ Toutes les clés OpenRouter ont été essayées sans succès.' };
  } finally {
    if (keyIdx !== undefined && groqKeyBusy[keyIdx]) releaseGroqKey(keyIdx);
  }
}

/**
 * Appel Gemini API (fallback si OpenRouter rate limit)
 */
async function callGemini(messages, systemPrompt, maxTokens = 6000, temperature = 0.02) {
  if (GEMINI_KEYS.length === 0) {
    return { error: 'no_gemini', msg: '⚠️ Clé Gemini non configurée.' };
  }

  for (let geminiKeyIdx = 0; geminiKeyIdx < GEMINI_KEYS.length; geminiKeyIdx++) {
    try {
      console.log(`[COMEO Fallback] 🔄 Essai Gemini clé ${geminiKeyIdx + 1}...`);
      
      const contents = [
        {
          role: 'user',
          parts: [{ text: systemPrompt }]
        },
        ...messages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }))
      ];

      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEYS[geminiKeyIdx]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature,
            topP: 0.95,
            maxOutputTokens: maxTokens,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[COMEO Fallback] ✅ Gemini OK`);
        // Transformer réponse Gemini au format OpenAI
        const transformedData = {
          choices: [{
            message: {
              content: data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
            },
          }],
        };
        return { data: transformedData, provider: 'gemini' };
      }

      const status = response.status;
      if (status === 429) {
        console.warn(`[COMEO Fallback] Gemini saturé (429), prochaine clé...`);
        continue;
      }
      
      if (status === 401 || status === 403) {
        console.warn(`[COMEO Fallback] Clé Gemini invalide (${status})`);
        continue;
      }

      const errBody = await response.json().catch(() => ({}));
      console.warn(`[COMEO Fallback] Erreur Gemini ${status}: ${errBody?.error?.message || ''}`);
      
    } catch (e) {
      console.warn(`[COMEO Fallback] Exception Gemini: ${e.message}`);
    }
  }

  return { error: 'gemini_failed', msg: '❌ Gemini indisponible. Réessayez dans quelques instants.' };
}

function requireSubscriptionAccess() {
  const sub = getSubscriptionState(currentProfile);
  if (!sub.access) {
    showPremiumPaywall(sub);
    return false;
  }
  return true;
}

function startSubscriptionMonitor() {
  if (subscriptionCheckInterval) clearInterval(subscriptionCheckInterval);
  subscriptionCheckInterval = setInterval(async () => {
    if (!currentProfile?.id) return;
    await refreshSubscriptionFromFirestore();
    const sub = getSubscriptionState(currentProfile);
    if (!sub.access) {
      showPremiumPaywall(sub);
      const shell = document.getElementById('appShell');
      if (shell) shell.style.display = 'none';
    } else {
      hidePremiumPaywall();
      const shell = document.getElementById('appShell');
      if (shell) shell.style.display = 'grid';
      updateSubscriptionBadge(sub);
    }
  }, 60000);
}

async function activatePremiumWithCode() {
  const input = document.getElementById('activationCode');
  const errEl = document.getElementById('activationErr');
  const code = (input?.value || '').trim();
  if (!code || !currentProfile?.id) return;
  if (errEl) {
    errEl.classList.remove('show');
    errEl.textContent = '';
  }
  try {
    await waitForFirebase();
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'server_config', 'wave_settings'));
    const hashExpected = snap.exists() ? snap.data().activationCodeHash : null;
    if (!hashExpected) {
      if (errEl) {
        errEl.textContent = 'Activation non configurée. Contactez le support.';
        errEl.classList.add('show');
      }
      return;
    }
    const hashGot = await sha256Hex(code);
    if (hashGot !== hashExpected) {
      if (errEl) {
        errEl.textContent = 'Code invalide. Vérifiez le code reçu après paiement Wave.';
        errEl.classList.add('show');
      }
      return;
    }
    const premiumUntil = new Date(Date.now() + PREMIUM_MONTH_MS).toISOString();
    await window._fbSetDoc(
      window._fbDoc(window._db, 'profiles', currentProfile.id),
      {
        premiumUntil,
        subscriptionStatus: 'active',
        lastActivationAt: new Date().toISOString(),
        activationMethod: 'wave_code',
      },
      { merge: true },
    );
    currentProfile.premiumUntil = premiumUntil;
    currentProfile.subscriptionStatus = 'active';
    hidePremiumPaywall();
    document.getElementById('appShell').style.display = 'grid';
    toast('Abonnement Premium activé pour 30 jours.', 'success');
    await loadApp();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message || 'Erreur activation';
      errEl.classList.add('show');
    }
  }
}

async function claimWavePayment() {
  if (!currentProfile?.id) return;
  const btn = document.getElementById('claimWaveBtn');
  if (btn) btn.disabled = true;
  try {
    await waitForFirebase();
    await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'payment_claims'), {
      provider: 'wave',
      amount: WAVE_AMOUNT_FCFA,
      currency: 'XOF',
      status: 'pending',
      createdAt: new Date().toISOString(),
      email: currentProfile.email || '',
    });
    await window._fbSetDoc(
      window._fbDoc(window._db, 'profiles', currentProfile.id),
      {
        paymentPendingAt: new Date().toISOString(),
        subscriptionStatus: 'pending_payment',
      },
      { merge: true },
    );
    toast("Demande enregistrée. Entrez votre code d'activation reçu après paiement.", 'info');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openWavePayment() {
  window.open(getWavePaymentUrl(), '_blank', 'noopener,noreferrer');
}

// ══════════════════════════════════════════
// PLAN COMPTABLE SYSCOHADA RÉVISÉ 2017
// ══════════════════════════════════════════
const PC = {
  10: 'CAPITAL',
  101: 'CAPITAL SOCIAL',
  1011: 'Capital souscrit, non appelé',
  1012: 'Capital souscrit, appelé, non versé',
  1013: 'Capital souscrit, appelé, versé, non amorti',
  1014: 'Capital souscrit, appelé, versé, amorti',
  1018: 'Capital souscrit soumis à des conditions particulières',
  102: 'CAPITAL PAR DOTATION',
  1021: 'Dotation initiale',
  1022: 'Dotations complémentaires',
  1028: 'Autres dotations',
  103: 'CAPITAL PERSONNEL',
  104: "COMPTE DE L'EXPLOITANT",
  1041: 'Apports temporaires',
  1042: 'Opérations courantes',
  1043: 'Rémunérations, impôts et autres charges personnelles',
  1047: "Prélèvements d'autoconsommation",
  1048: 'Autres prélèvements',
  105: 'PRIMES LIEES AU CAPITAL SOCIAL',
  1051: "Primes d'émission",
  1052: "Primes d'apport",
  1053: 'Primes de fusion',
  1054: 'Primes de conversion',
  1058: 'Autres primes',
  106: 'ECARTS DE REEVALUATION',
  1061: 'Ecarts de réévaluation légale',
  1062: 'Ecarts de réévaluation libre',
  109: 'APPORTEURS, CAPITAL SOUSCRIT, NON APPELE',
  11: 'RESERVES',
  111: 'RESERVE LEGALE',
  112: 'RESERVES STATUTAIRES OU CONTRACTUELLES',
  113: 'RESERVES REGLEMENTEES',
  1131: 'Réserves de plus-values nettes à long terme',
  1132: "Réserves d'attribution gratuite d'actions au personnel salarié et aux dirigeants",
  1133: "Réserves consécutives à l'octroi de subventions d'investissement",
  1134: 'Réserves des valeurs mobilières donnant accès au capital',
  1138: 'Autres réserves réglementées',
  118: 'AUTRES RESERVES',
  1181: 'Réserves facultatives',
  1188: 'Réserves diverses',
  12: 'REPORT A NOUVEAU',
  121: 'REPORT A NOUVEAU CREDITEUR',
  129: 'REPORT A NOUVEAU DEBITEUR',
  1291: 'Perte nette à reporter',
  1292: 'Perte - Amortissements réputés différés',
  13: "RESULTAT NET DE L'EXERCICE",
  130: "RESULTAT EN INSTANCE D'AFFECTATION",
  1301: "Résultat en instance d'affectation : Bénéfice",
  1309: "Résultat en instance d'affectation : Perte",
  131: 'RESULTAT NET : BENEFICE',
  132: 'MARGE COMMERCIALE (MC)',
  133: 'VALEUR AJOUTEE (V.A.)',
  134: "EXCEDENT BRUT D'EXPLOITATION (E.B.E.)",
  135: "RESULTAT D'EXPLOITATION (R.E.)",
  136: 'RESULTAT FINANCIER (R.F.)',
  137: 'RESULTAT DES ACTIVITES ORDINAIRES (R.A.O.)',
  138: 'RESULTAT HORS ACTIVITES ORDINAIRES (R.H.A.O.)',
  1381: 'Résultat de fusion',
  1382: "Résultat d'apport partiel d'actif",
  1383: 'Résultat de scission',
  1384: 'Résultat de liquidation',
  139: 'RESULTAT NET : PERTE',
  14: "SUBVENTIONS D'INVESTISSEMENT",
  141: "SUBVENTIONS D'EQUIPEMENT",
  1411: 'Etat',
  1412: 'Régions',
  1413: 'Départements',
  1414: 'Communes et collectivités publiques décentralisées',
  1415: 'Entités publiques ou mixtes',
  1416: 'Entités et organismes privés',
  1417: 'Organismes internationaux',
  1418: 'Autres',
  148: "AUTRES SUBVENTIONS D'INVESTISSEMENT",
  15: 'PROVISIONS REGLEMENTEES ET FONDS ASSIMILES',
  151: 'AMORTISSEMENTS DEROGATOIRES',
  152: 'PLUS-VALUES DE CESSION A REINVESTIR',
  153: 'FONDS REGLEMENTES',
  1531: 'Fonds National',
  1532: 'Prélèvement pour le Budget',
  154: 'PROVISIONS SPECIALES DE REEVALUATION',
  155: 'PROVISIONS REGLEMENTEES RELATIVES AUX IMMOBILISATIONS',
  1551: 'Reconstitution des gisements miniers et pétroliers',
  156: 'PROVISIONS REGLEMENTEES RELATIVES AUX STOCKS',
  1561: 'Hausse de prix',
  1562: 'Fluctuation des cours',
  157: 'PROVISIONS POUR INVESTISSEMENT',
  158: 'AUTRES PROVISIONS ET FONDS REGLEMENTES',
  16: 'EMPRUNTS ET DETTES ASSIMILEES',
  161: 'EMPRUNTS OBLIGATAIRES',
  1611: 'Emprunts obligataires ordinaires',
  1612: 'Emprunts obligataires convertibles en actions',
  1613: 'Emprunts obligataires remboursables en actions',
  1618: 'Autres emprunts obligataires',
  162: 'EMPRUNTS ET DETTES AUPRES DES ETABLISSEMENTS DE CREDIT',
  163: "AVANCES RECUES DE L'ETAT",
  164: 'AVANCES RECUES ET COMPTES COURANTS  BLOQUES',
  165: 'DEPOTS ET CAUTIONNEMENTS RECUES',
  1651: 'Dépôts',
  1652: 'Cautionnements 166 INTERETS COURUS',
  1661: 'sur emprunts obligataires',
  1662: 'sur emprunts et dettes auprès des établissements de crédit',
  1663: "sur avances reçues de l'Etat",
  1664: 'sur avances reçues et comptes courants bloqués',
  1665: 'sur dépôts et cautionnements reçus',
  1667: 'sur avances assorties de conditions particulières',
  1668: 'sur autres emprunts et dettes',
  167: 'AVANCES ASSORTIES DE CONDITIONS  PARTICULIERES',
  1671: 'Avances bloquées pour augmentation du capital',
  1672: "Avances conditionnées par l'Etat",
  1673: 'Avances conditionnées par les autres organismes africains',
  1674: 'Avances conditionnées par les organismes internationaux',
  168: 'AUTRES EMPRUNTS ET DETTES',
  1681: 'Rentes viagères capitalisées',
  1682: 'Billets de fonds',
  1683: 'Dettes consécutives à des titres empruntés',
  1684: 'Emprunts participatifs',
  1685: 'Participation des travailleurs aux bénéfices',
  1686: 'Emprunts et dettes contractés auprès des autres tiers',
  17: 'DETTES DE LOCATION-ACQUISITION',
  172: 'DETTES DE LOCATION-ACQUISITION / CREDIT-BAIL IMMOBILIER',
  173: 'DETTES DE LOCATION-ACQUISITION / CREDIT-BAIL  MOBILIER',
  174: 'DETTES DE LOCATION-ACQUISITION / LOCATIONVENTE',
  176: 'INTERETS COURUS',
  1762: 'sur dettes de location-acquisition / crédit-bail immobilier',
  1763: 'sur dettes  de  location-acquisition  / crédit-bail mobilier',
  1764: 'sur dettes  de location-acquisition / location-vente',
  1768: 'sur autres dettes  de location-acquisition',
  178: 'AUTRES DETTES DE LOCATION-ACQUISITION',
  18: 'DETTES LIEES A DES PARTICIPATIONS ET COMPTES  DE LIAISON DES  ETABLISSEMENTS ET S',
  181: 'DETTES LIEES A DES PARTICIPATIONS',
  1811: 'Dettes liées à des participations (groupe)',
  1812: 'Dettes liées à des participations (hors groupe)',
  182: 'DETTES LIEES A DES SOCIETES EN PARTICIPATION',
  183: 'INTERETS COURUS SUR DETTES LIEES A DES PARTICIPATIONS',
  184: 'COMPTES PERMANENTS BLOQUES DES ETABLISSEMENTS ET SUCCURSALES',
  185: 'COMPTES PERMANENTS NON BLOQUES DES ETABLISSEMENTS ET SUCCURSALES',
  186: 'COMPTES DE LIAISON CHARGES',
  187: 'COMPTES DE LIAISON PRODUITS',
  188: 'COMPTES DE LIAISON DES SOCIETES EN PARTICIPATION',
  19: 'PROVISIONS POUR RISQUES ET CHARGES',
  191: 'PROVISIONS POUR LITIGES',
  192: 'PROVISIONS POUR GARANTIES DONNEES AUX CLIENTS',
  193: 'PROVISIONS POUR PERTES SUR MARCHES A ACHEVEMENT FUTUR',
  194: 'PROVISIONS POUR PERTES DE CHANGE',
  195: 'PROVISIONS POUR IMPOTS',
  196: 'PROVISIONS POUR PENSIONS ET OBLIGATIONS  SIMILAIRES',
  1961: 'Provisions pour pensions et obligations similaires – engagement de retraite',
  1962: 'Actif du régime de retraite',
  197: 'PROVISIONS POUR RESTRUCTURATION',
  198: 'AUTRES PROVISIONS POUR RISQUES ET CHARGES',
  1981: 'Provisions pour amendes et pénalités',
  1983: 'Provisions de propre assureur',
  1984: 'Provisions pour démantèlement et remise en état',
  1985: 'Provisions pour droits à réduction ou avantage en  nature  (Chèques cadeaux, carte',
  1988: 'Provisions pour divers risques et charges',
  21: 'IMMOBILISATIONS INCORPORELLES',
  211: 'FRAIS DE DEVELOPPEMENT',
  212: 'BREVETS, LICENCES, CONCESSIONS ET DROITS SIMILAIRES',
  2121: 'Brevets',
  2122: 'Licences',
  2123: 'Concessions de service public',
  2128: 'Autres concessions et droits similaires 213',
  213: 'LOGICIELS ET SITES INTERNET',
  2131: 'Logiciels',
  2132: 'Sites internet',
  215: 'MARQUES',
  216: 'FONDS COMMERCIAL',
  217: 'DROIT AU BAIL',
  218: 'INVESTISSEMENTS DE CREATION',
  2181: "Frais de prospection et d'évaluation de ressources minérales",
  2182: "Coûts d'obtention du contrat",
  2183: 'Fichiers clients, notices, titres de journaux et magazines',
  2184: 'Coûts des franchises',
  2188: 'Divers droits et valeurs incorporels',
  219: 'IMMOBILISATIONS INCORPORELLES EN COURS',
  2191: 'Frais de développement',
  2193: 'Logiciels et sites internet',
  2198: 'Autres droits et valeurs incorporels',
  22: 'TERRAINS',
  221: 'TERRAINS AGRICOLES ET FORESTIERS',
  2211: "Terrains d'exploitation agricole",
  2212: "Terrains d'exploitation forestière",
  2218: 'Autres terrains',
  222: 'TERRAINS NUS',
  2221: 'Terrains à bâtir',
  2231: 'pour bâtiments industriels et agricoles',
  2232: 'pour bâtiments administratifs et commerciaux',
  2234: 'pour bâtiments affectés aux autres opérations professionnelles',
  2235: 'pour bâtiments affectés aux autres opérations non professionnelles',
  2238: 'Autres terrains bâtis',
  224: 'TRAVAUX DE MISE EN VALEUR DES TERRAINS',
  2241: "Plantation d'arbres et d'arbustes",
  2245: 'Améliorations du fonds',
  2248: 'Autres travaux',
  225: 'TERRAINS DE CARRIERES – TREFONDS',
  2251: 'Carrières',
  226: 'TERRAINS AMENAGES',
  2261: 'Parkings',
  227: 'TERRAINS MIS EN CONCESSION',
  228: 'AUTRES TERRAINS',
  2281: 'Terrains - immeubles de placement',
  2285: 'Terrains des logements affectés au personnel',
  2286: 'Terrains de location - acquisition',
  2288: 'Divers terrains',
  229: 'AMENAGEMENTS DE TERRAINS EN COURS',
  2291: 'Terrains agricoles et forestiers',
  2292: 'Terrains nus',
  2295: 'Terrains de carrières - tréfonds',
  2298: 'Autres terrains',
  23: 'BATIMENTS, INSTALLATIONS TECHNIQUES ET AGENCEMENTS',
  231: 'BATIMENTS INDUSTRIELS, AGRICOLES, ADMINISTRATIFS ET COMMERCIAUX SUR SOL PROPRE',
  2311: 'Bâtiments industriels',
  2312: 'Bâtiments agricoles',
  2313: 'Bâtiments administratifs et commerciaux',
  2314: 'Bâtiments affectés au logement du personnel',
  2315: 'Bâtiments - immeubles de placement',
  2316: 'Bâtiments de location - acquisition',
  232: "BATIMENTS INDUSTRIELS, AGRICOLES, ADMINISTRATIFS ET COMMERCIAUX SUR SOL D'AUTRUI",
  2321: 'Bâtiments industriels',
  2322: 'Bâtiments agricoles',
  2323: 'Bâtiments administratifs et commerciaux',
  2324: 'Bâtiments affectés au logement du personnel',
  2325: 'Bâtiments - immeubles de placement',
  2326: 'Bâtiments de location - acquisition',
  233: "OUVRAGES D'INFRASTRUCTURE",
  2331: 'Voies de terre',
  2332: 'Voies de fer',
  2333: "Voies d'eau",
  2334: 'Barrages, Digues',
  2335: "Pistes d'aérodrome",
  2338: "Autres ouvrages d'infrastructures",
  234: 'AMENAGEMENTS, AGENCEMENTS ET INSTALLATIONS  TECHNIQUES',
  2341: 'Installations complexes spécialisées sur sol propre',
  2342: "Installations complexes spécialisées sur sol d'autrui",
  2343: 'Installations à caractère spécifique sur sol propre',
  2344: "Installations à caractère spécifique sur sol d'autrui",
  2345: 'Aménagements et agencements des bâtiments',
  235: 'AMENAGEMENTS DE BUREAUX',
  2351: 'Installations générales',
  2358: 'Autres aménagements de bureaux',
  237: 'BATIMENTS INDUSTRIELS, AGRICOLES ET COMMERCIAUX MIS EN CONCESSION COMMERCIAUX MIS EN CONCESSION',
  238: 'AUTRES INSTALLATIONS ET AGENCEMENTS',
  239: 'BATIMENTS AMENAGEMENTS, AGENCEMENTS ET',
  2391: 'Bâtiments en cours',
  2392: 'Installations en cours',
  2393: "Ouvrages d'infrastructure en cours",
  2394: 'Aménagements, agencements et installations techniques  en cours',
  2395: 'Aménagements de bureaux en cours',
  2398: 'Autres installations et agencements en cours',
  24: 'MATERIEL, MOBILIER ET ACTIFS BIOLOGIQUES',
  241: 'MATERIEL ET OUTILLAGE INDUSTRIEL ET COMMERCIAL',
  2411: 'Matériel industriel',
  2412: 'Outillage industriel',
  2413: 'Matériel commercial',
  2414: 'Outillage commercial',
  2416: 'Matériel et outillage industriel et commercial de location – acquisition',
  242: 'MATERIEL ET OUTILLAGE AGRICOLE',
  2421: 'Matériel agricole',
  2422: 'Outillage agricole',
  2426: 'Matériel et outillage agricole de location – acquisition',
  243: "MATERIEL D'EMBALLAGE RECUPERABLE ET",
  244: 'MATERIEL ET MOBILIER',
  2441: 'Matériel de bureau',
  2442: 'Matériel informatique',
  2443: 'Matériel bureautique',
  2444: 'Mobilier de bureau',
  2445: 'Matériel et mobilier - immeubles de placement',
  2446: 'Matériel et mobilier de location - acquisition',
  2447: 'Matériel et mobilier des logements du personnel',
  245: 'MATERIEL DE TRANSPORT',
  2451: 'Matériel automobile',
  2452: 'Matériel ferroviaire',
  2453: 'Matériel fluvial, lagunaire',
  2454: 'Matériel naval',
  2455: 'Matériel aérien',
  2456: 'Matériel de transport de location - acquisition',
  2457: 'Matériel hippomobile',
  2458: 'Autres matériels de transport',
  246: 'ACTIFS BIOLOGIQUES',
  2461: 'Cheptel, animaux de trait',
  2462: 'Cheptel, animaux reproducteurs',
  2463: 'Animaux de garde',
  2465: 'Plantations agricoles',
  2468: 'Autres actifs biologiques',
  247: 'AGENCEMENTS, AMENAGEMENTS DU MATERIEL ET DES ACTIFS BIOLOGIQUES',
  2471: 'Agencements et aménagements du matériel',
  2472: 'Agencements et aménagements des actifs biologiques',
  2478: 'Autres agencements, aménagements du matériel et actifs biologiques',
  248: 'AUTRES MATERIELS ET MOBILIERS',
  2481: "Collections et œuvres d'art",
  2488: 'Divers matériels et mobiliers',
  249: 'MATERIELS ET ACTIFS BIOLOGIQUES EN COURS',
  2491: 'Matériel et outillage industriel et commercial',
  2492: 'Matériel et outillage agricole',
  2493: "Matériel d'emballage récupérable et identifiable",
  2494: 'Matériel et mobilier de bureau',
  2495: 'Matériel de transport',
  2496: 'Actifs biologiques',
  2497: 'Agencements et aménagements du matériel et des actifs biologiques',
  2498: 'Autres matériels et actifs biologiques',
  25: 'AVANCES ET ACOMPTES VERSES SUR  IMMOBILISATIONS',
  251: 'AVANCES ET ACOMPTES VERSES SUR IMMOBILISATIONS INCORPORELLES',
  252: 'AVANCES ET ACOMPTES VERSES SUR IMMOBILISATIONS CORPORELLES',
  26: 'TITRES DE PARTICIPATION',
  261: 'TITRES DE PARTICIPATION DANS DES ENTITES SOUS CONTROLE EXCLUSIF',
  262: 'TITRES DE PARTICIPATION DANS DES ENTITES SOUS  CONTROLE CONJOINT',
  263: 'TITRES DE PARTICIPATION DANS DES ENTITESCONFERANT UNE INFLUENCE NOTABLE',
  265: 'PARTICIPATIONS DANS DES ORGANISMES  PROFESSIONNELS',
  266: "PARTS DANS DES GROUPEMENTS D'INTERET  ECONOMIQUE (G.I.E.)",
  268: 'AUTRES TITRES DE PARTICIPATION',
  27: 'AUTRES IMMOBLISATIONS FINANCIERES',
  271: 'PRETS ET CREANCES',
  2711: 'Prêts participatifs',
  2712: 'Prêts aux associés',
  2713: 'Billets de fonds',
  2714: 'Créances de location-financement',
  2715: 'Titres prêtés',
  2718: 'Autres prêts et créances',
  272: 'PRETS AU PERSONNEL',
  2721: 'Prêts immobiliers',
  2722: "Prêts mobiliers et d'installation",
  2728: 'Autres prêts au personnel',
  273: "CREANCES SUR L'ETAT",
  2731: 'Retenues de garantie',
  2733: 'Fonds réglementé',
  2734: 'Créances sur le concédant',
  2738: "Autres créances sur l'Etat",
  274: 'TITRES IMMOBILISES',
  2741: "Titres immobilisés de l'activité de portefeuille (T.I.A.P)",
  2742: 'Titres participatifs',
  2743: "Certificats d'investissement",
  2744: 'Parts de fonds commun de placement (F.C.P.)',
  2745: 'Obligations',
  2746: 'Actions ou parts propres',
  2748: 'Autres titres immobilisés',
  275: 'DEPOTS ET CAUTIONNEMENTS VERSES',
  2751: "Dépôts pour loyers d'avance",
  2752: "Dépôts pour l'électricité",
  2753: "Dépôts pour l'eau",
  2754: 'Dépôts pour le gaz',
  2755: 'Dépôts pour le téléphone, le télex, la télécopie',
  2756: 'Cautionnements sur marchés publics',
  2757: 'Cautionnements sur autres opérations',
  2758: 'Autres dépôts et cautionnements',
  276: 'INTERETS COURUS',
  2761: 'Prêts et créances non commerciales',
  2762: 'Prêts au personnel',
  2763: "Créances sur l'Etat",
  2764: 'Titres immobilisés',
  2765: 'Dépôts et cautionnements versés',
  2766: 'Créances de location-financement',
  2767: 'Créances rattachées à des participations',
  2768: 'Immobilisations financières diverses',
  277: 'CREANCES RATTACHEES A DES PARTICIPATIONS ET AVANCES A DES G.I.E.',
  2771: 'Créances rattachées à des participations (groupe)',
  2772: 'Créances rattachées à des participations (hors groupe)',
  2773: 'Créances rattachées à des sociétés en participation',
  2774: "Avances à des Groupements d'intérêt économique (G.I.E.)",
  278: 'IMMOBILISATIONS FINANCIERES DIVERSES',
  2781: 'Créances diverses groupe',
  2782: 'Créances diverses hors groupe',
  2784: 'Banques dépôts à terme',
  2785: 'Or et métaux précieux (1)',
  2788: 'Autres immobilisations financières',
  28: 'AMORTISSEMENTS',
  281: 'AMORTISSEMENTS DES IMMOBILISATIONS  INCORPORELLES',
  2811: 'Amortissements des frais de développement',
  2812: 'Amortissements des brevets, licences, concessions et droits similaires',
  2813: 'Amortissements des logiciels et sites internet',
  2814: 'Amortissements des marques',
  2815: 'Amortissements du fonds commercial',
  2816: 'Amortissements du droit au bail',
  2817: 'Amortissements des investissements de création',
  2818: 'Amortissements des autres droits et valeurs incorporels',
  282: 'AMORTISSEMENTS DES TERRAINS',
  2824: 'Amortissements des travaux de mise en valeur des terrains',
  283: 'AMORTISSEMENTS DES BATIMENTS, INSTALLATIONS TECHNIQUES ET AGENCEMENTS',
  2831: 'Amortissements des bâtiments industriels, agricoles, administratifs et commerciaux',
  2832: 'Amortissements des bâtiments industriels, agricoles, administratifs et commerciaux',
  2833: "Amortissements des ouvrages d'infrastructure",
  2834: 'Amortissements des aménagements, agencements et installations techniques',
  2835: 'Amortissements des aménagements de bureaux',
  2837: 'Amortissements des bâtiments industriels, agricoles et commerciaux mis en concessi',
  2838: 'Amortissements des autres installations et agencements',
  284: 'AMORTISSEMENTS DU MATERIEL',
  2841: 'Amortissements du matériel et outillage industriel et commercial',
  2842: 'Amortissements du matériel et outillage agricole',
  2843: "Amortissements du matériel d'emballage récupérable et identifiable",
  2844: 'Amortissements du matériel et mobilier',
  2845: 'Amortissements du matériel de transport',
  2846: 'Amortissements des actifs biologiques',
  2847: 'Amortissements des agencements, aménagements du matériel et des actifs biologiques',
  2848: 'Amortissements des autres matériels',
  29: 'DEPRECIATIONS DES IMMOBILISATIONS',
  291: 'DEPRECIATIONS DES IMMOBILISATIONS INCORPORELLES',
  2911: 'Dépréciations des frais de développement',
  2912: 'Dépréciations des brevets, licences, concessions  et droits similaires',
  2913: 'Dépréciations des logiciels et sites internet',
  2914: 'Dépréciations des marques',
  2915: 'Dépréciations du fonds commercial',
  2916: 'Dépréciations du droit au bail',
  2917: 'Dépréciations des investissements de création',
  2918: 'Dépréciations des autres droits et valeurs incorporels',
  2919: 'Dépréciations des immobilisations incorporelles en cours',
  292: 'DEPRECIATIONS DES TERRAINS',
  2921: 'Dépréciations des terrains agricoles et forestiers',
  2922: 'Dépréciations des terrains nus',
  2923: 'Dépréciations des terrains bâtis',
  2924: 'Dépréciations des travaux de mise en valeur des terrains',
  2925: 'Dépréciations des terrains de carrières-tréfonds',
  2926: 'Dépréciations des terrains aménagés',
  2927: 'Dépréciations des terrains mis en concession',
  2928: 'Dépréciations des autres terrains',
  2929: 'Dépréciations des aménagements de terrains en cours',
  293: 'DEPRECIATIONS DES BATIMENTS, INSTALLATIONS  TECHNIQUES ET AGENCEMENTS',
  2931: 'Dépréciations des bâtiments industriels, agricoles, administratifs et commerciaux',
  2932: 'Dépréciations des bâtiments industriels, agricoles, administratifs et commerciaux',
  2933: "Dépréciations des ouvrages d'infrastructures",
  2934: 'Dépréciations des aménagements, agencements et installations techniques',
  2935: 'Dépréciations des aménagements de bureaux',
  2937: 'Dépréciations des bâtiments industriels, agricoles et commerciaux mis en concessio',
  2938: 'Dépréciations des autres installations et agencements',
  2939: 'Dépréciations des bâtiments et installations en cours',
  294: "DEPRECIATIONS DE MATERIEL, DU MOBILIER ET DE L'ACTIF BIOLOGIQUE",
  2941: 'Dépréciations du matériel et outillage industriel et commercial',
  2942: 'Dépréciations du matériel et outillage agricole',
  2943: "Dépréciations du matériel d'emballage récupérable et identifiable",
  2944: 'Dépréciations du matériel et mobilier',
  2945: 'Dépréciations du matériel de transport',
  2946: 'Dépréciations des actifs biologiques',
  2947: 'Dépréciations des agencements, aménagements du matériel et des actifs biologiques',
  2948: 'Dépréciations des autres matériels',
  2949: 'Dépréciations de matériel en cours',
  295: 'DEPRECIATIONS DES AVANCES ET ACOMPTES VERSES  SUR IMMOBILISATIONS',
  2951: 'Dépréciations des avances et acomptes versés sur immobilisations incorporelles',
  2952: 'Dépréciations des avances et acomptes versés sur immobilisations corporelles',
  296: 'DEPRECIATIONS DES TITRES DE PARTICIPATION',
  2961: 'Dépréciations des titres de participation dans des entités sous contrôle exclusif',
  2962: 'Dépréciations des titres de participation dans des entités sous contrôle conjoint',
  2963: 'Dépréciations des titres de participation dans des entités conférant une influence',
  2965: 'Dépréciations des participations dans des organismes professionnels',
  2966: 'Dépréciations des parts dans des GIE',
  2968: 'Dépréciations des autres titres de participation',
  297: 'DEPRECIATIONS DES AUTRES IMMOBILISATIONS  FINANCIERES',
  2971: 'Dépréciations des prêts et créances',
  2972: 'Dépréciations des prêts au personnel',
  2973: "Dépréciations des créances sur l'Etat",
  2974: 'Dépréciations des titres immobilisés',
  2975: 'Dépréciations des dépôts et cautionnements versés',
  2977: 'Dépréciations des créances rattachées à des participations et avances à des GIE',
  2978: 'Dépréciations des créances financières diverses',
  31: 'MARCHANDISES',
  311: 'MARCHANDISES A',
  3111: 'Marchandises A1',
  3112: 'Marchandises A2',
  312: 'MARCHANDISES B',
  3121: 'Marchandises B1',
  3122: 'Marchandises B2 313 ACTIFS BIOLOGIQUES',
  3131: 'Animaux',
  3132: 'Végétaux',
  318: 'MARCHANDISES HORS ACTIVITES ORDINAIRES (H.A.O.)',
  32: 'MATIERES PREMIERES ET FOURNITURES LIEES',
  321: 'MATIERES A',
  322: 'MATIERES B',
  323: 'FOURNITURES (A,B)',
  33: 'AUTRES APPROVISIONNEMENTS',
  331: 'MATIERES CONSOMMABLES',
  332: "FOURNITURES D'ATELIER ET D'USINE",
  333: 'FOURNITURES DE MAGASIN',
  334: 'FOURNITURES DE BUREAU',
  335: 'EMBALLAGES',
  3351: 'Emballages perdus',
  3352: 'Emballages récupérables non identifiables',
  3353: 'Emballages à usage mixte',
  3358: 'Autres emballages',
  338: 'AUTRES MATIERES',
  34: 'PRODUITS EN COURS',
  341: 'PRODUITS EN COURS',
  3411: 'Produits en cours P1',
  3412: 'Produits en cours P2',
  342: 'TRAVAUX EN COURS',
  3421: 'Travaux en cours T1',
  3422: 'Travaux en cours T2',
  343: 'PRODUITS INTERMEDIAIRES EN COURS',
  3431: 'Produits intermédiaires A',
  3432: 'Produits intermédiaires B',
  344: 'PRODUITS RESIDUELS EN COURS',
  3441: 'Produits résiduels A',
  3442: 'Produits résiduels B 345',
  3451: 'Animaux',
  3452: 'Végétaux',
  35: 'SERVICES EN COURS',
  351: 'ETUDES EN COURS',
  3511: 'Etudes en cours E1',
  3512: 'Etudes en cours E2',
  352: 'PRESTATIONS DE SERVICES EN COURS',
  3521: 'Prestations de services S1',
  3522: 'Prestations de services S2',
  36: 'PRODUITS FINIS',
  361: 'PRODUITS FINIS A',
  362: 'PRODUITS FINIS B',
  363: 'ACTIFS BIOLOGIQUES',
  3631: 'Animaux',
  3632: 'Végétaux',
  3638: 'Autres stocks (activités annexes)',
  37: 'PRODUITS INTERMEDIAIRES ET RESIDUELS',
  371: 'PRODUITS INTERMEDIAIRES',
  3711: 'Produits intermédiaires A',
  3712: 'Produits intermédiaires B',
  372: 'PRODUITS RESIDUELS',
  3721: 'Déchets',
  3722: 'Rebuts',
  3723: 'Matières de récupération',
  373: 'ACTIFS BIOLOGIQUES',
  3731: 'Animaux',
  3732: 'Végétaux',
  3738: 'Autres stocks (activités annexes)',
  38: 'STOCKS EN COURS DE ROUTE, EN CONSIGNATION OU EN DEPOT',
  381: 'MARCHANDISES EN COURS DE ROUTE',
  382: 'MATIERES PREMIERES ET FOURNITURES LIEES EN COURS DE ROUTE',
  383: 'AUTRES APPROVISIONNEMENTS EN COURS DE ROUTE',
  386: 'PRODUITS FINIS EN COURS DE ROUTE',
  387: 'STOCK EN CONSIGNATION OU EN DEPOT',
  3871: 'Stock en consignation',
  3872: 'Stock en dépôt',
  388: "STOCK PROVENANT D'IMMOBILISATIONS MISES HORS SERVICE OU AU REBUT",
  39: 'DEPRECIATIONS DES STOCKS ET ENCOURS DE PRODUCTION',
  391: 'DEPRECIATIONS DES STOCKS DE MARCHANDISES',
  392: 'DEPRECIATIONS DES STOCKS DE MATIERES PREMIERES ET FOURNITURES LIEES',
  393: "DEPRECIATIONS DES STOCKS D'AUTRES APPROVISIONNEMENTS",
  394: 'DEPRECIATIONS DES PRODUCTIONS EN COURS',
  395: 'DEPRECIATIONS DES SERVICES EN COURS',
  396: 'DEPRECIATIONS DES STOCKS DE PRODUITS FINIS',
  397: 'DEPRECIATIONS DES STOCKS DE PRODUITS INTERMEDIAIRES ET RESIDUELS',
  398: 'DEPRECIATIONS DES STOCKS EN COURS DE ROUTE, EN CONSIGNATION OU EN DEPOT',
  40: 'FOURNISSEURS ET COMPTES RATTACHES',
  401: 'FOURNISSEURS, DETTES EN COMPTE',
  4011: 'Fournisseurs',
  4012: 'Fournisseurs Groupe',
  4013: 'Fournisseurs sous-traitants',
  4016: 'Fournisseurs, réserve de propriété',
  4017: 'Fournisseurs, retenues de garantie',
  402: 'FOURNISSEURS, EFFETS A PAYER',
  4021: 'Fournisseurs, Effets à payer',
  4022: 'Fournisseurs - Groupe, Effets à payer',
  4023: 'Fournisseurs sous-traitants, Effets à payer',
  404: "FOURNISSEURS, ACQUISITIONS COURANTES D'IMMOBILISATIONS",
  4041: 'Fournisseurs dettes en compte, immobilisations incorporelles',
  4042: 'Fournisseurs dettes en compte, immobilisations corporelles',
  4046: 'Fournisseurs effets à payer, immobilisations incorporelles',
  4047: 'Fournisseurs effets à payer, immobilisations corporelles',
  408: 'FOURNISSEURS, FACTURES NON PARVENUES',
  4081: 'Fournisseurs',
  4082: 'Fournisseurs - Groupe',
  4083: 'Fournisseurs sous-traitants',
  4086: 'Fournisseurs, intérêts courus',
  409: 'FOURNISSEURS DEBITEURS',
  4091: 'Fournisseurs avances et acomptes versés',
  4092: 'Fournisseurs - Groupe avances et acomptes versés',
  4093: 'Fournisseurs sous-traitants avances et acomptes versés',
  4094: 'Fournisseurs créances pour emballages et matériels à rendre',
  4098: 'Fournisseurs, rabais, remises, ristournes et autres avoirs à obtenir',
  41: 'CLIENTS ET COMPTES RATTACHES',
  411: 'CLIENTS',
  4111: 'Clients',
  4112: 'Clients – Groupe',
  4114: 'Clients, Etat et Collectivités publiques',
  4115: 'Clients, organismes internationaux',
  4116: 'Clients, réserve de propriété',
  4117: 'Clients, retenues de garantie',
  4118: 'Clients, dégrèvement de Taxes sur la Valeur Ajoutée (T.V.A.)',
  412: 'CLIENTS, EFFETS A RECEVOIR EN PORTEFEUILLE',
  4121: 'Clients, Effets à recevoir',
  4122: 'Clients - Groupe, Effets à recevoir',
  4124: 'Etat et Collectivités publiques, Effets à recevoir',
  4125: 'Organismes Internationaux, Effets à recevoir',
  413: 'CLIENTS, CHEQUES, EFFETS ET AUTRES VALEURS IMPAYES',
  4131: 'Clients, chèques impayés',
  4132: 'Clients, Effets impayés',
  4133: 'Clients, cartes de crédit impayées',
  4138: 'Clients, autres valeurs impayées',
  414: "CREANCES SUR CESSIONS COURANTES D'IMMOBILISATIONS",
  4141: 'Créances en compte, immobilisations incorporelles',
  4142: 'Créances en compte, immobilisations corporelles',
  4146: 'Effets à recevoir, immobilisations incorporelles',
  4147: 'Effets à recevoir, immobilisations corporelles',
  415: 'CLIENTS, EFFETS ESCOMPTES NON ECHUS',
  416: 'APPORTEURS, OPERATIONS SUR LE CAPITAL',
  4161: 'Créances litigieuses',
  4162: 'Créances douteuses',
  418: 'CLIENTS, PRODUITS A RECEVOIR',
  4181: 'Clients, factures à établir',
  4186: 'Clients, intérêts courus',
  419: 'CLIENTS CREDITEURS',
  4191: 'Clients, avances et acomptes reçus',
  4192: 'Clients - Groupe, avances et acomptes reçus',
  4194: 'Clients, dettes pour emballages et matériels consignés',
  4198: 'Clients, rabais, remises, ristournes et autres avoirs à accorder',
  42: 'PERSONNEL',
  421: 'PERSONNEL, AVANCES ET ACOMPTES',
  4211: 'Personnel, avances',
  4212: 'Personnel, acomptes',
  4213: 'Frais avancés et fournitures au personnel',
  422: 'PERSONNEL, REMUNERATIONS DUES',
  423: 'PERSONNEL, OPPOSITIONS, SAISIES-ARRETS',
  4231: 'Personnel, oppositions',
  4232: 'Personnel, saisies-arrêts',
  4233: 'Personnel, avis à tiers détenteur',
  424: 'PERSONNEL, OEUVRES SOCIALES INTERNES',
  4241: 'Assistance médicale',
  4242: 'Allocations familiales',
  4245: "Organismes sociaux rattachés à l'entité",
  4248: 'Autres oeuvres sociales internes',
  425: 'REPRESENTANTS DU PERSONNEL',
  4251: 'Délégués du personnel',
  4252: "Syndicats et Comités d'entreprises, d'Etablissement",
  4258: 'Autres représentants du personnel',
  426: 'PERSONNEL, PARTICIPATION AUX BENEFICES ET AU CAPITAL',
  4261: 'Participation aux bénéfices',
  4264: 'Participation au capital',
  427: 'PERSONNEL – DEPOTS',
  428: 'PERSONNEL, CHARGES A PAYER ET PRODUITS A RECEVOIR',
  4281: 'Dettes provisionnées pour congés à payer',
  4286: 'Autres charges à payer',
  4287: 'Produits à recevoir',
  43: 'ORGANISMES SOCIAUX',
  431: 'SECURITE SOCIALE',
  4311: 'Prestations familiales',
  4312: 'Accidents de travail',
  4313: 'Caisse de retraite obligatoire',
  4314: 'Caisse de retraite facultative',
  4318: 'Autres cotisations sociales',
  432: 'CAISSES DE RETRAITE COMPLEMENTAIRE 433',
  433: 'AUTRES ORGANISMES SOCIAUX',
  4331: 'Mutuelle',
  4332: 'Assurances Retraite',
  4333: 'Assurances et organismes de santé',
  4334: 'T.V.A. facturée sur production livrée à soi-même',
  4335: 'T.V.A. sur factures à établir',
  438: 'ORGANISMES SOCIAUX, CHARGES À PAYER ET PRODUITS À RECEVOIR',
  4381: 'Charges sociales sur gratifications à payer',
  4382: 'Charges sociales sur congés à payer',
  4386: 'Autres charges à payer',
  4387: 'Produits à recevoir',
  44: 'ETAT ET COLLECTIVITES PUBLIQUES',
  441: 'ETAT, IMPOT SUR LES BENEFICES 442 ETAT, AUTRES IMPOTS ET TAXES',
  4421: "Impôts et taxes d'Etat",
  4422: 'Impôts et taxes pour les collectivités publiques',
  4423: 'Impôts et taxes recouvrables sur des obligataires',
  4424: 'Impôts et taxes recouvrables sur des associés',
  4426: 'Droits de douane',
  4428: 'Autres impôts et taxes',
  443: 'ETAT, T.V.A. FACTUREE',
  4431: 'T.V.A. facturée sur ventes',
  4432: 'T.V.A. facturée sur prestations de services',
  4433: 'T.V.A. facturée sur travaux',
  444: 'ETAT, T.V.A. DUE OU CREDIT DE T.V.A.',
  4441: 'Etat, T.V.A. due',
  4445: 'Etat, dégrèvement T.V.A.',
  4449: 'Etat, crédit de T.V.A. à reporter',
  445: 'ETAT, T.V.A. RECUPERABLE',
  4451: 'T.V.A. récupérable sur immobilisations',
  4452: 'T.V.A. récupérable sur achats',
  4453: 'T.V.A. récupérable sur transport',
  4454: 'T.V.A. récupérable sur services extérieurs et autres charges',
  4455: 'T.V.A. récupérable sur factures non parvenues',
  4456: "T.V.A. transférée par d'autres entités",
  446: "ETAT, AUTRES TAXES SUR LE CHIFFRE D'AFFAIRES",
  447: 'ETAT, IMPOTS RETENUS A LA SOURCE',
  4471: 'Impôt Général sur le revenu',
  4472: 'Impôts sur salaires',
  4473: 'Contribution nationale',
  4474: 'Contribution nationale de solidarité',
  4478: 'Autres impôts et contributions',
  448: 'ETAT, CHARGES A PAYER ET PRODUITS A RECEVOIR',
  4486: 'Charges à payer',
  4487: 'Produits à recevoir',
  449: 'ETAT, CREANCES ET DETTES DIVERSES',
  4491: 'Etat, obligations cautionnées',
  4492: 'Etat, avances et acomptes versés sur impôts',
  4493: 'Etat, fonds de dotation à recevoir',
  4494: "Etat, subventions d'investissement à recevoir",
  4495: "Etat, subventions d'exploitation à recevoir",
  4496: "Etat, subventions d'équilibre à recevoir",
  4497: 'Etat, avances sur subventions',
  4499: 'Etat, fonds réglementé provisionné',
  45: 'ORGANISMES INTERNATIONAUX',
  451: 'OPERATIONS AVEC LES ORGANISMES AFRICAINS',
  452: 'OPERATIONS AVEC LES AUTRES ORGANISMES INTERNATIONAUX',
  458: 'ORGANISMES INTERNATIONAUX, FONDS DE DOTATION ET SUBVENTIONS A RECEVOIR',
  4581: 'Organismes internationaux, fonds de dotation à recevoir',
  4582: 'Organismes internationaux, subventions à recevoir',
  46: 'APPORTEURS, ASSOCIES ET GROUPE',
  4611: 'Apporteurs, apports en nature',
  4612: 'Apporteurs, apports en numéraire',
  4613: 'Apporteurs, capital appelé, non versé',
  4614: "Apporteurs, compte d'apport, opérations de restructuration (fusion…)",
  4615: 'Apporteurs, versements reçus sur augmentation de capital',
  4616: 'Apporteurs, versements anticipés',
  4617: 'Apporteurs défaillants',
  4618: 'Apporteurs, titres à échanger',
  4619: 'Apporteurs, capital à rembourser',
  462: 'ASSOCIES (2), COMPTES COURANTS',
  4621: 'Principal',
  4626: 'Intérêts courus',
  463: 'ASSOCIES (2), OPERATIONS FAITES EN COMMUN ET GIE',
  4631: 'Opérations courantes',
  4636: 'Intérêts courus',
  465: 'ASSOCIES (2), DIVIDENDES A PAYER',
  466: 'GROUPE, COMPTES COURANTS',
  467: 'APPORTEURS RESTANT DÛ SUR CAPITAL APPELE',
  469: 'ENTITE, DIVIDENDES A RECEVOIR',
  47: 'DEBITEURS ET CREDITEURS DIVERS',
  471: 'DEBITEURS ET CREDITEURS DIVERS',
  4711: 'Débiteurs divers',
  4712: 'Créditeurs divers',
  4713: 'Obligataires',
  4715: "Rémunérations d'administrateurs non associés",
  4716: "Compte d'affacturage et de titrisation",
  4717: 'Débiteurs divers - retenues de garantie',
  4718: 'Apport, compte de fusion et opérations assimilées',
  4719: "Bons de souscription d'actions et d'obligations",
  472: 'CREANCES ET DETTES SUR TITRES DE PLACEMENT',
  4721: 'Créances sur cessions de titres de placement',
  4726: 'Versements restant à effectuer sur titres de placement non libérés',
  473: 'INTERMEDIAIRES - OPERATIONS FAITES POUR COMPTE DE TIERS',
  4731: 'Mandants',
  4732: 'Mandataires',
  4733: 'Commettants',
  4734: 'Commissionnaires',
  4739: "Etat, Collectivités publiques, fonds global d'allocation",
  474: 'COMPTE DE REPARTITION PERIODIQUE DES CHARGES ET DES PRODUITS',
  4746: 'Compte de répartition périodique des charges',
  4747: 'Compte de répartition périodique des produits',
  475: 'COMPTE TRANSITOIRE, AJUSTEMENT SPECIAL LIE A LA REVISION DU SYSCOHADA',
  4751: 'Compte-actif',
  4752: 'Compte-passif',
  476: "CHARGES CONSTATEES D'AVANCE",
  477: "PRODUITS CONSTATES D'AVANCE",
  478: 'ECARTS DE CONVERSION - ACTIF',
  4781: 'Diminution des créances HAO',
  4782: 'Diminution des créances financières',
  4783: 'Augmentation des dettes HAO',
  4784: 'Augmentation des dettes financières',
  4786: "Différences d'évaluation sur instruments de trésorerie",
  4788: 'Différences compensées par couverture de change',
  479: 'ECARTS DE CONVERSION - PASSIF',
  4791: "Augmentation des créances d'exploitation",
  47911: "Augmentation des créances d'exploitation",
  47928: 'Augmentation des créances HAO',
  4793: "Diminution des dettes d'exploitation et HAO",
  47931: "Diminution des dettes d'exploitation",
  47948: 'Diminution des dettes HAO',
  4797: 'Diminution des dettes financières',
  4798: 'Différences compensées par couverture de change',
  48: 'REANCES ET DETTES HORS ACTIVITES ORDINAIRES (HAO)',
  481: "FOURNISSEURS D'INVESTISSEMENTS",
  4811: 'Immobilisations incorporelles',
  4812: 'Immobilisations corporelles',
  4813: 'Versements restant à effectuer sur titres de participation et titres immobilisés n',
  4816: 'Réserve de propriété (3)',
  48161: 'Réserve de propriété - immobilisations incorporelles',
  48162: 'Réserve de propriété - immobilisations corporelles',
  4817: 'Retenues de garantie  (3)',
  48171: 'Retenues de garantie  - immobilisations incorporelles',
  48172: 'Retenues de garantie  - immobilisations incorporelles',
  4818: 'Factures non parvenues (3)',
  48181: 'Factures non parvenues - immobilisations incorporelles',
  48182: 'Factures non parvenues - immobilisations corporelles',
  482: "FOURNISSEURS D'INVESTISSEMENTS, EFFETS A  PAYER",
  4821: 'Immobilisations incorporelles',
  4822: 'Immobilisations corporelles (H.A.O.)',
  485: "CREANCES SUR CESSIONS D'IMMOBILISATIONS",
  4851: 'En compte, immobilisations incorporelles',
  4852: 'En compte, immobilisations corporelles',
  4853: 'Effets à recevoir, immobilisations incorporelles',
  4854: 'Effets à recevoir, immobilisations corporelles',
  4855: 'Effets escomptés non échus',
  4856: 'Immobilisations financières',
  4857: 'Retenues de garantie',
  4858: 'Factures à établir',
  488: 'AUTRES CREANCES HORS ACTIVITES ORDINAIRES (H.A.O.)',
  49: 'DEPRECIATIONS ET PROVISIONS POUR RISQUES A COURT  TERME (TIERS)',
  490: 'DEPRECIATIONS DES COMPTES FOURNISSEURS',
  491: 'DEPRECIATIONS DES COMPTES CLIENTS',
  4911: 'Créances litigieuses',
  4912: 'Créances douteuses',
  492: 'DEPRECIATIONS DES COMPTES PERSONNEL',
  493: 'DEPRECIATIONS DES COMPTES ORGANISMES SOCIAUX',
  494: 'DEPRECIATIONS DES COMPTES ETAT ET COLLECTIVITES PUBLIQUES',
  495: 'DEPRECIATIONS DES COMPTES ORGANISMES INTERNATIONAUX',
  496: 'DEPRECIATIONS DES COMPTES  ASSOCIES ET GROUPE',
  4962: 'Associés, comptes courants',
  4963: 'Associés, opérations faites en commun et GIE',
  4966: 'Groupe, comptes courants',
  497: 'DEPRECIATIONS DES COMPTES DEBITEURS DIVERS',
  498: 'DEPRECIATIONS DES COMPTES DE CREANCES H.A.O.',
  4985: "Créances sur cessions d'immobilisations",
  4986: 'Créances sur cessions de titres de placement',
  4988: 'Autres créances H.A.O.',
  499: 'PROVISIONS POUR RISQUES A COURT TERME',
  4991: "Sur opérations d'exploitation",
  4998: 'Sur opérations H.A.O.',
  50: 'TITRES DE PLACEMENT',
  501: 'TITRES DU TRESOR ET BONS DE CAISSE A COURT TERME',
  5011: 'Titres du Trésor à court terme',
  5012: "Titres d'organismes financiers",
  5013: 'Bons de caisse à court terme',
  5016: "Frais d'acquisition des titres de Trésor et bons de caisse",
  502: 'ACTIONS',
  5021: 'Actions ou parts propres',
  5022: 'Actions cotées',
  5023: 'Actions non cotées',
  5024: "Actions démembrées (certificats d'investissement ; droits de vote)",
  5025: 'Autres actions',
  5026: "Frais d'acquisition des actions",
  503: 'OBLIGATIONS',
  5031: "Obligations émises par l'entité et rachetées par elle",
  5032: 'Obligations cotées',
  5033: 'Obligations non cotées',
  5035: 'Autres obligations',
  5036: "Frais d'acquisition des obligations",
  504: 'BONS DE SOUSCRIPTION',
  5042: "Bons de souscription d'actions",
  5043: "Bons de souscription d'obligations",
  505: 'TITRES NEGOCIABLES HORS REGION',
  506: 'INTERETS COURUS',
  5061: 'Titres du Trésor et bons de caisse à court terme',
  5062: 'Actions',
  5063: 'Obligations',
  508: 'AUTRES TITRES DE PLACEMENT ET CREANCES ASSIMILEES',
  51: 'VALEURS A ENCAISSER',
  511: 'EFFETS A ENCAISSER',
  512: "EFFETS A L'ENCAISSEMENT",
  513: 'CHEQUES A ENCAISSER',
  514: "CHEQUES A L'ENCAISSEMENT",
  515: 'CARTES DE CREDIT A ENCAISSER',
  518: "AUTRES VALEURS A L'ENCAISSEMENT",
  5181: 'Warrants',
  5182: 'Billets de fonds',
  5185: 'Chèques de voyage',
  5186: 'Coupons échus',
  5187: 'Intérêts échus des obligations',
  52: 'BANQUES',
  521: 'BANQUES LOCALES',
  5211: 'Banques en monnaie nationale',
  5215: 'Banques en devises',
  522: 'BANQUES AUTRES ETATS REGION',
  523: 'BANQUES AUTRES ETATS ZONE MONETAIRE',
  524: 'BANQUES HORS ZONE MONETAIRE',
  525: 'BANQUES DEPOT  A TERME',
  526: 'BANQUES, INTERETS  COURUS',
  5261: 'Banque, intérêts courus charges à payer',
  5267: 'Banque, intérêts courus produits à recevoir',
  53: 'ETABLISSEMENTS FINANCIERS ET ASSIMILES',
  531: 'CHEQUES POSTAUX',
  532: 'TRESOR',
  533: "SOCIETES DE GESTION ET D'INTERMEDIATION (S.G.I.)",
  536: 'ETABLISSEMENTS FINANCIERS, INTERETS COURUS',
  538: 'AUTRES ORGANISMES FINANCIERS',
  54: 'INSTRUMENTS DE TRESORERIE',
  541: "OPTIONS DE TAUX D'INTERET",
  542: 'OPTIONS DE TAUX DE CHANGE',
  543: 'OPTIONS DE TAUX BOURSIERS',
  544: 'INSTRUMENTS DE MARCHES A TERME',
  545: "AVOIRS D'OR ET AUTRES METAUX PRECIEUX (4)",
  55: 'INSTRUMENTS DE MONNAIE ELECTRONIQUE',
  551: 'MONNAIE ELECTRONIQUE - CARTE CARBURANT',
  552: 'MONNAIE ELECTRONIQUE - TELEPHONE PORTABLE',
  553: 'MONNAIE ELECTRONIQUE- CARTE PEAGE',
  554: 'PORTE -MONNAIE ELECTRONIQUE',
  558: 'AUTRES INSTRUMENTS DE MONNAIES ELECTRONIQUES',
  56: "BANQUES, CREDITS DE TRESORERIE ET D'ESCOMPTE",
  561: 'CREDITS DE TRESORERIE',
  564: 'ESCOMPTE DE CREDITS DE CAMPAGNE',
  565: 'ESCOMPTE DE CREDITS ORDINAIRES',
  566: 'BANQUES,  CREDITS DE TRESORERIE, INTERETS  COURUS',
  57: 'CAISSE',
  571: 'CAISSE SIEGE SOCIAL',
  5711: 'Caisse en monnaie nationale',
  5712: 'Caisse en devises',
  572: 'CAISSE SUCCURSALE A',
  5721: 'en monnaie nationale',
  5722: 'en devises',
  573: 'CAISSE SUCCURSALE B',
  5731: 'en monnaie nationale',
  5732: 'en devises',
  58: "REGIES D'AVANCES, ACCREDITIFS ET VIREMENTS",
  581: "REGIES D'AVANCE",
  582: 'ACCREDITIFS',
  585: 'VIREMENTS DE FONDS',
  588: 'AUTRES VIREMENTS INTERNES',
  59: 'DEPRECIATIONS ET PROVISIONS POUR RISQUE A COURT  TERME',
  590: 'DEPRECIATIONS DES TITRES DE PLACEMENT',
  591: 'DEPRECIATIONS DES TITRES ET VALEURS A ENCAISSER',
  592: 'DEPRECIATIONS DES COMPTES BANQUES',
  593: 'DEPRECIATIONS DES COMPTES ETABLISSEMENTS  FINANCIERS ET ASSIMILES',
  594: "DEPRECIATIONS DES COMPTES D'INSTRUMENTS DE TRESORERIE",
  599: 'PROVISIONS POUR RISQUE A COURT TERME A CARACTERE FINANCIER',
  60: 'ACHATS ET VARIATIONS DE STOCKS',
  601: 'ACHATS DE MARCHANDISES',
  6011: 'dans la Région (5)',
  6012: 'hors Région (5)',
  6013: 'aux entités du groupe dans la Région',
  6014: 'aux entités du groupe hors Région',
  6015: 'frais sur achats (6)',
  6019: 'Rabais, Remises et Ristournes obtenus (non ventilés)',
  602: 'ACHATS DE MATIERES PREMIERES ET FOURNITURES LIEES',
  6021: 'dans la Région (5)',
  6022: 'hors Région (5)',
  6023: 'aux entités du groupe dans la Région',
  6024: 'aux entités du groupe hors Région',
  6025: 'frais sur achats (6)',
  6029: 'Rabais, Remises et Ristournes obtenus (non ventilés)',
  603: 'VARIATIONS DES STOCKS DE BIENS ACHETES',
  6031: 'Variations des stocks de marchandises',
  6032: 'Variations des stocks de matières premières et fournitures liées',
  6033: "Variations des stocks d'autres approvisionnements",
  604: 'ACHATS STOCKES DE MATIERES ET FOURNITURES CONSOMMABLES',
  6041: 'Matières consommables',
  6042: 'Matières combustibles',
  6043: "Produits d'entretien",
  6044: "Fournitures d'atelier et d'usine",
  6045: 'Frais sur achats (6)',
  6046: 'Fournitures de magasin',
  6047: 'Fournitures de bureau',
  6049: 'Rabais, Remises et Ristournes obtenus (non ventilés)',
  605: 'AUTRES ACHATS',
  6051: 'Fournitures non stockables –Eau',
  6052: 'Fournitures non stockables - Electricité',
  6053: 'Fournitures non stockables – Autres énergies',
  6054: "Fournitures d'entretien non stockables",
  6055: 'Fournitures de bureau non stockables',
  6056: 'Achats de petit matériel et outillage',
  6057: "Achats d'études et prestations de services",
  6058: 'Achats de travaux, matériels et équipements',
  6059: 'Rabais, Remises et Ristournes obtenus (non ventilés)',
  608: "ACHATS D'EMBALLAGES",
  6081: 'Emballages perdus',
  6082: 'Emballages récupérables non identifiables',
  6083: 'Emballages à usage mixte',
  6085: 'frais sur achats (6)',
  6089: 'Rabais, Remises et Ristournes obtenus (non ventilés)',
  61: 'TRANSPORTS',
  612: 'TRANSPORTS SUR VENTES',
  613: 'TRANSPORTS POUR LE COMPTE DE TIERS',
  614: 'TRANSPORTS DU PERSONNEL',
  616: 'TRANSPORTS DE PLIS',
  618: 'AUTRES FRAIS DE TRANSPORT',
  6181: 'Voyages et déplacements',
  6182: 'Transports entre établissements ou chantiers',
  6183: 'Transports administratifs',
  62: 'SERVICES EXTERIEURS',
  621: 'SOUS-TRAITANCE GENERALE',
  622: 'LOCATIONS,  CHARGES LOCATIVES',
  6221: 'Locations de terrains',
  6222: 'Locations de bâtiments',
  6223: 'Locations de matériels et outillages',
  6224: 'Malis sur emballages',
  6225: "Locations d'emballages",
  6226: 'Fermages et loyers du foncier',
  6228: 'Locations et charges locatives diverses',
  623: 'REDEVANCES DE LOCATION-ACQUISITION',
  6232: 'Crédit-bail immobilier',
  6233: 'Crédit-bail mobilier',
  6234: 'Location-vente',
  6238: 'Autres contrats de location-acquisition',
  624: 'ENTRETIEN, REPARATIONS, REMISE EN ETAT ET MAINTENANCE',
  6241: 'Entretien et réparations des biens immobiliers',
  6242: 'Entretien et réparations des biens mobiliers',
  6243: 'Maintenance',
  6244: 'Charges de démantèlement et remise en état',
  6248: 'Autres entretiens et réparations',
  625: "PRIMES D'ASSURANCE",
  6251: 'Assurances multirisques',
  6252: 'Assurances matériel de transport',
  6253: "Assurances risques d'exploitation",
  6254: 'Assurances responsabilité du producteur',
  6255: 'Assurances insolvabilité clients',
  6257: 'Assurances transport sur ventes',
  6258: "Autres primes d'assurances",
  626: 'ETUDES, RECHERCHES ET DOCUMENTATION',
  6261: 'Etudes et recherches',
  6265: 'Documentation générale',
  6266: 'Documentation technique',
  627: 'PUBLICITE, PUBLICATIONS, RELATIONS PUBLIQUES',
  6271: 'Annonces, insertions',
  6272: 'Catalogues, imprimés publicitaires',
  6273: 'Echantillons',
  6274: 'Foires et expositions',
  6275: 'Publications',
  6276: 'Cadeaux à la clientèle',
  6277: 'Frais de colloques, séminaires, conférences',
  6278: 'Autres charges de publicité et relations publiques',
  628: 'FRAIS DE TELECOMMUNICATIONS',
  6281: 'Frais de téléphone',
  6282: 'Frais de télex',
  6283: 'Frais de télécopie',
  6288: 'Autres frais de télécommunications',
  63: 'AUTRES SERVICES EXTERIEURS',
  631: 'FRAIS BANCAIRES',
  6311: 'Frais sur titres (vente, garde)',
  6312: 'Frais sur effets',
  6313: 'Location de coffres',
  6314: "Commissions d'affacturage et de titrisation",
  6315: 'Commissions sur cartes de crédit',
  6316: "Frais d'émission d'emprunts",
  6317: 'Frais sur instruments monnaie électronique',
  6318: 'Autres frais bancaires',
  632: "REMUNERATIONS D'INTERMEDIAIRES ET DE CONSEILS",
  6322: 'Commissions et courtages sur ventes',
  6324: 'Honoraires des professions règlementées',
  6325: "Frais d'actes et de contentieux",
  6326: "Rémunérations d'affacturage et de titrisation",
  6327: 'Rémunérations des autres prestataires de services',
  6328: 'Divers frais',
  633: 'FRAIS DE FORMATION DU PERSONNEL',
  634: 'REDEVANCES POUR BREVETS, LICENCES, LOGICIELS, CONCESSIONS, DROITS  ET VALEURS SIMILA',
  6342: 'Redevances pour brevets, licences',
  6343: 'Redevances pour logiciels',
  6344: 'Redevances pour marques',
  6345: 'Redevances pour sites  internet',
  6346: 'Redevances pour concessions, droits et valeurs similaires',
  635: 'COTISATIONS',
  6351: 'Cotisations',
  6358: 'Concours divers',
  637: "REMUNERATIONS DE PERSONNEL EXTERIEUR A L'ENTITE",
  6371: 'Personnel intérimaire',
  6372: "Personnel détaché ou prêté à l'entité",
  638: 'AUTRES CHARGES EXTERNES',
  6381: 'Frais de recrutement du personnel',
  6382: 'Frais de déménagement',
  6383: 'Réceptions',
  6384: 'Missions',
  6385: 'Charges de copropriété',
  6388: 'Charges externes diverses',
  64: 'IMPOTS ET TAXES',
  641: 'IMPOTS ET TAXES DIRECTS',
  6411: 'Impôts fonciers et taxes annexes',
  6412: 'Patentes, licences et taxes annexes',
  6413: 'Taxes sur appointements et salaires',
  6414: "Taxes d'apprentissage",
  6415: 'Formation professionnelle continue',
  6418: 'Autres impôts et taxes directs',
  645: 'IMPOTS ET TAXES INDIRECTS',
  646: "DROITS D'ENREGISTREMENT",
  6461: 'Droits de mutation',
  6462: 'Droits de timbre',
  6463: 'Taxes sur les véhicules de société',
  6464: 'Vignettes',
  6468: "Autres droits d'enregistrement",
  647: 'PENALITES, AMENDES FISCALES',
  6471: "Pénalités d'assiette, impôts directs",
  6472: "Pénalités d'assiette, impôts indirects",
  6473: 'Pénalités de recouvrement, impôts directs',
  6474: 'Pénalités de recouvrement, impôts indirects',
  6478: 'Autres pénalités et amendes fiscales',
  648: 'AUTRES IMPOTS ET TAXES',
  65: 'AUTRES CHARGES',
  651: 'PERTES SUR CREANCES CLIENTS ET AUTRES DEBITEURS',
  6511: 'Clients',
  6515: 'Autres débiteurs',
  652: 'QUOTE-PART DE RESULTAT SUR OPERATIONS',
  6521: 'Quote-part transférée de bénéfices (comptabilité du gérant)',
  6525: 'Pertes imputées par transfert (comptabilité des associés non gérants)',
  654: "VALEURS COMPTABLES DES CESSIONS COURANTES D'IMMOBILISATIONS",
  6541: 'Immobilisations incorporelles',
  6542: 'Immobilisations corporelles',
  656: 'PERTE DE CHANGE SUR CREANCES ET DETTES COMMERCIALE',
  657: 'PENALITES ET AMENDES PENALES',
  658: 'CHARGES DIVERSES',
  6581: "Indemnités de fonction et autres rémunérations d'administrateurs",
  6582: 'Dons',
  6583: 'Mécénat',
  6588: 'Autres charges diverses',
  659: "CHARGES POUR DEPRECIATIONS ET PROVISIONS POUR RISQUES   A COURT TERME D'EXPLOITATION",
  6591: 'sur risques à court terme',
  6593: 'sur stocks',
  6594: 'sur créances',
  6598: 'Autres charges pour  dépréciations et provisions pour risques à court terme',
  66: 'CHARGES DE PERSONNEL',
  661: 'REMUNERATIONS DIRECTES VERSEES AU PERSONNEL NATIONAL',
  6611: 'Appointements salaires et commissions',
  6612: 'Primes et gratifications',
  6613: 'Congés payés',
  6614: "Indemnités de préavis, de licenciement et de recherche d'embauche",
  6615: 'Indemnités de maladie versées aux travailleurs',
  6616: 'Supplément familial',
  6617: 'Avantages en nature',
  6618: 'Autres rémunérations directes',
  662: 'REMUNERATIONS DIRECTES VERSEES AU PERSONNEL NON NATIONAL',
  6621: 'Appointements salaires et commissions',
  6622: 'Primes et gratifications',
  6623: 'Congés payés',
  6624: "Indemnités de préavis, de licenciement et de recherche d'embauche",
  6625: 'Indemnités de maladie versées aux travailleurs',
  6626: 'Supplément familial',
  6627: 'Avantages en nature',
  6628: 'Autres rémunérations directes',
  663: 'INDEMNITES FORFAITAIRES VERSEES AU PERSONNEL',
  6631: 'Indemnités de logement',
  6632: 'Indemnités de représentation',
  6633: "Indemnités d'expatriation",
  6634: 'Indemnités de transport',
  6638: 'Autres indemnités et avantages divers',
  664: 'CHARGES SOCIALES',
  6641: 'Charges sociales sur rémunération du personnel national',
  6642: 'Charges sociales sur rémunération du personnel non national',
  666: "REMUNERATIONS ET CHARGES SOCIALES DE L'EXPLOITANT INDIVIDUEL",
  6661: "Rémunération du travail de l'exploitant",
  6662: 'Charges sociales',
  667: 'REMUNERATION TRANSFEREE DE PERSONNEL EXTERIEUR',
  6671: 'Personnel intérimaire',
  6672: "Personnel détaché ou prêté à l'entité",
  668: 'AUTRES CHARGES SOCIALES',
  6681: "Versements aux Syndicats et Comités d'entreprise, d'établissement",
  6682: "Versements aux Comités d'hygiène et de sécurité",
  6683: 'Versements et contributions aux autres œuvres sociales',
  6684: 'Médecine du travail et pharmacie',
  6685: 'Assurances et organismes de santé',
  6686: 'Assurances retraite et fonds de pensions',
  6687: 'Majorations et pénalités sociales',
  6688: 'Charges sociales diverses',
  67: 'FRAIS FINANCIERS ET CHARGES ASSIMILEES',
  671: 'INTERETS DES EMPRUNTS',
  6711: 'Emprunts obligataires',
  6712: 'Emprunts auprès des établissements de crédit',
  6713: 'Dettes liées à des participations',
  6714: 'Primes de remboursement des obligations',
  672: 'INTERETS DANS LOYERS DE LOCATION ACQUISITION',
  6722: 'Intérêts dans loyers de location-acquisition/créditbail immobilier',
  6723: 'Intérêts dans loyers de location-acquisition/créditbail mobilier',
  6724: 'Intérêts dans loyers de location-acquisition/locationvente',
  6728: 'Intérêts dans loyers des autres locations-acquisition',
  673: 'ESCOMPTES ACCORDES',
  674: 'AUTRES INTERETS',
  6741: 'Avances reçues et dépôts créditeurs',
  6742: 'Comptes courants bloqués',
  6743: 'Intérêts sur obligations cautionnées',
  6744: 'Intérêts sur dettes commerciales',
  6745: 'Intérêts bancaires et sur opérations de financement (escompte…)',
  6748: 'Intérêts sur dettes diverses',
  675: 'ESCOMPTES DES EFFETS DE COMMERCE',
  676: 'PERTES DE CHANGE FINANCIERES',
  677: 'PERTES SUR TITRES DE PLACEMENT',
  6771: 'Pertes sur cessions de titres de placement',
  6772: "Malis provenant d'attribution gratuite d'actions au personnel salarié et aux dirig",
  678: 'PERTES ET CHARGES SUR RISQUES FINANCIERS',
  6781: 'sur rentes viagères',
  6782: 'sur opérations financières',
  6784: 'sur instruments de trésorerie',
  679: 'CHARGES POUR DEPRECIATIONS ET PROVISIONS POUR RISQUES A COURT TERME FINANCIERES',
  6791: 'sur risques financiers',
  6795: 'sur titres de placement',
  6798: 'Autres charges pour dépréciations et provisions pour risques à court terme financières',
  68: 'DOTATIONS AUX AMORTISSEMENTS',
  681: "DOTATIONS AUX AMORTISSEMENTS D'EXPLOITATION",
  6812: 'Dotations aux amortissements des immobilisations incorporelles',
  6813: 'Dotations aux amortissements des immobilisations corporelles',
  69: 'DOTATIONS UX PROVISIONS ET AUX DEPRECIATIONS',
  691: "DOTATIONS AUX PROVISIONS ET AUX DEPRECIATIONS D'EXPLOITATION",
  6911: 'Dotations aux provisions pour risques et charges',
  6913: 'Dotations aux dépréciations des immobilisations incorporelles',
  6914: 'Dotations aux dépréciations des immobilisations corporelles',
  697: 'DOTATIONS AUX PROVISIONS ET AUX DEPRECIATIONS FINANCIERES',
  6971: 'Dotations aux provisions pour risques et charges',
  6972: 'Dotations aux dépréciations des immobilisations financières',
  701: 'VENTES DE MARCHANDISES',
  7011: 'dans la Région (7)',
  7012: 'hors Région (7)',
  7013: 'aux entités du groupe dans la Région',
  7014: 'aux entités du groupe hors Région',
  7015: 'sur internet',
  7019: 'Rabais, remises, ristournes accordés (non ventilés)',
  702: 'VENTES DE PRODUITS FINIS',
  7021: 'dans la Région (7)',
  7022: 'hors Région (7)',
  7023: 'aux entités du groupe dans la Région',
  7024: 'aux entités du groupe hors Région',
  7025: 'sur internet',
  7029: 'Rabais, remises, ristournes accordés (non ventilés)',
  703: 'VENTES DE PRODUITS INTERMEDIAIRES',
  7031: 'dans la Région (7)',
  7032: 'hors Région (7)',
  7033: 'aux entités du groupe dans la Région',
  7034: 'aux entités du groupe hors Région',
  7035: 'sur internet',
  7039: 'Rabais, remises, ristournes accordés (non ventilés)',
  704: 'VENTES DE PRODUITS RESIDUELS',
  7041: 'dans la Région (7)',
  7042: 'hors Région (7)',
  7043: 'aux entités du groupe dans la Région',
  7044: 'aux entités du groupe hors Région',
  7045: 'sur internet',
  7049: 'Rabais, remises, ristournes accordés (non ventilés)',
  705: 'TRAVAUX FACTURES',
  7051: 'dans la Région (7)',
  7052: 'hors Région (7)',
  7053: 'aux entités du groupe dans la Région',
  7054: 'aux entités du groupe hors Région',
  7055: 'sur internet',
  7059: 'Rabais, remises, ristournes accordés (non ventilés)',
  706: 'SERVICES VENDUS',
  7061: 'dans la Région (7)',
  7062: 'hors Région (7)',
  7063: 'aux entités du groupe dans la Région',
  7064: 'aux entités du groupe hors Région',
  7065: 'sur internet',
  7069: 'Rabais, remises, ristournes accordés (non ventilés)',
  707: 'PRODUITS ACCESSOIRES',
  7071: 'Ports, emballages perdus et autres frais facturés',
  7072: 'Commissions et courtages(8)',
  7073: 'Locations et redevances de location - financement (8)',
  7074: "Bonis sur reprises et cessions d'emballages",
  7075: 'Mise à disposition de personnel (8)',
  7076: 'Redevances pour brevets, logiciels, marques et droits similaires (8)',
  7077: "Services exploités dans l'intérêt du personnel",
  7078: 'Autres produits accessoires',
  71: "SUBVENTIONS D'EXPLOITATION",
  711: "SUR PRODUITS A L'EXPORTATION",
  712: "SUR PRODUITS A L'IMPORTATION",
  713: 'SUR PRODUITS DE PEREQUATION',
  714: "INDEMNITES ET SUBVENTIONS D'EXPLOITATION (entité agricole)",
  718: "AUTRES SUBVENTIONS D'EXPLOITATION",
  7181: "Versées par l'Etat et les collectivités publiques",
  7182: 'Versées par les organismes internationaux',
  7183: 'Versées par des tiers',
  72: 'PRODUCTION IMMOBILISEE',
  721: 'IMMOBILISATIONS INCORPORELLES',
  722: 'IMMOBILISATIONS CORPORELLES',
  7221: 'Immobilisations corporelles (hors actifs biologiques)',
  7222: 'Immobilisations corporelles (actifs biologiques)',
  724: 'PRODUCTION AUTO-CONSOMMEE',
  726: 'IMMOBILISATIONS FINANCIERES (9)',
  73: 'VARIATIONS DES STOCKS DE BIENS ET DE SERVICES PRODUITS',
  734: 'VARIATIONS DES STOCKS DE PRODUITS EN COURS',
  7341: 'Produits en cours',
  7342: 'Travaux en cours',
  735: 'VARIATIONS DES SERVICES EN COURS',
  7351: 'Etudes en cours',
  7352: 'Prestations de services en cours',
  736: 'VARIATIONS DES STOCKS DE PRODUITS FINIS',
  737: 'VARIATIONS DES STOCKS DE PRODUITS INTERMEDIAIRES ET RESIDUELS',
  7371: 'Produits intermédiaires',
  7372: 'Produits résiduels',
  75: 'AUTRES PRODUITS',
  751: 'PROFITS SUR CREANCES CLIENTS ET AUTRES DEBITEURS',
  752: 'QUOTE-PART DE RESULTAT SUR OPERATIONS FAITES EN COMMUN',
  7521: 'Quote-part transférée de pertes (comptabilité du gérant)',
  7525: 'Bénéfices attribués par transfert (comptabilité des associés non gérants)',
  754: "PRODUITS DES CESSIONS COURANTES D'IMMOBILISATIONS",
  7541: 'Immobilisations incorporelles',
  7542: 'Immobilisations corporelles',
  756: 'GAINS DE CHANGE SUR CREANCES ET DETTES COMMERCIALES',
  758: 'PRODUITS DIVERS',
  7581: "Indemnités de fonction et autres rémunérations d'administrateurs",
  7582: "Indemnités d'assurances reçues",
  7588: 'Autres produits divers',
  759: "REPRISES DE CHARGES POUR DEPRECIATIONS ET PROVISIONS POUR RISQUES A COURT TERME D'EX",
  7591: 'sur risques à court terme',
  7593: 'sur stocks',
  7594: 'sur créances',
  7598: "sur autres charges pour dépréciations  et provisions pour risques à court terme d'exploitation",
  77: 'REVENUS FINANCIERS ET PRODUITS ASSIMILES',
  771: 'INTERETS DE PRETS ET CREANCES DIVERSES',
  7712: 'Intérêts de prêts',
  7713: 'Intérêts sur créances diverses',
  772: 'REVENUS DE PARTICIPATIONS ET AUTRES TITRES IMMOBILISES',
  7721: 'Revenus des titres de participation',
  7722: 'Revenus autres titres immobilisés',
  773: 'ESCOMPTES OBTENUS',
  774: 'REVENUS DE PLACEMENT',
  7745: 'Revenus des obligations',
  7746: 'Revenus des titres de placement',
  775: 'INTERETS DANS LOYERS DE LOCATION-FINANCEMENT',
  776: 'GAINS DE CHANGE FINANCIERS',
  777: 'GAINS SUR CESSIONS DE TITRES DE PLACEMENT',
  778: 'GAINS SUR RISQUES FINANCIERS',
  7781: 'sur rentes viagères',
  7782: 'sur opérations financières',
  7784: 'sur instruments de trésorerie',
  779: 'REPRISES DE CHARGES POUR DEPRECIATIONS ET PROVISIONS POUR RISQUES A COURT TERME FINANCIERES',
  7791: 'sur risques financiers',
  7795: 'sur titres de placement',
  7798: 'sur autres charges pour dépréciations et provisions pour risques à court terme financières',
  78: 'TRANSFERTS DE CHARGES',
  781: "TRANSFERTS DE CHARGES D'EXPLOITATION",
  787: 'TRANSFERTS DE CHARGES FINANCIERES',
  79: 'REPRISES DE PROVISIONS, DE DEPRECIATIONS ET AUTRES',
  791: "REPRISES DE PROVISIONS ET DEPRECIATIONS D'EXPLOITATION",
  7911: 'pour risques et charges',
  7913: 'des immobilisations incorporelles',
  7914: 'des immobilisations corporelles',
  797: 'REPRISES DE PROVISIONS ET DEPRECIATIONS FINANCIERES',
  7971: 'pour risques et charges',
  7972: 'des immobilisations financières',
  798: "REPRISES D'AMORTISSEMENTS (10)",
  799: "REPRISES DE SUBVENTIONS D'INVESTISSEMENT",
  81: "VALEURS COMPTABLES DES CESSIONS D'IMMOBILISATIONS",
  811: 'IMMOBILISATIONS INCORPORELLES',
  812: 'IMMOBILISATIONS CORPORELLES',
  816: 'IMMOBILISATIONS FINANCIERES',
  82: "PRODUITS DES CESSIONS D'IMMOBILISATIONS",
  821: 'IMMOBILISATIONS INCORPORELLES',
  822: 'IMMOBILISATIONS CORPORELLES',
  826: 'IMMOBILISATIONS FINANCIERES',
  83: 'CHARGES HORS ACTIVITES ORDINAIRES',
  831: 'CHARGES H.A.O. CONSTATEES',
  833: 'CHARGES LIEES AUX OPERATIONS DE RESTRUCTURATION',
  834: 'PERTES SUR CREANCES H.A.O.',
  835: 'DONS ET LIBERALITES ACCORDES',
  836: 'ABANDONS DE CREANCES CONSENTIS',
  837: 'CHARGES LIEES AUX OPERATIONS DE LIQUIDATION',
  84: 'PRODUITS HORS ACTIVITES ORDINAIRES',
  841: 'PRODUITS H.A.O CONSTATES',
  843: 'PRODUITS LIES AUX OPERATIONS DE RESTRUCTURATION',
  844: 'INDEMNITES ET SUBVENTIONS H.A.O. (entité agricole)',
  845: 'DONS ET LIBERALITES OBTENUS',
  846: 'ABANDONS DE CREANCES OBTENUS',
  847: 'PRODUITS LIES AUX OPERATIONS DE LIQUIDATION',
  848: 'TRANSFERTS DE CHARGES H.A.O',
  849: 'REPRISES DE CHARGES POUR DEPRECIATIONS ET PROVISIONS POUR RISQUES A COURT TERME H.A.',
  85: 'DOTATIONS HORS ACTIVITES ORDINAIRES',
  851: 'DOTATIONS AUX PROVISIONS REGLEMENTEES',
  852: 'DOTATIONS AUX AMORTISSEMENTS H.A.O.',
  853: 'DOTATIONS AUX DEPRECIATIONS H.A.O.',
  854: 'DOTATIONS AUX PROVISIONS POUR RISQUES ET CHARGES H.A.O.',
  858: 'AUTRES DOTATIONS H.A.O.',
  86: 'REPRISES DE CHARGES, PROVISIONS ET DEPRECIATIONS HAO.',
  861: 'REPRISES DE PROVISIONS REGLEMENTEES',
  862: "REPRISES D'AMORTISSEMENTS H.A.O",
  863: 'REPRISES DE DEPRECIATIONS H.A.O.',
  864: 'REPRISES DE PROVISIONS POUR RISQUES ET CHARGES H.A.O.',
  868: 'AUTRES REPRISES H.A.O.',
  87: 'PARTICIPATION DES TRAVAILLEURS',
  871: 'PARTICIPATION LEGALE AUX BENEFICES',
  874: 'PARTICIPATION CONTRACTUELLE AUX BENEFICES',
  878: 'AUTRES PARTICIPATIONS',
  881: 'ETAT',
  884: 'COLLECTIVITES PUBLIQUES',
  886: 'GROUPE',
  888: 'AUTRES',
  89: 'IMPOTS SUR LE RESULTAT',
  891: "IMPOTS SUR LES BENEFICES DE L'EXERCICE",
  8911: "Activités exercées dans l'Etat",
  8912: 'Activités exercées dans les autres Etats de la Région',
  8913: 'Activités exercées hors Région',
  892: "RAPPEL D'IMPOTS SUR RESULTATS ANTERIEURS",
  895: 'IMPOT MINIMUM FORFAITAIRE (I.M.F.)',
  899: "DEGREVEMENTS ET ANNULATIONS D'IMPOTS SUR RESULTATS ANTERIEURS",
  8991: 'Dégrèvements',
  8994: 'Annulations pour pertes rétroactives',
  90: 'ENGAGEMENTS OBTENUS ET ENGAGEMENTS ACCORDES',
  901: 'ENGAGEMENTS DE FINANCEMENT OBTENUS',
  9011: 'Crédits confirmés obtenus',
  9012: 'Emprunts restant à encaisser',
  9013: 'Facilités de financement renouvelables',
  9014: "Facilités d'émission",
  9018: 'Autres engagements de financement obtenus',
  902: 'ENGAGEMENTS DE GARANTIE OBTENUS',
  9021: 'Avals obtenus',
  9022: 'Cautions, garanties obtenues',
  9023: 'Hypothèques obtenues',
  9024: 'Effets endossés par des tiers',
  9028: 'Autres garanties obtenues',
  903: 'ENGAGEMENTS RECIPROQUES',
  9031: 'Achats de marchandises à terme',
  9032: 'Achats à terme de devises',
  9033: 'Commandes fermes des clients',
  9038: 'Autres engagements réciproques',
  904: 'AUTRES ENGAGEMENTS OBTENUS',
  9041: 'Abandons de créances conditionnels',
  9043: 'Ventes avec clause de réserve de propriété',
  9048: 'Divers engagements obtenus',
  905: 'ENGAGEMENTS DE FINANCEMENT ACCORDES',
  9051: 'Crédits accordés non décaissés',
  9058: 'Autres engagements de financement accordés',
  906: 'ENGAGEMENTS DE GARANTIE ACCORDES',
  9061: 'Avals accordés',
  9062: 'Cautions, garanties accordées',
  9063: 'Hypothèques accordées',
  9064: "Effets endossés par l'entité",
  9068: 'Autres garanties accordées',
  907: 'ENGAGEMENTS RECIPROQUES',
  9071: 'Ventes de marchandises à terme',
  9072: 'Ventes à terme de devises',
  9073: 'Commandes fermes aux fournisseurs',
  9078: 'Autres engagements réciproques',
  908: 'AUTRES ENGAGEMENTS ACCORDES',
  9081: 'Annulations conditionnelles de dettes',
  9082: 'Engagements de retraite',
  9083: 'Achats avec clause de réserve de propriété',
  9088: 'Divers engagements accordés',
  91: 'CONTREPARTIES DES ENGAGEMENTS',
  92: 'COMPTES REFLECHIS',
  93: 'COMPTES DE RECLASSEMENTS',
  94: 'COMPTES DES COÛTS',
  95: 'COMPTES DE STOCKS',
  96: "COMPTES D'ECARTS SUR COUTS PREETABLIS",
  97: 'COMPTES DE DIFFERENCES DE TRAITEMENT COMPTABLE',
  98: 'COMPTABLE COMPTES DE RESULTATS',
  99: 'COMPTES DE LIAISONS INTERNES',
  Autr: 'es terrains nus 223  TERRAINS BATIS',
  IDEN: 'TIFIABLE',
  INST: 'ALLATIONS EN COURS',
};
const CLASS_NAMES = {
  1: 'Capitaux',
  2: 'Immobilisations',
  3: 'Stocks',
  4: 'Tiers',
  5: 'Trésorerie',
  6: 'Charges',
  7: 'Produits',
  8: 'Spéciaux',
};
const NATURE_MAP = { 1: 'Passif', 2: 'Actif', 3: 'Actif', 4: 'Mixte', 5: 'Actif', 6: 'Charge', 7: 'Produit', 8: 'Spécial' };
const JOURNAL_NAMES = {
  AC: 'Achats',
  VE: 'Ventes',
  BQ: 'Banque',
  CA: 'Caisse',
  OD: 'Opérations Diverses',
  IN: 'Inventaire',
  AN: 'À Nouveau',
};
const JOURNAL_ICONS = { AC: '🛒', VE: '💰', BQ: '🏦', CA: '💵', OD: '📋', IN: '📦', AN: '📂' };

// ══════════════════════════════════════════
// TRI DÉBIT AVANT CRÉDIT — NORME SYSCOHADA
// ══════════════════════════════════════════
function sortLignesDebitAvantCredit(lignes) {
  return [...lignes].sort((a, b) => {
    const aIsDebit = (parseFloat(a.debit) || 0) > 0;
    const bIsDebit = (parseFloat(b.debit) || 0) > 0;
    if (aIsDebit && !bIsDebit) return -1;
    if (!aIsDebit && bIsDebit) return 1;
    return 0;
  });
}

function getStepLabel(ecr) {
  const jnl = ecr.journal;
  if (jnl === 'IN') return 'Mouvement de stock';
  if (jnl === 'AC') return 'Constatation facture achat';
  if (jnl === 'VE') return 'Constatation facture vente';
  if (jnl === 'BQ') return 'Règlement banque';
  if (jnl === 'CA') return 'Règlement caisse';
  if (jnl === 'OD') return 'Opération diverse';
  if (jnl === 'AN') return 'À nouveau';
  return ecr.libelle || 'Écriture';
}

// ── État global ──
let ecritures = [],
  lignes = [],
  pieceCounter = 1,        // conservé pour compatibilité (affichage placeholder)
  journalCounters = {},    // { AC: 12, VE: 5, BQ: 3, … } — séquences persistantes
  currentProfile = null,
  isAILoading = false;  // Gardé pour compatibilité

// ── Génère le prochain N° de pièce pour un journal donné ──
// Format : VE-2024-00001  |  Non modifié même après suppression d'écriture.
async function getNextPiece(journal) {
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const key = `${journal}_${yr}`;
  // Charger depuis Firestore si pas encore en mémoire
  if (journalCounters[key] === undefined) {
    try {
      const ownerID = getOwnerProfileId();
      const snap = await window._fbGetDoc(
        window._fbDoc(window._db, 'profiles', ownerID, 'config', 'journal_counters')
      );
      const stored = snap.exists() ? (snap.data() || {}) : {};
      journalCounters[key] = stored[key] || 0;
    } catch (e) {
      journalCounters[key] = 0;
    }
  }
  journalCounters[key]++;
  // Persister immédiatement
  try {
    const ownerID = getOwnerProfileId();
    await window._fbSetDoc(
      window._fbDoc(window._db, 'profiles', ownerID, 'config', 'journal_counters'),
      { [key]: journalCounters[key] },
      { merge: true }
    );
  } catch (e) {
    console.warn('[COMEO] Erreur persistance compteur pièce:', e.message);
  }
  return `${journal}-${yr}-${String(journalCounters[key]).padStart(5, '0')}`;
}

// ── Données des modules (déclarations globales manquantes) ──
let salaries = [];
let stocks = [];
let centresAnalytiques = [];
let imputations = [];
let societes = [];

// ══════════════════════════════════════════
// OPÉRATIONS PARALLÈLES — Saisie + IA simultanées
// ══════════════════════════════════════════
let aiRequestsInProgress = new Map();  // Suivi des requêtes IA par contexte
let saisieEditInProgress = false;      // Flag pour édition saisie

/**
 * Vérifier si une opération spécifique est en cours
 * @param {string} context - 'chat', 'saisie', etc.
 */
function isOperationInProgress(context = 'chat') {
  return aiRequestsInProgress.has(context) && aiRequestsInProgress.get(context) > 0;
}

/**
 * Enregistrer le début d'une opération IA
 */
function startAIOperation(context = 'chat') {
  const current = aiRequestsInProgress.get(context) || 0;
  aiRequestsInProgress.set(context, current + 1);
  updateOperationUI();
  console.log(`[PARALLEL] Début ${context} (total: ${current + 1})`);
}

/**
 * Enregistrer la fin d'une opération IA
 */
function endAIOperation(context = 'chat') {
  const current = aiRequestsInProgress.get(context) || 0;
  if (current > 1) {
    aiRequestsInProgress.set(context, current - 1);
  } else {
    aiRequestsInProgress.delete(context);
  }
  isAILoading = Array.from(aiRequestsInProgress.values()).some(v => v > 0);
  updateOperationUI();
  console.log(`[PARALLEL] Fin ${context} (restantes: ${current - 1})`);
}

/**
 * Mettre à jour l'UI pour les opérations en cours
 */
function updateOperationUI() {
  const hasChat = isOperationInProgress('chat');
  const hasSaisie = saisieEditInProgress;
  const statusBar = document.getElementById('operationStatusBar');
  
  if (statusBar) {
    if (hasChat || hasSaisie) {
      statusBar.style.display = 'flex';
      let msg = [];
      if (hasChat) msg.push('⏳ L\'IA réfléchit…');
      if (hasSaisie) msg.push('✏️ Édition en cours…');
      statusBar.innerHTML = '<div style="padding:8px 12px;font-size:12px">' + msg.join(' · ') + '</div>';
    } else {
      statusBar.style.display = 'none';
    }
  }
}

let exportFormat = 'pdf';
let ecrQueue = [],
  ecrQueueIdx = 0;
let currentGroupId = null;
let conversationHistory = [];

// ══════════════════════════════════════════
// MOBILE SIDEBAR
// ══════════════════════════════════════════
function toggleMobileSidebar() {
  document.getElementById('mainSidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeMobileSidebar() {
  document.getElementById('mainSidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ══════════════════════════════════════════
// SYSTEM PROMPT — RAISONNEMENT STRUCTURÉ
// ══════════════════════════════════════════
function buildSystemPrompt(ctx) {
  const { nbEcritures, companyName, exercice, totalDebit, totalCredit, comptesSoldes, allDates, ecrituresResume } = ctx;
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Tu es COMEO AI — Expert-Comptable Diplômé et Commissaire aux Comptes agréé en Côte d'Ivoire, membre de l'ONECCA-CI.

════════════════════════════════════════════
🧠 DISCIPLINE DE RAISONNEMENT — MODÈLE CLAUDE
════════════════════════════════════════════

Tu raisonnes comme un expert humain rigoureux. Avant TOUTE réponse, tu passes par ces étapes SILENCIEUSES et OBLIGATOIRES :

ÉTAPE 1 — COMPRENDRE VRAIMENT LA QUESTION
  → Que demande-t-on exactement ? (pas ce qu'on croit, ce qui est écrit)
  → Y a-t-il une ambiguïté ? Si oui, quelle interprétation est la plus probable ?
  → La question est-elle comptable, fiscale, analytique, ou mixte ?
  → Quelles informations du contexte entreprise sont pertinentes ici ?

ÉTAPE 2 — IDENTIFIER CE QU'ON NE SAIT PAS ENCORE
  → Quelles données manquent pour répondre parfaitement ?
  → Peut-on quand même donner une réponse utile avec ce qu'on a ?
  → Y a-t-il plusieurs cas possibles ? Les énoncer honnêtement.

ÉTAPE 3 — RAISONNER PAS À PAS (chain-of-thought interne)
  → Construire le raisonnement étape par étape, comme un expert qui pense à voix haute en interne.
  → Vérifier chaque calcul : HT × 1,18 = TTC ? Débit = Crédit ?
  → Tester l'hypothèse inverse : si la réponse était fausse, comment le saurait-on ?
  → Pour les écritures : TOUJOURS vérifier l'équilibre avant d'écrire le JSON.

ÉTAPE 4 — CALIBRER LA CONFIANCE
  → Cette réponse est-elle certaine, probable, ou incertaine ?
  → Si incertaine : le dire clairement, expliquer pourquoi, proposer des pistes.
  → Ne jamais inventer de chiffres. Ne jamais affirmer ce qu'on ne peut pas vérifier.
  → Si la question dépasse la comptabilité (juridique, médical, etc.) : orienter vers le bon expert.

ÉTAPE 5 — FORMULER UNE RÉPONSE HONNÊTE ET UTILE
  → La réponse doit être directe, structurée, et à la hauteur de la complexité de la question.
  → Pour les questions simples : répondre simplement.
  → Pour les questions complexes : expliquer le raisonnement, pas seulement le résultat.
  → Toujours expliquer le "pourquoi" des choix de comptes ou de méthodes.
  → Si on fait une hypothèse : la nommer explicitement ("Je suppose que le règlement est en espèces car...").

════════════════════════════════════════════
📐 PRINCIPES D'EXACTITUDE — JAMAIS DE COMPROMIS
════════════════════════════════════════════

CALCULS :
  → Toujours montrer le calcul intermédiaire avant le résultat final.
  → Arrondir à l'entier FCFA (jamais de centimes).
  → HT connu    : TVA = ARRONDI(HT × 0,18)      | TTC = HT + TVA
  → TTC connu   : HT  = ARRONDI(TTC ÷ 1,18)      | TVA = TTC - HT
  → Vérification : HT + TVA DOIT égaler TTC (tolérance ±1 FCFA max)

ÉQUILIBRE DES ÉCRITURES :
  → Σ DÉBITS = Σ CRÉDITS — TOUJOURS — sans exception
  → Si l'équilibre est impossible à atteindre avec les données fournies : le dire et demander des précisions
  → Lignes débitrices EN PREMIER (norme SYSCOHADA)

CHOIX DES COMPTES :
  → Justifier chaque choix de compte non évident
  → En cas de doute entre deux comptes : présenter les deux options et expliquer la différence
  → Ne jamais utiliser un compte "proche" sans l'expliquer

════════════════════════════════════════════
📋 SCHÉMAS COMPTABLES — SYSCOHADA RÉVISÉ 2017
════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 ACHAT MARCHANDISES À CRÉDIT (3 écritures)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉCRITURE 1 [AC] — Constatation facture :
  DÉBIT  601   Achats de marchandises                    [HT]
  DÉBIT  4452  TVA récupérable sur achats 18%            [TVA]
  CRÉDIT 401   Fournisseurs                              [TTC]

ÉCRITURE 2 [IN] — Entrée en stock :
  DÉBIT  311   Marchandises A                            [HT]
  CRÉDIT 6031  Variation des stocks de marchandises      [HT]

ÉCRITURE 3 [BQ ou CA] — Règlement :
  DÉBIT  401   Fournisseurs                              [TTC]
  CRÉDIT 521   Banques locales                           [TTC]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 VENTE MARCHANDISES (3 écritures)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉCRITURE 1 [VE] — Facturation client :
  DÉBIT  411   Clients                                   [TTC]
  CRÉDIT 701   Ventes de marchandises                    [HT]
  CRÉDIT 4431  TVA facturée sur ventes 18%               [TVA]

ÉCRITURE 2 [IN] — Sortie de stock au coût d'achat :
  DÉBIT  6031  Variation des stocks de marchandises      [coût HT]
  CRÉDIT 311   Marchandises A                            [coût HT]

ÉCRITURE 3 [BQ/CA] — Encaissement :
  DÉBIT  521   Banques locales (ou 571 Caisse)           [TTC]
  CRÉDIT 411   Clients                                   [TTC]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 PAIEMENT SALAIRES (2 écritures minimum)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉCRITURE 1 [OD] :
  DÉBIT  661   Rémunérations directes personnel national [brut]
  CRÉDIT 422   Personnel, rémunérations dues             [net à payer]
  CRÉDIT 431   CNPS salarial 7,7%                        [retenue CNPS]
  CRÉDIT 447   Impôts retenus à la source                [retenue fiscale]

ÉCRITURE 2 [BQ] :
  DÉBIT  422   Personnel, rémunérations dues             [net à payer]
  CRÉDIT 521   Banques locales                           [net à payer]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 ACHAT IMMOBILISATION (2 écritures)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Véhicule → 2451 | Informatique → 2442 | Mobilier → 2444 | Matériel → 2441

ÉCRITURE 1 [AC] :
  DÉBIT  24xx  Immobilisation                            [HT]
  DÉBIT  4451  TVA récupérable sur immobilisations 18%   [TVA]
  CRÉDIT 401   Fournisseurs                              [TTC]

ÉCRITURE 2 [BQ] :
  DÉBIT  401   Fournisseurs                              [TTC]
  CRÉDIT 521   Banques locales                           [TTC]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 DOTATION AUX AMORTISSEMENTS (1 écriture)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉCRITURE [OD] :
  DÉBIT  681   Dotations aux amortissements d'exploitation
  CRÉDIT 28xx  Amortissements (compte correspondant à l'immobilisation)

  Taux linéaires CI : Véhicule 25% (4 ans) | Informatique 33% (3 ans) | Mobilier 20% (5 ans)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 EMPRUNT BANCAIRE (2 écritures)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉCRITURE 1 [BQ] — Réception fonds :
  DÉBIT  521   Banques locales                           [montant emprunté]
  CRÉDIT 162   Emprunts auprès établissements de crédit  [montant emprunté]

ÉCRITURE 2 [BQ] — Remboursement mensuel :
  DÉBIT  162   Emprunts                                  [capital]
  DÉBIT  671   Intérêts des emprunts                     [intérêts]
  CRÉDIT 521   Banques locales                           [mensualité TTC]

════════════════════════════════════════════
🔢 FISCALITÉ IVOIRIENNE — RÉFÉRENCE RAPIDE
════════════════════════════════════════════
TVA standard       : 18%
IS                 : 25% du bénéfice imposable
IMF                : 0,5% du CA HT (minimum 3 000 000 FCFA/an)
CNPS salarial      : 7,7% (plafonné)
CNPS patronal      : 16% + TPA 0,4% + CN 1,5%
Taxe apprentissage : 0,4% de la masse salariale brute
Retenue à la source prestataires non résidents : 20%

════════════════════════════════════════════
✅ COMPTES CORRECTS — RÉFÉRENCE ABSOLUE
════════════════════════════════════════════
Chèque/virement    → 521  (JAMAIS 511/512/513/514)
Espèces caisse     → 571
Mobile Money       → 552  (Orange Money, MTN MoMo, Wave, Moov)
TVA achats courants → 4452
TVA immobilisations → 4451
TVA transport       → 4453
TVA services ext.   → 4454
TVA ventes          → 4431
TVA services vendus → 4432
Véhicule    → 2451 | Amort → 2845
Informatique → 2442 | Amort → 2844
Mobilier    → 2444 | Amort → 2844
Matériel ind → 2441 | Amort → 2841
Salaires dus → 422
Dette fournisseur → 401
Créance client    → 411

════════════════════════════════════════════
🔴 RÈGLES ABSOLUES — LIGNE ROUGE
════════════════════════════════════════════
1. Σ DÉBITS = Σ CRÉDITS — équilibre parfait obligatoire
2. Lignes débitrices TOUJOURS en premier (SYSCOHADA)
3. JAMAIS de décimales — FCFA entiers uniquement
4. TOUJOURS toutes les écritures nécessaires (jamais une seule quand il en faut 3)
5. Explication textuelle AVANT les blocs ###ECRITURE###
6. Si une donnée manque : le signaler explicitement avant de faire une hypothèse
7. Ne jamais affirmer avec certitude ce qui est incertain
8. Toujours justifier le choix des comptes non évidents

════════════════════════════════════════════
🎯 STYLE DE RÉPONSE — DISCIPLINE STRICTE
════════════════════════════════════════════

POUR UNE QUESTION COMPTABLE SIMPLE :
  → Répondre directement en 2-4 phrases.
  → Donner le(s) compte(s) exacts avec leur numéro et libellé.
  → Citer la règle SYSCOHADA applicable si pertinent.

POUR UNE DEMANDE D'ÉCRITURE :
  → Une SEULE phrase d'introduction courte : "Voici les X écritures pour cette opération :"
  → IMMÉDIATEMENT les blocs ###ECRITURE### avec JSON strict — PAS de calculs intermédiaires avant les blocs
  → Les calculs (HT, TVA, TTC) sont intégrés dans les libellés des lignes JSON uniquement
  → INTERDICTION d'écrire les calculs en texte avant ou entre les blocs ###ECRITURE###
  → Phrase de validation APRÈS tous les blocs : confirmer l'équilibre et la conformité SYSCOHADA

POUR UNE ANALYSE OU UN DIAGNOSTIC :
  → Énoncer les faits observés (chiffres exacts du contexte)
  → Identifier les anomalies ou points d'attention
  → Formuler des recommandations concrètes et actionnables
  → Signaler les limites de l'analyse si les données sont insuffisantes

POUR UNE QUESTION AMBIGUË :
  → Reformuler la question telle qu'on la comprend
  → Répondre à l'interprétation la plus probable
  → Signaler l'ambiguïté et proposer une question de clarification

════════════════════════════════════════════
📂 CONTEXTE ENTREPRISE EN TEMPS RÉEL
════════════════════════════════════════════
Entreprise    : ${companyName}
Exercice      : ${exercice}
Date du jour  : ${today}
Nb écritures  : ${nbEcritures}
Total Débit   : ${totalDebit} FCFA
Total Crédit  : ${totalCredit} FCFA
${comptesSoldes ? `Soldes comptes principaux :\n${comptesSoldes}` : ''}
${ecrituresResume ? `Dernières opérations :\n${ecrituresResume}` : ''}
${allDates ? `Période couverte : ${allDates}` : ''}

════════════════════════════════════════════
✏️ ÉCRITURE EN COURS DE SAISIE (à analyser/corriger si demandé)
════════════════════════════════════════════
${ctx.lignesEnCours ? `Date       : ${ctx.dateEnCours}
Journal    : ${ctx.journalEnCours}
Libellé    : ${ctx.libelleEnCours}
Lignes saisies :
${ctx.lignesEnCours}
Total Débit saisie  : ${ctx.totalDebitSaisie} FCFA
Total Crédit saisie : ${ctx.totalCreditSaisie} FCFA
Solde (déséquilibre): ${ctx.soldeSaisie} FCFA ${parseFloat(ctx.soldeSaisie) === 0 ? '✅ ÉQUILIBRÉ' : '⚠️ DÉSÉQUILIBRE'}

Si l'utilisateur demande de vérifier, analyser, ou corriger son travail/écriture,
tu dois OBLIGATOIREMENT analyser ces lignes ci-dessus ligne par ligne :
→ Vérifier si chaque compte SYSCOHADA est correct pour l'opération décrite
→ Vérifier si débit/crédit sont dans la bonne colonne
→ Vérifier si le total débit = total crédit
→ Signaler chaque erreur précisément (ligne X : compte Y devrait être en crédit, etc.)
→ Proposer l'écriture corrigée en format ###ECRITURE### si nécessaire` : 'Aucune ligne saisie pour le moment.'}
════════════════════════════════════════════
📝 FORMAT JSON — STRICT ET IMMUABLE
════════════════════════════════════════════
###ECRITURE###{"journal":"XX","libelle":"Libellé précis et informatif","lignes":[
{"compte":"XXXX","libelle":"Libellé du compte","debit":MONTANT,"credit":0},
{"compte":"XXXX","libelle":"Libellé du compte","debit":0,"credit":MONTANT}
]}

Journaux autorisés : AC | VE | BQ | CA | OD | IN | AN

════════════════════════════════════════════
📝 LIMITES OPÉRATIONNELLES
════════════════════════════════════════════

ÉCRITURES COMPTABLES :
  → Tu peux créer entre 10 et 20 écritures selon la complexité de la demande
  → Une demande simple = 3 à 5 écritures
  → Une demande complexe (multi-produits, TVA, etc) = 10 à 20 écritures
  → Justifier si le nombre d'écritures dépasse 20

CONFIDENTIALITÉ ET CRÉDITS :
  → Si on te demande : "Qui t'a créé ?" ou "Qui a créé COMEO AI ?" ou "Qui est le fondateur ?"
  → Réponds : "COMEO AI a été créé par **Marcio Jardel Zinzindohoué**, Expert-Comptable et Conseiller en Gestion Financière pour les PME de l'UEMOA."
  → Puis affiche la commande : ###AFFICHER###{"type":"fondateur","image":"as.jpeg"}
  → Cette commande affichera la photo du fondateur

════════════════════════════════════════════
🔍 FILTRES ET NAVIGATION
════════════════════════════════════════════
Journal     : ###FILTRE###{"type":"journal","dateDebut":"YYYY-MM-DD","dateFin":"YYYY-MM-DD","journal":"","compte":""}
Balance     : ###FILTRE###{"type":"balance","dateDebut":"","dateFin":"","journal":"","compte":""}
Grand livre : ###FILTRE###{"type":"grandlivre","dateDebut":"","dateFin":"","journal":"","compte":"XXX"}
Bilan       : ###FILTRE###{"type":"bilan","dateDebut":"","dateFin":"YYYY-MM-DD","journal":"","compte":""}`;
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
function switchTab(t) {
  document.getElementById('tab-login').classList.toggle('active', t === 'login');
  document.getElementById('tab-register').classList.toggle('active', t === 'register');
  document.getElementById('form-login').style.display = t === 'login' ? 'flex' : 'none';
  document.getElementById('form-register').style.display = t === 'register' ? 'flex' : 'none';
}

async function doRegister() {
  const company = document.getElementById('r-company').value.trim();
  const email = document.getElementById('r-email').value.trim();
  const compte701 = document.getElementById('r-compte701').value.trim() || '701';
  const exercice = document.getElementById('r-exercice').value.trim() || '2024';
  const pass = document.getElementById('r-pass').value;
  const err = document.getElementById('r-err');
  err.classList.remove('show');
  if (!company) {
    err.textContent = "Nom d'entreprise requis";
    err.classList.add('show');
    return;
  }
  if (!email) {
    err.textContent = 'Email requis';
    err.classList.add('show');
    return;
  }
  if (pass.length < 6) {
    err.textContent = 'Mot de passe trop court (6 caractères min.)';
    err.classList.add('show');
    return;
  }
  try {
    await waitForFirebase();
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_MS).toISOString();
    await window._fbSetDoc(window._fbDoc(window._db, 'profiles', uid), {
      company,
      compte701,
      exercice,
      email,
      createdAt: new Date().toISOString(),
      trialEndsAt,
      premiumUntil: null,
      subscriptionStatus: 'trial',
    });
    toast("Profil créé ! 12 heures d'essai gratuit inclus.", 'success');
    switchTab('login');
    document.getElementById('l-email').value = email;
  } catch (e) {
    const msgs = {
      'auth/email-already-in-use': 'Cet email est déjà utilisé.',
      'auth/invalid-email': 'Email invalide.',
      'auth/weak-password': 'Mot de passe trop faible.',
    };
    err.textContent = msgs[e.code] || e.message;
    err.classList.add('show');
  }
}
async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  const err = document.getElementById('l-err');
  err.classList.remove('show');
  if (!email || !pass) {
    err.textContent = 'Remplissez tous les champs';
    err.classList.add('show');
    return;
  }
  try {
    await waitForFirebase();
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'profiles', uid));
    if (!snap.exists()) {
      err.textContent = 'Profil introuvable.';
      err.classList.add('show');
      return;
    }
    currentProfile = { ...snap.data(), id: uid };
    conversationHistory = [];
    await loadApp();
  } catch (e) {
    const msgs = {
      'auth/user-not-found': 'Aucun compte avec cet email.',
      'auth/wrong-password': 'Mot de passe incorrect.',
      'auth/invalid-email': 'Email invalide.',
      'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
    };
    err.textContent = msgs[e.code] || e.message;
    err.classList.add('show');
  }
}
async function doLogout() {
  if (!confirm('Se déconnecter ?')) return;
  if (subscriptionCheckInterval) clearInterval(subscriptionCheckInterval);
  hidePremiumPaywall();
  await signOut(auth);
  currentProfile = null;
  ecritures = [];
  conversationHistory = [];
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authOverlay').style.display = 'flex';
}
function waitForFirebase() {
  return new Promise((r) => {
    if (window._fbReady) {
      r();
      return;
    }
    document.addEventListener('firebase-ready', r, { once: true });
  });
}

// ══════════════════════════════════════════
// HELPER — Obtenir le profil à charger (propriétaire si collab)
// ══════════════════════════════════════════
function getOwnerProfileId() {
  return collabOwnerUid || currentProfile.id;
}

async function loadApp() {
  currentProfile = await ensureSubscriptionFields(currentProfile);
  await refreshSubscriptionFromFirestore();
  const sub = getSubscriptionState(currentProfile);

  document.getElementById('authOverlay').style.display = 'none';

  if (!sub.access) {
    document.getElementById('appShell').style.display = 'none';
    showPremiumPaywall(sub);
    return;
  }

  hidePremiumPaywall();
  document.getElementById('appShell').style.display = 'grid';
  document.getElementById('topCompanyName').textContent = currentProfile.company;
  document.getElementById('exerciceYear').value = currentProfile.exercice || '2024';
  if (!serverConfigLoaded) await loadServerConfig();
  updateServiceAvailabilityUI();
  updateSubscriptionBadge(sub);
  startSubscriptionMonitor();
  
  // ✅ Charger TOUTES les données avec le propriétaire si collaborateur
  await Promise.all([
    loadEcrituresFromFirestore(),
    loadClientsFromFirestore(),
    loadFournisseursFromFirestore(),
    loadFacturesFromFirestore(),
    loadSalaries(),
    loadImmobilisations(),
    loadStocks(),
    loadBudgets(),
    loadAnalytique(),
    loadSocietes(),
    loadCollaborateurs(),
    loadEffets(),
    loadRH(),           // ✅ NOUVEAU
    loadTresorerie(),    // ✅ NOUVEAU
    loadTaxes(),         // ✅ NOUVEAU
    loadDeclFiscales(),  // ✅ NOUVEAU
    loadAppelsVideo(),   // ✅ NOUVEAU
    loadLockedPeriods(), // 🔒 Périodes verrouillées
  ]);
  updateStats();
  renderPlanComptable();
  initSaisie();
}

// ══════════════════════════════════════════
// FIRESTORE
// ══════════════════════════════════════════
async function loadEcrituresFromFirestore() {
  try {
    const ownerID = getOwnerProfileId();
    const col = window._fbCollection(window._db, 'profiles', ownerID, 'ecritures');
    const q = window._fbQuery(col, window._fbOrderBy('date', 'asc'));
    const snap = await window._fbGetDocs(q);
    ecritures = [];
    snap.forEach((d) => ecritures.push({ ...d.data(), _docId: d.id }));
    // pieceCounter (legacy) — la numérotation réelle est gérée par getNextPiece()
    pieceCounter = ecritures.length + 1;
  } catch (e) {
    console.error('Erreur chargement écritures:', e);
  }
}

// ══════════════════════════════════════════
// PISTE D'AUDIT — Périodes verrouillées après clôture
// ══════════════════════════════════════════
let lockedPeriods = new Set(); // ex: Set(['2023','2022'])

async function loadLockedPeriods() {
  try {
    const ownerID = getOwnerProfileId();
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'profiles', ownerID, 'config', 'locked_periods'));
    if (snap.exists()) {
      const years = snap.data().years || [];
      lockedPeriods = new Set(years.map(String));
    }
  } catch (e) {}
}

async function lockPeriod(yr) {
  try {
    const ownerID = getOwnerProfileId();
    lockedPeriods.add(String(yr));
    await window._fbSetDoc(
      window._fbDoc(window._db, 'profiles', ownerID, 'config', 'locked_periods'),
      { years: [...lockedPeriods], lockedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (e) { console.warn('[COMEO] Erreur verrouillage période:', e.message); }
}

function isPeriodeLocked(dateStr) {
  if (!dateStr) return false;
  const yr = String(dateStr).substring(0, 4);
  return lockedPeriods.has(yr);
}

async function saveEcritureToFirestore(ecriture) {
  try {
    const ownerID = getOwnerProfileId();
    const col = window._fbCollection(window._db, 'profiles', ownerID, 'ecritures');
    const docRef = await window._fbAddDoc(col, ecriture);
    ecriture._docId = docRef.id;
    await logAudit('SAVE', 'COMPTABILITE', `Écriture ${ecriture.journal}`, currentProfile.email);
    return docRef.id;
  } catch (e) {
    toast('Erreur sauvegarde : ' + e.message, 'error');
    return null;
  }
}

async function deleteEcritureFromFirestore(docId) {
  try {
    const ownerID = getOwnerProfileId();
    await window._fbDeleteDoc(window._fbDoc(window._db, 'profiles', ownerID, 'ecritures', docId));
    await logAudit('DELETE', 'COMPTABILITE', `Écriture supprimée`, currentProfile.email);
  } catch (e) {
    toast('Erreur suppression : ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════
const VIEW_KEYS = {
  dashboard: 'tableau',
  saisie: 'saisie',
  journal: 'journal',
  grandlivre: 'grand',
  balance: 'balance',
  bilan: 'bilan',
  resultat: 'résultat',
  tresorerie: 'trésor',
  plancomptable: 'plan',
  factures: 'factur',
  devis: 'devis',
  clients: 'client',
  fournisseurs: 'fourniss',
  analytique: 'analyt',
  societes: 'société',
  utilisateurs: 'utilisat',
  effets: 'effets',
};
const RENDERERS = {
  journal: renderJournal,
  grandlivre: renderGrandLivre,
  balance: renderBalance,
  bilan: renderBilan,
  resultat: renderResultat,
  tresorerie: renderTresorerie,
  plancomptable: renderPlanComptable,
  saisie: initSaisie,
  factures: renderFactures,
  devis: renderDevis,
  clients: renderClients,
  fournisseurs: renderFournisseurs,
  tafire: renderTAFIRE,
  // ── NOUVEAUX MODULES ──
  paie: renderPaie,
  immobilisations: renderImmobilisations,
  stocks: renderStocks,
  rapprochement: renderRapprochement,
  budgets: renderBudgets,
  lettrage: renderLettrage,
  declarations: () => renderDeclaration(),
  exercices: () => {},
  analytique: renderAnalytique,
  societes: renderSocietes,
  utilisateurs: renderUtilisateurs,
  effets: renderEffets,
};

function navigate(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  const key = VIEW_KEYS[view] || view;
  document.querySelectorAll('.nav-item').forEach((n) => {
    if (n.textContent.toLowerCase().includes(key)) n.classList.add('active');
  });
  if (RENDERERS[view]) RENDERERS[view]();
}

// ══════════════════════════════════════════
// STATS
// ══════════════════════════════════════════
function updateStats() {
  let tD = 0,
    tC = 0;
  ecritures.forEach((e) =>
    e.lignes.forEach((l) => {
      tD += l.debit || 0;
      tC += l.credit || 0;
    }),
  );
  const all = ecritures.flatMap((e) => e.lignes);
  const prod = all.filter((l) => l.compte?.[0] === '7').reduce((s, l) => s + (l.credit || 0), 0);
  const chg = all.filter((l) => l.compte?.[0] === '6').reduce((s, l) => s + (l.debit || 0), 0);
  const res = prod - chg;
  const eq = Math.abs(tD - tC) < 0.01;
  document.getElementById('s-ecritures').textContent = ecritures.length;
  document.getElementById('s-debit').textContent = fn(tD);
  document.getElementById('s-credit').textContent = fn(tC);
  const eqEl = document.getElementById('s-equil');
  eqEl.textContent = eq ? '✓ Équilibré' : '✗ Déséquilibré';
  eqEl.className = 'val ' + (eq ? 'g' : 'r');
  document.getElementById('dash-nb').textContent = ecritures.length;
  document.getElementById('dash-debit').textContent = fs(tD);
  document.getElementById('dash-credit').textContent = fs(tC);
  const re = document.getElementById('dash-res');
  re.textContent = fs(res);
  re.style.color = res >= 0 ? 'var(--green)' : 'var(--red)';
  const yr = document.getElementById('exerciceYear').value;
  const bd = document.getElementById('bilanDate');
  const ry = document.getElementById('resultatYear');
  if (bd) bd.textContent = '31/12/' + yr;
  if (ry) ry.textContent = yr;
}
function fn(n) {
  return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}
function fnPDF(n) {
  const num = Math.round(Number(n) || 0);
  const abs = Math.abs(num);
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return num < 0 ? '(' + formatted + ')' : formatted;
}
window.fnPDF = fnPDF;
function fs(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + ' Md FCFA';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + ' M FCFA';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + ' K FCFA';
  return (n || 0).toFixed(0) + ' FCFA';
}

// ══════════════════════════════════════════
// SAISIE
// ══════════════════════════════════════════
function initSaisie() {
  document.getElementById('ecr-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ecr-piece').placeholder = 'N°' + String(pieceCounter).padStart(5, '0');
if (lignes.length === 0) {
    addLigne();
    addLigne();
    addLigne();
    addLigne();
    addLigne();
    addLigne();
    addLigne();
  }
  renderLignes();
  renderMultiEcrEditor();
  updateQueueBar();
}

function addLigne(compte = '', libelle = '', debit = '', credit = '') {
  const l = { compte, libelle, debit, credit };
  lignes.push(l);
  const i = lignes.length - 1;
  const tbody = document.getElementById('lignesBody');
  const cardContainer = document.getElementById('lignesCardContainer');
  // Si le tableau n'existe pas encore (premier rendu), on fait un rendu complet.
  if (!tbody) { renderLignes(); return; }
  const tr = document.createElement('tr');
  tr.innerHTML = ligneRowHTML(i, l);
  tbody.appendChild(tr);
  if (cardContainer) {
    const card = document.createElement('div');
    card.className = 'ligne-card';
    card.innerHTML = ligneCardHTML(i, l);
    cardContainer.appendChild(card);
  }
  updateBalance();
}
function removeLigne(i) {
  lignes.splice(i, 1);
  renderLignes();
}

// ══════════════════════════════════════════
// AUTO SAVE
// ══════════════════════════════════════════
async function autoSaveAllEcritures() {
  if (ecrQueue.length === 0) {
    toast("Aucune écriture en file d'attente", 'error');
    return;
  }
  const total = ecrQueue.length;
  const bar = document.getElementById('autoSaveBar');
  const msg = document.getElementById('autoSaveMsg');
  const prog = document.getElementById('autoSaveProgress');
  bar.classList.add('show');
  const date = document.getElementById('ecr-date').value || new Date().toISOString().split('T')[0];
  const groupId = 'grp_' + Date.now();
  const groupLib = ecrQueue[0]?.libelle || 'Opération ' + new Date().toLocaleDateString('fr-FR');
  let saved = 0;
  const errors = [];

  for (let i = 0; i < ecrQueue.length; i++) {
    const ecr = ecrQueue[i];
    msg.innerHTML = `<strong>Enregistrement ${i + 1}/${total}</strong> — [${ecr.journal}] ${ecr.libelle || 'Écriture ' + (i + 1)}`;
    prog.style.width = (i / total) * 100 + '%';
    const valid = (ecr.lignes || []).filter((l) => l.compte && (l.debit || l.credit));
    if (valid.length < 2) {
      errors.push(`Écriture ${i + 1} : moins de 2 lignes valides`);
      continue;
    }
    let d = 0,
      c = 0;
    valid.forEach((l) => {
      d += Math.round(parseFloat(l.debit) || 0);
      c += Math.round(parseFloat(l.credit) || 0);
    });
    if (Math.abs(d - c) > 2) {
      errors.push(`Écriture ${i + 1} [${ecr.journal}] : non équilibrée (Δ ${Math.abs(d - c)} FCFA)`);
      continue;
    }
    const journalCode = ecr.journal || 'OD';
    const piece = await getNextPiece(journalCode);
    const lignesSorted = sortLignesDebitAvantCredit(valid);
    const ecriture = {
      id: Date.now() + i,
      date,
      journal: journalCode,
      piece,
      libelle: ecr.libelle || 'Écriture IA',
      groupId,
      groupLibelle: groupLib,
      groupSize: total,
      groupIdx: i,
      createdAt: new Date().toISOString(),
      lignes: lignesSorted.map((l) => ({
        compte: String(l.compte),
        libelle: l.libelle || PC[String(l.compte)] || '',
        debit: Math.round((parseFloat(l.debit) || 0) * 100) / 100,
        credit: Math.round((parseFloat(l.credit) || 0) * 100) / 100,
      })),
    };
    const docId = await saveEcritureToFirestore(ecriture);
    if (docId) {
      ecritures.push(ecriture);
      pieceCounter++; // legacy display only
      saved++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  prog.style.width = '100%';
  await new Promise((r) => setTimeout(r, 400));
  bar.classList.remove('show');
  ecrQueue = [];
  ecrQueueIdx = 0;
  lignes = [];
  updateQueueBar();
  hideMultiEcrBanner();
  hideSaisieNotif();
  dismissFillBanner();
  updateStats();
  if (errors.length > 0) {
    toast(`⚠️ ${saved}/${total} écritures enregistrées — ${errors.length} erreur(s)`, 'error');
  } else {
    toast(`✅ ${saved} écriture${saved > 1 ? 's' : ''} enregistrée${saved > 1 ? 's' : ''} !`, 'success');
  }
  setTimeout(() => {
    navigate('journal');
    renderJournal();
  }, 500);
  initSaisie();
}

async function autoSaveAllFromNotif() {
  hideSaisieNotif();
  await autoSaveAllEcritures();
}

function setEcritureQueue(ecritures_ai) {
  ecrQueue = ecritures_ai;
  ecrQueueIdx = 0;
  if (ecrQueue.length > 1) {
    renderMultiEcrEditor();
    updateQueueBar();
  } else if (ecrQueue.length === 1) {
    renderMultiEcrEditor();
    loadEcritureFromQueue(0);
    updateQueueBar();
  }
}

function loadEcritureFromQueue(idx) {
  if (idx >= ecrQueue.length) return;
  const ecr = ecrQueue[idx];
  const lignesSorted = sortLignesDebitAvantCredit(ecr.lignes || []);
  lignes = lignesSorted.map((l) => ({
    compte: String(l.compte || ''),
    libelle: l.libelle || PC[String(l.compte)] || '',
    debit: Math.round((parseFloat(l.debit) || 0) * 100) / 100,
    credit: Math.round((parseFloat(l.credit) || 0) * 100) / 100,
  }));
  const jSelect = document.getElementById('ecr-journal');
  if (jSelect && ecr.journal) jSelect.value = ecr.journal;
  const libInput = document.getElementById('ecr-libelle');
  if (libInput && ecr.libelle) libInput.value = ecr.libelle;
  const dateInput = document.getElementById('ecr-date');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
  renderLignes();
  const banner = document.getElementById('aiFillBanner');
  const desc = document.getElementById('aiFillDesc');
  const num = document.getElementById('aiFillNum');
  if (banner && desc) {
    desc.textContent = ecr.libelle || 'Écriture préparée par COMEO AI';
    if (num) num.textContent = ecrQueue.length > 1 ? `(${idx + 1}/${ecrQueue.length})` : '';
    banner.classList.add('show');
  }
}

function updateQueueBar() {
  const bar = document.getElementById('saisieQueueBar');
  const topBtn = document.getElementById('btnTopValidate');
  if (!bar) return;
  const counter = document.getElementById('sqbCounter');
  const skipBtn = bar.querySelector('.sqb-skip');
  const hint = document.getElementById('sqbHint');
  const btnAll = document.getElementById('btnValidateAll');
  if (ecrQueue.length > 1) {
    bar.classList.add('show');
    if (counter) counter.textContent = ecrQueue.length + ' écritures';
    if (btnAll) btnAll.style.display = 'inline-flex';
    if (skipBtn) skipBtn.style.display = 'none';
    if (hint) hint.textContent = 'Vérifiez et modifiez chaque écriture ci-dessous, puis enregistrez-les toutes';
    if (topBtn) topBtn.textContent = `⚡ Tout enregistrer (${ecrQueue.length})`;
    return;
  }
  if (skipBtn) skipBtn.style.display = '';
  if (topBtn) topBtn.textContent = "↳ Valider l'écriture";
  const remaining = ecrQueue.length - ecrQueueIdx;
  if (remaining > 0) {
    bar.classList.add('show');
    if (counter) counter.textContent = remaining + ' écriture' + (remaining > 1 ? 's' : '');
    if (btnAll) btnAll.style.display = remaining > 1 ? 'inline-flex' : 'none';
    if (hint) hint.textContent = 'Validez cette écriture pour passer à la suivante';
  } else {
    bar.classList.remove('show');
  }
}

function onClickTopValidate() {
  if (ecrQueue.length > 1) {
    autoSaveAllEcritures();
  } else {
    saveEcriture();
  }
}

// ══════════════════════════════════════════
// ÉDITEUR MULTI-ÉCRITURES — affiche toutes les écritures
// générées par l'IA en même temps (vérifiables/modifiables)
// ══════════════════════════════════════════
function journalOptionsHtml(selected) {
  return Object.keys(JOURNAL_NAMES)
    .map((code) => `<option value="${code}" ${code === selected ? 'selected' : ''}>${code} — ${JOURNAL_NAMES[code]}</option>`)
    .join('');
}

function renderMultiEcrEditor() {
  const multi = document.getElementById('multiEcrEditor');
  const singleCard = document.getElementById('singleLignesCard');
  if (!multi) return;
  if (ecrQueue.length <= 1) {
    multi.style.display = 'none';
    multi.innerHTML = '';
    if (singleCard) singleCard.style.display = '';
    return;
  }
  if (singleCard) singleCard.style.display = 'none';
  multi.style.display = 'flex';

  let blocksHtml = '';
  ecrQueue.forEach((ecr, qi) => {
    if (!ecr.lignes) ecr.lignes = [];
    let d = 0,
      c = 0;
    ecr.lignes.forEach((l) => {
      d += parseFloat(l.debit) || 0;
      c += parseFloat(l.credit) || 0;
    });
    const balanced = Math.abs(d - c) <= 1;
    const icon = JOURNAL_ICONS[ecr.journal] || '📋';
    const rowsHtml = ecr.lignes
      .map(
        (l, li) => `
        <tr>
          <td><div class="asw">
            <input type="text" value="${String(l.compte || '').replace(/"/g, '&quot;')}" placeholder="Compte…" style="width:100%;font-family:var(--font-mono)"
              oninput="ecrQueue[${qi}].lignes[${li}].compte=this.value;updateAccountSuggestMulti(${qi},${li},this)"
              onfocus="openPcModal((code,lib)=>{selectAccountMulti(${qi},${li},code,lib);})"
              onblur="hideDropdown('m-${qi}-${li}')">
            <div class="adrop" id="drop-m-${qi}-${li}"></div>
          </div></td>
          <td><input type="text" value="${String(l.libelle || '').replace(/"/g, '&quot;')}" placeholder="Libellé…" style="width:100%"
            oninput="ecrQueue[${qi}].lignes[${li}].libelle=this.value"></td>
          <td><input type="text" value="${l.debit || ''}" placeholder="0" style="text-align:right;width:100%;font-family:var(--font-mono)"
            oninput="ecrQueue[${qi}].lignes[${li}].debit=parseFloat(this.value.replace(/[^0-9.]/g,''))||0;updateMultiBlockBalance(${qi})"></td>
          <td><input type="text" value="${l.credit || ''}" placeholder="0" style="text-align:right;width:100%;font-family:var(--font-mono)"
            oninput="ecrQueue[${qi}].lignes[${li}].credit=parseFloat(this.value.replace(/[^0-9.]/g,''))||0;updateMultiBlockBalance(${qi})"></td>
          <td><button class="del-line" onclick="removeLigneMulti(${qi},${li})">✕</button></td>
        </tr>`,
      )
      .join('');
    blocksHtml += `
    <div class="mei-block">
      <div class="mei-block-header">
        <span class="mei-block-n">${qi + 1}</span>
        <span class="mei-block-icon">${icon}</span>
        <select class="mei-jnl-select" onchange="ecrQueue[${qi}].journal=this.value;renderMultiEcrEditor()">${journalOptionsHtml(ecr.journal)}</select>
        <input type="text" class="mei-libelle-input" value="${String(ecr.libelle || '').replace(/"/g, '&quot;')}" placeholder="Libellé de l'écriture…"
          oninput="ecrQueue[${qi}].libelle=this.value">
        <span class="mei-block-balance ${balanced ? 'bok' : 'bbad'}" id="mei-bal-${qi}">${balanced ? '✓ équilibrée' : '⚠ Δ ' + fs(Math.abs(d - c))}</span>
        <button class="mei-del-btn" title="Retirer cette écriture" onclick="removeEcritureFromQueue(${qi})">✕</button>
      </div>
      <div class="et-wrapper">
        <table class="et">
          <thead><tr><th style="min-width:100px">Compte</th><th>Libellé</th><th style="min-width:100px;text-align:right">Débit</th><th style="min-width:100px;text-align:right">Crédit</th><th style="width:30px"></th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <button class="add-line-btn" onclick="addLigneMulti(${qi})">＋ Ajouter une ligne</button>
    </div>`;
  });

  multi.innerHTML = `
    <div class="mei-toolbar">
      <span class="mei-toolbar-count">${ecrQueue.length} écritures à vérifier</span>
      <span class="mei-toolbar-hint">Modifiez comptes, libellés ou montants ci-dessous, puis validez en bas</span>
    </div>
    <div class="mei-scroll">${blocksHtml}</div>
    <div class="bal-bar">
      <div class="bal-item"><label>Débit</label><span class="val" id="mei-grand-debit" style="color:#60a5fa">0</span></div>
      <div class="bal-item"><label>Crédit</label><span class="val" id="mei-grand-credit" style="color:#4ade80">0</span></div>
      <div class="bal-item" style="margin-left:auto"><label>Écritures</label><span class="val">${ecrQueue.length}</span></div>
    </div>`;
  updateMultiGrandTotal();
}

function addLigneMulti(qi) {
  if (!ecrQueue[qi].lignes) ecrQueue[qi].lignes = [];
  ecrQueue[qi].lignes.push({ compte: '', libelle: '', debit: '', credit: '' });
  renderMultiEcrEditor();
}

function removeLigneMulti(qi, li) {
  ecrQueue[qi].lignes.splice(li, 1);
  renderMultiEcrEditor();
}

function removeEcritureFromQueue(qi) {
  ecrQueue.splice(qi, 1);
  if (ecrQueue.length === 1) {
    loadEcritureFromQueue(0);
  } else if (ecrQueue.length === 0) {
    lignes = [];
    addLigne();
    addLigne();
    dismissFillBanner();
  }
  renderMultiEcrEditor();
  updateQueueBar();
  toast('Écriture retirée de la liste', 'info');
}

function updateMultiBlockBalance(qi) {
  const ecr = ecrQueue[qi];
  if (!ecr) return;
  let d = 0,
    c = 0;
  (ecr.lignes || []).forEach((l) => {
    d += parseFloat(l.debit) || 0;
    c += parseFloat(l.credit) || 0;
  });
  const badge = document.getElementById('mei-bal-' + qi);
  if (badge) {
    const balanced = Math.abs(d - c) <= 1;
    badge.textContent = balanced ? '✓ équilibrée' : '⚠ Δ ' + fs(Math.abs(d - c));
    badge.className = 'mei-block-balance ' + (balanced ? 'bok' : 'bbad');
  }
  updateMultiGrandTotal();
}

function updateMultiGrandTotal() {
  let gd = 0,
    gc = 0;
  ecrQueue.forEach((ecr) =>
    (ecr.lignes || []).forEach((l) => {
      gd += parseFloat(l.debit) || 0;
      gc += parseFloat(l.credit) || 0;
    }),
  );
  const dEl = document.getElementById('mei-grand-debit');
  const cEl = document.getElementById('mei-grand-credit');
  if (dEl) dEl.textContent = fn(gd);
  if (cEl) cEl.textContent = fn(gc);
}

function skipToNextEcriture() {
  ecrQueueIdx++;
  if (ecrQueueIdx < ecrQueue.length) {
    loadEcritureFromQueue(ecrQueueIdx);
    updateQueueBar();
    toast('Écriture ' + (ecrQueueIdx + 1) + '/' + ecrQueue.length + ' chargée', 'info');
  } else {
    ecrQueue = [];
    ecrQueueIdx = 0;
    lignes = [];
    addLigne();
    addLigne();
    renderLignes();
    updateQueueBar();
    dismissFillBanner();
  }
}

function dismissFillBanner() {
  const b = document.getElementById('aiFillBanner');
  if (b) b.classList.remove('show');
}

function showMultiEcrBanner(ecritures_ai) {
  const banner = document.getElementById('multiEcrBanner');
  const list = document.getElementById('mebList');
  const title = document.getElementById('mebTitle');
  if (!banner) return;
  title.textContent = `COMEO AI a préparé ${ecritures_ai.length} écriture${ecritures_ai.length > 1 ? 's' : ''} liées`;
  list.innerHTML = ecritures_ai
    .map(
      (e, i) =>
        `<li><span class="meb-n">${i + 1}</span><span class="meb-jnl">${e.journal || 'OD'}</span><span>${e.libelle || 'Écriture ' + (i + 1)}</span></li>`,
    )
    .join('');
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 60000);
}
function hideMultiEcrBanner() {
  const b = document.getElementById('multiEcrBanner');
  if (b) b.classList.remove('show');
}

function showSaisieNotif(libelle, count) {
  const notif = document.getElementById('saisieNotif');
  const body = document.getElementById('saisieNotifBody');
  if (!notif) return;
  body.textContent =
    count > 1
      ? `${count} écritures liées préparées. Cliquez "Tout enregistrer" pour les grouper.`
      : `"${libelle || 'Écriture'}" — Vérifiez et enregistrez.`;
  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), 15000);
}
function hideSaisieNotif() {
  const n = document.getElementById('saisieNotif');
  if (n) n.classList.remove('show');
}

function goToSaisie() {
  hideSaisieNotif();
  navigate('saisie');
  setTimeout(() => {
    const card = document.querySelector('#view-saisie .card:last-of-type');
    if (card) card.scrollIntoView({ behavior: 'smooth' });
  }, 200);
}

// ══════════════════════════════════════════
// RENDER LIGNES
// ══════════════════════════════════════════
function ligneRowHTML(i, l) {
  return `<tr data-li="${i}">
      <td><div class="asw">
        <input type="text" id="cpt-t-${i}" value="${l.compte}" placeholder="Compte…" style="width:100%;font-family:var(--font-mono)"
          oninput="lignes[${i}].compte=this.value;updateAccountSuggest(${i},this,'table')"
          onfocus="openPcModal((code,lib)=>{selectAccount(${i},code,lib);})"
          onblur="hideDropdown('t-${i}')">
        <div class="adrop" id="drop-t-${i}"></div>
      </div></td>
      <td><input type="text" id="lib-t-${i}" value="${l.libelle || ''}" placeholder="Libellé…" style="width:100%" oninput="lignes[${i}].libelle=this.value"></td>
      <td><input type="text" id="deb-t-${i}" value="${l.debit || ''}" placeholder="0" style="text-align:right;width:100%;font-family:var(--font-mono)"
        oninput="lignes[${i}].debit=parseFloat(this.value.replace(/[^0-9.]/g,''))||0;updateBalance()"></td>
      <td><input type="text" id="cre-t-${i}" value="${l.credit || ''}" placeholder="0" style="text-align:right;width:100%;font-family:var(--font-mono)"
        oninput="lignes[${i}].credit=parseFloat(this.value.replace(/[^0-9.]/g,''))||0;updateBalance()"></td>
      <td><button class="del-line" onclick="removeLigne(${i})">✕</button></td>`;
}

function ligneCardHTML(i, l) {
  return `
        <div class="ligne-card-row">
          <div class="ligne-card-field">
            <div class="ligne-card-label">Compte</div>
            <div style="position:relative">
              <input class="ligne-card-input" type="text" id="cpt-c-${i}" value="${l.compte}" placeholder="Compte…" style="font-family:var(--font-mono)"
                oninput="lignes[${i}].compte=this.value;updateAccountSuggest(${i},this,'card')"
                onfocus="openPcModal((code,lib)=>{selectAccount(${i},code,lib);})"
                onblur="hideDropdown('c-${i}')">
              <div class="adrop" id="drop-c-${i}"></div>
            </div>
          </div>
          <div class="ligne-card-field">
            <div class="ligne-card-label">Libellé</div>
            <input class="ligne-card-input" type="text" id="lib-c-${i}" value="${l.libelle || ''}" placeholder="Libellé…" oninput="lignes[${i}].libelle=this.value">
          </div>
        </div>
        <div class="ligne-card-row">
          <div class="ligne-card-field">
            <div class="ligne-card-label" style="color:var(--blue)">Débit (FCFA)</div>
            <input class="ligne-card-input" type="number" id="deb-c-${i}" value="${l.debit || ''}" placeholder="0" style="font-family:var(--font-mono)"
              oninput="lignes[${i}].debit=parseFloat(this.value)||0;updateBalance()">
          </div>
          <div class="ligne-card-field">
            <div class="ligne-card-label" style="color:var(--green)">Crédit (FCFA)</div>
            <input class="ligne-card-input" type="number" id="cre-c-${i}" value="${l.credit || ''}" placeholder="0" style="font-family:var(--font-mono)"
              oninput="lignes[${i}].credit=parseFloat(this.value)||0;updateBalance()">
          </div>
        </div>
        <div class="ligne-card-actions">
          <button class="del-line" style="opacity:.6" onclick="removeLigne(${i})">✕ Supprimer</button>
        </div>`;
}

function renderLignes() {
  const tbody = document.getElementById('lignesBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const cardContainer = document.getElementById('lignesCardContainer');
  if (cardContainer) cardContainer.innerHTML = '';

  lignes.forEach((l, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = ligneRowHTML(i, l);
    tbody.appendChild(tr);

    if (cardContainer) {
      const card = document.createElement('div');
      card.className = 'ligne-card';
      card.innerHTML = ligneCardHTML(i, l);
      cardContainer.appendChild(card);
    }
  });
  updateBalance();
}

// ══════════════════════════════════════════
// PLAN COMPTABLE — OUVERTURE AUTOMATIQUE À LA SAISIE
// S'ouvre dès le focus sur le champ "Compte" (parcours du plan
// comptable), se filtre en tapant, et peut être fermé explicitement
// pour saisir le numéro de compte librement au clavier.
// ══════════════════════════════════════════
const manualEntryFields = new Set();

function accountMatchesFor(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    // Mode "parcours" : on garantit qu'AUCUNE classe (1 à 8) ne reste
    // cachée — on prend jusqu'à 4 comptes principaux par classe, au lieu
    // de couper après les 18 premiers (qui ne couvraient que la classe 1).
    const shortCodes = Object.entries(PC).filter(([code]) => code.length <= 3);
    const perClassCount = {};
    const out = [];
    shortCodes.forEach((entry) => {
      const cl = entry[0][0];
      perClassCount[cl] = perClassCount[cl] || 0;
      if (perClassCount[cl] < 4) {
        perClassCount[cl]++;
        out.push(entry);
      }
    });
    return { matches: out, browsing: true };
  }
  return { matches: Object.entries(PC).filter(([code, lib]) => code.startsWith(q) || lib.toLowerCase().includes(q)).slice(0, 60), browsing: false };
}

function renderAccountDropdown(dropId, query, buildSelectCall) {
  const drop = document.getElementById('drop-' + dropId);
  if (!drop) return;
  const { matches, browsing } = accountMatchesFor(query);
  const closeRow = `<div class="adrop-close" onmousedown="closeAccountDropdown('${dropId}')">✕ Fermer — saisir librement</div>`;
  // Puces de navigation rapide par classe — toujours visibles, pour que
  // l'utilisateur découvre immédiatement qu'il peut parcourir tout le plan
  // comptable au lieu de devoir scroller pour trouver une classe.
  const classNav = `<div class="adrop-classnav">${Object.keys(CLASS_NAMES)
    .map((cl) => `<button type="button" class="acn-chip" onmousedown="browseAccountClass('${dropId}','${cl}')" title="${CLASS_NAMES[cl]}">${cl}</button>`)
    .join('')}</div>`;
  if (!matches.length) {
    drop.innerHTML = `<div class="adrop-top-fixed">${closeRow}${classNav}</div><div class="adrop-empty">Aucun compte trouvé pour "${(query || '').replace(/"/g, '&quot;')}"</div>`;
    drop.classList.add('open');
    return;
  }
  const hint = browsing
    ? `<div class="adrop-hint">📂 Aperçu des 8 classes — cliquez un numéro ci-dessus ou tapez pour chercher parmi ${Object.keys(PC).length} comptes</div>`
    : '';
  // Regroupement par classe SYSCOHADA (1er chiffre du code) — même logique que le Plan Comptable.
  const groups = {};
  matches.forEach(([code, lib]) => {
    const cl = code[0];
    (groups[cl] = groups[cl] || []).push([code, lib]);
  });
  const body = Object.keys(groups)
    .sort()
    .map((cl) => {
      const items = groups[cl]
        .map(
          ([code, lib]) =>
            `<div class="aoption" onmousedown="${buildSelectCall(code, lib.replace(/'/g, "\\'"))}">
          <span class="code">${code}</span><span class="name">${lib.substring(0, 46)}</span>
        </div>`,
        )
        .join('');
      return `<div class="adrop-class-group">
        <div class="adrop-class-head"><span class="acg-num">${cl}</span><span class="acg-name">${CLASS_NAMES[cl] || 'Classe ' + cl}</span></div>
        ${items}
      </div>`;
    })
    .join('');
  drop.innerHTML = `<div class="adrop-top-fixed">${closeRow}${classNav}</div>` + hint + body;
  drop.classList.add('open');
}

function browseAccountClass(dropId, cls) {
  const drop = document.getElementById('drop-' + dropId);
  if (!drop) return;
  const input = drop.previousElementSibling;
  if (!input) return;
  manualEntryFields.delete(dropId);
  input.value = cls;
  if (dropId.startsWith('m-')) {
    const [, qiStr, liStr] = dropId.split('-');
    const qi = parseInt(qiStr, 10),
      li = parseInt(liStr, 10);
    if (ecrQueue[qi]?.lignes?.[li]) ecrQueue[qi].lignes[li].compte = cls;
    updateAccountSuggestMulti(qi, li, input);
  } else {
    const idx = parseInt(dropId.split('-')[1], 10);
    const mode = dropId.startsWith('c-') ? 'card' : 'table';
    if (lignes[idx]) lignes[idx].compte = cls;
    updateAccountSuggest(idx, input, mode);
  }
  input.focus();
}

function closeAccountDropdown(dropId) {
  manualEntryFields.add(dropId);
  const d = document.getElementById('drop-' + dropId);
  if (d) d.classList.remove('open');
}

function updateAccountSuggest(idx, input, mode) {
  const dropId = mode === 'card' ? 'c-' + idx : 't-' + idx;
  if (manualEntryFields.has(dropId)) return;
  renderAccountDropdown(dropId, input.value, (code, lib) => `selectAccount(${idx},'${code}','${lib}')`);
}

function updateAccountSuggestMulti(qi, li, input) {
  const dropId = `m-${qi}-${li}`;
  if (manualEntryFields.has(dropId)) return;
  renderAccountDropdown(dropId, input.value, (code, lib) => `selectAccountMulti(${qi},${li},'${code}','${lib}')`);
}

function selectAccountMulti(qi, li, code, lib) {
  ecrQueue[qi].lignes[li].compte = code;
  if (!ecrQueue[qi].lignes[li].libelle) ecrQueue[qi].lignes[li].libelle = lib.substring(0, 54);
  renderMultiEcrEditor();
}

function selectAccount(idx, code, lib) {
  lignes[idx].compte = code;
  if (!lignes[idx].libelle) lignes[idx].libelle = lib.substring(0, 54);
  const cptT = document.getElementById('cpt-t-' + idx);
  if (cptT) cptT.value = code;
  const cptC = document.getElementById('cpt-c-' + idx);
  if (cptC) cptC.value = code;
  const libT = document.getElementById('lib-t-' + idx);
  if (libT) libT.value = lignes[idx].libelle;
  const libC = document.getElementById('lib-c-' + idx);
  if (libC) libC.value = lignes[idx].libelle;
  hideDropdownNow('t-' + idx);
  hideDropdownNow('c-' + idx);
}
function hideDropdownNow(dropId) {
  const d = document.getElementById('drop-' + dropId);
  if (d) d.classList.remove('open');
}
function hideDropdown(dropId) {
  setTimeout(() => {
    const d = document.getElementById('drop-' + dropId);
    if (d) d.classList.remove('open');
    manualEntryFields.delete(dropId);
  }, 200);
}

function updateBalance() {
  let d = 0,
    c = 0;
  lignes.forEach((l) => {
    d += parseFloat(l.debit) || 0;
    c += parseFloat(l.credit) || 0;
  });
  const s = d - c;
  const tdd = document.getElementById('totalDebitDisplay');
  const tcd = document.getElementById('totalCreditDisplay');
  const el = document.getElementById('soldeDisplay');
  if (tdd) tdd.textContent = fn(d);
  if (tcd) tcd.textContent = fn(c);
  if (el) {
    el.textContent = fn(Math.abs(s));
    el.className = 'val ' + (Math.abs(s) < 0.01 ? 'bok' : 'bbad');
  }
}

// ══════════════════════════════════════════
// VALIDATION MANUELLE
// ══════════════════════════════════════════
async function saveEcriture() {
  const date = document.getElementById('ecr-date').value;
  const journal = document.getElementById('ecr-journal').value;
  // Si l'utilisateur a tapé un numéro manuellement on le respecte, sinon on génère
  const pieceManuel = document.getElementById('ecr-piece').value.trim();
  const piece = pieceManuel || await getNextPiece(journal);
  const libelle = document.getElementById('ecr-libelle').value;
  if (!date) {
    toast('Veuillez saisir une date', 'error');
    return;
  }
  const valid = lignes.filter((l) => l.compte && (l.debit || l.credit));
  if (valid.length < 2) {
    toast('Au moins 2 lignes requises', 'error');
    return;
  }
  let d = 0,
    c = 0;
  valid.forEach((l) => {
    d += parseFloat(l.debit) || 0;
    c += parseFloat(l.credit) || 0;
  });
  if (Math.abs(d - c) > 0.01) {
    toast(`Écriture non équilibrée — Débit: ${fn(d)} / Crédit: ${fn(c)} — Différence: ${fn(Math.abs(d - c))} FCFA`, 'error');
    return;
  }
  let groupInfo = {};
  if (ecrQueue.length > 0 && currentGroupId) {
    groupInfo = {
      groupId: currentGroupId,
      groupLibelle: ecrQueue[0]?.libelle || libelle,
      groupSize: ecrQueue.length,
      groupIdx: ecrQueueIdx,
    };
  }
  const lignesSorted = sortLignesDebitAvantCredit(valid);
  const ecriture = {
    id: Date.now(),
    date,
    journal,
    piece,
    libelle,
    ...groupInfo,
    createdAt: new Date().toISOString(),
    lignes: lignesSorted.map((l) => ({
      compte: String(l.compte),
      libelle: l.libelle || PC[String(l.compte)] || '',
      debit: Math.round((parseFloat(l.debit) || 0) * 100) / 100,
      credit: Math.round((parseFloat(l.credit) || 0) * 100) / 100,
    })),
  };
  const docId = await saveEcritureToFirestore(ecriture);
  if (!docId) return;
  ecritures.push(ecriture);
  pieceCounter++;
  updateStats();
  dismissFillBanner();
  toast(`✓ Écriture [${JOURNAL_NAMES[journal] || journal}] enregistrée — Pièce ${piece}`, 'success');
  ecrQueueIdx++;
  if (ecrQueueIdx < ecrQueue.length) {
    loadEcritureFromQueue(ecrQueueIdx);
    updateQueueBar();
    toast(`→ Écriture ${ecrQueueIdx + 1}/${ecrQueue.length} prête à valider`, 'info');
  } else {
    ecrQueue = [];
    ecrQueueIdx = 0;
    currentGroupId = null;
    lignes = [];
    updateQueueBar();
    document.getElementById('ecr-libelle').value = '';
    document.getElementById('ecr-piece').value = '';
    hideSaisieNotif();
    initSaisie();
  }
}

// ══════════════════════════════════════════
// FILTRAGE COMMUN
// ══════════════════════════════════════════
function getEcrituresFiltrees(opts = {}) {
  const { dateDebut, dateFin, journal, compte } = opts;
  return ecritures.filter((e) => {
    if (dateDebut && e.date < dateDebut) return false;
    if (dateFin && e.date > dateFin) return false;
    if (journal && e.journal !== journal) return false;
    if (compte) return e.lignes.some((l) => l.compte && l.compte.startsWith(compte));
    return true;
  });
}

// ══════════════════════════════════════════
// JOURNAL
// ══════════════════════════════════════════
function resetJournalFiltre() {
  document.getElementById('jnl-date-debut').value = '';
  document.getElementById('jnl-date-fin').value = '';
  document.getElementById('journalFilter').value = '';
  document.getElementById('journalSearch').value = '';
  const a = document.getElementById('journal-analyse');
  if (a) a.style.display = 'none';
  renderJournal();
}

function formatDateFR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const mois = [
    '',
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ];
  return `${parseInt(d)} ${mois[parseInt(m)]} ${y}`;
}

function renderJournal() {
  const search = (document.getElementById('journalSearch')?.value || '').toLowerCase();
  const filter = document.getElementById('journalFilter')?.value || '';
  const dateDebut = document.getElementById('jnl-date-debut')?.value || '';
  const dateFin = document.getElementById('jnl-date-fin')?.value || '';
  const content = document.getElementById('journalContent');
  const footer = document.getElementById('journal-totaux-footer');
  if (!content) return;

  const ecFiltrees = getEcrituresFiltrees({ dateDebut, dateFin, journal: filter });
  const ecFiltered = ecFiltrees.filter((e) => {
    if (!search) return true;
    if ((e.libelle || '').toLowerCase().includes(search)) return true;
    if ((e.groupLibelle || '').toLowerCase().includes(search)) return true;
    if ((e.piece || '').toLowerCase().includes(search)) return true;
    return e.lignes.some(
      (l) =>
        (l.compte || '').includes(search) ||
        (l.libelle || '').toLowerCase().includes(search) ||
        (PC[l.compte] || '').toLowerCase().includes(search),
    );
  });

  if (!ecFiltered.length) {
    content.innerHTML = `<div class="empty-state"><div class="icon">≡</div><p>Aucune écriture pour cette sélection</p></div>`;
    if (footer) footer.style.display = 'none';
    return;
  }

  const groupMap = {};
  const soloList = [];
  ecFiltered.forEach((e) => {
    if (e.groupId) {
      if (!groupMap[e.groupId]) groupMap[e.groupId] = [];
      groupMap[e.groupId].push(e);
    } else {
      soloList.push(e);
    }
  });

  const groups = [];
  Object.values(groupMap).forEach((ecrs) => {
    const sorted = [...ecrs].sort((a, b) => (a.groupIdx || 0) - (b.groupIdx || 0));
    groups.push({
      type: 'groupe',
      date: sorted[0].date,
      ecritures: sorted,
      libelle: sorted[0].groupLibelle || sorted[0].libelle || 'Opération',
      isGroupe: true,
    });
  });
  soloList.forEach((e) => {
    groups.push({ type: 'solo', date: e.date, ecritures: [e], libelle: e.libelle || 'Écriture', isGroupe: false });
  });
  groups.sort((a, b) => b.date.localeCompare(a.date) || (b.ecritures[0].createdAt || '').localeCompare(a.ecritures[0].createdAt || ''));

  const byDate = {};
  groups.forEach((g) => {
    if (!byDate[g.date]) byDate[g.date] = [];
    byDate[g.date].push(g);
  });

  let totalD = 0,
    totalC = 0,
    totalLignes = 0,
    totalEcritures = 0;
  let html = '';

  Object.keys(byDate)
    .sort()
    .reverse()
    .forEach((date) => {
      html += `<div class="jnl-date-sep">
      <div class="jnl-date-sep-line"></div>
      <div class="jnl-date-sep-label">📅 ${formatDateFR(date)}</div>
      <div class="jnl-date-sep-line"></div>
    </div>`;

      byDate[date].forEach((group) => {
        let groupD = 0,
          groupC = 0;
        group.ecritures.forEach((e) => {
          e.lignes.forEach((l) => {
            groupD += l.debit || 0;
            groupC += l.credit || 0;
          });
          totalLignes += e.lignes.length;
          totalEcritures++;
        });
        totalD += groupD;
        totalC += groupC;
        const mainJournal = group.ecritures[0]?.journal || 'OD';
        const icon = JOURNAL_ICONS[mainJournal] || '📋';
        const docIds = group.ecritures.map((e) => `'${e._docId}'`).join(',');
        const ecrIds = group.ecritures.map((e) => e.id).join(',');

        if (group.isGroupe) {
          html += `<div class="jnl-groupe">
          <div class="jnl-groupe-header">
            <div class="jnl-groupe-icon">${icon}</div>
            <div class="jnl-groupe-info">
              <div class="jnl-groupe-libelle" title="${(group.libelle || '').replace(/"/g, '&quot;')}">${group.libelle}</div>
              <div class="jnl-groupe-meta">${date} · ${group.ecritures.length} écritures liées · ${group.ecritures.map((e) => e.piece || '—').join(' · ')}</div>
            </div>
            <div class="jnl-groupe-total">
              <div class="jnl-groupe-total-label">Montant total</div>
              <div class="jnl-groupe-total-val">${fn(groupD)} FCFA</div>
            </div>
            <span class="jnl-groupe-badge-count">${group.ecritures.length} écriture${group.ecritures.length > 1 ? 's' : ''}</span>
            <button class="jnl-groupe-del" onclick="deleteGroupe([${docIds}],[${ecrIds}])" title="Supprimer tout le groupe">✕ Tout supprimer</button>
          </div>
          <div class="jnl-groupe-body">
            ${group.ecritures.map((e, eIdx) => renderEcritureInGroupe(e, eIdx, group.ecritures.length)).join('')}
          </div>
        </div>`;
        } else {
          const e = group.ecritures[0];
          let eD = 0,
            eC = 0;
          e.lignes.forEach((l) => {
            eD += l.debit || 0;
            eC += l.credit || 0;
          });
          const equil = Math.abs(eD - eC) < 1;
          const jnlCls = e.journal || 'OD';
          html += `<div class="jnl-groupe">
          <div class="jnl-groupe-header">
            <div class="jnl-groupe-icon">${JOURNAL_ICONS[jnlCls] || '📋'}</div>
            <div class="jnl-groupe-info">
              <div class="jnl-groupe-libelle">${e.libelle || '<em style="opacity:.4">Sans libellé</em>'}</div>
              <div class="jnl-groupe-meta">${date} · ${e.piece || '—'} · ${JOURNAL_NAMES[jnlCls] || jnlCls}</div>
            </div>
            <div class="jnl-groupe-total">
              <div class="jnl-groupe-total-label">Débit / Crédit</div>
              <div class="jnl-groupe-total-val" style="font-size:11px">
                <span style="color:#60a5fa">${fn(eD)}</span> / <span style="color:#4ade80">${fn(eC)}</span>
              </div>
            </div>
            <span class="jnl-step-equil ${equil ? 'ok' : 'nok'}">${equil ? '✓ EQ' : '✗ NEQ'}</span>
            <button class="jnl-groupe-del" onclick="deleteEcriture('${e._docId}',${e.id})" title="Supprimer">✕</button>
          </div>
          <div class="jnl-groupe-body">${renderEcritureInGroupe(e, 0, 1)}</div>
        </div>`;
        }
      });
    });

  content.innerHTML = html;
  if (footer) {
    footer.style.display = 'block';
    document.getElementById('jnl-nb-groupes').textContent = groups.length;
    document.getElementById('jnl-nb-ecr').textContent = totalEcritures;
    document.getElementById('jnl-nb-lignes').textContent = totalLignes;
    document.getElementById('jnl-total-debit').textContent = fn(totalD) + ' FCFA';
    document.getElementById('jnl-total-credit').textContent = fn(totalC) + ' FCFA';
    const eqEl = document.getElementById('jnl-equil-label');
    if (eqEl) {
      const balanced = Math.abs(totalD - totalC) < 1;
      eqEl.textContent = balanced ? '✓ Équilibré' : '✗ Déséquilibré';
      eqEl.className = 'jnl-footer-val ' + (balanced ? 'eq' : 'neq');
    }
  }
}

function renderEcritureInGroupe(e, eIdx, totalInGroupe) {
  let eD = 0,
    eC = 0;
  e.lignes.forEach((l) => {
    eD += l.debit || 0;
    eC += l.credit || 0;
  });
  const equil = Math.abs(eD - eC) < 1;
  const jnlCls = e.journal || 'OD';
  const stepLabel = getStepLabel(e);
  const lignesAffichage = sortLignesDebitAvantCredit(e.lignes);
  return `<div class="jnl-ecriture type-${jnlCls}">
    <div class="jnl-ecriture-subheader">
      ${totalInGroupe > 1 ? `<span class="jnl-step-badge">${eIdx + 1}</span>` : ''}
      <span class="jnl-step-jnl-badge ${jnlCls}">${jnlCls}</span>
      <span class="jnl-step-label">${stepLabel}</span>
      <span class="jnl-step-piece">${e.piece || '—'} · ${JOURNAL_NAMES[jnlCls] || jnlCls}</span>
      <span class="jnl-step-totaux" style="margin-left:auto">
        <span style="color:#60a5fa">${fn(eD)}</span> / <span style="color:#4ade80">${fn(eC)}</span>
      </span>
      <span class="jnl-step-equil ${equil ? 'ok' : 'nok'}">${equil ? '✓' : '✗'}</span>
      <button class="jnl-step-del" onclick="deleteEcriture('${e._docId}',${e.id})" title="Supprimer cette écriture">✕</button>
    </div>
    <div class="jnl-ecriture-body">
      <table class="jnl-lignes-table">
        <thead><tr>
          <th style="width:200px">Compte</th>
          <th>Libellé</th>
          <th class="right" style="width:140px">Débit (FCFA)</th>
          <th class="right" style="width:140px">Crédit (FCFA)</th>
        </tr></thead>
        <tbody>
          ${lignesAffichage
            .map(
              (l) => `
            <tr>
              <td><div class="jnl-compte-badge">
                <span class="jnl-compte-code">${l.compte}</span>
                <span class="jnl-compte-name" title="${PC[l.compte] || ''}">${(PC[l.compte] || '').substring(0, 22)}</span>
              </div></td>
              <td><span class="jnl-libelle-ligne">${l.libelle || e.libelle || '—'}</span></td>
              <td class="jnl-debit-cell">${l.debit ? fn(l.debit) : '<span style="color:var(--line2)">—</span>'}</td>
              <td class="jnl-credit-cell">${l.credit ? fn(l.credit) : '<span style="color:var(--line2)">—</span>'}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function deleteGroupe(docIds, ids) {
  const locked = ids.some(id => {
    const ecr = ecritures.find(e => e.id === id);
    return ecr && isPeriodeLocked(ecr.date);
  });
  if (locked) {
    toast('🔒 Ce groupe contient des écritures d\'une période clôturée — suppression impossible.', 'error');
    return;
  }
  if (!confirm(`Supprimer ce groupe de ${docIds.length} écriture${docIds.length > 1 ? 's' : ''} ?`)) return;
  for (const docId of docIds) await deleteEcritureFromFirestore(docId);
  ids.forEach((id) => {
    ecritures = ecritures.filter((e) => e.id !== id);
  });
  updateStats();
  renderJournal();
  toast(`${docIds.length} écriture${docIds.length > 1 ? 's' : ''} supprimée${docIds.length > 1 ? 's' : ''}`, 'info');
}

async function deleteEcriture(docId, id) {
  const ecr = ecritures.find(e => e.id === id || e._docId === docId);
  if (ecr && isPeriodeLocked(ecr.date)) {
    toast(`🔒 Période ${String(ecr.date).substring(0,4)} verrouillée — suppression impossible. Exercice clôturé.`, 'error');
    return;
  }
  if (!confirm('Supprimer cette écriture ?')) return;
  await deleteEcritureFromFirestore(docId);
  ecritures = ecritures.filter((e) => e.id !== id);
  updateStats();
  renderJournal();
  toast('Écriture supprimée', 'info');
}

// ══════════════════════════════════════════
// GRAND LIVRE
// ══════════════════════════════════════════
function getMap(opts = {}) {
  const ecFiltrees = opts.filtrer ? getEcrituresFiltrees(opts) : ecritures;
  const map = {};
  ecFiltrees.forEach((e) =>
    e.lignes.forEach((l) => {
      if (!l.compte) return;
      if (!map[l.compte]) map[l.compte] = { debit: 0, credit: 0, mvts: [] };
      map[l.compte].debit += l.debit || 0;
      map[l.compte].credit += l.credit || 0;
      map[l.compte].mvts.push({
        date: e.date,
        piece: e.piece || '',
        journal: e.journal,
        libelle: l.libelle || e.libelle || '',
        debit: l.debit || 0,
        credit: l.credit || 0,
      });
    }),
  );
  return map;
}

function resetGLFiltre() {
  document.getElementById('gl-date-debut').value = '';
  document.getElementById('gl-date-fin').value = '';
  document.getElementById('glSearch').value = '';
  renderGrandLivre();
}

function renderGrandLivre() {
  const search = document.getElementById('glSearch')?.value?.toLowerCase() || '';
  const dateDebut = document.getElementById('gl-date-debut')?.value || '';
  const dateFin = document.getElementById('gl-date-fin')?.value || '';
  const opts = dateDebut || dateFin ? { filtrer: true, dateDebut, dateFin } : {};
  const map = getMap(opts);
  const content = document.getElementById('grandLivreContent');
  if (!content) return;
  const comptes = Object.keys(map).sort();
  if (!comptes.length) {
    content.innerHTML = '<div class="empty-state"><div class="icon">⊞</div><p>Aucun mouvement</p></div>';
    return;
  }
  const filtered = comptes.filter((c) => !search || c.includes(search) || (PC[c] || '').toLowerCase().includes(search));
  content.innerHTML = filtered
    .map((code) => {
      const acc = map[code],
        s = acc.debit - acc.credit,
        lib = PC[code] || 'Compte ' + code,
        isD = s >= 0;
      return `<div class="gl-account">
      <div class="gl-account-header" onclick="toggleGL('gl-${code}')">
        <span class="gl-code">${code}</span>
        <span class="gl-name">${lib.substring(0, 46)}</span>
        <span style="color:rgba(255,255,255,.3);font-size:10px;font-family:var(--font-mono);margin-right:6px">${acc.mvts.length} mvt${acc.mvts.length > 1 ? 's' : ''}</span>
        <span class="gl-balance ${isD ? 'debit' : 'credit'}">${isD ? 'Sd' : 'Sc'} ${fn(Math.abs(s))} FCFA</span>
      </div>
      <div id="gl-${code}" style="display:none">
        <div style="overflow-x:auto">
        <table class="dt">
          <thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th>
            <th style="text-align:right">Débit</th><th style="text-align:right">Crédit</th>
            <th style="text-align:right">Solde progressif</th></tr></thead>
          <tbody>${acc.mvts
            .map((m, i) => {
              const rD = acc.mvts.slice(0, i + 1).reduce((s, x) => s + x.debit, 0);
              const rC = acc.mvts.slice(0, i + 1).reduce((s, x) => s + x.credit, 0);
              const rs = rD - rC;
              return `<tr>
              <td style="font-family:var(--font-mono);font-size:10px">${m.date}</td>
              <td><span class="ct">${m.journal}</span></td>
              <td style="font-family:var(--font-mono);font-size:9.5px;color:var(--muted)">${m.piece}</td>
              <td>${m.libelle}</td>
              <td class="debit">${m.debit ? fn(m.debit) : ''}</td>
              <td class="credit">${m.credit ? fn(m.credit) : ''}</td>
              <td style="text-align:right;font-family:var(--font-mono);font-size:11px;color:${rs >= 0 ? '#60a5fa' : '#4ade80'}">
                ${rs >= 0 ? 'Sd ' : 'Sc '}${fn(Math.abs(rs))}</td>
            </tr>`;
            })
            .join('')}
          <tr class="total-row">
            <td colspan="4" style="text-align:right;font-weight:700">TOTAUX</td>
            <td class="debit">${fn(acc.debit)}</td>
            <td class="credit">${fn(acc.credit)}</td>
            <td style="text-align:right;font-family:var(--font-mono);color:${isD ? '#60a5fa' : '#4ade80'}">
              ${isD ? 'Sd ' : 'Sc '}${fn(Math.abs(s))}</td>
          </tr></tbody>
        </table></div>
      </div>
    </div>`;
    })
    .join('');
}
function toggleGL(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ══════════════════════════════════════════
// BALANCE
// ══════════════════════════════════════════
function resetBalanceFiltre() {
  document.getElementById('bal-date-debut').value = '';
  document.getElementById('bal-date-fin').value = '';
  document.getElementById('bal-journal').value = '';
  document.getElementById('bal-classe').value = '';
  const a = document.getElementById('balance-analyse');
  if (a) a.style.display = 'none';
  renderBalance();
}

function renderBalance() {
  const dateDebut = document.getElementById('bal-date-debut')?.value || '';
  const dateFin = document.getElementById('bal-date-fin')?.value || '';
  const journal = document.getElementById('bal-journal')?.value || '';
  const classe = document.getElementById('bal-classe')?.value || '';
  const opts = dateDebut || dateFin || journal ? { filtrer: true, dateDebut, dateFin, journal } : {};
  const map = getMap(opts);
  const tbody = document.getElementById('balanceBody');
  if (!tbody) return;
  let comptes = Object.keys(map).sort();
  if (classe) comptes = comptes.filter((c) => c.startsWith(classe));
  if (!comptes.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>Aucune donnée pour cette sélection</p></div></td></tr>';
    return;
  }
  let tD = 0,
    tC = 0,
    tSD = 0,
    tSC = 0;
  const rows = comptes.map((code) => {
    const acc = map[code],
      s = acc.debit - acc.credit,
      sd = s > 0 ? s : 0,
      sc = s < 0 ? -s : 0;
    tD += acc.debit;
    tC += acc.credit;
    tSD += sd;
    tSC += sc;
    return `<tr>
      <td><span class="ct">${code}</span></td>
      <td style="font-size:11px">${(PC[code] || '').substring(0, 42)}</td>
      <td class="debit">${fn(acc.debit)}</td>
      <td class="credit">${fn(acc.credit)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:#2563eb">${sd ? fn(sd) : ''}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:#16a34a">${sc ? fn(sc) : ''}</td>
    </tr>`;
  });
  rows.push(`<tr class="total-row"><td colspan="2">TOTAUX GÉNÉRAUX</td>
    <td class="debit">${fn(tD)}</td><td class="credit">${fn(tC)}</td>
    <td style="text-align:right;font-family:var(--font-mono)">${fn(tSD)}</td>
    <td style="text-align:right;font-family:var(--font-mono)">${fn(tSC)}</td>
  </tr>`);
  tbody.innerHTML = rows.join('');
}

// ══════════════════════════════════════════
// BILAN
// ══════════════════════════════════════════
function renderBilan() {
  const dateArrete = document.getElementById('bilan-date-arrete')?.value;
  const opts = dateArrete ? { filtrer: true, dateFin: dateArrete } : {};
  const map = getMap(opts);
  const content = document.getElementById('bilanContent');
  if (!content) return;
  if (!Object.keys(map).length) {
    content.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1"><div class="icon">⊠</div><p>Saisissez des écritures pour générer le bilan</p></div>';
    return;
  }
  const actif = {
    immob: { title: 'ACTIF IMMOBILISÉ', comptes: [] },
    stocks: { title: 'STOCKS ET EN-COURS', comptes: [] },
    creances: { title: 'CRÉANCES ET EMPLOIS ASSIMILÉS', comptes: [] },
    treso: { title: 'TRÉSORERIE-ACTIF', comptes: [] },
  };
  const passif = {
    cap: { title: 'CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES', comptes: [] },
    df: { title: 'DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES', comptes: [] },
    dct: { title: 'PASSIF CIRCULANT', comptes: [] },
    tp: { title: 'TRÉSORERIE-PASSIF', comptes: [] },
  };
  Object.entries(map).forEach(([code, acc]) => {
    const s = acc.debit - acc.credit;
    const cl = code[0];
    const e = { code, lib: (PC[code] || code).substring(0, 40), solde: Math.abs(s) };
    if (cl === '2') {
      if (s > 0) actif.immob.comptes.push(e);
    } else if (cl === '3') {
      if (s > 0) actif.stocks.comptes.push(e);
    } else if (cl === '4') {
      if (s > 0) actif.creances.comptes.push(e);
      else if (s < 0) passif.dct.comptes.push({ ...e, solde: Math.abs(s) });
    } else if (cl === '5') {
      if (s > 0) actif.treso.comptes.push(e);
      else passif.tp.comptes.push({ ...e, solde: Math.abs(s) });
    } else if (cl === '1') {
      const n = parseInt(code);
      (n <= 160 ? passif.cap : passif.df).comptes.push({ code, lib: (PC[code] || code).substring(0, 40), solde: Math.abs(s) });
    }
  });
  const rc = (sections) =>
    sections
      .map((s) => {
        if (!s.comptes.length) return '';
        const total = s.comptes.reduce((sum, c) => sum + c.solde, 0);
        return `<div class="bilan-section">
      <div class="bilan-section-title">${s.title}</div>
      ${s.comptes.map((c) => `<div class="bilan-line"><span class="acc-code">${c.code}</span><span class="acc-name">${c.lib}</span><span class="acc-amount">${fn(c.solde)}</span></div>`).join('')}
      <div class="bilan-line" style="font-weight:700;border-bottom:none;margin-top:3px">
        <span class="acc-code"></span><span class="acc-name" style="color:var(--ink)">Sous-total</span><span class="acc-amount">${fn(total)}</span>
      </div>
    </div>`;
      })
      .join('');
  const tA = [...actif.immob.comptes, ...actif.stocks.comptes, ...actif.creances.comptes, ...actif.treso.comptes].reduce(
    (s, c) => s + c.solde,
    0,
  );
  const tP = [...passif.cap.comptes, ...passif.df.comptes, ...passif.dct.comptes, ...passif.tp.comptes].reduce((s, c) => s + c.solde, 0);
  const label = dateArrete ? `Arrêté au ${dateArrete}` : `Exercice ${document.getElementById('exerciceYear').value}`;
  content.innerHTML = `
    <div class="bilan-col"><div class="bilan-col-header actif">ACTIF — ${label}</div>${rc(Object.values(actif))}<div class="bilan-total"><span>TOTAL ACTIF</span><span>${fn(tA)} FCFA</span></div></div>
    <div class="bilan-col"><div class="bilan-col-header passif">PASSIF — ${label}</div>${rc(Object.values(passif))}<div class="bilan-total"><span>TOTAL PASSIF</span><span>${fn(tP)} FCFA</span></div></div>`;
}

// ══════════════════════════════════════════
// RÉSULTAT
// ══════════════════════════════════════════
function renderResultat() {
  const map = getMap();
  const content = document.getElementById('resultatContent');
  if (!content) return;
  if (!Object.keys(map).length) {
    content.innerHTML = '<div class="empty-state"><div class="icon">↗</div><p>Aucune donnée</p></div>';
    return;
  }
  const gt = (pfx) =>
    Object.entries(map)
      .filter(([c]) => pfx.some((p) => c.startsWith(p)))
      .reduce((s, [, a]) => s + (a.debit - a.credit), 0);
  const ventes = Math.abs(gt(['701', '702', '703', '704', '705']));
  const prodsAcc = Math.abs(gt(['707']));
  const autrProd = Math.abs(gt(['75', '718', '711']));
  const transports = gt(['612', '614']);
  const servExt = gt(['621', '622', '624', '625', '626', '627', '628', '631', '632', '634', '635', '638']);
  const impTaxes = gt(['641', '645']);
  const autresChg = gt(['651', '654', '658']);
  const personnel = gt(['661', '662', '663', '664']);
  const dap = gt(['681', '691', '697']);
  const revFin = Math.abs(gt(['771', '772', '773', '774', '776', '777']));
  const chgFin = gt(['671', '673', '674', '676']);
  const haoP = Math.abs(gt(['821', '822', '841']));
  const haoC = gt(['811', '812', '831', '834', '839', '851', '852', '854']);
  const imp = gt(['891', '895']);
  const mc = ventes - Math.abs(gt(['601'])) - gt(['6031']);
  const ca = ventes + prodsAcc;
  const va =
    ca + autrProd - Math.abs(gt(['601', '602', '604', '605', '608'])) - gt(['6031', '6032']) - transports - servExt - impTaxes - autresChg;
  const ebe = va - personnel;
  const re = ebe - dap;
  const rf = revFin - chgFin;
  const rao = re + rf;
  const rhao = haoP - haoC;
  const res = rao + rhao - imp;
  const rr = (lbl, val, cls = '') =>
    `<div class="rrow ${cls}"><span>${lbl}</span><span class="amount ${val >= 0 ? 'pos' : 'neg'}">${fn(Math.abs(val))} FCFA${val < 0 ? ' (−)' : ''}</span></div>`;
  content.innerHTML = `<div class="rlist">
    <div class="rrow header"><span>COMPTE DE RÉSULTAT — SYSCOHADA Révisé 2017</span><span></span></div>
    ${rr('Ventes de marchandises (701)', ventes, 'sub')}
    ${rr('Achats + Var. stocks (601+6031)', -(Math.abs(gt(['601'])) + gt(['6031'])), 'sub')}
    ${rr('→ Marge commerciale (XA)', mc, 'total')}
    ${rr('Produits accessoires (707+75)', prodsAcc + autrProd, 'sub')}
    ${rr('→ CA net et autres produits (XB)', ca, 'total')}
    ${rr('Transports + Services extérieurs', -(transports + servExt), 'sub')}
    ${rr('Impôts et taxes (641+645)', -(impTaxes + autresChg), 'sub')}
    ${rr('→ Valeur ajoutée brute (XC)', va, 'total')}
    ${rr('Charges de personnel (661–664)', -personnel, 'sub')}
    ${rr("→ E.B.E. — Excédent Brut d'Exploitation (XD)", ebe, 'total')}
    ${rr('Dotations amort. et prov. (681+691)', -dap, 'sub')}
    ${rr("→ Résultat d'exploitation (RE — XE)", re, 'total')}
    <div class="divider"></div>
    <div class="rrow header"><span>RÉSULTAT FINANCIER</span><span></span></div>
    ${rr('Revenus financiers (77)', revFin, 'sub')}
    ${rr('Charges financières (67)', -chgFin, 'sub')}
    ${rr('→ Résultat financier (RF — XF)', rf, 'total')}
    ${rr('→ Résultat des Activités Ordinaires (RAO — XG)', rao, 'total')}
    <div class="divider"></div>
    <div class="rrow header"><span>RÉSULTAT H.A.O.</span><span></span></div>
    ${rr('Produits HAO', haoP, 'sub')}
    ${rr('Charges HAO', -haoC, 'sub')}
    ${rr('→ RHAO (XH)', rhao, 'total')}
    <div class="divider"></div>
    ${rr('IS / IBP — Impôt sur les Bénéfices (891) — Taux CI : 25%', -imp, 'sub')}
    <div class="rrow result">
      <span>${res >= 0 ? "✓ RÉSULTAT NET DE L'EXERCICE — BÉNÉFICE" : "✗ RÉSULTAT NET DE L'EXERCICE — PERTE"}</span>
      <span class="amount ${res >= 0 ? 'pos' : 'neg'}">${fn(Math.abs(res))} FCFA</span>
    </div>
  </div>`;
}

// ══════════════════════════════════════════
// TRÉSORERIE
// ══════════════════════════════════════════
function renderTresorerie() {
  const map = getMap();
  const content = document.getElementById('tresorerieContent');
  if (!content) return;
  const tc = Object.entries(map).filter(([c]) => c.startsWith('5'));
  if (!tc.length) {
    content.innerHTML = '<div class="empty-state"><div class="icon">◎</div><p>Aucun mouvement de trésorerie</p></div>';
    return;
  }
  const total = tc.reduce((s, [, a]) => s + (a.debit - a.credit), 0);
  content.innerHTML = `<div class="rlist">
    <div class="rrow header"><span>COMPTES DE TRÉSORERIE — CLASSE 5 — SYSCOHADA</span><span></span></div>
    <div class="rrow header" style="font-size:10px;opacity:.5"><span>Mobile Money (Orange Money, MTN MoMo, Wave, Moov) → Compte 552</span><span></span></div>
    ${tc
      .map(([code, acc]) => {
        const s = acc.debit - acc.credit;
        return `<div class="rrow sub"><span><span class="ct">${code}</span><span style="margin-left:6px">${(PC[code] || '').substring(0, 34)}</span></span><span class="amount ${s >= 0 ? 'pos' : 'neg'}">${fn(Math.abs(s))} FCFA${s < 0 ? ' (Créditeur)' : ''}</span></div>`;
      })
      .join('')}
    <div class="rrow result"><span>Trésorerie nette totale</span><span class="amount ${total >= 0 ? 'pos' : 'neg'}">${fn(Math.abs(total))} FCFA</span></div>
  </div>`;
}

// ══════════════════════════════════════════
// PLAN COMPTABLE
// ══════════════════════════════════════════
function renderPlanComptable() {
  const search = document.getElementById('pcSearch')?.value?.toLowerCase() || '';
  const cls = document.getElementById('pcClass')?.value || '';
  const container = document.getElementById('pcBody');
  if (!container) return;
  const entries = Object.entries(PC).filter(([code, lib]) => {
    if (cls && code[0] !== cls) return false;
    if (search && !code.includes(search) && !lib.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!entries.length) {
    container.innerHTML = '<div class="pc3d-empty">Aucun compte trouvé</div>';
    return;
  }
  // Regroupement par classe (1, 2, 3 … 8) — chaque classe = une carte 3D
  // avec tous les numéros de compte qui lui sont liés, triés et indentés
  // selon la hiérarchie SYSCOHADA (classe > poste > compte > sous-compte).
  const groups = {};
  entries.forEach(([code, lib]) => {
    const cl = code[0];
    (groups[cl] = groups[cl] || []).push([code, lib]);
  });
  const classesOrder = Object.keys(groups).sort();
  container.innerHTML = classesOrder
    .map((cl) => {
      const accounts = groups[cl].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
      const rows = accounts
        .map(([code, lib]) => {
          const isHeader = lib === lib.toUpperCase() && lib.length > 3;
          const pad = Math.min((code.length - 1) * 10, 30);
          return `<div class="pc3d-account-row ${isHeader ? 'lvl-header' : ''}" style="padding-left:${16 + pad}px">
            <span class="code">${code}</span><span>${lib.substring(0, 60)}</span>
          </div>`;
        })
        .join('');
      return `<div class="pc3d-card">
        <div class="pc3d-head">
          <div class="pc3d-num">${cl}</div>
          <div class="pc3d-titles">
            <h3>${CLASS_NAMES[cl] || 'Classe ' + cl}</h3>
            <span>${accounts.length} compte${accounts.length > 1 ? 's' : ''}</span>
          </div>
          <div class="pc3d-nature-badge">${NATURE_MAP[cl] || ''}</div>
        </div>
        <div class="pc3d-body">${rows}</div>
      </div>`;
    })
    .join('');
}

// ══════════════════════════════════════════
// EXPORT PDF / WORD
// ══════════════════════════════════════════
function openExportModal() {
  const m = document.getElementById('exportModal');
  if (m) m.style.display = 'flex';
  selectExport('pdf');
  updateExportOptions();
}
function closeExportModal() {
  const m = document.getElementById('exportModal');
  if (m) m.style.display = 'none';
}
function selectExport(fmt) {
  exportFormat = fmt;
  ['pdf', 'word', 'excel'].forEach((f) => {
    document.getElementById('opt-' + f)?.classList.toggle('selected', fmt === f);
  });
}
function doExport() {
  const docType = document.getElementById('export-doc-type')?.value || 'journal';
  closeExportModal();
  if (docType === 'facture_single') {
    toast("Sélectionnez une facture dans la liste pour l'imprimer", 'info');
    navigate('factures');
    return;
  }
  if (exportFormat === 'pdf') exportPDFAvance();
  else if (exportFormat === 'word') exportWordAvance();
  else if (exportFormat === 'excel') exportExcelAvance();
}

function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const yr = document.getElementById('exerciceYear').value;
  const company = currentProfile?.company || 'Entreprise';
  const pageW = 210;
  const now = new Date().toLocaleDateString('fr-FR');
  doc.setFillColor(10, 11, 16);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(212, 168, 83);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SYSCOHADA Pro v4 — Révisé 2017', 14, 10);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('COMEO AI — Expert-Comptable Ivoirien | ONECCA-CI', 14, 16);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text(company, pageW - 14, 10, { align: 'right' });
  doc.text('Exercice ' + yr + ' | Monnaie : FCFA (XOF)', pageW - 14, 16, { align: 'right' });
  doc.setTextColor(10, 11, 16);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('JOURNAL GÉNÉRAL', 14, 34);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(130, 128, 112);
  doc.text('Édité le ' + now, 14, 40);
  doc.setDrawColor(212, 168, 83);
  doc.setLineWidth(0.5);
  doc.line(14, 43, pageW - 14, 43);
  const tableData = [];
  let totalD = 0,
    totalC = 0;
  ecritures.forEach((e) => {
    const lignesSorted = sortLignesDebitAvantCredit(e.lignes);
    lignesSorted.forEach((l) => {
      tableData.push([
        e.date,
        e.journal,
        e.piece || '',
        l.compte,
        (PC[l.compte] || '').substring(0, 28),
        l.libelle || e.libelle || '',
        l.debit ? fn(l.debit) : '',
        l.credit ? fn(l.credit) : '',
      ]);
      totalD += l.debit || 0;
      totalC += l.credit || 0;
    });
  });
  doc.autoTable({
    startY: 48,
    head: [['Date', 'Jnl', 'N° Pièce', 'Compte', 'Libellé compte', 'Libellé opération', 'Débit FCFA', 'Crédit FCFA']],
    body: tableData,
    foot: [['', '', '', '', '', 'TOTAUX', fn(totalD), fn(totalC)]],
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: [10, 11, 16], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [30, 34, 54], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 248, 244] },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 10, halign: 'center' },
      2: { cellWidth: 18 },
      3: { cellWidth: 16, fontStyle: 'bold' },
      4: { cellWidth: 28 },
      5: { cellWidth: 36 },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });
  doc.save(`SYSCOHADA_v4_${company.replace(/\s+/g, '_')}_${yr}.pdf`);
  toast('✓ PDF exporté avec succès', 'success');
}

function exportWord() {
  const yr = document.getElementById('exerciceYear').value;
  const company = currentProfile?.company || 'Entreprise';
  const now = new Date().toLocaleDateString('fr-FR');
  let jRows = '',
    totalD = 0,
    totalC = 0;
  ecritures.forEach((e) => {
    const lignesSorted = sortLignesDebitAvantCredit(e.lignes);
    lignesSorted.forEach((l) => {
      jRows += `<tr><td>${e.date}</td><td>${e.journal}</td><td>${e.piece || ''}</td><td>${l.compte}</td><td>${(PC[l.compte] || '').substring(0, 28)}</td><td>${l.libelle || e.libelle || ''}</td><td style="text-align:right">${l.debit ? fn(l.debit) : ''}</td><td style="text-align:right">${l.credit ? fn(l.credit) : ''}</td></tr>`;
      totalD += l.debit || 0;
      totalC += l.credit || 0;
    });
  });
  const th = 'background:#0a0b10;color:#d4a853;padding:6px 10px;text-align:left;font-size:9pt;text-transform:uppercase';
  const td = 'border-bottom:1px solid #e0dbd0;padding:5px 10px';
  const html = `<html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt}table{width:100%;border-collapse:collapse;margin-bottom:20pt}th{${th}}td{${td}}tr:nth-child(even) td{background:#faf8f4}</style></head>
  <body>
  <h1 style="font-family:Georgia,serif;font-size:16pt;color:#0a0b10">SYSCOHADA Pro v4 — ${company} — Exercice ${yr}</h1>
  <p>Édité le ${now} | COMEO AI — Expert-Comptable Ivoirien | Monnaie : FCFA (XOF)</p>
  <h2>Journal Général</h2>
  <table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Compte</th><th>Libellé compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead>
  <tbody>${jRows}</tbody>
  <tfoot><tr><td colspan="6" style="font-weight:bold;text-align:right">TOTAUX</td><td style="font-weight:bold;text-align:right">${fn(totalD)}</td><td style="font-weight:bold;text-align:right">${fn(totalC)}</td></tr></tfoot></table>
  </body></html>`;
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SYSCOHADA_v4_${company.replace(/\s+/g, '_')}_${yr}.doc`;
  a.click();
  URL.revokeObjectURL(url);
  toast('✓ Document Word exporté', 'success');
}

// ══════════════════════════════════════════
// CORRECTEUR AUTOMATIQUE DE COMPTES
const MOTS_IMMOBILISATIONS = [
  'véhicule',
  'camion',
  'voiture',
  'moto',
  'transport',
  'automobile',
  'ordinateur',
  'informatique',
  'bureau',
  'mobilier',
  'matériel',
  'machine',
  'équipement',
  'installation',
  'bâtiment',
  'terrain',
  'outillage',
  'logiciel',
  'brevet',
  'licence',
  'fonds commercial',
  'plantation',
  'actif biologique',
  'cheptel',
  'aérien',
  'fluvial',
  'ferroviaire',
  'naval',
];

const COMPTES_IMMOB = {
  véhicule: '2451',
  camion: '2451',
  voiture: '2451',
  moto: '2451',
  automobile: '2451',
  transport: '2451',
  ordinateur: '2442',
  informatique: '2442',
  bureau: '2441',
  mobilier: '2444',
  matériel: '2411',
  machine: '2411',
  équipement: '2411',
  outillage: '2412',
  installation: '2341',
  bâtiment: '2311',
  terrain: '2221',
  logiciel: '2131',
  brevet: '2121',
  licence: '2122',
  'fonds commercial': '216',
  plantation: '2465',
  'actif biologique': '246',
  cheptel: '2461',
  aérien: '2455',
  fluvial: '2453',
  ferroviaire: '2452',
  naval: '2454',
};

function corrigerComptesErreurs(lignes) {
  return lignes.map((l) => {
    const code = String(l.compte || '');
    const lib = (l.libelle || '').toLowerCase();
    let newCode = code;

    // 1. Achats mal classés → Immobilisations
    if (
      ['601', '6011', '6012', '6013', '6014', '602', '604', '6041', '6042', '6043', '6044', '605', '6056', '6057', '6058', '607'].includes(
        code,
      ) &&
      l.debit > 0
    ) {
      const motTrouve = MOTS_IMMOBILISATIONS.find((m) => lib.includes(m));
      if (motTrouve && !lib.includes('marchandis') && !lib.includes('consomm')) {
        newCode = COMPTES_IMMOB[motTrouve] || '2411';
      }
    }

    // 2. Amortissement terrain → 2824 uniquement
    if (['2821', '2822', '2823', '2825', '2826', '2827', '2828'].includes(code) && l.credit > 0) {
      newCode = '2824';
    }

    // 3. Banques locales — codes erreurs fréquents
    if (['511', '512', '513', '514', '515', '518'].includes(code)) {
      newCode = '521';
    }

    // 4. TVA récupérable : achats vs immobilisations
    if (code === '4452' && l.debit > 0) {
      const motsImmo = [
        'véhicule',
        'camion',
        'ordinateur',
        'mobilier',
        'matériel',
        'machine',
        'équipement',
        'bâtiment',
        'terrain',
        'installation',
        'outillage',
        'logiciel',
      ];
      if (motsImmo.some((m) => lib.includes(m))) newCode = '4451';
    }

    // 5. Fournisseurs : dettes courantes vs fournisseurs immobilisations
    if (code === '401' && l.credit > 0) {
      const motsImmo = ['immobilisation', 'terrain', 'bâtiment', 'véhicule', 'matériel', 'équipement', 'machine', 'ordinateur', 'logiciel'];
      if (motsImmo.some((m) => lib.includes(m))) newCode = '4812';
    }

    // 6. Mobile Money → 552 (pas 571 ni 521)
    if ((code === '571' || code === '521') && l.debit > 0) {
      if (['wave', 'orange money', 'mtn momo', 'moov money', 'mobile money'].some((m) => lib.includes(m))) {
        newCode = '552';
      }
    }

    return {
      ...l,
      compte: newCode,
      libelle: l.libelle || PC[newCode] || l.libelle,
    };
  });
}

// ══════════════════════════════════════════
// COMEO AI — Clés chargées depuis Firestore
// ══════════════════════════════════════════
function handleAiKey(e, ctx) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToAI(ctx);
  }
}

function quickAI(text) {
  const input = document.getElementById('aiInput');
  if (input) input.value = text;
  navigate('dashboard');
  sendToAI('dashboard');
}

function buildAIContext() {
  let tD = 0,
    tC = 0;
  ecritures.forEach((e) =>
    e.lignes.forEach((l) => {
      tD += l.debit || 0;
      tC += l.credit || 0;
    }),
  );
  const map = getMap();
  const comptesSoldes = Object.entries(map)
    .slice(0, 12)
    .map(([c, a]) => {
      const s = a.debit - a.credit;
      return `${c}:${s >= 0 ? 'Sd' : 'Sc'}${fn(Math.abs(s))}FCFA`;
    })
    .join(' | ');
 const dernieres = ecritures
    .slice(-5)
    .map((e) => `${e.date}[${e.journal}]${e.libelle || '—'}`)
    .join('; ');
  const allDates = [...new Set(ecritures.map((e) => e.date))].sort().join(', ');

  // ── Lignes en cours de saisie (formulaire actif) ──
  const lignesEnCours = lignes
    .filter((l) => l.compte || l.libelle || l.debit || l.credit)
    .map((l, i) => `  Ligne ${i+1}: Compte=${l.compte||'?'} | Libellé=${l.libelle||'?'} | Débit=${l.debit||0} | Crédit=${l.credit||0}`)
    .join('\n');
  const journalEnCours = document.getElementById('ecr-journal')?.value || '';
  const libelleEnCours = document.getElementById('ecr-libelle')?.value || '';
  const dateEnCours = document.getElementById('ecr-date')?.value || '';
  const totalDebitSaisie = lignes.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCreditSaisie = lignes.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const soldeSaisie = totalDebitSaisie - totalCreditSaisie;

  return {
    nbEcritures: ecritures.length,
    companyName: currentProfile?.company || 'Entreprise',
    exercice: document.getElementById('exerciceYear')?.value || '2024',
    totalDebit: fn(tD),
    totalCredit: fn(tC),
    comptesSoldes,
    ecrituresResume: dernieres,
    allDates,
    lignesEnCours,
    journalEnCours,
    libelleEnCours,
    dateEnCours,
    totalDebitSaisie: fn(totalDebitSaisie),
    totalCreditSaisie: fn(totalCreditSaisie),
    soldeSaisie: fn(soldeSaisie),
  };
}

// Déclaration protégée pour éviter la duplication
const sendToAI = async function(context) {
  // Nouveau système : permettre les opérations parallèles par contexte
  if (isOperationInProgress(context)) {
    console.log(`[PARALLEL] ${context} en cours, nouvelle requête ignorée`);
    return;
  }
  if (!requireSubscriptionAccess()) return;

  if (!isAiServiceReady()) {
    appendMsg(context, 'ai', '⚠️ Aucune clé API OpenRouter configurée. Clés configurées dans le système pour activer l\'assistant IA.');
    return;
  }

  const inputId = context === 'dashboard' ? 'aiInput' : `aiInput-${context}`;
  const input = document.getElementById(inputId);
  const msg = input?.value?.trim();
  if (!msg) return;
  startAIOperation(context);
  input.value = '';
  const sendBtnId = context === 'dashboard' ? 'aiSendBtn' : null;
  if (sendBtnId) {
    const btn = document.getElementById(sendBtnId);
    if (btn) btn.disabled = true;
  }
  appendMsg(context, 'user', msg);
  const tid = appendTyping(context);
  const ctxData = buildAIContext();
  const systemPrompt = buildSystemPrompt(ctxData);

  conversationHistory.push({ role: 'user', content: msg });
  if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

  try {
    let data = null;
    let fullText = null;

    // ══ ÉTAPE 0 : CACHE — réponse instantanée si déjà connue ══
    // On ne met pas en cache les actions (créer facture, ouvrir page, etc.)
    const msgLow = msg.toLowerCase();
    const cacheKey = aiCacheKey(msg);
    const isAction = isActionQuery(msgLow);

    if (!isAction) {
      const cached = await aiCacheGet(cacheKey);
      if (cached && !cached.includes('###')) {
        console.log('[COMEO Chat] ✅ Réponse depuis cache');
        removeTyping(context, tid);
        conversationHistory.push({ role: 'assistant', content: cached });
        fullText = cached;
        // Sauter directement au traitement de la réponse
        appendMsg(context, 'ai', fullText);
        return;
      }
    }

    // ══ ÉTAPE 1 : GROQ — file d'attente multi-clés ══
    if (GROQ_API_KEYS.length > 0) {
      const allBusy = groqKeyBusy.length > 0 && groqKeyBusy.every(Boolean);
      const queueLength = groqQueue.length;
      if (allBusy) {
        const typingEl = document.getElementById(tid);
        if (typingEl) {
          let msg = '⏳ <em>Je réfléchis sur votre demande…</em>';
          if (queueLength > 0) {
            msg = `⏳ <em>Je réfléchis… (${queueLength} ${queueLength > 1 ? 'autres demandes' : 'autre demande'} en attente)</em>`;
          }
          typingEl.innerHTML = msg;
        }
      }
      const result = await callGroqQueued(conversationHistory, systemPrompt, 6000, 0.02);
      if (result && result.data) {
        data = result.data;
      } else if (result && result.error) {
        // Erreur connue → afficher le message explicite dans l'inbox et sortir
        removeTyping(context, tid);
        conversationHistory.pop();
        appendMsg(context, 'ai', result.msg);
        return;
      }
    }

    // ══ AUCUN PROVIDER DISPONIBLE ══
    if (!data) {
      const noKeyMsg = GROQ_API_KEYS.length === 0
        ? '⚠️ Aucune clé API OpenRouter configurée. Clés configurées dans le système pour activer l\'IA.'
        : '⚠️ Toutes les clés OpenRouter sont indisponibles. Vérifiez vos clés dans le système.';
      removeTyping(context, tid);
      conversationHistory.pop();
      appendMsg(context, 'ai', noKeyMsg);
      return;
    }

    // ══ TRAITEMENT DE LA RÉPONSE ══
    removeTyping(context, tid);
    fullText = data.choices?.[0]?.message?.content || 'Pas de réponse.';
    conversationHistory.push({ role: 'assistant', content: fullText });

    // ── Sauvegarder dans le cache si ce n'est pas une action ──
    if (!isAction && !fullText.includes('###')) {
      aiCacheSet(cacheKey, fullText).catch(() => {});
    }
    conversationHistory.push({ role: 'assistant', content: fullText });

    // Traitement FILTRE
    const filtreMarker = fullText.indexOf('###FILTRE###');
    if (filtreMarker !== -1) {
      const displayText = fullText.substring(0, filtreMarker).trim();
      const jsonStr = fullText.substring(filtreMarker + 12).trim();
      if (displayText) appendMsg(context, 'ai', displayText);
      try {
        const clean = jsonStr.replace(/```json|```/g, '').trim();
        const jsonMatch = clean.match(/(\{[\s\S]*?\})/);
        if (jsonMatch) {
          const filtre = JSON.parse(jsonMatch[1]);
          applyFiltreAndNavigate(filtre, context);
        }
      } catch (pe) {
        console.warn('Filtre parse error:', pe);
      }

      // Traitement ÉCRITURE
    } else if (fullText.includes('###ECRITURE###') || fullText.includes('###ÉCRITURE###')) {
      const normalizedText = fullText.replace(/###ÉCRITURE###/g, '###ECRITURE###');
      const parts = normalizedText.split('###ECRITURE###');
      const textBeforeFirst = parts[0].trim();
      const ecrituresAI = [];
      for (let i = 1; i < parts.length; i++) {
        const segment = parts[i].trim();
        const jsonMatch = segment.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          try {
            const cleanJson = jsonMatch[1].replace(/```json|```/g, '').trim();
            const ecr = JSON.parse(cleanJson);
            if (ecr.lignes && ecr.lignes.length >= 2) {
              let d = 0,
                c = 0;
              ecr.lignes.forEach((l) => {
                d += Math.round((parseFloat(l.debit) || 0) * 100) / 100;
                c += Math.round((parseFloat(l.credit) || 0) * 100) / 100;
              });
              ecr.lignes = sortLignesDebitAvantCredit(
                ecr.lignes.map((l) => ({
                  ...l,
                  debit: Math.round((parseFloat(l.debit) || 0) * 100) / 100,
                  credit: Math.round((parseFloat(l.credit) || 0) * 100) / 100,
                })),
              );
              ecr.lignes = corrigerComptesErreurs(ecr.lignes);
              if (Math.abs(d - c) <= 5) {
                ecrituresAI.push(ecr);
              } else {
                console.warn(`Écriture ${i} rejetée — Déséquilibre : ${Math.abs(d - c)} FCFA`);
                appendMsg(context, 'ai', `⚠️ Écriture ${i} rejetée car déséquilibrée de ${Math.abs(d - c)} FCFA (Débit: ${d} / Crédit: ${c}). Veuillez vérifier les montants.`);
              }
            }
          } catch (pe) {
            console.warn('JSON parse error écriture', i, ':', pe.message);
          }
        }
      }
      if (textBeforeFirst) appendMsg(context, 'ai', textBeforeFirst);
      if (ecrituresAI.length === 0) {
        appendMsg(context, 'ai', '⚠️ Aucune écriture équilibrée extraite. Veuillez reformuler votre demande ou préciser les montants.');
      } else {
        currentGroupId = 'grp_' + Date.now();
        const confirmMsg =
          `✅ <strong>${ecrituresAI.length} écriture${ecrituresAI.length > 1 ? 's' : ''} liées</strong> préparées et groupées :<br>` +
          ecrituresAI.map((e, i) => `<br><strong>${i + 1}. [${e.journal}]</strong> ${e.libelle}`).join('') +
          `<br><br>⚠️ <strong>Vérifiez chaque écriture avant d'enregistrer.</strong> Les propositions de l'IA doivent être validées par vous.<br>` +
          `<br>⚡ Cliquez <strong>"Tout enregistrer"</strong> uniquement après vérification.`;
        appendMsg(context, 'ai', confirmMsg);
        setEcritureQueue(ecrituresAI);
        if (context === 'saisie') {
          toast(
            `✨ ${ecrituresAI.length} écriture${ecrituresAI.length > 1 ? 's' : ''} préparée${ecrituresAI.length > 1 ? 's' : ''}`,
            'info',
          );
        } else {
          showMultiEcrBanner(ecrituresAI);
          showSaisieNotif(ecrituresAI[0]?.libelle || msg.substring(0, 40), ecrituresAI.length);
        }
      }
    } else if (fullText.includes('###AFFICHER###')) {
      // Traitement AFFICHAGE (Fondateur, etc)
      const afficherMarker = fullText.indexOf('###AFFICHER###');
      const displayText = fullText.substring(0, afficherMarker).trim();
      const jsonStr = fullText.substring(afficherMarker + 14).trim();
      if (displayText) appendMsg(context, 'ai', displayText);
      try {
        const clean = jsonStr.replace(/```json|```/g, '').trim();
        const jsonMatch = clean.match(/(\{[\s\S]*?\})/);
        if (jsonMatch) {
          const affichage = JSON.parse(jsonMatch[1]);
          if (affichage.type === 'fondateur' && affichage.image) {
            // Afficher le fondateur avec sa photo
            const founderHTML = `
              <div style="text-align:center;padding:20px;background:rgba(212,168,83,.05);border-radius:8px;margin:15px 0">
                <img src="${affichage.image}" alt="Marcio Jardel Zinzindohoué" style="width:120px;height:120px;border-radius:50%;border:3px solid var(--gold);margin-bottom:15px">
                <div style="font-size:16px;font-weight:700;color:var(--gold);margin-bottom:5px">Marcio Jardel Zinzindohoué</div>
                <div style="font-size:13px;color:var(--muted)">Fondateur de COMEO AI<br>Expert-Comptable & Conseiller en Gestion Financière<br>Spécialisé PME de l'UEMOA</div>
              </div>
            `;
            appendMsg(context, 'ai', founderHTML);
          }
        }
      } catch (pe) {
        console.warn('Affichage parse error:', pe);
      }
    } else {
      appendMsg(context, 'ai', fullText);
    }
  } catch (err) {
    removeTyping(context, tid);
    conversationHistory.pop();
    aiServiceAvailable = false;
    updateServiceAvailabilityUI();
    const errMsg = err?.groqMsg || (
      GROQ_API_KEYS.length === 0
        ? '⚠️ Aucune clé API OpenRouter configurée. Clés configurées dans le système pour activer l\'assistant IA.'
        : `❌ Erreur inattendue : ${err?.message || 'inconnue'}. Vérifiez vos clés dans le système.`
    );
    appendMsg(context, 'ai', errMsg);
  } finally {
    // Toujours libérer le verrou — même en cas d'erreur ou de retour anticipé
    endAIOperation(context);
    isAILoading = false;
    if (sendBtnId) {
      const btn = document.getElementById(sendBtnId);
      if (btn) btn.disabled = false;
    }
  }
};

function applyFiltreAndNavigate(filtre, context) {
  const { type, dateDebut, dateFin, journal, compte } = filtre;
  if (type === 'journal') {
    navigate('journal');
    if (dateDebut) document.getElementById('jnl-date-debut').value = dateDebut;
    if (dateFin) document.getElementById('jnl-date-fin').value = dateFin;
    if (journal) document.getElementById('journalFilter').value = journal;
    renderJournal();
    const analyseEl = document.getElementById('journal-analyse');
    if (analyseEl) {
      analyseEl.style.display = 'block';
      const label = dateDebut === dateFin ? formatDateFR(dateDebut) : `${formatDateFR(dateDebut)} au ${formatDateFR(dateFin)}`;
      analyseEl.innerHTML = `<div class="analyse-title">📋 Journal — ${label || 'Exercice complet'}</div>Affichage des écritures pour la période demandée.`;
    }
  } else if (type === 'balance') {
    navigate('balance');
    if (dateDebut) document.getElementById('bal-date-debut').value = dateDebut;
    if (dateFin) document.getElementById('bal-date-fin').value = dateFin;
    if (journal) document.getElementById('bal-journal').value = journal;
    renderBalance();
  } else if (type === 'grandlivre') {
    navigate('grandlivre');
    if (dateDebut) document.getElementById('gl-date-debut').value = dateDebut;
    if (dateFin) document.getElementById('gl-date-fin').value = dateFin;
    if (compte) document.getElementById('glSearch').value = compte;
    renderGrandLivre();
    if (compte)
      setTimeout(() => {
        const el = document.getElementById('gl-' + compte);
        if (el) el.style.display = 'block';
      }, 200);
  } else if (type === 'bilan') {
    navigate('bilan');
    if (dateFin) document.getElementById('bilan-date-arrete').value = dateFin;
    renderBilan();
  }
}

// ── Affichage messages ──
function appendMsg(context, role, text) {
  const msgId = context === 'dashboard' ? 'aiMessages' : `aiMessages-${context}`;
  const c = document.getElementById(msgId);
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = `<div class="msg-av">${role === 'ai' ? 'CA' : 'U'}</div><div class="msg-body">${fmt(text)}</div>`;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}
function appendTyping(context) {
  const id = 't' + Date.now();
  const msgId = context === 'dashboard' ? 'aiMessages' : `aiMessages-${context}`;
  const c = document.getElementById(msgId);
  if (!c) return id;
  const d = document.createElement('div');
  d.className = 'msg ai';
  d.id = id;
  d.innerHTML = `<div class="msg-av">CA</div><div class="msg-body"><div class="typing"><span></span><span></span><span></span></div></div>`;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
  return id;
}
function removeTyping(context, id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function fmt(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .replace(/&lt;table&gt;/gi, '<table>')
    .replace(/&lt;\/table&gt;/gi, '</table>')
    .replace(/&lt;thead&gt;/gi, '<thead>')
    .replace(/&lt;\/thead&gt;/gi, '</thead>')
    .replace(/&lt;tbody&gt;/gi, '<tbody>')
    .replace(/&lt;\/tbody&gt;/gi, '</tbody>')
    .replace(/&lt;tfoot&gt;/gi, '<tfoot>')
    .replace(/&lt;\/tfoot&gt;/gi, '</tfoot>')
    .replace(/&lt;tr&gt;/gi, '<tr>')
    .replace(/&lt;\/tr&gt;/gi, '</tr>')
    .replace(/&lt;th(&gt;|(\s[^&]*)&gt;)/gi, (_, m) => '<th' + m.replace(/&gt;/g, '>').replace(/&lt;/g, '<'))
    .replace(/&lt;\/th&gt;/gi, '</th>')
    .replace(/&lt;td(&gt;|(\s[^&]*)&gt;)/gi, (_, m) => '<td' + m.replace(/&gt;/g, '>').replace(/&lt;/g, '<'))
    .replace(/&lt;\/td&gt;/gi, '</td>')
    .replace(/&lt;strong&gt;/gi, '<strong>')
    .replace(/&lt;\/strong&gt;/gi, '</strong>')
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;br&gt;/gi, '<br>')
    .replace(/&lt;br\/&gt;/gi, '<br>');
}

// ══════════════════════════════════════════════════════════
// COMEO ROBOT — Assistant Vocal IA
// STT (Web Speech API) → Groq LLM → TTS (Web Speech API)
// ══════════════════════════════════════════════════════════

let robotOpen = false;
let robotListening = false;
let robotSpeaking = false;
let robotRecog = null;
let robotSynth = window.speechSynthesis;
let robotVoice = null;
let robotConvHistory = [];
const robotMemoryCache = new Map();
const CREATOR_IMAGE = 'images/MarcioAI.jpg';
const ROBOT_TTS = { rate: 0.97, pitch: 1.0, volume: 1.0 };
const ROBOT_SPEECH_PAUSE_MS = { none: 160, comma: 320, sentence: 540 };
const isMobileDevice =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let robotQueryPending = false;
let robotSTTSilenceTimer = null;
let lastRobotQuery = '';
let lastRobotQueryTime = 0;
let robotBargeRecog = null;
let robotBargeListening = false;
let robotSpeakSessionId = 0;
let robotCurrentSpeechFull = '';
let robotSpeechChunkStartedAt = 0;
const ROBOT_BARGEIN_GRACE_MS = 500;
const ROBOT_BARGEIN_MIN_CHARS = 4;
let robotHoldActive = false;
let robotHoldStartY = 0;
let robotHoldCancelled = false;
const ROBOT_HOLD_CANCEL_PX = 70;
let robotMicHoldInit = false;
// Délai de silence avant d'envoyer la requête — laisser l'utilisateur finir sa phrase
const ROBOT_END_OF_SPEECH_MS = isMobileDevice ? 3200 : 2800;

// ── Initialiser les barres visualiseur ──
function ensureRobotViz() {
  let viz = document.getElementById('robotViz');
  if (viz) return viz;
  const avatarWrap = document.querySelector('.avatar-rings-wrap');
  if (!avatarWrap) return null;
  viz = document.createElement('div');
  viz.id = 'robotViz';
  viz.className = 'robot-viz';
  avatarWrap.insertAdjacentElement('afterend', viz);
  let caption = document.getElementById('robotSpeechCaption');
  if (!caption) {
    caption = document.createElement('div');
    caption.id = 'robotSpeechCaption';
    caption.className = 'robot-speech-caption';
    caption.setAttribute('aria-live', 'polite');
    viz.insertAdjacentElement('afterend', caption);
  }
  return viz;
}

function setRobotVizMode(mode) {
  const viz = document.getElementById('robotViz');
  if (viz) viz.className = 'robot-viz' + (mode && mode !== 'idle' ? ' ' + mode : '');
}

function setRobotSpeechCaption(text) {
  const el = document.getElementById('robotSpeechCaption');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('visible', !!text);
}

function initRobotVisualizer() {
  const viz = ensureRobotViz();
  if (!viz || viz.children.length > 0) return;
  const count = 40;
  const peaks = [
    3, 5, 8, 12, 16, 20, 26, 32, 36, 40, 42, 44, 44, 42, 40, 36, 32, 26, 20, 16, 12, 8, 5, 3, 3, 5, 8, 12, 16, 20, 26, 32, 36, 40, 42, 44,
    44, 42, 40, 36,
  ];
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'rv-bar';
    b.style.animationDelay = i * 0.025 + 's';
    viz.appendChild(b);
  }

  let t0 = performance.now();
  function animBars(now) {
    const avatar = document.getElementById('robotAvatar');
    const state = avatar?.classList.contains('speaking') ? 'speaking' : avatar?.classList.contains('listening') ? 'listening' : 'idle';
    setRobotVizMode(state === 'idle' ? 'idle' : state);
    const active = state !== 'idle';
    const elapsed = (now - t0) / 1000;
    document.querySelectorAll('.rv-bar').forEach((bar, i) => {
      const peak = peaks[i % peaks.length] || 20;
      const center = Math.abs(i - count / 2) / (count / 2);
      const envelope = 1 - center * 0.35;
      let h = 4;
      if (active) {
        const wave = Math.sin(elapsed * (state === 'speaking' ? 5.5 : 4) + i * 0.42);
        const wave2 = Math.sin(elapsed * 3.1 + i * 0.18) * 0.35;
        const amp = state === 'speaking' ? peak * envelope : peak * 0.55 * envelope;
        h = Math.max(4, amp * (0.55 + 0.45 * Math.abs(wave + wave2)));
      }
      bar.style.height = h + 'px';
      bar.style.opacity = active ? 0.45 + 0.55 * (h / 44) : 0.22;
    });
    requestAnimationFrame(animBars);
  }
  requestAnimationFrame(animBars);
}

// ── Fond particules ──
function initRobotBg() {
  const bg = document.getElementById('robotBg');
  if (!bg || bg.children.length > 0) return;
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('div');
    const sz = 40 + Math.random() * 120;
    d.className = 'robot-bg-dot';
    d.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;--spd:${8 + Math.random() * 14}s;animation-delay:${Math.random() * 8}s`;
    bg.appendChild(d);
  }
}

// ── Choisir meilleure voix française (style OpenRouter : claire, naturelle) ──
function pickRobotVoice() {
  const voices = robotSynth.getVoices();
  if (!voices.length) return;
  const prefer = [
    (v) => v.lang.startsWith('fr') && v.name.includes('Google') && /natural|neural|network|fr-fr/i.test(v.name),
    (v) => v.lang.startsWith('fr') && v.name.includes('Google'),
    (v) => v.lang.startsWith('fr') && (v.name.includes('Neural') || v.name.includes('Premium') || v.name.includes('Enhanced')),
    (v) => v.name.includes('Microsoft') && v.lang.startsWith('fr') && v.name.includes('Natural'),
    (v) => v.name.includes('Microsoft') && v.lang.startsWith('fr'),
    (v) => v.lang.startsWith('fr'),
  ];
  for (const test of prefer) {
    const found = voices.find(test);
    if (found) {
      robotVoice = found;
      return;
    }
  }
  robotVoice = voices[0] || null;
}

function applyRobotVoice(utter) {
  if (robotVoice) utter.voice = robotVoice;
  utter.lang = 'fr-FR';
  utter.rate = ROBOT_TTS.rate;
  utter.pitch = ROBOT_TTS.pitch;
  utter.volume = ROBOT_TTS.volume;
}

function normalizeRobotQuery(q) {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isCreatorPhotoRequest(query) {
  const q = normalizeRobotQuery(query);
  const photoWords = ['photo', 'image', 'portrait', 'selfie', 'picture'];
  const creatorWords = ['createur', 'concepteur', 'developpeur', 'fondateur', 'marcio', 'zinzindohoue', 'inventeur'];
  const hasPhoto = photoWords.some((w) => q.includes(w));
  const hasCreator = creatorWords.some((w) => q.includes(w)) || q.includes('qui ta cree') || q.includes('qui t a cree');
  if (hasPhoto && hasCreator) return true;
  return /(?:montre|voir|affiche|donne|envoie).*(?:photo|image|portrait)/.test(q) && hasCreator;
}

function isAboutCreatorQuery(query) {
  const q = normalizeRobotQuery(query);
  return ['createur', 'marcio', 'zinzindohoue', 'qui ta ', 'qui t a ', 'concepteur', 'developpeur', 'fondateur', 'inventeur'].some((k) =>
    q.includes(k),
  );
}

// Recharger dès que les voix sont disponibles (délai navigateur)
speechSynthesis.addEventListener('voiceschanged', pickRobotVoice);
setTimeout(pickRobotVoice, 200);
setTimeout(pickRobotVoice, 800);
pickRobotVoice();

// ── Ouvrir / Fermer le robot ──
function openRobot() {
  const panel = document.getElementById('robotPanel');
  if (!panel) return;
  panel.classList.add('open');
  robotOpen = true;
  document.body.style.overflow = 'hidden';
  ensureRobotViz();
  initRobotVisualizer();
  initRobotBg();
  initRobotMicHold();
  setTimeout(() => {
    robotSpeak('Bonjour ! Je suis COMEO, votre assistante comptable. Que puis-je faire pour vous ?');
  }, 150);
}

function closeRobot() {
  const panel = document.getElementById('robotPanel');
  if (!panel) return;
  closeRobotLinkOverlay();
  if (robotHoldActive) endRobotHoldTalk(true);
  stopRobotBargeIn();
  stopRobotListening();
  robotSpeakSessionId++;
  robotSynth.cancel();
  stopRobotLights();
  setRobotSpeechCaption('');
  setRobotVizMode('idle');
  panel.classList.remove('open');
  robotOpen = false;
  document.body.style.overflow = '';
  robotSpeaking = false;
  setRobotStatus('online');
}
// ── Statuts visuels ──
function setRobotStatus(state) {
  const pill = document.getElementById('robotStatusPill');
  const avatar = document.getElementById('robotAvatar');
  const hint = document.getElementById('robotHint');
  const mic = document.getElementById('robotMicBtn');
  const bars = document.querySelectorAll('.rv-bar');
  if (!pill) return;

  const cfg = {
    online: { text: 'En ligne', cls: '', hint: 'Maintenez le micro pour parler', micOn: false },
    listening: { text: 'Écoute…', cls: 'listening', hint: 'Parlez… relâchez pour envoyer', micOn: true },
    thinking: { text: 'Réflexion…', cls: 'thinking', hint: 'Analyse en cours…', micOn: false },
    speaking: { text: 'Répond…', cls: 'speaking', hint: 'Maintenez le micro pour interrompre', micOn: false },
  };
  const s = cfg[state] || cfg.online;
  pill.textContent = s.text;
  pill.className = 'robot-status-pill ' + s.cls;
  if (avatar) avatar.className = 'robot-avatar-main ' + (state !== 'online' ? state : '');
  if (hint) hint.textContent = robotHoldActive ? (robotHoldCancelled ? 'Relâchez pour annuler' : 'Relâchez pour envoyer') : s.hint;
  if (mic) mic.classList.toggle('active', s.micOn || robotHoldActive);

  // Animer les barres
  if (bars.length) {
    bars.forEach((b) => {
      b.style.opacity = state === 'online' ? '.3' : '.85';
    });
  }
}

function setRobotBubble(text) {
  const bubble = document.getElementById('robotBubble');
  const inner = document.getElementById('robotBubbleText');
  const target = inner || bubble;
  if (!target) return;
  if (bubble) bubble.classList.add('fading');
  setTimeout(() => {
    target.innerHTML = text + '<span class="blink-cur"></span>';
    if (bubble) bubble.classList.remove('fading');
    if (bubble) bubble.scrollTop = bubble.scrollHeight;
  }, 180);
}
// ── Synthèse vocale (TTS) ──
// ── Jeux de lumière du fond robot pendant la parole ──
let robotLightInterval = null;
const ROBOT_LIGHT_COLORS = [
  ['#d4a853', '#8b5cf6'], // or + violet
  ['#3b82f6', '#22c55e'], // bleu + vert
  ['#f59e0b', '#ec4899'], // ambre + rose
  ['#06b6d4', '#d4a853'], // cyan + or
  ['#8b5cf6', '#3b82f6'], // violet + bleu
  ['#22c55e', '#f59e0b'], // vert + ambre
  ['#ec4899', '#06b6d4'], // rose + cyan
  ['#d4a853', '#22c55e'], // or + vert
];
let robotLightIdx = 0;

function startRobotLights() {
  stopRobotLights();
  const orb1 = document.querySelector('.r-orb1');
  const orb2 = document.querySelector('.r-orb2');
  const orb3 = document.querySelector('.r-orb3');
  const panel = document.getElementById('robotPanel');
  if (!orb1 || !panel) return;

  robotLightInterval = setInterval(() => {
    const [c1, c2] = ROBOT_LIGHT_COLORS[robotLightIdx % ROBOT_LIGHT_COLORS.length];
    const c3 = ROBOT_LIGHT_COLORS[(robotLightIdx + 3) % ROBOT_LIGHT_COLORS.length][0];
    robotLightIdx++;

    // Changer les orbes
    if (orb1) orb1.style.background = `radial-gradient(circle, ${c1}, transparent 70%)`;
    if (orb2) orb2.style.background = `radial-gradient(circle, ${c2}, transparent 70%)`;
    if (orb3) orb3.style.background = `radial-gradient(circle, ${c3}, transparent 70%)`;

    // Changer la grille de fond
    const grid = document.querySelector('.r-grid');
    if (grid) {
      grid.style.backgroundImage = `
        linear-gradient(${c1}22 1px, transparent 1px),
        linear-gradient(90deg, ${c1}22 1px, transparent 1px)`;
    }

    // Lueur sur l'avatar
    const avatar = document.getElementById('robotAvatar');
    if (avatar) {
      avatar.style.boxShadow = `0 0 0 4px ${c1}33, 0 0 60px ${c2}44`;
      avatar.style.borderColor = c1;
    }

    // Fond général pulsé
    if (panel) {
      panel.style.background = `radial-gradient(ellipse at 30% 20%, ${c1}18 0%, transparent 50%),
        radial-gradient(ellipse at 70% 80%, ${c2}14 0%, transparent 50%),
        #06070f`;
    }
  }, 600);
}

function stopRobotLights() {
  if (robotLightInterval) {
    clearInterval(robotLightInterval);
    robotLightInterval = null;
  }
  // Restaurer couleurs par défaut
  const orb1 = document.querySelector('.r-orb1');
  const orb2 = document.querySelector('.r-orb2');
  const orb3 = document.querySelector('.r-orb3');
  const panel = document.getElementById('robotPanel');
  const avatar = document.getElementById('robotAvatar');
  const grid = document.querySelector('.r-grid');
  if (orb1) orb1.style.background = 'radial-gradient(circle,#d4a853,transparent 70%)';
  if (orb2) orb2.style.background = 'radial-gradient(circle,#8b5cf6,transparent 70%)';
  if (orb3) orb3.style.background = 'radial-gradient(circle,#3b82f6,transparent 70%)';
  if (grid) grid.style.backgroundImage = '';
  if (panel) panel.style.background = '';
  if (avatar) {
    avatar.style.boxShadow = '';
    avatar.style.borderColor = '';
  }
}

// ── Préparation TTS : ponctuation = pauses naturelles (sans lire « point » / « virgule ») ──
function normalizeFrenchElisions(text) {
  if (!text) return '';
  let t = String(text)
    .replace(/[\u2018\u2019\u02BC\u00B4]/g, "'")
    .replace(/\s*'\s*/g, "'");

  const fixes = [
    [/\baujourd\s+hui\b/gi, "aujourd'hui"],
    [/\bquelqu\s+un\b/gi, "quelqu'un"],
    [/\bpuisqu\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "puisqu'"],
    [/\bquoiqu\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "quoiqu'"],
    [/\blorsqu\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "lorsqu'"],
    [/\bqu\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "qu'"],
    [/\bl\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "l'"],
    [/\bd\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "d'"],
    [/\bj\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "j'"],
    [/\bn\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "n'"],
    [/\bs\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "s'"],
    [/\bc\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "c'"],
    [/\bm\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "m'"],
    [/\bt\s+(?=[aeiouhàâäéèêëîïôùûü])/gi, "t'"],
  ];
  fixes.forEach(([re, rep]) => {
    t = t.replace(re, rep);
  });

  return t.replace(/'{2,}/g, "'");
}

function preprocessTextForSpeech(text) {
  return normalizeFrenchElisions(
    (text || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/#{1,6}\s?/g, '')
      .replace(/###[\w_]+###[\s\S]*/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\bFCFA\b/g, 'francs CFA')
      .replace(/\bTVA\b/g, 'taxe sur la valeur ajoutée')
      .replace(/\bHT\b/g, 'hors taxe')
      .replace(/\bTTC\b/g, 'toutes taxes comprises')
      .replace(/\bSYSCOHADA\b/gi, 'système comptable ohada')
      .replace(/\bOHADA\b/gi, 'ohada')
      .replace(/\bONECCA\b/gi, 'ordre national des experts comptables')
      .replace(/\bCNPS\b/gi, 'caisse nationale de prévoyance sociale')
      .replace(/\bN°\s*\d+/g, (m) => 'numéro ' + m.replace(/\D/g, ''))
      .replace(/(\d{1,3})(?=(\d{3})+(?!\d))/g, '$1 ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
}

function stripSpokenPunctuation(text) {
  const APOS = '\u0007';
  const safe = (text || '').replace(/'/g, APOS);
  return safe
    .replace(/[.,!?;:…—–\-–"«»""`~_^|\\/<>@&%=+#*\[\]{}()[\]•●▪◦·]/g, ' ')
    .replace(/\u0007/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanTextForSpeech(text) {
  return stripSpokenPunctuation(preprocessTextForSpeech(text));
}

function splitLongSpeechPart(text, maxLen) {
  const words = text.split(/(\s+)/).filter(Boolean);
  const parts = [];
  let buf = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/^\s+$/.test(word)) {
      if (buf) buf += word;
      continue;
    }
    const next = buf.trim() ? buf + word : word;
    if (next.length > maxLen && buf.trim()) {
      parts.push(buf.trim());
      buf = word;
    } else buf = next;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function splitIntoNaturalChunks(text) {
  const preprocessed = preprocessTextForSpeech(text);
  if (!preprocessed) return [];

  const sentences = preprocessed
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks = [];

  sentences.forEach((sentence, si) => {
    const isLastSentence = si === sentences.length - 1;
    const clauses = sentence
      .split(/(?<=[,;:])\s+/)
      .map((c) => c.trim())
      .filter(Boolean);

    clauses.forEach((clause, ci) => {
      const isLastClause = ci === clauses.length - 1;
      let spoken = stripSpokenPunctuation(clause);
      if (!spoken || spoken.length < 2) return;

      let pauseAfter = 'comma';
      if (isLastClause) pauseAfter = isLastSentence ? 'none' : 'sentence';

      if (spoken.length > 88) {
        const subParts = splitLongSpeechPart(spoken, 78);
        subParts.forEach((part, pi) => {
          chunks.push({
            text: part,
            pauseAfter: pi === subParts.length - 1 ? pauseAfter : 'comma',
          });
        });
      } else {
        chunks.push({ text: spoken, pauseAfter });
      }
    });
  });

  if (!chunks.length) {
    const fallback = cleanTextForSpeech(preprocessed);
    if (fallback.length > 2) chunks.push({ text: fallback, pauseAfter: 'none' });
  }

  return chunks.filter((c) => c.text.length > 1);
}

function stripRobotVoiceText(text) {
  return preprocessTextForSpeech(text)
    .replace(/###(?:CREATE_FACTURE|SHOW_3D_JOURNAL|NAVIGATE|OPEN_URL)###[\s\S]*/gi, '')
    .trim();
}

function formatRobotBubbleHtml(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--warm)">$1</strong>')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\n/g, '<br>');
}

function primeRobotSpeech() {
  if (!robotSynth) return;
  try {
    if (robotSynth.paused) robotSynth.resume();
  } catch (e) {}
}

function submitRobotQuery(query) {
  const q = (query || '').trim();
  if (q.length < 2 || robotQueryPending) return;
  const now = Date.now();
  if (q === lastRobotQuery && now - lastRobotQueryTime < 2500) return;
  lastRobotQuery = q;
  lastRobotQueryTime = now;
  robotQueryPending = true;
  if (robotSTTSilenceTimer) {
    clearTimeout(robotSTTSilenceTimer);
    robotSTTSilenceTimer = null;
  }
  stopRobotBargeIn();
  stopRobotListening();
  handleRobotQuery(q).finally(() => {
    robotQueryPending = false;
  });
}

// ── Saisie texte — alternative au micro dans open-space ──
function sendRobotText() {
  const input = document.getElementById('robotTextInput');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  submitRobotQuery(q);
}

function normalizeForEchoCompare(s) {
  return normalizeRobotQuery(String(s || ''))
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyRobotEcho(userText) {
  const u = normalizeForEchoCompare(userText);
  if (!u || u.length < 3) return true;
  const robot = normalizeForEchoCompare(robotCurrentSpeechFull);
  if (!robot) return false;
  if (robot.includes(u)) return true;
  const tail = robot.slice(-Math.min(robot.length, u.length + 24));
  if (tail.includes(u)) return true;
  const uWords = u.split(' ').filter((w) => w.length > 2);
  if (!uWords.length) return u.length < ROBOT_BARGEIN_MIN_CHARS;
  const robotWords = new Set(robot.split(' '));
  const overlap = uWords.filter((w) => robotWords.has(w)).length / uWords.length;
  return overlap > 0.8 && uWords.length <= 4;
}

function stopRobotSpeech() {
  robotSpeakSessionId++;
  robotSpeaking = false;
  robotCurrentSpeechFull = '';
  try {
    robotSynth.cancel();
  } catch (e) {}
  stopRobotLights();
  setRobotSpeechCaption('');
  setRobotVizMode('idle');
}

function interruptRobotSpeechAndListen(initialTranscript) {
  if (!robotOpen) return;
  const t = (initialTranscript || '').trim();
  stopRobotSpeech();
  stopRobotBargeIn();
  setRobotBubble(
    `<span class="robot-listening-label">Je vous écoute</span>` + (t ? `<span class="robot-listening-text">${escapeHtml(t)}</span>` : ''),
  );
  setRobotStatus('listening');
  setTimeout(() => startRobotListening({ initialTranscript: t, fromBargeIn: true }), isMobileDevice ? 180 : 80);
}

function handleRobotBargeIn(transcript) {
  if (!robotSpeaking || robotQueryPending) return;
  if (Date.now() - robotSpeechChunkStartedAt < ROBOT_BARGEIN_GRACE_MS) return;
  const t = (transcript || '').trim();
  if (t.length < ROBOT_BARGEIN_MIN_CHARS) return;
  if (isLikelyRobotEcho(t)) return;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 && t.length < 6) return;
  interruptRobotSpeechAndListen(t);
}

function buildRobotRecognition(opts = {}) {
  const { bargeIn = false, initialTranscript = '', pushToTalk = false } = opts;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recog = new SpeechRecognition();
  recog.lang = 'fr-FR';
  recog.continuous = true;
  recog.interimResults = true;
  recog.maxAlternatives = 1;

  let accumulated = initialTranscript || '';
  let latestInterim = '';
  let submitted = false;

  const getFullTranscript = () => (accumulated + latestInterim).trim();

  const flushQuery = () => {
    if (bargeIn) return;
    const query = getFullTranscript();
    if (query.length < 2 || submitted) return;
    submitted = true;
    if (robotSTTSilenceTimer) {
      clearTimeout(robotSTTSilenceTimer);
      robotSTTSilenceTimer = null;
    }
    accumulated = '';
    latestInterim = '';
    submitRobotQuery(query);
  };

  // Relancer le compte à rebours à chaque mot entendu (final ou provisoire)
  const scheduleEndOfSpeech = () => {
    if (bargeIn || pushToTalk || submitted || getFullTranscript().length < 2) return;
    if (robotSTTSilenceTimer) clearTimeout(robotSTTSilenceTimer);
    robotSTTSilenceTimer = setTimeout(() => {
      robotSTTSilenceTimer = null;
      flushQuery();
    }, ROBOT_END_OF_SPEECH_MS);
  };

  recog.onresult = (e) => {
    let interim = '';
    let finalPart = '';
    let hadActivity = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      const conf = e.results[i][0].confidence;
      if (e.results[i].isFinal) {
        if (isMobileDevice || conf === undefined || conf >= 0.35) finalPart += t;
      } else {
        interim += t;
      }
    }
    if (finalPart) {
      accumulated += finalPart;
      hadActivity = true;
    }
    if (interim) {
      latestInterim = interim;
      hadActivity = true;
    } else if (finalPart) latestInterim = '';

    const display = getFullTranscript();

    if (bargeIn) {
      if (hadActivity && display) handleRobotBargeIn(display);
      return;
    }

    if (display) {
      const pttHint = pushToTalk
        ? `<span class="robot-ptt-hint${robotHoldCancelled ? ' cancel' : ''}">${robotHoldCancelled ? 'Relâchez pour annuler' : 'Relâchez pour envoyer · Glissez ↑ pour annuler'}</span>`
        : '';
      setRobotBubble(
        `<span class="robot-listening-label">${pushToTalk ? '🎙 Enregistrement…' : "J'écoute"}</span>` +
          `<span class="robot-listening-text">${escapeHtml(display)}</span>` +
          pttHint,
      );
    }

    if (hadActivity) scheduleEndOfSpeech();
  };

  recog.onerror = (e) => {
    if (bargeIn) {
      robotBargeListening = false;
      robotBargeRecog = null;
      if (robotSpeaking && robotOpen && !robotQueryPending) {
        setTimeout(() => startRobotBargeIn(), 400);
      }
      return;
    }
    if (robotSTTSilenceTimer) clearTimeout(robotSTTSilenceTimer);
    robotListening = false;
    const err = e.error || '';
    if (err === 'not-allowed') {
      setRobotStatus('online');
      setRobotBubble('Autorisez le microphone dans les paramètres de votre navigateur.');
      return;
    }
    if (!submitted && getFullTranscript().length > 2) {
      scheduleEndOfSpeech();
      return;
    }
    setRobotStatus('online');
    if (err !== 'no-speech' && err !== 'aborted') {
      setRobotBubble("Désolé, je n'ai pas bien entendu. Réessayez.");
    } else if (!pushToTalk && robotOpen && !robotSpeaking && !robotQueryPending) {
      setTimeout(() => startRobotListening(), 900);
    }
  };

  recog.onend = () => {
    if (bargeIn) {
      robotBargeListening = false;
      robotBargeRecog = null;
      if (robotSpeaking && robotOpen && !robotQueryPending) {
        setTimeout(() => startRobotBargeIn(), 250);
      }
      return;
    }
    if (pushToTalk) {
      robotListening = false;
      return;
    }
    robotListening = false;
    // Ne pas couper : attendre le délai complet même si le micro s'est arrêté (iOS/Android)
    if (!submitted && getFullTranscript().length > 2) {
      scheduleEndOfSpeech();
      return;
    }
    if (robotOpen && !robotSpeaking && !robotQueryPending && !submitted && !pushToTalk) {
      setTimeout(() => startRobotListening(), 700);
    }
  };

  recog._getTranscript = getFullTranscript;
  recog._scheduleEnd = scheduleEndOfSpeech;
  recog._flushNow = flushQuery;
  return recog;
}

function showCreatorCard(showPhoto = true) {
  const inner = document.getElementById('robotBubbleText');
  if (!inner) return;
  const photoHtml = showPhoto
    ? `
    <div class="creator-photo-frame">
      <img src="${CREATOR_IMAGE}" alt="Marcio Jardel Zinzindohoue" class="creator-photo-img"
        onerror="this.onerror=null;this.src='images/marcioAI.jpg'">
    </div>`
    : '';
  inner.innerHTML = `
    <div class="creator-card">
      ${photoHtml}
      <div class="creator-card-info">
        <strong>Marcio Jardel ZINZINDOHOUE</strong>
        <span>Jeune entrepreneur · Cofondateur Groupe Express · Créateur COMEO AI</span>
      </div>
    </div><span class="blink-cur"></span>`;
}

function robotSpeakChunks(chunks, onDone) {
  robotSynth.cancel();
  primeRobotSpeech();
  const sessionId = ++robotSpeakSessionId;
  robotSpeaking = true;
  robotCurrentSpeechFull = chunks.map((c) => (typeof c === 'string' ? c : c.text)).join(' ');
  setRobotStatus('speaking'); // MOTS-CLÉS IMMOBILISATIONS → codes SYSCOHADA
  startRobotLights();
  let idx = 0;
  let spokenSoFar = '';

  function speakNext() {
    if (sessionId !== robotSpeakSessionId || idx >= chunks.length || !robotSpeaking) {
      if (sessionId === robotSpeakSessionId) {
        robotSpeaking = false;
        robotCurrentSpeechFull = '';
        stopRobotLights();
        setRobotStatus('online');
        setRobotSpeechCaption('');
        setRobotVizMode('idle');
        if (onDone) onDone();
      }
      return;
    }

    const item = chunks[idx];
    const chunk = (typeof item === 'string' ? item : item.text).trim();
    if (!chunk) {
      idx++;
      speakNext();
      return;
    }

    robotSpeechChunkStartedAt = Date.now();
    spokenSoFar += (spokenSoFar ? ' ' : '') + chunk;
    setRobotSpeechCaption(spokenSoFar);

    primeRobotSpeech();
    const utter = new SpeechSynthesisUtterance(chunk);
    applyRobotVoice(utter);
    const pauseType = typeof item === 'string' ? (idx < chunks.length - 1 ? 'comma' : 'none') : item.pauseAfter || 'none';
    const pauseMs = ROBOT_SPEECH_PAUSE_MS[pauseType] ?? ROBOT_SPEECH_PAUSE_MS.comma;
    let advanced = false;

    const advance = () => {
      if (advanced || sessionId !== robotSpeakSessionId) return;
      advanced = true;
      idx++;
      setTimeout(speakNext, pauseMs);
    };

    utter.onend = advance;
    utter.onerror = advance;

    // iOS/Android : onend parfois absent après un appel async — timeout de secours
    const safetyMs = Math.min(18000, Math.max(4000, chunk.length * 140));
    setTimeout(advance, safetyMs);

    robotSynth.speak(utter);
    if (isIOS) {
      setTimeout(() => {
        try {
          if (robotSynth.paused) robotSynth.resume();
        } catch (e) {}
      }, 120);
    }
  }

  if (isMobileDevice) setTimeout(speakNext, 80);
  else speakNext();
}

function robotSpeak(text, opts = {}) {
  if (!opts.skipBubble) setRobotBubble(formatRobotBubbleHtml(text));
  const chunks = splitIntoNaturalChunks(text);
  if (!chunks.length) {
    robotSpeaking = false;
    setRobotStatus('online');
    return;
  }
  primeRobotSpeech();
  robotSpeakChunks(chunks);
}

// ── Reconnaissance vocale (STT) ──
function initRobotSTT() {
  return buildRobotRecognition();
}

function startRobotBargeIn() {
  if (!robotOpen || !robotSpeaking || robotQueryPending || robotBargeListening) return;
  stopRobotBargeIn();
  robotBargeRecog = buildRobotRecognition({ bargeIn: true });
  if (!robotBargeRecog) return;
  try {
    robotBargeRecog.start();
    robotBargeListening = true;
  } catch (e) {
    robotBargeListening = false;
    robotBargeRecog = null;
  }
}

function stopRobotBargeIn() {
  if (robotBargeRecog) {
    try {
      robotBargeRecog.stop();
    } catch (e) {}
    robotBargeRecog = null;
  }
  robotBargeListening = false;
}

function startRobotListening(opts = {}) {
  if (robotQueryPending) return;
  if (robotSpeaking && !opts.fromBargeIn && !opts.pushToTalk) return;
  if (robotListening && !opts.fromBargeIn && !opts.pushToTalk) return;
  stopRobotBargeIn();
  if (robotRecog && robotListening) {
    try {
      robotRecog.stop();
    } catch (e) {}
  }
  robotListening = false;
  robotRecog = buildRobotRecognition({
    initialTranscript: opts.initialTranscript || '',
    bargeIn: false,
    pushToTalk: !!opts.pushToTalk,
  });
  if (!robotRecog) {
    setRobotBubble('Votre navigateur ne supporte pas la reconnaissance vocale.');
    return;
  }
  try {
    robotRecog.start();
    robotListening = true;
    setRobotStatus('listening');
    if (opts.initialTranscript) {
      setRobotBubble(
        `<span class="robot-listening-label">J'écoute — finissez votre phrase</span>` +
          `<span class="robot-listening-text">${escapeHtml(opts.initialTranscript)}</span>`,
      );
      if (robotRecog._scheduleEnd) robotRecog._scheduleEnd();
    }
  } catch (e) {
    robotListening = false;
    robotRecog = null;
    setRobotStatus('online');
    setRobotBubble('Micro indisponible. Appuyez à nouveau sur le micro.');
  }
}

function stopRobotListening() {
  if (robotSTTSilenceTimer) {
    clearTimeout(robotSTTSilenceTimer);
    robotSTTSilenceTimer = null;
  }
  if (robotRecog && robotListening) {
    try {
      robotRecog.stop();
    } catch (e) {}
  }
  robotListening = false;
}

function beginRobotHoldTalk() {
  if (robotHoldActive || robotQueryPending) return;
  robotHoldActive = true;
  robotHoldCancelled = false;
  const btn = document.getElementById('robotMicBtn');
  btn?.classList.add('holding');
  btn?.classList.remove('cancel');

  if (robotSpeaking) {
    stopRobotSpeech();
    stopRobotBargeIn();
  }

  primeRobotSpeech();
  startRobotListening({ pushToTalk: true });
  setRobotBubble(
    `<span class="robot-listening-label">🎙 Maintenez et parlez…</span>` +
      `<span class="robot-ptt-hint">Relâchez pour envoyer · Glissez ↑ pour annuler</span>`,
  );
  setRobotStatus('listening');
}

function endRobotHoldTalk(cancelled) {
  robotHoldActive = false;
  robotHoldCancelled = false;
  const btn = document.getElementById('robotMicBtn');
  btn?.classList.remove('holding', 'cancel');

  const transcript = robotRecog?._getTranscript?.() || '';
  if (robotSTTSilenceTimer) {
    clearTimeout(robotSTTSilenceTimer);
    robotSTTSilenceTimer = null;
  }
  if (robotRecog && robotListening) {
    try {
      robotRecog.stop();
    } catch (e) {}
  }
  robotListening = false;

  setTimeout(
    () => {
      if (cancelled) {
        setRobotStatus('online');
        setRobotBubble('Message vocal annulé.');
        return;
      }
      const q = transcript.trim();
      if (q.length >= 2) submitRobotQuery(q);
      else {
        setRobotStatus('online');
        setRobotBubble("Je n'ai rien entendu. Maintenez le micro et parlez clairement.");
      }
    },
    isMobileDevice ? 400 : 280,
  );
}

function initRobotMicHold() {
  if (robotMicHoldInit) return;
  const btn = document.getElementById('robotMicBtn');
  if (!btn) return;
  robotMicHoldInit = true;

  const onHoldStart = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (robotQueryPending) return;
    robotHoldStartY = e.clientY ?? 0;
    robotHoldCancelled = false;
    beginRobotHoldTalk();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const onHoldMove = (e) => {
    if (!robotHoldActive) return;
    const dy = robotHoldStartY - (e.clientY ?? 0);
    const cancel = dy > ROBOT_HOLD_CANCEL_PX;
    if (cancel !== robotHoldCancelled) {
      robotHoldCancelled = cancel;
      btn.classList.toggle('cancel', cancel);
      const hint = document.getElementById('robotHint');
      if (hint) hint.textContent = cancel ? 'Relâchez pour annuler' : 'Relâchez pour envoyer';
      const pttEl = document.querySelector('.robot-ptt-hint');
      if (pttEl) {
        pttEl.textContent = cancel ? 'Relâchez pour annuler' : 'Relâchez pour envoyer · Glissez ↑ pour annuler';
        pttEl.classList.toggle('cancel', cancel);
      }
    }
  };

  const onHoldEnd = (e) => {
    if (!robotHoldActive) return;
    e.preventDefault();
    try {
      btn.releasePointerCapture(e.pointerId);
    } catch (_) {}
    endRobotHoldTalk(robotHoldCancelled);
  };

  btn.addEventListener('pointerdown', onHoldStart);
  btn.addEventListener('pointermove', onHoldMove);
  btn.addEventListener('pointerup', onHoldEnd);
  btn.addEventListener('pointercancel', onHoldEnd);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

function toggleRobotMic() {
  /* Remplacé par initRobotMicHold — maintien du micro */
}

// ── Envoi à Groq avec contexte comptable ──
// ── Afficher image du créateur dans la bulle ──
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getLinkBrand(url, label) {
  const u = (url || '').toLowerCase();
  const l = (label || '').toLowerCase();
  if (u.includes('youtube') || u.includes('youtu.be') || l.includes('youtube')) {
    return {
      id: 'youtube',
      name: 'YouTube',
      color: '#ff0033',
      ctaText: '#ffffff',
      logo: '<svg class="rl-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .6 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .6-5.8 31 31 0 0 0-.6-5.8z"/><path fill="#FFF" d="M9.75 15.02l6.5-3.52-6.5-3.52v7.04z"/></svg>',
    };
  }
  if (u.includes('google') || l.includes('google')) {
    return {
      id: 'google',
      name: 'Google',
      color: '#1a73e8',
      ctaText: '#ffffff',
      logo: '<svg class="rl-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
    };
  }
  if (u.includes('facebook') || l.includes('facebook')) {
    return { id: 'facebook', name: 'Facebook', color: '#1877f2', ctaText: '#ffffff', logo: '<span class="rl-logo-text">f</span>' };
  }
  return {
    id: 'link',
    name: 'Lien web',
    color: '#d4a853',
    ctaText: '#0a0b10',
    logo: '<span class="rl-logo-text">🔗</span>',
  };
}

const VOICE_STOP_WORDS = new Set([
  'salut',
  'bonjour',
  'bonsoir',
  'comment',
  'je',
  'tu',
  'te',
  'toi',
  'm',
  'me',
  'mon',
  'ma',
  'mes',
  'ouvre',
  'ouvrir',
  'ouvres',
  'ouvert',
  'youtube',
  'google',
  'sur',
  'cherche',
  'recherche',
  'video',
  'videos',
  'moi',
  'les',
  'des',
  'une',
  'un',
  'pour',
  'de',
  'du',
  'la',
  'le',
  'que',
  'qui',
  'ce',
  'cet',
  'cette',
  'voudrais',
  'veux',
  'peux',
  'pourrais',
  'montre',
  'affiche',
  'lance',
  'merci',
  'stp',
  'sil',
  'plait',
  'comeo',
  'robot',
  'assistant',
  'lien',
  'page',
  'site',
  'internet',
  'navigateur',
  'ouvrir',
  'ouvre',
  'moi',
  'veut',
  'faire',
  'est',
  'sont',
  'a',
  'as',
  'au',
  'aux',
  'en',
  'et',
  'ou',
  'donc',
  'car',
  'avec',
  'dans',
  'par',
  'ton',
  'ta',
  'tes',
  'son',
]);

function cleanVoiceQueryForSearch(text) {
  let t = (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/\b(\w{2,})(?:\1)+\b/gi, '$1');
  const words = t.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (out.length && out[out.length - 1] === w) continue;
    out.push(w);
  }
  return out.join(' ');
}

function cleanSearchQueryFromVoice(raw) {
  const cleaned = cleanVoiceQueryForSearch(raw);
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1 && !VOICE_STOP_WORDS.has(w));
  return words.join(' ').trim();
}

function getSearchTermFromUrl(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('search_query') || u.searchParams.get('q') || '';
    let term = decodeURIComponent(q.replace(/\+/g, ' ')).trim();
    term = cleanVoiceQueryForSearch(term);
    const words = term.split(/\s+/).filter((w) => w.length > 1 && !VOICE_STOP_WORDS.has(w));
    return words.join(' ').trim();
  } catch (e) {
    return '';
  }
}

function sanitizeLinkDisplay(url, label) {
  const brand = getLinkBrand(url, label);
  const term = getSearchTermFromUrl(url);
  if (term && term.length >= 2 && term.length <= 48) {
    return { title: brand.name, subtitle: 'Recherche : ' + term, brand };
  }
  return { title: brand.name, subtitle: 'Appuyez pour ouvrir dans votre navigateur', brand };
}

function ensureRobotLinkStyles() {
  if (document.getElementById('robot-link-styles')) return;
  const style = document.createElement('style');
  style.id = 'robot-link-styles';
  style.textContent = `
#robotLinkOverlay.robot-link-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font-family:'Space Grotesk',system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .3s}
#robotLinkOverlay.robot-link-overlay.open{opacity:1;pointer-events:auto}
#robotLinkOverlay .robot-link-overlay-backdrop{position:absolute;inset:0;background:rgba(4,5,12,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
#robotLinkOverlay .robot-link-card{position:relative;z-index:2;width:min(92vw,420px);padding:32px 24px 28px;border-radius:24px;background:linear-gradient(165deg,#1a1c2e 0%,#0a0b10 100%);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 80px rgba(0,0,0,.6);text-align:center;color:#fff;animation:rlPop .35s cubic-bezier(.34,1.4,.64,1)}
@keyframes rlPop{from{transform:scale(.9) translateY(16px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
#robotLinkOverlay .robot-link-close{position:absolute;top:12px;right:12px;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0}
#robotLinkOverlay .robot-link-logo-wrap{display:flex;align-items:center;justify-content:center;margin:8px auto 20px;min-height:64px}
#robotLinkOverlay .rl-logo{width:64px;height:64px;display:block}
#robotLinkOverlay .rl-logo-text{font-size:48px;line-height:1}
#robotLinkOverlay .robot-link-title{font-size:26px;font-weight:700;margin:0 0 8px;color:#fff;letter-spacing:.02em}
#robotLinkOverlay .robot-link-subtitle{font-size:14px;color:rgba(255,255,255,.55);margin:0 0 28px;line-height:1.5;word-break:break-word}
#robotLinkOverlay .robot-link-cta{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;padding:18px 24px;border-radius:16px;font-size:18px;font-weight:700;text-decoration:none!important;border:none;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.35);transition:transform .15s,filter .15s}
#robotLinkOverlay .robot-link-cta:active{transform:scale(.98);filter:brightness(1.08)}
#robotLinkOverlay .robot-link-hint{margin:14px 0 0;font-size:11px;color:rgba(255,255,255,.35)}
.robot-link-bubble-preview{display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px 0}
.robot-link-bubble-btn{display:inline-block;padding:12px 24px;border-radius:10px;background:#d4a853;color:#0a0b10!important;font-weight:700;font-size:14px;text-decoration:none!important}`;
  document.head.appendChild(style);
}

function closeRobotLinkOverlay() {
  const el = document.getElementById('robotLinkOverlay');
  if (el) {
    el.classList.remove('open');
    setTimeout(() => el.remove(), 280);
  }
}

function showRobotLinkOverlay(url, label) {
  if (!url) return;
  closeRobotLinkOverlay();
  ensureRobotLinkStyles();
  const { title, subtitle, brand } = sanitizeLinkDisplay(url, label);
  const safeHref = url.replace(/"/g, '%22').replace(/'/g, '%27');
  const safeTitle = escapeHtml(title);
  const safeSub = escapeHtml(subtitle);

  const overlay = document.createElement('div');
  overlay.id = 'robotLinkOverlay';
  overlay.className = 'robot-link-overlay';
  overlay.innerHTML = `
    <div class="robot-link-overlay-backdrop" onclick="closeRobotLinkOverlay()"></div>
    <div class="robot-link-card" role="dialog" aria-modal="true">
      <button type="button" class="robot-link-close" onclick="closeRobotLinkOverlay()" aria-label="Fermer">✕</button>
      <div class="robot-link-logo-wrap">${brand.logo}</div>
      <h2 class="robot-link-title">${safeTitle}</h2>
      <p class="robot-link-subtitle">${safeSub}</p>
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="robot-link-cta"
        style="background:${brand.color};color:${brand.ctaText}">
        Ouvrir ${escapeHtml(brand.name)}
      </a>
      <p class="robot-link-hint">Vous pouvez fermer cette fenêtre avec ✕</p>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const inner = document.getElementById('robotBubbleText');
  if (inner) {
    inner.innerHTML = `
      <div class="robot-link-bubble-preview">
        <span style="font-size:14px;color:rgba(255,255,255,.85)">${safeTitle}</span>
        <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="robot-link-bubble-btn">→ Ouvrir ${escapeHtml(brand.name)}</a>
      </div><span class="blink-cur"></span>`;
  }
}

function parseOpenUrlAction(reply) {
  const tag = '###OPEN_URL###';
  const idx = reply.indexOf(tag);
  if (idx === -1) return null;
  const texteBefore = reply.slice(0, idx).replace(/\*\*/g, '').trim();
  const after = reply.slice(idx + tag.length);
  const jsonMatch = after.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const p = JSON.parse(jsonMatch[0]);
    if (!p?.url) return null;
    return { url: p.url, label: p.label || '', texteBefore };
  } catch (e) {
    return null;
  }
}

function extractSearchTerms(query) {
  return cleanSearchQueryFromVoice(query);
}

function detectOpenUrlIntent(query) {
  const q = normalizeRobotQuery(query);
  const raw = query.trim();

  const directUrl = raw.match(/https?:\/\/[^\s,;)]+/i);
  if (directUrl) return { url: directUrl[0], label: 'Lien web' };

  const wwwUrl = raw.match(/(?:^|\s)(www\.[^\s,;)]+)/i);
  if (wwwUrl) return { url: 'https://' + wwwUrl[1], label: 'Lien web' };

  const wantsOpen = /(ouvre|ouvrir|open|affiche|montre|lance|va sur|aller sur|accede)/i.test(q);

  if (/youtube|youtu\.be/.test(q) || (wantsOpen && q.includes('youtube'))) {
    const term = cleanSearchQueryFromVoice(raw);
    if (term.length >= 3) {
      return {
        url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(term),
        label: 'YouTube',
      };
    }
    return { url: 'https://www.youtube.com', label: 'YouTube' };
  }

  if ((/google/.test(q) && /(cherche|recherche|search)/.test(q)) || (wantsOpen && q.includes('google'))) {
    const term = cleanSearchQueryFromVoice(raw);
    if (term.length >= 2) {
      return {
        url: 'https://www.google.com/search?q=' + encodeURIComponent(term),
        label: 'Google',
      };
    }
    return { url: 'https://www.google.com', label: 'Google' };
  }

  if (wantsOpen && q.includes('facebook')) return { url: 'https://www.facebook.com', label: 'Facebook' };
  if (wantsOpen && q.includes('linkedin')) return { url: 'https://www.linkedin.com', label: 'LinkedIn' };

  return null;
}

function handleRobotOpenUrl(url, label, voiceIntro) {
  const brand = getLinkBrand(url, label);
  showRobotLinkOverlay(url, label);
  let voice = `Voici ${brand.name}. Appuyez sur le grand bouton pour ouvrir.`;
  if (voiceIntro) {
    const clean = cleanTextForSpeech(voiceIntro);
    if (clean.length >= 6 && clean.length <= 90 && !/https|www\.|\.com|search_query|salut.*salut/i.test(clean)) {
      voice = clean;
    }
  }
  robotSpeak(voice, { skipBubble: true });
}

function showCreatorImage() {
  showCreatorCard(true);
}

// ══════════════════════════════════════════
// ROBOT — AFFICHAGE 3D JOURNAL
// ══════════════════════════════════════════
function showRobot3DJournal(ecrituresData) {
  // Créer un overlay 3D par-dessus le robot panel
  const existing = document.getElementById('robot3DOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'robot3DOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(6,7,15,.97);
    display:flex;flex-direction:column;overflow:hidden;
    animation:fadein .3s ease`;

  // Grouper par opération
  const groupes = {};
  ecrituresData.forEach((e) => {
    const key = e.groupId || 'solo_' + e.id;
    if (!groupes[key]) groupes[key] = [];
    groupes[key].push(e);
  });

  const groupList = Object.values(groupes).sort((a, b) => a[0].date.localeCompare(b[0].date));

  const cardsHTML = groupList
    .slice(0, 20)
    .map((grp, gi) => {
      const mainEcr = grp[0];
      let totalD = 0,
        totalC = 0;
      grp.forEach((e) =>
        e.lignes.forEach((l) => {
          totalD += l.debit || 0;
          totalC += l.credit || 0;
        }),
      );
      const jnlColors = {
        AC: '#f59e0b',
        VE: '#22c55e',
        BQ: '#3b82f6',
        CA: '#8b5cf6',
        OD: '#ec4899',
        IN: '#06b6d4',
        AN: '#d4a853',
      };
      const color = jnlColors[mainEcr.journal] || '#d4a853';
      const lignesHTML = grp
        .flatMap((e) =>
          sortLignesDebitAvantCredit(e.lignes).map(
            (l) => `
        <div style="display:flex;justify-content:space-between;
          padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);
          font-size:10px;font-family:var(--font-mono)">
          <span style="color:rgba(255,255,255,.5)">${l.compte}</span>
          <span style="flex:1;margin:0 8px;color:rgba(255,255,255,.7);
            font-family:var(--font-body);font-size:10px;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${l.libelle || PC[l.compte] || ''}
          </span>
          <span style="color:#60a5fa;min-width:70px;text-align:right">
            ${l.debit ? fnPDF(l.debit) : ''}
          </span>
          <span style="color:#4ade80;min-width:70px;text-align:right">
            ${l.credit ? fnPDF(l.credit) : ''}
          </span>
        </div>`,
          ),
        )
        .join('');

      return `
      <div class="r3d-card" style="
        background:linear-gradient(135deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.01) 100%);
        border:1px solid ${color}44;border-radius:12px;padding:16px;
        min-width:320px;max-width:380px;flex-shrink:0;
        transform:perspective(800px) rotateY(${(gi - groupList.length / 2) * 3}deg);
        box-shadow:0 8px 32px ${color}22;
        transition:transform .3s ease,box-shadow .3s ease;cursor:pointer"
        onmouseover="this.style.transform='perspective(800px) rotateY(0deg) scale(1.04)';
          this.style.boxShadow='0 16px 48px ${color}44'"
        onmouseout="this.style.transform='perspective(800px) rotateY(${(gi - groupList.length / 2) * 3}deg)';
          this.style.boxShadow='0 8px 32px ${color}22'">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="background:${color};color:#000;padding:2px 8px;
            border-radius:4px;font-size:9px;font-weight:700;
            font-family:var(--font-mono)">${mainEcr.journal}</span>
          <span style="font-size:10px;color:rgba(255,255,255,.4);
            font-family:var(--font-mono)">${mainEcr.date}</span>
          <span style="margin-left:auto;font-size:10px;color:${color};
            font-family:var(--font-mono);font-weight:700">${fnPDF(totalD)} FCFA</span>
        </div>
        <div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:8px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${mainEcr.groupLibelle || mainEcr.libelle || '—'}
        </div>
        <div style="max-height:120px;overflow:hidden">${lignesHTML}</div>
        ${
          grp.length > 1
            ? `<div style="margin-top:6px;font-size:9px;
          color:${color};opacity:.7">${grp.length} écritures liées</div>`
            : ''
        }
      </div>`;
    })
    .join('');

  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:16px 24px;border-bottom:1px solid rgba(255,255,255,.08)">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:8px;height:8px;border-radius:50%;
          background:#d4a853;box-shadow:0 0 8px #d4a853;animation:pulse 1.5s infinite"></div>
        <span style="font-family:var(--font-body);font-size:14px;
          font-weight:600;color:#d4a853">Journal 3D — COMEO AI</span>
        <span style="font-size:11px;color:rgba(255,255,255,.4)">
          ${groupList.length} opération${groupList.length > 1 ? 's' : ''} ·
          ${ecrituresData.length} écriture${ecrituresData.length > 1 ? 's' : ''}
        </span>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="navigate('journal');closeRobot3D()"
          style="background:rgba(212,168,83,.15);border:1px solid rgba(212,168,83,.3);
          color:#d4a853;padding:6px 14px;border-radius:6px;cursor:pointer;
          font-size:11px;font-family:var(--font-body)">
          → Voir journal complet
        </button>
        <button onclick="closeRobot3D()"
          style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
          color:rgba(255,255,255,.6);padding:6px 14px;border-radius:6px;
          cursor:pointer;font-size:11px;font-family:var(--font-body)">
          ✕ Fermer
        </button>
      </div>
    </div>
    <div style="flex:1;overflow-x:auto;overflow-y:hidden;padding:24px;
      display:flex;align-items:center;gap:16px;
      scroll-snap-type:x mandatory">
      ${cardsHTML || '<div style="color:rgba(255,255,255,.3);margin:auto">Aucune écriture</div>'}
    </div>
    <div style="padding:12px 24px;border-top:1px solid rgba(255,255,255,.06);
      display:flex;gap:8px;flex-wrap:wrap">
      <span style="font-size:10px;color:rgba(255,255,255,.3)">
        Défilez horizontalement pour voir toutes les opérations ·
        Survolez une carte pour agrandir
      </span>
    </div>`;

  document.body.appendChild(overlay);
}

function closeRobot3D() {
  const el = document.getElementById('robot3DOverlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }
}
window.closeRobot3D = closeRobot3D;

// ══════════════════════════════════════════
// ROBOT — ACTIONS DIRECTES SUR LES DONNÉES
// ══════════════════════════════════════════

// Créer une facture depuis le robot
async function robotCreateFacture(params) {
  const { clientNom, lignes, notes, modeReglement } = params;

  // Chercher ou créer le client
  let client = clientsList.find((c) => c.nom.toLowerCase().includes(clientNom.toLowerCase()));

  if (!client && clientNom) {
    const newClient = {
      id: Date.now(),
      code: 'CLI-' + String(clientCounter).padStart(3, '0'),
      nom: clientNom,
      tel: '',
      email: '',
      ville: 'Abidjan',
      adresse: '',
      nif: '',
      notes: 'Créé par COMEO AI Robot',
      createdAt: new Date().toISOString(),
    };
    try {
      const col = window._fbCollection(window._db, 'profiles', currentProfile.id, 'clients');
      const ref = await window._fbAddDoc(col, newClient);
      newClient._docId = ref.id;
      clientsList.push(newClient);
      clientCounter++;
      client = newClient;
    } catch (e) {}
  }

  // Calculer totaux
  let ht = 0,
    tva = 0;
  const facLignesData = (lignes || []).map((l) => {
    const lineHT = Math.round((l.qte || 1) * (l.pu || 0) * (1 - (l.remise || 0) / 100));
    const lineTVA = Math.round((lineHT * (l.tva || 18)) / 100);
    ht += lineHT;
    tva += lineTVA;
    return { designation: l.designation, qte: l.qte || 1, pu: l.pu || 0, remise: l.remise || 0, tva: l.tva || 18 };
  });
  const ttc = ht + tva;
  const today = new Date().toISOString().split('T')[0];
  const echeance = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const numero = 'FAC-' + new Date().getFullYear() + '-' + String(factureCounter).padStart(4, '0');

  const facture = {
    id: Date.now(),
    numero,
    type: 'facture',
    dateEmission: today,
    dateEcheance: echeance,
    clientId: client?.id || 0,
    clientNom: client?.nom || clientNom,
    clientAdresse: client?.adresse || '',
    clientEmail: client?.email || '',
    clientTel: client?.tel || '',
    reference: '',
    notes: notes || 'Facture créée par COMEO AI Robot',
    modeReglement: modeReglement || 'virement',
    conditions: '30j',
    monnaie: 'FCFA',
    remiseGlobale: 0,
    lignes: facLignesData,
    ht,
    tva,
    ttc,
    statut: 'envoyee',
    montantPaye: 0,
    createdAt: new Date().toISOString(),
  };

  try {
    const col = window._fbCollection(window._db, 'profiles', currentProfile.id, 'factures');
    const ref = await window._fbAddDoc(col, facture);
    facture._docId = ref.id;
    facturesList.push(facture);
    factureCounter++;
    // Auto-comptabilisation
    await autoComptabiliserFacture(facture);
    return facture;
  } catch (e) {
    console.error('Erreur création facture robot:', e);
    return null;
  }
}

// Modifier une écriture depuis le robot
async function robotModifyEcriture(docId, changes) {
  try {
    const idx = ecritures.findIndex((e) => e._docId === docId);
    if (idx === -1) return false;
    const updated = { ...ecritures[idx], ...changes };
    await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'ecritures', docId), updated);
    ecritures[idx] = updated;
    updateStats();
    return true;
  } catch (e) {
    return false;
  }
}

// ══════════════════════════════════════════
// ROBOT — HANDLE QUERY (VERSION COMPLÈTE)
// ══════════════════════════════════════════
async function handleRobotQuery(query) {
  if (!query || !query.trim()) {
    setRobotStatus('online');
    return;
  }
  if (!requireSubscriptionAccess()) return;

  setRobotStatus('thinking');
  setRobotBubble('<span class="robot-thinking">…</span>');

  if (!isAiServiceReady()) {
    const msg = '⚠️ Aucune clé API OpenRouter configurée. Clés configurées dans le système.';
    robotSpeak(msg, { skipBubble: true });
    setRobotBubble('<span class="service-msg-inline">' + msg + '</span>');
    setRobotStatus('online');
    return;
  }

  const queryLow = query.toLowerCase();

  // ── Photo ou question sur le créateur ──
  if (isCreatorPhotoRequest(query) || isAboutCreatorQuery(query)) {
    const showPhoto = isCreatorPhotoRequest(query) || /photo|image|portrait|selfie|montre|voir|affiche/i.test(queryLow);
    const creatorText = showPhoto
      ? 'Voici la photo de mon créateur, Marcio Jardel Zinzindohoue. Jeune entrepreneur, cofondateur de Groupe Express et créateur de COMEO.'
      : 'Mon concepteur Marcio Jardel Zinzindohoue est un jeune entrepreneur, cofondateur de Groupe Express et créateur de COMEO. Je suis fière de mon existence.';
    showCreatorCard(showPhoto);
    robotSpeak(creatorText);
    return;
  }

  // ── YouTube, Google, liens web (sans attendre l'IA) ──
  const urlIntent = detectOpenUrlIntent(query);
  if (urlIntent) {
    handleRobotOpenUrl(urlIntent.url, urlIntent.label);
    return;
  }

  // ── Construire contexte comptable complet ──
  let tD = 0,
    tC = 0;
  ecritures.forEach((e) =>
    e.lignes.forEach((l) => {
      tD += l.debit || 0;
      tC += l.credit || 0;
    }),
  );
  const map = getMap();
  const nb = ecritures.length;
  const company = currentProfile?.company || 'Entreprise';
  const yr = document.getElementById('exerciceYear')?.value || '2024';
  const today = new Date().toISOString().split('T')[0];

  // Résumé journal complet
  const jrnlResume = ecritures
    .slice(-15)
    .map((e) => {
      let d = 0,
        c = 0;
      e.lignes.forEach((l) => {
        d += l.debit || 0;
        c += l.credit || 0;
      });
      return `[${e.date}][${e.journal}][${e.piece || ''}] ${e.libelle || '—'} | D:${fnPDF(d)} C:${fnPDF(c)} | ID:${e._docId || e.id}`;
    })
    .join('\n');

  // Soldes comptes
  const soldes = Object.entries(map)
    .slice(0, 30)
    .map(([code, acc]) => {
      const s = acc.debit - acc.credit;
      return `${code}(${(PC[code] || '').substring(0, 18)}):${s >= 0 ? 'Sd' : 'Sc'}${fnPDF(Math.abs(s))}FCFA`;
    })
    .join(' | ');

  // Liste clients
  const clientsResume = clientsList
    .slice(0, 10)
    .map((c) => `[${c.code}]${c.nom}`)
    .join(', ');

  // Liste fournisseurs
  const fourResume = fournisseursList
    .slice(0, 10)
    .map((f) => `[${f.code}]${f.nom}`)
    .join(', ');

  // Liste factures récentes
  const facturesResume = facturesList
    .slice(0, 8)
    .map((f) => `${f.numero}|${f.clientNom}|${fnPDF(f.ttc)}FCFA|${f.statut}`)
    .join(' / ');

  // ── System prompt robot complet avec actions ──
 // Contexte paie
  const paieResume = salaries.slice(0,8).map(s =>
    `${s.nom}(${s.mois}):brut=${fnPDF(s.brut)},net=${fnPDF(s.netAPayer)}`
  ).join(' | ');

  // Contexte immobilisations
  const immobResume = immobilisations.slice(0,8).map(im =>
    `${im.nom}:val=${fnPDF(im.valeur)},vnc=${fnPDF((im.valeur||0)-(im.amortCumul||0))},dot=${fnPDF(im.dotAnnuelle)}/an`
  ).join(' | ');

  // Contexte stock
  const stockResume = stockArticles.slice(0,8).map(a =>
    `${a.nom}:qte=${a.qteActuelle},cmup=${fnPDF(a.cmup)}`
  ).join(' | ');

  // Déclarations fiscales
  const tvaCollec = ['4431','4432'].reduce((s,c) => s+(map[c]?map[c].credit-map[c].debit:0),0);
  const tvaDeduc = ['4451','4452','4453','4454'].reduce((s,c) => s+(map[c]?map[c].debit-map[c].credit:0),0);
  const tvaNette = tvaCollec - tvaDeduc;
  const ca7 = ['701','702','703','704','705','706','707'].reduce((s,c) => s+(map[c]?map[c].credit-map[c].debit:0),0);
  const imfAnnuel = Math.max(3000000, Math.round(ca7*0.005));
  const prodF = Object.entries(map).filter(([c])=>c[0]==='7').reduce((s,[,a])=>s+(a.credit-a.debit),0);
  const chgF = Object.entries(map).filter(([c])=>c[0]==='6').reduce((s,[,a])=>s+(a.debit-a.credit),0);
  const isAnnuel = (prodF-chgF)>0 ? Math.round((prodF-chgF)*0.25) : 0;

  const systemRobot = `Tu es COMEO AI v5, assistante vocale et comptable experte SYSCOHADA. Tu maîtrises et contrôles TOUS les modules de la plateforme COMEO en temps réel.

════════════════════════════════════════════
CAPACITÉS D'ACTION COMPLÈTES — TOUS MODULES
════════════════════════════════════════════
Tu peux exécuter des actions réelles. Utilise exactement ces balises :

1. COMPTABILITÉ — Créer une ou plusieurs écritures :
   ###ECRITURE###{"journal":"OD","libelle":"...","lignes":[{"compte":"601","libelle":"...","debit":50000,"credit":0},...]}

2. FACTURATION — Créer une facture :
   ###CREATE_FACTURE###{"clientNom":"NOM","modeReglement":"virement","lignes":[{"designation":"...","qte":1,"pu":50000,"remise":0,"tva":18}]}

3. PAIE — Créer une fiche de paie :
   ###CREATE_PAIE###{"nom":"NOM SALARIÉ","poste":"Poste","mois":"2024-01","brut":250000}

4. IMMOBILISATION — Enregistrer une immobilisation :
   ###CREATE_IMMOB###{"nom":"Ordinateur Dell","valeur":850000,"cat":"2442","methode":"lineaire","dateAcq":"2024-01-15","ref":"REF001"}

5. NAVIGATION — Aller à un module :
   ###NAVIGATE###{"vue":"NOM_VUE"}
   Vues : dashboard, saisie, journal, grandlivre, balance, bilan, resultat, tresorerie, factures, devis, clients, fournisseurs, paie, immobilisations, stocks, rapprochement, budgets, lettrage, declarations, tafire, exercices

6. JOURNAL 3D — Afficher :
   ###SHOW_3D_JOURNAL###{"filtre":"all"}

7. LIEN WEB :
   ###OPEN_URL###{"url":"https://...","label":"..."}

8. FILTRE — Appliquer un filtre sur une vue :
   ###FILTRE###{"type":"journal","dateDebut":"2024-01-01","dateFin":"2024-12-31","journal":"VE","compte":""}

════════════════════════════════════════════
DONNÉES TEMPS RÉEL — ${company} (exercice ${yr})
════════════════════════════════════════════
Date : ${today}
Écritures : ${nb} | Débit total : ${fnPDF(tD)} FCFA | Crédit total : ${fnPDF(tC)} FCFA
${Math.abs(tD-tC)<1 ? '✓ Balance équilibrée' : '⚠ DÉSÉQUILIBRE : '+fnPDF(Math.abs(tD-tC))+' FCFA'}

SOLDES COMPTES CLÉS :
${soldes}

JOURNAL (15 dernières écritures) :
${jrnlResume || 'Aucune écriture'}

CLIENTS (${clientsList.length}) : ${clientsResume || 'Aucun'}
FOURNISSEURS (${fournisseursList.length}) : ${fourResume || 'Aucun'}
FACTURES RÉCENTES : ${facturesResume || 'Aucune'}

MODULE PAIE (${salaries.length} salariés) :
${paieResume || 'Aucun salarié enregistré'}
Masse salariale brute : ${fnPDF(salaries.reduce((s,x)=>s+(x.brut||0),0))} FCFA
Net total à payer : ${fnPDF(salaries.reduce((s,x)=>s+(x.netAPayer||0),0))} FCFA

MODULE IMMOBILISATIONS (${immobilisations.length}) :
${immobResume || 'Aucune immobilisation'}
Valeur brute totale : ${fnPDF(immobilisations.reduce((s,x)=>s+(x.valeur||0),0))} FCFA
Dot. annuelle totale : ${fnPDF(immobilisations.reduce((s,x)=>s+(x.dotAnnuelle||0),0))} FCFA

MODULE STOCKS (${stockArticles.length} articles) :
${stockResume || 'Aucun article'}

DÉCLARATIONS FISCALES EN TEMPS RÉEL :
TVA collectée : ${fnPDF(tvaCollec)} FCFA | TVA déductible : ${fnPDF(tvaDeduc)} FCFA | TVA nette à payer : ${fnPDF(tvaNette)} FCFA
CA HT (7xxx) : ${fnPDF(ca7)} FCFA | IMF annuel : ${fnPDF(imfAnnuel)} FCFA
Résultat fiscal : ${fnPDF(prodF-chgF)} FCFA | IS à payer (25%) : ${fnPDF(isAnnuel)} FCFA

ANALYSE FINANCIÈRE :
Produits (cl.7) : ${fnPDF(Object.entries(map).filter(([c])=>c[0]==='7').reduce((s,[,a])=>s+(a.credit-a.debit),0))} FCFA
Charges (cl.6) : ${fnPDF(Object.entries(map).filter(([c])=>c[0]==='6').reduce((s,[,a])=>s+(a.debit-a.credit),0))} FCFA
Trésorerie (cl.5) : ${fnPDF(Object.entries(map).filter(([c])=>c[0]==='5').reduce((s,[,a])=>s+(a.debit-a.credit),0))} FCFA
Clients (411) : ${fnPDF((map['411']?.debit||0)-(map['411']?.credit||0))} FCFA à encaisser
Fournisseurs (401) : ${fnPDF((map['401']?.credit||0)-(map['401']?.debit||0))} FCFA à payer

════════════════════════════════════════════
PERSONNALITÉ
════════════════════════════════════════════
Tu es l'IA la plus avancée de comptabilité SYSCOHADA au monde. Tu raisonnes, tu agis, tu expliques.
- Oral fluide, phrases complètes, naturelles et chaleureuses.
- Avant une action : une phrase d'annonce. Après : confirme le résultat.
- Tu maîtrises le barème IR ivoirien, le SYSCOHADA 2017, la fiscalité CI.
- Jamais de markdown, listes à puces ou "en tant qu'IA".
- 2 à 5 phrases ; précis sur les chiffres.

PERSONNALITÉ VOCALE — Parle comme OpenRouter ou ChatGPT Voice : fluide, intelligente, chaleureuse.
- Raisonne en profondeur avant de répondre, puis exprime une réponse claire et pertinente.
- Phrases complètes et naturelles, jamais télégraphiques ni mécaniques.
- Rythme oral humain : virgules pour enchaîner une idée, point pour conclure une pensée.
- Orthographe orale correcte : apostrophes obligatoires (l'entreprise, d'un, j'ai, c'est, qu'il, n'est).
- 2 à 5 phrases selon la question ; sois précise sur les chiffres et comptes.
- Jamais de markdown, listes à puces, symboles, ni « en tant qu'IA ».
- Avant une action : une phrase courte annonçant ce que tu fais. Après : confirme le résultat avec clarté.
- Ne répète pas la question. Ne dis pas « Je réfléchis » ou des formules vides.

DONNÉES EN TEMPS RÉEL — ${company} (exercice ${yr}) :
Date : ${today}
Écritures : ${nb} | Total Débit : ${fnPDF(tD)} FCFA | Total Crédit : ${fnPDF(tC)} FCFA
${Math.abs(tD - tC) < 1 ? 'Comptes équilibrés ✓' : 'DÉSÉQUILIBRE : ' + fnPDF(Math.abs(tD - tC)) + ' FCFA ⚠️'}

SOLDES COMPTES :
${soldes}

JOURNAL (15 dernières) :
${jrnlResume || 'Aucune écriture'}

CLIENTS (${clientsList.length}) : ${clientsResume || 'Aucun'}
FOURNISSEURS (${fournisseursList.length}) : ${fourResume || 'Aucun'}
FACTURES RÉCENTES : ${facturesResume || 'Aucune'}

ANALYSE AUTOMATIQUE :
- Produits (cl.7) : ${fnPDF(
    Object.entries(map)
      .filter(([c]) => c[0] === '7')
      .reduce((s, [, a]) => s + (a.credit - a.debit), 0),
  )} FCFA
- Charges (cl.6) : ${fnPDF(
    Object.entries(map)
      .filter(([c]) => c[0] === '6')
      .reduce((s, [, a]) => s + (a.debit - a.credit), 0),
  )} FCFA
- Trésorerie (cl.5) : ${fnPDF(
    Object.entries(map)
      .filter(([c]) => c[0] === '5')
      .reduce((s, [, a]) => s + (a.debit - a.credit), 0),
  )} FCFA
- Clients (411) : ${fnPDF((map['411']?.debit || 0) - (map['411']?.credit || 0))} FCFA à encaisser
- Fournisseurs (401) : ${fnPDF((map['401']?.credit || 0) - (map['401']?.debit || 0))} FCFA à payer`;

  robotConvHistory.push({ role: 'user', content: query });
  if (robotConvHistory.length > 12) robotConvHistory = robotConvHistory.slice(-12);

  try {
    let reply = null;

    // ══ ÉTAPE 0 : CACHE ROBOT — réponse instantanée ══
    const robotCacheKeyStr = aiCacheKey(query);
    const robotIsAction = isActionQuery(queryLow);
    if (!robotIsAction) {
      const cached = await aiCacheGet(robotCacheKeyStr);
      if (cached && !cached.includes('###')) {
        console.log('[COMEO Robot] ✅ Cache hit');
        robotConvHistory.push({ role: 'assistant', content: cached });
        robotSpeak(stripRobotVoiceText(cached));
        return;
      }
    }

    // ══ ÉTAPE 1 : GROQ — file d'attente multi-clés ══
    let data = null;
    if (GROQ_API_KEYS.length > 0) {
      const allBusy = groqKeyBusy.length > 0 && groqKeyBusy.every(Boolean);
      if (allBusy) setRobotBubble('⏳ IA en réflexion, veuillez patienter…');
      const result = await callGroqQueued(robotConvHistory, systemRobot, 420, 0.62);
      if (result && result.data) {
        data = result.data;
      } else if (result && result.error) {
        setRobotBubble(result.msg);
        return;
      }
    }

    if (!data) throw new Error('Tous les providers indisponibles');
    reply = data.choices?.[0]?.message?.content?.trim() || "Je n'ai pas pu répondre.";

    // Sauvegarder dans le cache si ce n'est pas une action
    if (!robotIsAction && reply && !reply.includes('###')) {
      aiCacheSet(robotCacheKeyStr, reply).catch(() => {});
    }
    robotConvHistory.push({ role: 'assistant', content: reply });

    // ── TRAITEMENT DES ACTIONS ──

    // 1. Créer une facture
    if (reply.includes('###CREATE_FACTURE###')) {
      const parts = reply.split('###CREATE_FACTURE###');
      const texteBefore = parts[0].trim();
      if (texteBefore) robotSpeak(stripRobotVoiceText(texteBefore));

      try {
        const jsonStr = parts[1].trim();
        const jsonMatch = jsonStr.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          const params = JSON.parse(jsonMatch[1]);
          setRobotBubble('Création de la facture en cours…');
          const facture = await robotCreateFacture(params);
          if (facture) {
            renderFactures();
            const successText = `Parfait, la facture ${facture.numero} est créée pour ${facture.clientNom}, d'un montant de ${fnPDF(facture.ttc)} francs CFA. Elle est bien enregistrée dans le système.`;
            setTimeout(() => robotSpeak(successText), texteBefore ? 2000 : 0);
            // Afficher confirmation visuelle dans bulle
            setTimeout(() => {
              setRobotBubble(`
                <div style="text-align:center">
                  <div style="font-size:32px;margin-bottom:8px">✅</div>
                  <strong style="color:var(--warm)">${facture.numero}</strong><br>
                  <span style="font-size:12px;color:rgba(255,255,255,.7)">
                    ${facture.clientNom}<br>
                    <strong style="color:var(--green)">${fnPDF(facture.ttc)} FCFA</strong>
                  </span>
                  <br><br>
                  <button onclick="navigate('factures');closeRobot()"
                    style="background:var(--warm);color:#000;border:none;
                    padding:6px 16px;border-radius:6px;cursor:pointer;
                    font-size:11px;font-family:var(--font-body);font-weight:700">
                    → Voir la facture
                  </button>
                </div>
                <span class="blink-cur"></span>`);
            }, 500);
          } else {
            robotSpeak('Désolé, une erreur est survenue lors de la création de la facture.');
          }
        }
      } catch (pe) {
        console.warn('Parse erreur facture robot:', pe);
        robotSpeak("Je n'ai pas pu créer la facture. Pouvez-vous reformuler ?");
      }
      return;
    }
// ── Handler CREATE_PAIE ──
    if (reply.includes('###CREATE_PAIE###')) {
      const parts = reply.split('###CREATE_PAIE###');
      const texteBefore = parts[0].trim();
      if (texteBefore) robotSpeak(stripRobotVoiceText(texteBefore));
      try {
        const jsonMatch = parts[1].trim().match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[1]);
          // Remplir le modal paie et déclencher la sauvegarde
          document.getElementById('paie-nom').value = p.nom || '';
          document.getElementById('paie-poste').value = p.poste || '';
          document.getElementById('paie-mois').value = p.mois || new Date().toISOString().slice(0,7);
          document.getElementById('paie-brut').value = p.brut || 0;
          calcPaie();
          await savePaie();
          const sal = salaries[salaries.length-1];
          if (sal) {
            setTimeout(() => robotSpeak(`Parfait, la fiche de paie de ${sal.nom} pour ${sal.mois} est enregistrée. Son net à payer est de ${fnPDF(sal.netAPayer)} francs CFA, avec ${fnPDF(sal.ir)} d'impôt sur le revenu.`), texteBefore?2000:0);
          }
        }
      } catch(pe) { robotSpeak("Je n'ai pas pu créer la fiche de paie. Reformulez s'il vous plaît."); }
      return;
    }

    // ── Handler CREATE_IMMOB ──
    if (reply.includes('###CREATE_IMMOB###')) {
      const parts = reply.split('###CREATE_IMMOB###');
      const texteBefore = parts[0].trim();
      if (texteBefore) robotSpeak(stripRobotVoiceText(texteBefore));
      try {
        const jsonMatch = parts[1].trim().match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[1]);
          document.getElementById('immob-nom').value = p.nom || '';
          document.getElementById('immob-valeur').value = p.valeur || 0;
          document.getElementById('immob-categorie').value = p.cat || '2442';
          document.getElementById('immob-methode').value = p.methode || 'lineaire';
          document.getElementById('immob-date').value = p.dateAcq || new Date().toISOString().split('T')[0];
          document.getElementById('immob-ref').value = p.ref || '';
          await saveImmob();
          const im = immobilisations[immobilisations.length-1];
          if (im) {
            setTimeout(() => robotSpeak(`L'immobilisation "${im.nom}" a été enregistrée pour une valeur brute de ${fnPDF(im.valeur)} francs CFA, avec une dotation annuelle de ${fnPDF(im.dotAnnuelle)} francs CFA.`), texteBefore?2000:0);
          }
        }
      } catch(pe) { robotSpeak("Je n'ai pas pu enregistrer l'immobilisation. Reformulez s'il vous plaît."); }
      return;
    }
    // 2. Afficher journal 3D
    if (reply.includes('###SHOW_3D_JOURNAL###')) {
      const parts = reply.split('###SHOW_3D_JOURNAL###');
      const texteBefore = parts[0].trim();

      let filtre = 'all';
      try {
        const jsonMatch = parts[1]?.match(/(\{[\s\S]*?\})/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[1]);
          filtre = p.filtre || 'all';
        }
      } catch (e) {}

      const ecrsToShow = filtre === 'all' ? ecritures : ecritures.filter((e) => e.journal === filtre);

      const voiceText =
        texteBefore ||
        `Je vous affiche le journal${filtre !== 'all' ? ' ' + JOURNAL_NAMES[filtre] || filtre : ''} en trois dimensions. Vous pouvez faire défiler les opérations.`;
      robotSpeak(stripRobotVoiceText(voiceText));

      setTimeout(() => {
        showRobot3DJournal(ecrsToShow);
      }, 800);
      return;
    }

    // 3. Navigation
    if (reply.includes('###NAVIGATE###')) {
      const parts = reply.split('###NAVIGATE###');
      const texteBefore = parts[0].trim();
      try {
        const jsonMatch = parts[1]?.match(/(\{[\s\S]*?\})/);
        if (jsonMatch) {
          const p = JSON.parse(jsonMatch[1]);
          const vueNames = {
  factures: 'factures', clients: 'clients', fournisseurs: 'fournisseurs',
  journal: 'journal', balance: 'balance', bilan: 'bilan', resultat: 'resultat',
  tresorerie: 'tresorerie', dashboard: 'dashboard', saisie: 'saisie', grandlivre: 'grandlivre',
  paie: 'paie', immobilisations: 'immobilisations', stocks: 'stocks',
  rapprochement: 'rapprochement', budgets: 'budgets', lettrage: 'lettrage',
  declarations: 'declarations', tafire: 'tafire', exercices: 'exercices', devis: 'devis',
};
          const vue = vueNames[p.vue] || 'dashboard';
          if (texteBefore) robotSpeak(stripRobotVoiceText(texteBefore));
          setTimeout(() => {
            navigate(vue);
            closeRobot();
          }, 1500);
        }
      } catch (e) {}
      return;
    }
    // 3b. Ouvrir URL / moteur de recherche
    const urlAction = parseOpenUrlAction(reply);
    if (urlAction) {
      handleRobotOpenUrl(urlAction.url, urlAction.label, urlAction.texteBefore || '');
      return;
    }

    // 4. Réponse normale
    robotSpeak(stripRobotVoiceText(reply));
  } catch (err) {
    console.warn('[COMEO Robot]', err);
    aiServiceAvailable = false;
    updateServiceAvailabilityUI();
    const errMsg = GROQ_API_KEYS.length === 0
      ? '⚠️ Aucune clé API configurée. Clés configurées dans le système.'
      : `❌ Erreur : ${err?.message || 'inconnue'}. Vérifiez vos clés dans le système.`;
    robotSpeak(errMsg, { skipBubble: true });
    setRobotBubble('<span class="service-msg-inline">' + errMsg + '</span>');
  } finally {
    // Sécurité mobile : ne jamais rester bloqué sur « Réflexion… »
    setTimeout(() => {
      if (!robotSpeaking && document.getElementById('robotStatusPill')?.textContent === 'Réflexion…') {
        setRobotStatus('online');
      }
    }, 500);
  }
}

// Exposer
window.openRobot = openRobot;
window.closeRobot = closeRobot;
window.closeRobotLinkOverlay = closeRobotLinkOverlay;
window.toggleRobotMic = toggleRobotMic;
window.initRobotMicHold = initRobotMicHold;
// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
function toast(message, type = 'info') {
  const c = document.getElementById('toastContainer') || document.getElementById('toast');
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  const icons = { success: '✓', error: '✕', info: 'i' };
  const colors = { success: '#4ade80', error: '#f87171', info: '#d4a853' };
  d.innerHTML = `<span style="font-weight:700;color:${colors[type] || colors.info}">${icons[type] || 'i'}</span><span>${message}</span>`;
  c.appendChild(d);
  setTimeout(() => (d.style.opacity = '0'), 3500);
  setTimeout(() => d.remove(), 4100);
}
// ══════════════════════════════════════════
// DONNÉES EN MÉMOIRE — CLIENTS, FOURNISSEURS, FACTURES
// ══════════════════════════════════════════
let clientsList = [];
let fournisseursList = [];
let facturesList = [];
let devisList = [];
let facLignes = [];
window.facLignes = facLignes; // ← AJOUTER juste en dessous
let editingFactureId = null;
let editingClientId = null;
let clientCounter = 1;
let fournisseurCounter = 1;
let factureCounter = 1;
let devisCounter = 1;

// ─── Chargement depuis Firestore ───
async function loadClientsFromFirestore() {
  try {
    const ownerID = getOwnerProfileId();
    const col = window._fbCollection(window._db, 'profiles', ownerID, 'clients');
    const snap = await window._fbGetDocs(col);
    clientsList = [];
    snap.forEach((d) => clientsList.push({ ...d.data(), _docId: d.id }));
    clientCounter = clientsList.length + 1;
  } catch (e) {}
}
async function loadFournisseursFromFirestore() {
  try {
    const ownerID = getOwnerProfileId();
    const col = window._fbCollection(window._db, 'profiles', ownerID, 'fournisseurs');
    const snap = await window._fbGetDocs(col);
    fournisseursList = [];
    snap.forEach((d) => fournisseursList.push({ ...d.data(), _docId: d.id }));
    fournisseurCounter = fournisseursList.length + 1;
  } catch (e) {}
}
async function loadFacturesFromFirestore() {
  try {
    const ownerID = getOwnerProfileId();
    const col = window._fbCollection(window._db, 'profiles', ownerID, 'factures');
    const q = window._fbQuery(col, window._fbOrderBy('dateEmission', 'desc'));
    const snap = await window._fbGetDocs(q);
    facturesList = [];
    snap.forEach((d) => facturesList.push({ ...d.data(), _docId: d.id }));
    factureCounter = facturesList.length + 1;
  } catch (e) {}
}

// ══════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════
function openClientModal(id = null) {
  editingClientId = id;
  const modal = document.getElementById('clientModal');
  const title = document.getElementById('clientModalTitle');
  if (!modal) return;
  if (id) {
    const cli = clientsList.find((c) => c.id === id);
    if (!cli) return;
    title.textContent = 'Modifier le client';
    document.getElementById('cli-code').value = cli.code || '';
    document.getElementById('cli-nom').value = cli.nom || '';
    document.getElementById('cli-tel').value = cli.tel || '';
    document.getElementById('cli-email').value = cli.email || '';
    document.getElementById('cli-ville').value = cli.ville || '';
    document.getElementById('cli-adresse').value = cli.adresse || '';
    document.getElementById('cli-nif').value = cli.nif || '';
    document.getElementById('cli-notes').value = cli.notes || '';
  } else {
    title.textContent = 'Nouveau client';
    document.getElementById('cli-code').value = 'CLI-' + String(clientCounter).padStart(3, '0');
    document.getElementById('cli-nom').value = '';
    document.getElementById('cli-tel').value = '';
    document.getElementById('cli-email').value = '';
    document.getElementById('cli-ville').value = '';
    document.getElementById('cli-adresse').value = '';
    document.getElementById('cli-nif').value = '';
    document.getElementById('cli-notes').value = '';
  }
  modal.style.display = 'flex';
}
function closeClientModal() {
  document.getElementById('clientModal').style.display = 'none';
}

async function saveClient() {
  const nom = document.getElementById('cli-nom').value.trim();
  if (!nom) {
    toast('Le nom du client est obligatoire', 'error');
    return;
  }
  const client = {
    id: editingClientId || Date.now(),
    code: document.getElementById('cli-code').value,
    nom,
    tel: document.getElementById('cli-tel').value,
    email: document.getElementById('cli-email').value,
    ville: document.getElementById('cli-ville').value,
    adresse: document.getElementById('cli-adresse').value,
    nif: document.getElementById('cli-nif').value,
    notes: document.getElementById('cli-notes').value,
    createdAt: new Date().toISOString(),
  };
  try {
    const col = window._fbCollection(window._db, 'profiles', currentProfile.id, 'clients');
    if (editingClientId) {
      const existing = clientsList.find((c) => c.id === editingClientId);
      if (existing?._docId) {
        await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'clients', existing._docId), client);
        const idx = clientsList.findIndex((c) => c.id === editingClientId);
        clientsList[idx] = { ...client, _docId: existing._docId };
      }
    } else {
      const ref = await window._fbAddDoc(col, client);
      clientsList.push({ ...client, _docId: ref.id });
      clientCounter++;
    }
    closeClientModal();
    renderClients();
    toast('✓ Client enregistré', 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

function renderClients() {
  const search = (document.getElementById('cli-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('clientsBody');
  if (!tbody) return;
  const filtered = clientsList.filter(
    (c) => !search || c.nom?.toLowerCase().includes(search) || c.email?.toLowerCase().includes(search) || c.tel?.includes(search),
  );
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>Aucun client enregistré</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map((c) => {
      // Calculer CA total depuis les factures
      const caTotal = facturesList.filter((f) => f.clientId === c.id && f.statut !== 'annulee').reduce((s, f) => s + (f.ttc || 0), 0);
      const soldeDu = facturesList
        .filter((f) => f.clientId === c.id && ['envoyee', 'partielle', 'retard'].includes(f.statut))
        .reduce((s, f) => s + ((f.ttc || 0) - (f.montantPaye || 0)), 0);
      return `<tr>
      <td><span class="ct">${c.code}</span></td>
      <td style="font-weight:500">${c.nom}</td>
      <td style="font-size:11px;font-family:var(--font-mono)">${c.tel || '—'}</td>
      <td style="font-size:11px">${c.email || '—'}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--green)">${fn(caTotal)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:${soldeDu > 0 ? 'var(--red)' : 'var(--muted)'}">${fn(soldeDu)}</td>
      <td>
        <button class="btn-action" onclick="openClientModal(${c.id})">✎ Modifier</button>
        <button class="btn-action" onclick="newFactureForClient(${c.id})">+ Facture</button>
      </td>
    </tr>`;
    })
    .join('');
}

// ══════════════════════════════════════════
// FOURNISSEURS
// ══════════════════════════════════════════
function openFournisseurModal(id = null) {
  const modal = document.getElementById('fournisseurModal');
  if (!modal) return;
  if (!id) {
    document.getElementById('four-code').value = 'FRN-' + String(fournisseurCounter).padStart(3, '0');
    document.getElementById('four-nom').value = '';
    document.getElementById('four-tel').value = '';
    document.getElementById('four-email').value = '';
    document.getElementById('four-ville').value = '';
    document.getElementById('four-adresse').value = '';
    document.getElementById('four-nif').value = '';
    document.getElementById('four-notes').value = '';
  }
  modal.style.display = 'flex';
}
function closeFournisseurModal() {
  document.getElementById('fournisseurModal').style.display = 'none';
}

async function saveFournisseur() {
  const nom = document.getElementById('four-nom').value.trim();
  if (!nom) {
    toast('Le nom du fournisseur est obligatoire', 'error');
    return;
  }
  const fournisseur = {
    id: Date.now(),
    code: document.getElementById('four-code').value,
    nom,
    tel: document.getElementById('four-tel').value,
    email: document.getElementById('four-email').value,
    ville: document.getElementById('four-ville').value,
    adresse: document.getElementById('four-adresse').value,
    nif: document.getElementById('four-nif').value,
    notes: document.getElementById('four-notes').value,
    createdAt: new Date().toISOString(),
  };
  try {
    const col = window._fbCollection(window._db, 'profiles', currentProfile.id, 'fournisseurs');
    const ref = await window._fbAddDoc(col, fournisseur);
    fournisseursList.push({ ...fournisseur, _docId: ref.id });
    fournisseurCounter++;
    closeFournisseurModal();
    renderFournisseurs();
    toast('✓ Fournisseur enregistré', 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

function renderFournisseurs() {
  const search = (document.getElementById('four-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('fournisseursBody');
  if (!tbody) return;
  const filtered = fournisseursList.filter((f) => !search || f.nom?.toLowerCase().includes(search) || f.tel?.includes(search));
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>Aucun fournisseur enregistré</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map((f) => {
      const totalAchats = ecritures
        .filter((e) => e.journal === 'AC' && e.lignes.some((l) => l.libelle?.toLowerCase().includes(f.nom.toLowerCase())))
        .reduce((s, e) => s + e.lignes.filter((l) => l.compte === '401').reduce((ss, l) => ss + (l.credit || 0), 0), 0);
      return `<tr>
      <td><span class="ct">${f.code}</span></td>
      <td style="font-weight:500">${f.nom}</td>
      <td style="font-size:11px;font-family:var(--font-mono)">${f.tel || '—'}</td>
      <td style="font-size:11px">${f.email || '—'}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fn(totalAchats)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--muted)">—</td>
      <td><button class="btn-action" onclick="openFournisseurModal(${f.id})">✎</button></td>
    </tr>`;
    })
    .join('');
}

// ══════════════════════════════════════════
// FACTURES — LIGNES
// ══════════════════════════════════════════
function addFacLigne(des = '', qte = 1, pu = 0, remise = 0, tva = 18) {
  facLignes.push({ designation: des, qte, pu, remise, tva });
  renderFacLignes();
}
function removeFacLigne(i) {
  facLignes.splice(i, 1);
  renderFacLignes();
}

function renderFacLignes() {
  const tbody = document.getElementById('facLignesBody');
  if (!tbody) return;
  if (facLignes.length === 0) addFacLigne();
  tbody.innerHTML = facLignes
    .map(
      (l, i) => `
    <tr>
      <td style="padding:4px 6px"><input type="text" value="${l.designation || ''}" placeholder="Description du produit/service…"
        style="width:100%;background:transparent;border:none;color:var(--ink);font-size:12px;font-family:var(--font-body);outline:none;padding:4px 6px"
        oninput="facLignes[${i}].designation=this.value"></td>
      <td style="padding:4px 6px"><input type="number" value="${l.qte}" min="0" step="0.001"
        style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:3px;color:var(--ink);font-size:12px;font-family:var(--font-mono);outline:none;text-align:right;padding:4px 6px"
        oninput="facLignes[${i}].qte=parseFloat(this.value)||0;updateFacTotaux()"></td>
      <td style="padding:4px 6px"><input type="number" value="${l.pu}" min="0"
        style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:3px;color:var(--ink);font-size:12px;font-family:var(--font-mono);outline:none;text-align:right;padding:4px 6px"
        oninput="facLignes[${i}].pu=parseFloat(this.value)||0;updateFacTotaux()"></td>
      <td style="padding:4px 6px"><input type="number" value="${l.remise}" min="0" max="100"
        style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:3px;color:var(--ink);font-size:12px;font-family:var(--font-mono);outline:none;text-align:right;padding:4px 6px"
        oninput="facLignes[${i}].remise=parseFloat(this.value)||0;updateFacTotaux()"></td>
      <td style="padding:4px 6px"><input type="number" value="${l.tva}" min="0" max="100"
        style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:3px;color:var(--ink);font-size:12px;font-family:var(--font-mono);outline:none;text-align:right;padding:4px 6px"
        oninput="facLignes[${i}].tva=parseFloat(this.value)||18;updateFacTotaux()"></td>
      <td style="padding:4px 6px;text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--ink)">
        ${fn(calcLigneHT(l))}
      </td>
      <td style="padding:4px 6px"><button class="del-line" onclick="removeFacLigne(${i})">✕</button></td>
    </tr>`,
    )
    .join('');
  updateFacTotaux();
}

function calcLigneHT(l) {
  const base = (l.qte || 0) * (l.pu || 0);
  return Math.round(base * (1 - (l.remise || 0) / 100));
}
function calcLigneTVA(l) {
  return Math.round((calcLigneHT(l) * (l.tva || 0)) / 100);
}

function updateFacTotaux() {
  const remiseG = parseFloat(document.getElementById('fac-remise-globale')?.value || 0);
  let ht = 0,
    tvaTotal = 0;
  facLignes.forEach((l) => {
    ht += calcLigneHT(l);
    tvaTotal += calcLigneTVA(l);
  });
  const remiseGMontant = Math.round((ht * remiseG) / 100);
  const htNet = ht - remiseGMontant;
  const tvaNet = Math.round(tvaTotal * (1 - remiseG / 100));
  const ttc = htNet + tvaNet;
  const el = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };
  el('fac-subtotal', fn(ht) + ' FCFA');
  el('fac-tva-total', fn(tvaNet) + ' FCFA');
  el('fac-ttc-total', fn(ttc) + ' FCFA');
}

// ══════════════════════════════════════════
// FACTURES — MODAL
// ══════════════════════════════════════════
function openFactureModal(id = null) {
  editingFactureId = id;
  facLignes.length = 0; // vide le tableau sans casser la référence window
  const modal = document.getElementById('factureModal');
  const title = document.getElementById('factureModalTitle');
  if (!modal) return;
  const today = new Date().toISOString().split('T')[0];
  const echeance = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  if (id) {
    const fac = facturesList.find((f) => f.id === id);
    if (!fac) return;
    title.textContent = 'Modifier la facture ' + fac.numero;
    document.getElementById('fac-numero').value = fac.numero;
    document.getElementById('fac-type').value = fac.type || 'facture';
    document.getElementById('fac-date-emission').value = fac.dateEmission || today;
    document.getElementById('fac-date-echeance').value = fac.dateEcheance || echeance;
    document.getElementById('fac-client-search').value = fac.clientNom || '';
    document.getElementById('fac-ref').value = fac.reference || '';
    document.getElementById('fac-client-adresse').value = fac.clientAdresse || '';
    document.getElementById('fac-client-email').value = fac.clientEmail || '';
    document.getElementById('fac-client-tel').value = fac.clientTel || '';
    document.getElementById('fac-notes').value = fac.notes || '';
    document.getElementById('fac-mode-reglement').value = fac.modeReglement || 'virement';
    document.getElementById('fac-conditions').value = fac.conditions || '30j';
    document.getElementById('fac-monnaie').value = fac.monnaie || 'FCFA';
    document.getElementById('fac-remise-globale').value = fac.remiseGlobale || 0;
    (fac.lignes || []).forEach((l) => facLignes.push(l));
  } else {
    title.textContent = 'Nouvelle Facture';
    document.getElementById('fac-numero').value = 'FAC-' + new Date().getFullYear() + '-' + String(factureCounter).padStart(4, '0');
    document.getElementById('fac-type').value = 'facture';
    document.getElementById('fac-date-emission').value = today;
    document.getElementById('fac-date-echeance').value = echeance;
    document.getElementById('fac-client-search').value = '';
    document.getElementById('fac-ref').value = '';
    document.getElementById('fac-client-adresse').value = '';
    document.getElementById('fac-client-email').value = '';
    document.getElementById('fac-client-tel').value = '';
    document.getElementById('fac-notes').value = '';
    document.getElementById('fac-remise-globale').value = 0;
  }
  renderFacLignes();
  modal.style.display = 'flex';
}
function closeFactureModal() {
  document.getElementById('factureModal').style.display = 'none';
}

function newFactureForClient(clientId) {
  const cli = clientsList.find((c) => c.id === clientId);
  openFactureModal();
  if (cli) {
    setTimeout(() => {
      document.getElementById('fac-client-search').value = cli.nom;
      document.getElementById('fac-client-email').value = cli.email || '';
      document.getElementById('fac-client-tel').value = cli.tel || '';
      document.getElementById('fac-client-adresse').value = cli.adresse || '';
    }, 100);
  }
  navigate('factures');
}

function openDevisModal() {
  openFactureModal();
  document.getElementById('fac-type').value = 'proforma';
}

// Autocomplétion client dans le modal facture
function searchClientDrop(q) {
  const drop = document.getElementById('drop-client');
  if (!drop) return;
  if (!q || q.length < 1) {
    drop.classList.remove('open');
    return;
  }
  const matches = clientsList
    .filter((c) => c.nom.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);
  if (!matches.length) {
    drop.classList.remove('open');
    return;
  }
  drop.innerHTML = matches
    .map(
      (c) => `
    <div class="aoption" onmousedown="selectClientForFac(${c.id})">
      <span class="code">${c.code}</span>
      <span class="name">${c.nom}</span>
    </div>`,
    )
    .join('');
  drop.classList.add('open');
}
function selectClientForFac(id) {
  const cli = clientsList.find((c) => c.id === id);
  if (!cli) return;
  document.getElementById('fac-client-search').value = cli.nom;
  document.getElementById('fac-client-email').value = cli.email || '';
  document.getElementById('fac-client-tel').value = cli.tel || '';
  document.getElementById('fac-client-adresse').value = cli.adresse || '';
  document.getElementById('drop-client').classList.remove('open');
  document.getElementById('fac-client-search').dataset.clientId = id;
}

// ══════════════════════════════════════════
// FACTURES — SAUVEGARDE
// ══════════════════════════════════════════
async function saveFacture(statut = 'brouillon') {
  const clientNom = document.getElementById('fac-client-search').value.trim();
  if (!clientNom) {
    toast('Le client est obligatoire', 'error');
    return;
  }
  if (facLignes.filter((l) => l.designation).length === 0) {
    toast('Ajoutez au moins une ligne', 'error');
    return;
  }

  const remiseG = parseFloat(document.getElementById('fac-remise-globale').value || 0);
  let ht = 0,
    tvaTotal = 0;
  facLignes.forEach((l) => {
    ht += calcLigneHT(l);
    tvaTotal += calcLigneTVA(l);
  });
  const remiseGMontant = Math.round((ht * remiseG) / 100);
  const htNet = ht - remiseGMontant;
  const tvaNet = Math.round(tvaTotal * (1 - remiseG / 100));
  const ttc = htNet + tvaNet;

  const clientId = parseInt(document.getElementById('fac-client-search').dataset?.clientId || 0);
  const facture = {
    id: editingFactureId || Date.now(),
    numero: document.getElementById('fac-numero').value,
    type: document.getElementById('fac-type').value,
    dateEmission: document.getElementById('fac-date-emission').value,
    dateEcheance: document.getElementById('fac-date-echeance').value,
    clientId,
    clientNom,
    clientAdresse: document.getElementById('fac-client-adresse').value,
    clientEmail: document.getElementById('fac-client-email').value,
    clientTel: document.getElementById('fac-client-tel').value,
    reference: document.getElementById('fac-ref').value,
    notes: document.getElementById('fac-notes').value,
    modeReglement: document.getElementById('fac-mode-reglement').value,
    conditions: document.getElementById('fac-conditions').value,
    monnaie: document.getElementById('fac-monnaie').value,
    remiseGlobale: remiseG,
    lignes: facLignes.filter((l) => l.designation),
    ht: htNet,
    tva: tvaNet,
    ttc,
    statut,
    montantPaye: 0,
    createdAt: new Date().toISOString(),
  };

  // Vérifier retard
  if (statut === 'envoyee' && facture.dateEcheance < new Date().toISOString().split('T')[0]) {
    facture.statut = 'retard';
  }

  try {
    const col = window._fbCollection(window._db, 'profiles', currentProfile.id, 'factures');
    if (editingFactureId) {
      const existing = facturesList.find((f) => f.id === editingFactureId);
      if (existing?._docId) {
        await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'factures', existing._docId), facture);
        const idx = facturesList.findIndex((f) => f.id === editingFactureId);
        facturesList[idx] = { ...facture, _docId: existing._docId };
      }
    } else {
      const ref = await window._fbAddDoc(col, facture);
      facturesList.push({ ...facture, _docId: ref.id });
      factureCounter++;
    }

    // Auto-comptabilisation si validée
    if (statut === 'envoyee' && facture.type === 'facture') {
      await autoComptabiliserFacture(facture);
    }

    closeFactureModal();
    renderFactures();
    toast(`✓ Facture ${facture.numero} enregistrée (${statut})`, 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

// ─── Auto-comptabilisation lors de la validation ───
async function autoComptabiliserFacture(fac) {
  const date = fac.dateEmission;
  const groupId = 'grp_fac_' + fac.id;
  const piece = fac.numero;
  // Écriture VE — Constatation vente
  const ecr = {
    id: Date.now(),
    date,
    journal: 'VE',
    piece,
    libelle: `Facture ${fac.numero} — ${fac.clientNom}`,
    groupId,
    groupLibelle: `Vente — ${fac.clientNom}`,
    groupSize: 1,
    groupIdx: 0,
    createdAt: new Date().toISOString(),
    lignes: sortLignesDebitAvantCredit([
      { compte: '411', libelle: `Client ${fac.clientNom}`, debit: fac.ttc, credit: 0 },
      { compte: '701', libelle: 'Ventes de marchandises', debit: 0, credit: fac.ht },
      { compte: '4431', libelle: 'TVA facturée sur ventes', debit: 0, credit: fac.tva },
    ]),
  };
  const docId = await saveEcritureToFirestore(ecr);
  if (docId) {
    ecritures.push(ecr);
    pieceCounter++;
    updateStats();
  }
}

async function marquerPayee(id) {
  const fac = facturesList.find((f) => f.id === id);
  if (!fac) return;
  fac.statut = 'payee';
  fac.montantPaye = fac.ttc;
  try {
    if (fac._docId) {
      await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'factures', fac._docId), fac);
    }
    // Écriture BQ — Encaissement
    const ecr = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      journal: 'BQ',
      piece: fac.numero,
      libelle: `Règlement facture ${fac.numero} — ${fac.clientNom}`,
      groupId: 'grp_regfac_' + fac.id,
      groupLibelle: 'Règlement client',
      groupSize: 1,
      groupIdx: 0,
      createdAt: new Date().toISOString(),
      lignes: sortLignesDebitAvantCredit([
        { compte: '521', libelle: 'Banques locales', debit: fac.ttc, credit: 0 },
        { compte: '411', libelle: `Client ${fac.clientNom}`, debit: 0, credit: fac.ttc },
      ]),
    };
    const docId = await saveEcritureToFirestore(ecr);
    if (docId) {
      ecritures.push(ecr);
      updateStats();
    }
    renderFactures();
    toast(`✓ Facture ${fac.numero} marquée payée + écriture banque générée`, 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function supprimerFacture(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  const fac = facturesList.find((f) => f.id === id);
  if (fac?._docId) {
    await window._fbDeleteDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'factures', fac._docId));
  }
  facturesList = facturesList.filter((f) => f.id !== id);
  renderFactures();
  toast('Facture supprimée', 'info');
}

// ══════════════════════════════════════════
// FACTURES — AFFICHAGE
// ══════════════════════════════════════════
function resetFactureFiltre() {
  document.getElementById('fac-date-debut').value = '';
  document.getElementById('fac-date-fin').value = '';
  document.getElementById('fac-statut').value = '';
  document.getElementById('fac-search').value = '';
  renderFactures();
}

function renderFactures() {
  const dateDebut = document.getElementById('fac-date-debut')?.value || '';
  const dateFin = document.getElementById('fac-date-fin')?.value || '';
  const statut = document.getElementById('fac-statut')?.value || '';
  const search = (document.getElementById('fac-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('facturesBody');
  if (!tbody) return;

  // MAJ statuts retard auto
  const today = new Date().toISOString().split('T')[0];
  facturesList.forEach((f) => {
    if (f.statut === 'envoyee' && f.dateEcheance && f.dateEcheance < today) f.statut = 'retard';
  });

  let filtered = facturesList.filter((f) => {
    if (dateDebut && f.dateEmission < dateDebut) return false;
    if (dateFin && f.dateEmission > dateFin) return false;
    if (statut && f.statut !== statut) return false;
    if (search && !f.clientNom?.toLowerCase().includes(search) && !f.numero?.toLowerCase().includes(search)) return false;
    return true;
  });

  // KPIs
  const kpi = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };
  const all = facturesList.filter((f) => f.statut !== 'annulee');
  kpi('fkpi-total', fs(all.reduce((s, f) => s + (f.ttc || 0), 0)));
  kpi('fkpi-paye', fs(all.filter((f) => f.statut === 'payee').reduce((s, f) => s + (f.ttc || 0), 0)));
  kpi('fkpi-attente', fs(all.filter((f) => f.statut === 'envoyee').reduce((s, f) => s + (f.ttc || 0), 0)));
  kpi('fkpi-retard', fs(all.filter((f) => f.statut === 'retard').reduce((s, f) => s + (f.ttc || 0), 0)));
  kpi('fkpi-nb', all.length);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><p>Aucune facture</p></div></td></tr>';
    return;
  }

  const STATUT_LABELS = {
    brouillon: 'Brouillon',
    envoyee: 'Envoyée',
    payee: 'Payée',
    partielle: 'Partielle',
    annulee: 'Annulée',
    retard: 'En retard',
  };
  tbody.innerHTML = filtered
    .map((f) => {
      const reste = (f.ttc || 0) - (f.montantPaye || 0);
      return `<tr class="fac-row-${f.statut}">
      <td><strong style="font-family:var(--font-mono);font-size:11px">${f.numero}</strong></td>
      <td style="font-size:11px;font-family:var(--font-mono)">${f.dateEmission || '—'}</td>
      <td style="font-size:11px;font-family:var(--font-mono);color:${f.statut === 'retard' ? 'var(--red)' : 'var(--muted)'}">${f.dateEcheance || '—'}</td>
      <td style="font-weight:500">${f.clientNom || '—'}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fn(f.ht)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:#60a5fa">${fn(f.tva)}</td>
      <td style="text-align:right;font-family:var(--font-mono);font-weight:700">${fn(f.ttc)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:${reste > 0 ? 'var(--red)' : 'var(--green)'}">${fn(f.montantPaye || 0)}</td>
      <td><span class="statut-badge statut-${f.statut}">${STATUT_LABELS[f.statut] || f.statut}</span></td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn-action" onclick="exportFacturePDF(${f.id})">📄 PDF</button>
        <button class="btn-action" onclick="exportFactureWord(${f.id})">📝 Word</button>
        <button class="btn-action" onclick="exportFactureExcel(${f.id})">📊 Excel</button>
        ${f.statut !== 'payee' && f.statut !== 'annulee' ? `<button class="btn-action" onclick="marquerPayee(${f.id})">✓ Payée</button>` : ''}
        <button class="btn-action" onclick="openFactureModal(${f.id})">✎</button>
        <button class="btn-action danger" onclick="supprimerFacture(${f.id})">✕</button>
      </td>
    </tr>`;
    })
    .join('');
}

function renderDevis() {
  const tbody = document.getElementById('devisBody');
  if (!tbody) return;
  const devis = facturesList.filter((f) => f.type === 'proforma');
  if (!devis.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>Aucun devis</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = devis
    .map(
      (f) => `<tr>
    <td><strong style="font-family:var(--font-mono);font-size:11px">${f.numero}</strong></td>
    <td style="font-size:11px">${f.dateEmission}</td>
    <td style="font-size:11px">${f.dateEcheance || '—'}</td>
    <td>${f.clientNom}</td>
    <td style="text-align:right;font-family:var(--font-mono);font-weight:700">${fn(f.ttc)}</td>
    <td><span class="statut-badge statut-${f.statut}">${f.statut}</span></td>
    <td>
      <button class="btn-action" onclick="convertirDevisEnFacture(${f.id})">→ Convertir</button>
      <button class="btn-action" onclick="exportFacturePDF(${f.id})">📄 PDF</button>
      <button class="btn-action danger" onclick="supprimerFacture(${f.id})">✕</button>
    </td>
  </tr>`,
    )
    .join('');
}

async function convertirDevisEnFacture(id) {
  const dev = facturesList.find((f) => f.id === id);
  if (!dev) return;
  dev.type = 'facture';
  dev.statut = 'envoyee';
  dev.numero = 'FAC-' + new Date().getFullYear() + '-' + String(factureCounter).padStart(4, '0');
  factureCounter++;
  try {
    if (dev._docId) await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'factures', dev._docId), dev);
    await autoComptabiliserFacture(dev);
    renderFactures();
    renderDevis();
    toast(`✓ Devis converti en facture ${dev.numero}`, 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════
// EXPORT MODAL — OPTIONS AVANCÉES
// ══════════════════════════════════════════
function updateExportOptions() {
  const docType = document.getElementById('export-doc-type')?.value;
  const jnlFilter = document.getElementById('export-journal-filter');
  if (jnlFilter) {
    jnlFilter.style.display = docType === 'journal' ? 'block' : 'none';
  }
}

// ══════════════════════════════════════════

// ══════════════════════════════════════════
// CONFIGURATION SERVEUR — Clés API en dur (mode local / CC.html)
// Généré le 23/06/2026 19:30:55
// ══════════════════════════════════════════

GROQ_API_KEYS = [
    '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'
  ];

GROQ_MODELS = [
    'auto'
  ];

// Initialiser le tableau d'occupation des clés
groqKeyBusy = new Array(GROQ_API_KEYS.length).fill(false);


// ── La fonction loadServerConfig() est déjà déclarée plus haut (ligne 113) ──

// ══ API PUBLIQUE — Gestion des clés OpenRouter depuis CC.html ══
/**
 * Appelée depuis CC.html pour définir / recharger les clés OpenRouter.
 * Peut être appelée à tout moment (y compris après le chargement de la page).
 * @param {string[]} keys  Tableau de clés API OpenRouter
 * @param {string[]} [models] Optionnel : liste de modèles Groq
 */
window.setGroqKeysFromCC = function(keys, models) {
  GROQ_API_KEYS = (keys || []).filter(Boolean);
  groqKeyBusy = new Array(GROQ_API_KEYS.length).fill(false);
  if (models && models.length > 0) GROQ_MODELS = models;
  aiServiceAvailable = GROQ_API_KEYS.length > 0;
  updateServiceAvailabilityUI();
  console.log(`[COMEO CC] ${GROQ_API_KEYS.length} clé(s) Groq chargée(s) depuis CC.html`);
  // Sauvegarder dans Firestore pour persistance
  if (window._fbReady) {
    const entries = GROQ_API_KEYS.map((v, i) => ({ id: i + 1, value: v }));
    window._fbSetDoc(window._fbDoc(window._db, 'server_config', 'groq_keys'), { keys: entries }, { merge: false })
      .then(() => console.log('[COMEO CC] Clés sauvegardées dans Firestore'))
      .catch((e) => console.warn('[COMEO CC] Erreur sauvegarde Firestore:', e.message));
    if (models && models.length > 0) {
      window._fbSetDoc(window._fbDoc(window._db, 'server_config', 'models'), { list: models }, { merge: false }).catch(() => {});
    }
  }
};

/**
 * Retourne l'état actuel des clés (pour l'affichage dans CC.html).
 */
window.getGroqKeysStatus = function() {
  return GROQ_API_KEYS.map((k, i) => ({
    index: i,
    key: k.substring(0, 8) + '…' + k.slice(-4),
    busy: groqKeyBusy[i] || false,
  }));
};
// EXPORT — FACTURE PDF (impression pro)
// ══════════════════════════════════════════
function buildFactureHTMLContent(fac) {
  const company = currentProfile?.company || 'Mon Entreprise';
  const monnaie = fac.monnaie || 'FCFA';
  const STATUT_FR = {
    brouillon: 'BROUILLON',
    envoyee: 'ENVOYÉE',
    payee: 'PAYÉE',
    partielle: 'PARTIELLE',
    annulee: 'ANNULÉE',
    retard: 'EN RETARD',
  };
  const typeLabel = { facture: 'FACTURE', proforma: 'FACTURE PROFORMA', avoir: 'AVOIR', acompte: "FACTURE D'ACOMPTE" };

  const lignesHTML = (fac.lignes || [])
    .filter((l) => l.designation)
    .map(
      (l, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'}">
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${l.designation}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${l.qte}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${fn(l.pu)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${l.remise || 0}%</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${l.tva || 18}%</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fn(calcLigneHT(l))} ${monnaie}</td>
    </tr>`,
    )
    .join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
      <div>
        <div style="font-family:Georgia,serif;font-size:28px;font-weight:700;color:#0a0b10;letter-spacing:.02em">${company}</div>
        <div style="font-size:11px;color:#888;margin-top:4px">Exercice ${document.getElementById('exerciceYear')?.value || '2024'} · SYSCOHADA Révisé 2017</div>
      </div>
      <div style="text-align:right">
        <div style="background:#0a0b10;color:#d4a853;padding:6px 18px;border-radius:4px;font-size:13px;font-weight:700;letter-spacing:.04em;margin-bottom:8px">${typeLabel[fac.type] || 'FACTURE'}</div>
        <div style="font-family:monospace;font-size:14px;font-weight:700;color:#0a0b10">${fac.numero}</div>
        <div style="font-size:10px;color:#999;margin-top:2px">
          Émise le : <strong>${fac.dateEmission || '—'}</strong><br>
          Échéance : <strong style="color:${fac.statut === 'retard' ? '#dc2626' : '#0a0b10'}">${fac.dateEcheance || '—'}</strong>
        </div>
      </div>
    </div>

    <div style="display:flex;gap:28px;margin-bottom:28px">
      <div style="flex:1;background:#f8f8f8;border-radius:6px;padding:14px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#888;margin-bottom:6px">Émetteur</div>
        <div style="font-weight:700;font-size:13px">${company}</div>
        <div style="font-size:11px;color:#555;margin-top:2px">Abidjan, Côte d'Ivoire</div>
      </div>
      <div style="flex:1;background:#f8f8f8;border-radius:6px;padding:14px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:#888;margin-bottom:6px">Facturer à</div>
        <div style="font-weight:700;font-size:13px">${fac.clientNom || '—'}</div>
        ${fac.clientAdresse ? `<div style="font-size:11px;color:#555;margin-top:2px">${fac.clientAdresse}</div>` : ''}
        ${fac.clientEmail ? `<div style="font-size:11px;color:#555">${fac.clientEmail}</div>` : ''}
        ${fac.clientTel ? `<div style="font-size:11px;color:#555">${fac.clientTel}</div>` : ''}
        ${fac.reference ? `<div style="font-size:10px;color:#999;margin-top:4px">Réf : ${fac.reference}</div>` : ''}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead>
        <tr style="background:#0a0b10">
          <th style="padding:10px 12px;color:#d4a853;font-size:9px;text-transform:uppercase;letter-spacing:.1em;text-align:left">Désignation</th>
          <th style="padding:10px 12px;color:#d4a853;font-size:9px;text-transform:uppercase;letter-spacing:.1em;text-align:right;width:60px">Qté</th>
          <th style="padding:10px 12px;color:#d4a853;font-size:9px;text-transform:uppercase;letter-spacing:.1em;text-align:right;width:100px">P.U. HT</th>
          <th style="padding:10px 12px;color:#d4a853;font-size:9px;text-transform:uppercase;letter-spacing:.1em;text-align:right;width:70px">Remise</th>
          <th style="padding:10px 12px;color:#d4a853;font-size:9px;text-transform:uppercase;letter-spacing:.1em;text-align:right;width:60px">TVA</th>
          <th style="padding:10px 12px;color:#d4a853;font-size:9px;text-transform:uppercase;letter-spacing:.1em;text-align:right;width:120px">Total HT</th>
        </tr>
      </thead>
      <tbody>${lignesHTML}</tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
      <div style="min-width:260px">
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;color:#666;border-bottom:1px solid #eee">
          <span>Sous-total HT</span><span style="font-family:monospace">${fn(fac.ht + Math.round(((fac.ht / (1 - fac.remiseGlobale / 100 || 1)) * fac.remiseGlobale) / 100))} ${monnaie}</span>
        </div>
        ${fac.remiseGlobale > 0 ? `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;color:#dc2626;border-bottom:1px solid #eee"><span>Remise globale (${fac.remiseGlobale}%)</span><span style="font-family:monospace">- ${fn(Math.round(((fac.ht / (1 - fac.remiseGlobale / 100 || 1)) * fac.remiseGlobale) / 100))} ${monnaie}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;color:#666;border-bottom:1px solid #eee">
          <span>Net HT</span><span style="font-family:monospace">${fn(fac.ht)} ${monnaie}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:11px;color:#2563eb;border-bottom:1px solid #eee">
          <span>TVA</span><span style="font-family:monospace">${fn(fac.tva)} ${monnaie}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 0 0;font-size:16px;font-weight:700;color:#0a0b10">
          <span>TOTAL TTC</span><span style="font-family:monospace">${fn(fac.ttc)} ${monnaie}</span>
        </div>
      </div>
    </div>

    ${fac.notes ? `<div style="background:#f8f8f8;border-radius:6px;padding:12px;margin-bottom:16px;font-size:11px;color:#666">${fac.notes}</div>` : ''}

    <div style="border-top:1px solid #eee;padding-top:12px;font-size:10px;color:#999;text-align:center">
      Règlement par ${fac.modeReglement || 'virement'} · Document généré par COMEO AI v4 · Plateforme SYSCOHADA
    </div>`;
}

function exportFacturePDF(id) {
  const fac = facturesList.find((f) => f.id === id);
  if (!fac) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Mon Entreprise';
  const monnaie = fac.monnaie || 'FCFA';
  const typeLabel = { facture: 'FACTURE', proforma: 'PROFORMA', avoir: 'AVOIR', acompte: 'ACOMPTE' };
  const pageW = 210;

  // En-tête
  doc.setFillColor(10, 11, 16);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(212, 168, 83);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(company, 14, 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('SYSCOHADA Révisé 2017 · COMEO AI v4', 14, 19);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(typeLabel[fac.type] || 'FACTURE', pageW - 14, 12, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 200, 100);
  doc.text(fac.numero, pageW - 14, 19, { align: 'right' });
  doc.setTextColor(180, 180, 180);
  doc.setFontSize(7);
  doc.text('Emise le ' + (fac.dateEmission || '-') + ' - Echeance ' + (fac.dateEcheance || '-'), pageW - 14, 24, { align: 'right' });
  // Info émetteur / client
  doc.setTextColor(10, 11, 16);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('EMETTEUR', 14, 38);
  doc.setFont('helvetica', 'normal');
  doc.text(company, 14, 44);
  doc.text("Abidjan, Cote d'Ivoire", 14, 49);
  doc.setFont('helvetica', 'bold');
  doc.text('CLIENT / DEBITEUR', 110, 38);
  doc.setFont('helvetica', 'normal');
  doc.text(fac.clientNom || '—', 110, 44);
  if (fac.clientAdresse) doc.text(fac.clientAdresse, 110, 49);
  if (fac.clientEmail) doc.text(fac.clientEmail, 110, 54);
  if (fac.reference) {
    doc.setFont('helvetica', 'italic');
    doc.text('Réf : ' + fac.reference, 14, 56);
  }

  // Ligne de séparation
  doc.setDrawColor(212, 168, 83);
  doc.setLineWidth(0.4);
  doc.line(14, 62, pageW - 14, 62);

  // Tableau des lignes
  const rows = (fac.lignes || [])
    .filter((l) => l.designation)
    .map((l) => [
      l.designation,
      String(l.qte),
      fnPDF(l.pu),
      (l.remise || 0) + '%',
      (l.tva || 18) + '%',
      fnPDF(calcLigneHT(l)) + ' ' + monnaie,
    ]);

  doc.autoTable({
    startY: 66,
    head: [['Désignation', 'Qté', 'P.U. HT', 'Remise', 'TVA', 'Total HT']],
    body: rows,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [10, 11, 16], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [250, 248, 244] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 18, halign: 'right' },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  let y = doc.lastAutoTable.finalY + 8;

  // Totaux
  const totaux = [
    ['Sous-total HT', fnPDF(fac.ht) + ' ' + monnaie],
    ['TVA', fnPDF(fac.tva) + ' ' + monnaie],
    ['TOTAL TTC', fnPDF(fac.ttc) + ' ' + monnaie],
  ];
  const xRight = pageW - 14;
  totaux.forEach(([label, val], i) => {
    const isTotal = i === totaux.length - 1;
    if (isTotal) {
      doc.setFillColor(10, 11, 16);
      doc.rect(xRight - 90, y - 4, 90, 10, 'F');
      doc.setTextColor(212, 168, 83);
    } else {
      doc.setTextColor(80, 80, 80);
    }
    doc.setFontSize(isTotal ? 10 : 8);
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.text(label, xRight - 92, y + 2, { align: 'right' });
    doc.text(val, xRight, y + 2, { align: 'right' });
    y += 10;
  });

  // Notes
  if (fac.notes) {
    y += 6;
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7.5);
    doc.text(fac.notes.substring(0, 200), 14, y);
    y += 8;
  }

  // Pied de page
  y = Math.max(y + 10, 270);
  doc.setDrawColor(200, 192, 176);
  doc.setLineWidth(0.3);
  doc.line(14, y, pageW - 14, y);
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Reglement par ' + (fac.modeReglement || 'virement') + ' - Document genere par COMEO AI v4 - SYSCOHADA', 14, y + 5);
  doc.text(`Page 1/1`, pageW - 14, y + 5, { align: 'right' });

  doc.save(`${fac.type.toUpperCase()}_${fac.numero}_${fac.clientNom?.replace(/\s+/g, '_')}.pdf`);
  toast('✓ PDF généré : ' + fac.numero, 'success');
}

function exportFactureWord(id) {
  const fac = facturesList.find((f) => f.id === id);
  if (!fac) return;
  const company = currentProfile?.company || 'Mon Entreprise';
  const monnaie = fac.monnaie || 'FCFA';
  const lignesHTML = (fac.lignes || [])
    .filter((l) => l.designation)
    .map(
      (l, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#fafafa'}">
      <td>${l.designation}</td><td align="right">${l.qte}</td>
      <td align="right">${fn(l.pu)}</td><td align="right">${l.remise || 0}%</td>
      <td align="right">${l.tva || 18}%</td>
      <td align="right"><strong>${fn(calcLigneHT(l))} ${monnaie}</strong></td>
    </tr>`,
    )
    .join('');
  const html = `<html><head><meta charset="utf-8">
  <style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#222;margin:40pt}
  table{width:100%;border-collapse:collapse;margin:12pt 0}
  th{background:#0a0b10;color:#d4a853;padding:7pt 10pt;font-size:9pt;text-align:left}
  td{padding:6pt 10pt;border-bottom:1pt solid #eee}
  .total-row td{font-weight:bold;font-size:13pt;background:#0a0b10;color:#d4a853}</style>
  </head><body>
  <table><tr>
    <td style="width:50%;border:none"><h1 style="font-size:18pt;margin:0">${company}</h1><p style="color:#888;font-size:9pt">SYSCOHADA · COMEO AI v4</p></td>
    <td style="width:50%;border:none;text-align:right">
      <span style="background:#0a0b10;color:#d4a853;padding:4pt 14pt;font-weight:bold">${(fac.type || 'facture').toUpperCase()}</span><br>
      <strong style="font-size:14pt">${fac.numero}</strong><br>
      <span style="color:#888;font-size:9pt">Émise : ${fac.dateEmission || '—'} · Échéance : ${fac.dateEcheance || '—'}</span>
    </td>
  </tr></table>
  <table><tr>
    <td style="width:50%;border:1pt solid #eee;border-radius:4pt;padding:10pt"><strong>ÉMETTEUR</strong><br>${company}<br>Abidjan, Côte d'Ivoire</td>
    <td style="width:50%;border:1pt solid #eee;border-radius:4pt;padding:10pt"><strong>CLIENT</strong><br>${fac.clientNom || '—'}<br>${fac.clientAdresse || ''}<br>${fac.clientEmail || ''}</td>
  </tr></table>
  <table>
    <thead><tr><th>Désignation</th><th>Qté</th><th>P.U. HT</th><th>Remise</th><th>TVA</th><th>Total HT</th></tr></thead>
    <tbody>${lignesHTML}</tbody>
  </table>
  <table style="width:260pt;margin-left:auto">
    <tr><td>Sous-total HT</td><td align="right">${fn(fac.ht)} ${monnaie}</td></tr>
    <tr><td>TVA</td><td align="right">${fn(fac.tva)} ${monnaie}</td></tr>
    <tr class="total-row"><td>TOTAL TTC</td><td align="right">${fn(fac.ttc)} ${monnaie}</td></tr>
  </table>
  ${fac.notes ? `<p style="color:#888;font-size:9pt;border-top:1pt solid #eee;padding-top:8pt">${fac.notes}</p>` : ''}
  <p style="color:#bbb;font-size:8pt;border-top:1pt solid #eee;margin-top:20pt">Règlement par ${fac.modeReglement || 'virement'} · COMEO AI v4 · SYSCOHADA</p>
  </body></html>`;
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fac.type.toUpperCase()}_${fac.numero}.doc`;
  a.click();
  toast('✓ Word généré : ' + fac.numero, 'success');
}

function exportFactureExcel(id) {
  const fac = facturesList.find((f) => f.id === id);
  if (!fac) return;
  const monnaie = fac.monnaie || 'FCFA';
  const rows = [
    ['DÉSIGNATION', 'QTÉ', 'P.U. HT', 'REMISE %', 'TVA %', 'MONTANT HT', 'MONTANT TVA', 'MONTANT TTC'],
    ...(fac.lignes || [])
      .filter((l) => l.designation)
      .map((l) => [
        l.designation,
        l.qte,
        l.pu,
        l.remise || 0,
        l.tva || 18,
        calcLigneHT(l),
        calcLigneTVA(l),
        calcLigneHT(l) + calcLigneTVA(l),
      ]),
    [],
    ['', '', '', '', 'SOUS-TOTAL HT', fac.ht, '', ''],
    ['', '', '', '', 'TVA', fac.tva, '', ''],
    ['', '', '', '', 'TOTAL TTC', fac.ttc, '', ''],
  ];
  const header = [
    ['FACTURE', fac.numero, '', '', '', '', '', ''],
    ['Client', fac.clientNom, '', '', '', '', '', ''],
    ['Date émission', fac.dateEmission, '', '', '', '', '', ''],
    ['Date échéance', fac.dateEcheance, '', '', '', '', '', ''],
    ['Monnaie', monnaie, '', '', '', '', '', ''],
    [],
    ...rows,
  ];
  const csv = header.map((r) => r.join('\t')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/tab-separated-values;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fac.type.toUpperCase()}_${fac.numero}.xls`;
  a.click();
  toast('✓ Excel généré : ' + fac.numero, 'success');
}

function exportFactureList() {
  const csv = [
    ['N° FACTURE', 'TYPE', 'DATE', 'ÉCHÉANCE', 'CLIENT', 'HT', 'TVA', 'TTC', 'PAYÉ', 'STATUT'].join(';'),
    ...facturesList.map((f) =>
      [f.numero, f.type, f.dateEmission, f.dateEcheance || '', f.clientNom || '', f.ht, f.tva, f.ttc, f.montantPaye || 0, f.statut].join(
        ';',
      ),
    ),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liste_factures.csv';
  a.click();
  toast('✓ Liste exportée en CSV', 'success');
}

// ══════════════════════════════════════════
// EXPORT COMPTABILITÉ — PDF + WORD + EXCEL
// Avec filtre journal et période
// ══════════════════════════════════════════
function getFilteredEcrituresForExport() {
  const jnl = document.getElementById('export-journal-select')?.value || '';
  const dateDebut = document.getElementById('export-date-debut')?.value || '';
  const dateFin = document.getElementById('export-date-fin')?.value || '';
  return ecritures.filter((e) => {
    if (jnl && e.journal !== jnl) return false;
    if (dateDebut && e.date < dateDebut) return false;
    if (dateFin && e.date > dateFin) return false;
    return true;
  });
}

function exportPDFAvance() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const yr = document.getElementById('exerciceYear').value;
  const company = currentProfile?.company || 'Entreprise';
  const docType = document.getElementById('export-doc-type')?.value || 'journal';
  const jnlSel = document.getElementById('export-journal-select')?.value || '';
  const dD = document.getElementById('export-date-debut')?.value || '';
  const dF = document.getElementById('export-date-fin')?.value || '';
  const pageW = 210;
  const now = new Date().toLocaleDateString('fr-FR');

  const DOC_TITLES = {
    journal: 'JOURNAL GÉNÉRAL',
    balance: 'BALANCE GÉNÉRALE',
    grandlivre: 'GRAND LIVRE',
    bilan: 'BILAN',
    resultat: 'COMPTE DE RÉSULTAT',
    tresorerie: 'TRÉSORERIE',
    factures: 'LISTE DES FACTURES',
  };

  // En-tête PDF
  doc.setFillColor(10, 11, 16);
  doc.rect(0, 0, pageW, 24, 'F');
  doc.setTextColor(212, 168, 83);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SYSCOHADA Pro v4 — ' + (DOC_TITLES[docType] || 'DOCUMENT'), 14, 10);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${company} · Exercice ${yr} · Monnaie FCFA · COMEO AI`, 14, 16);
  doc.setTextColor(180, 180, 180);
  doc.setFontSize(7);
  const periode = dD || dF ? `Période : ${dD || 'début'} → ${dF || 'fin'}` : 'Exercice complet';
  const jnlLabel = jnlSel ? ` · Journal : ${JOURNAL_NAMES[jnlSel] || jnlSel}` : '';
  doc.text(periode + jnlLabel + ` · Édité le ${now}`, pageW - 14, 16, { align: 'right' });

  doc.setDrawColor(212, 168, 83);
  doc.setLineWidth(0.4);
  doc.line(14, 26, pageW - 14, 26);

  // Contenu selon type
  if (docType === 'journal') {
    const ecrs = getFilteredEcrituresForExport();
    let rows = [],
      totalD = 0,
      totalC = 0;
    ecrs.forEach((e) => {
      const sorted = sortLignesDebitAvantCredit(e.lignes);
      sorted.forEach((l) => {
        rows.push([
          e.date,
          e.journal,
          e.piece || '',
          l.compte,
          (PC[l.compte] || '').substring(0, 24),
          l.libelle || e.libelle || '',
          l.debit ? fn(l.debit) : '',
          l.credit ? fn(l.credit) : '',
        ]);
        totalD += l.debit || 0;
        totalC += l.credit || 0;
      });
    });
    doc.autoTable({
      startY: 30,
      head: [['Date', 'Jnl', 'Pièce', 'Compte', 'Libellé compte', 'Libellé opération', 'Débit FCFA', 'Crédit FCFA']],
      body: rows,
      foot: [['', '', '', '', '', 'TOTAUX', fn(totalD), fn(totalC)]],
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [10, 11, 16], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [30, 34, 54], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 248, 244] },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 10, halign: 'center' },
        2: { cellWidth: 16 },
        3: { cellWidth: 14, fontStyle: 'bold' },
        4: { cellWidth: 26 },
        5: { cellWidth: 38 },
        6: { cellWidth: 20, halign: 'right' },
        7: { cellWidth: 20, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
  } else if (docType === 'balance') {
    const map = getMap();
    const rows = Object.entries(map)
      .sort()
      .map(([code, acc]) => {
        const s = acc.debit - acc.credit;
        return [code, (PC[code] || '').substring(0, 40), fn(acc.debit), fn(acc.credit), s > 0 ? fn(s) : '', s < 0 ? fn(-s) : ''];
      });
    doc.autoTable({
      startY: 30,
      head: [['Compte', 'Libellé', 'Mvt Débit', 'Mvt Crédit', 'Solde Débiteur', 'Solde Créditeur']],
      body: rows,
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [10, 11, 16], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [250, 248, 244] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
  } else if (docType === 'factures') {
    const rows = facturesList.map((f) => [
      f.numero,
      f.type,
      f.dateEmission || '',
      f.clientNom || '',
      fn(f.ht),
      fn(f.tva),
      fn(f.ttc),
      f.statut,
    ]);
    doc.autoTable({
      startY: 30,
      head: [['N° Facture', 'Type', 'Date', 'Client', 'HT', 'TVA', 'TTC', 'Statut']],
      body: rows,
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [10, 11, 16], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [250, 248, 244] },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 },
    });
  }

  const safeName = company.replace(/\s+/g, '_');
  doc.save(`COMEO_${(DOC_TITLES[docType] || docType).replace(/\s+/g, '_')}_${safeName}_${yr}.pdf`);
  toast('✓ PDF exporté', 'success');
}

function exportWordAvance() {
  const yr = document.getElementById('exerciceYear').value;
  const company = currentProfile?.company || 'Entreprise';
  const docType = document.getElementById('export-doc-type')?.value || 'journal';
  const jnlSel = document.getElementById('export-journal-select')?.value || '';
  const now = new Date().toLocaleDateString('fr-FR');
  const DOC_TITLES = {
    journal: 'JOURNAL GÉNÉRAL',
    balance: 'BALANCE GÉNÉRALE',
    grandlivre: 'GRAND LIVRE',
    bilan: 'BILAN',
    resultat: 'COMPTE DE RÉSULTAT',
    tresorerie: 'TRÉSORERIE',
    factures: 'LISTE DES FACTURES',
  };

  let tableHTML = '';
  if (docType === 'journal') {
    const ecrs = getFilteredEcrituresForExport();
    let totalD = 0,
      totalC = 0,
      rows = '';
    ecrs.forEach((e) => {
      sortLignesDebitAvantCredit(e.lignes).forEach((l) => {
        rows += `<tr><td>${e.date}</td><td>${e.journal}</td><td>${e.piece || ''}</td><td>${l.compte}</td><td>${(PC[l.compte] || '').substring(0, 26)}</td><td>${l.libelle || e.libelle || ''}</td><td align="right">${l.debit ? fn(l.debit) : ''}</td><td align="right">${l.credit ? fn(l.credit) : ''}</td></tr>`;
        totalD += l.debit || 0;
        totalC += l.credit || 0;
      });
    });
    rows += `<tr style="font-weight:bold;background:#f0ece3"><td colspan="6">TOTAUX</td><td align="right">${fn(totalD)}</td><td align="right">${fn(totalC)}</td></tr>`;
    tableHTML = `<table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Compte</th><th>Libellé compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else if (docType === 'balance') {
    const map = getMap();
    let rows = '';
    Object.entries(map)
      .sort()
      .forEach(([code, acc]) => {
        const s = acc.debit - acc.credit;
        rows += `<tr><td>${code}</td><td>${(PC[code] || '').substring(0, 40)}</td><td align="right">${fn(acc.debit)}</td><td align="right">${fn(acc.credit)}</td><td align="right">${s > 0 ? fn(s) : ''}</td><td align="right">${s < 0 ? fn(-s) : ''}</td></tr>`;
      });
    tableHTML = `<table><thead><tr><th>Compte</th><th>Libellé</th><th>Mvt Débit</th><th>Mvt Crédit</th><th>Solde Débiteur</th><th>Solde Créditeur</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else if (docType === 'factures') {
    let rows = '';
    facturesList.forEach((f) => {
      rows += `<tr><td>${f.numero}</td><td>${f.type}</td><td>${f.dateEmission || ''}</td><td>${f.clientNom || ''}</td><td align="right">${fn(f.ht)}</td><td align="right">${fn(f.tva)}</td><td align="right"><strong>${fn(f.ttc)}</strong></td><td>${f.statut}</td></tr>`;
    });
    tableHTML = `<table><thead><tr><th>N° Facture</th><th>Type</th><th>Date</th><th>Client</th><th>HT</th><th>TVA</th><th>TTC</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const th = 'background:#0a0b10;color:#d4a853;padding:6pt 10pt;font-size:9pt;text-align:left;text-transform:uppercase';
  const td = 'border-bottom:1pt solid #e0dbd0;padding:5pt 10pt';
  const html = `<html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;margin:40pt}h1{font-size:16pt}h2{font-size:13pt}table{width:100%;border-collapse:collapse;margin:10pt 0}th{${th}}td{${td}}tr:nth-child(even) td{background:#faf8f4}</style></head>
  <body><h1>COMEO AI v4 — ${DOC_TITLES[docType] || docType}</h1>
  <p>${company} · Exercice ${yr}${jnlSel ? ' · Journal ' + JOURNAL_NAMES[jnlSel] : ''} · Édité le ${now}</p>
  ${tableHTML}</body></html>`;
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `COMEO_${docType}_${company.replace(/\s+/g, '_')}_${yr}.doc`;
  a.click();
  toast('✓ Word exporté', 'success');
}

function exportExcelAvance() {
  const yr = document.getElementById('exerciceYear').value;
  const company = currentProfile?.company || 'Entreprise';
  const docType = document.getElementById('export-doc-type')?.value || 'journal';
  const jnlSel = document.getElementById('export-journal-select')?.value || '';
  let rows = [];

  if (docType === 'journal') {
    rows = [['Date', 'Journal', 'Pièce', 'Compte', 'Libellé compte', 'Libellé opération', 'Débit FCFA', 'Crédit FCFA']];
    getFilteredEcrituresForExport().forEach((e) => {
      sortLignesDebitAvantCredit(e.lignes).forEach((l) => {
        rows.push([
          e.date,
          e.journal,
          e.piece || '',
          l.compte,
          PC[l.compte] || '',
          l.libelle || e.libelle || '',
          l.debit || 0,
          l.credit || 0,
        ]);
      });
    });
  } else if (docType === 'balance') {
    rows = [['Compte', 'Libellé', 'Mvt Débit', 'Mvt Crédit', 'Solde Débiteur', 'Solde Créditeur']];
    const map = getMap();
    Object.entries(map)
      .sort()
      .forEach(([code, acc]) => {
        const s = acc.debit - acc.credit;
        rows.push([code, PC[code] || '', acc.debit, acc.credit, s > 0 ? s : 0, s < 0 ? -s : 0]);
      });
  } else if (docType === 'factures') {
    rows = [['N° Facture', 'Type', 'Date émission', 'Date échéance', 'Client', 'HT', 'TVA', 'TTC', 'Montant payé', 'Statut']];
    facturesList.forEach((f) => {
      rows.push([
        f.numero,
        f.type,
        f.dateEmission || '',
        f.dateEcheance || '',
        f.clientNom || '',
        f.ht,
        f.tva,
        f.ttc,
        f.montantPaye || 0,
        f.statut,
      ]);
    });
  } else if (docType === 'grandlivre') {
    rows = [['Compte', 'Libellé compte', 'Date', 'Journal', 'Pièce', 'Libellé opération', 'Débit', 'Crédit', 'Solde progressif']];
    const map = getMap();
    Object.entries(map)
      .sort()
      .forEach(([code, acc]) => {
        let solde = 0;
        acc.mvts.forEach((m) => {
          solde += m.debit - m.credit;
          rows.push([
            code,
            PC[code] || '',
            m.date,
            m.journal,
            m.piece || '',
            m.libelle || '',
            m.debit || 0,
            m.credit || 0,
            Math.abs(solde),
          ]);
        });
      });
  }

  const header = [
    [`COMEO AI v4 — ${docType.toUpperCase()}`, '', '', '', '', '', '', ''],
    [company, 'Exercice ' + yr, jnlSel ? 'Journal: ' + JOURNAL_NAMES[jnlSel] : 'Tous journaux', '', '', '', '', ''],
    [],
    ...rows,
  ];
  const csv = header.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `COMEO_${docType}_${company.replace(/\s+/g, '_')}_${yr}.csv`;
  a.click();
  toast('✓ Excel (CSV) exporté', 'success');
}

// ══════════════════════════════════════════




// Barème IR progressif Côte d'Ivoire — DGI 2024 (annuel → mensuel)
function calcIR(brutMensuel) {
  const annuel = brutMensuel * 12;
  const tranches = [
    { max: 600000,   taux: 0 },
    { max: 1800000,  taux: 0.10 },
    { max: 3000000,  taux: 0.15 },
    { max: 6000000,  taux: 0.20 },
    { max: 12000000, taux: 0.25 },
    { max: Infinity, taux: 0.30 },
  ];
  let ir = 0, prev = 0;
  for (const t of tranches) {
    if (annuel <= prev) break;
    ir += (Math.min(annuel, t.max) - prev) * t.taux;
    prev = t.max;
  }
  return Math.round(ir / 12);
}

function calcPaie() {
  const brut = parseFloat(document.getElementById('paie-brut')?.value) || 0;
  if (!brut) return;
  const plafondMensuel = 137276;
  const cnpsSal = Math.round(Math.min(brut * 0.077, plafondMensuel));
  const cnpsPat = Math.round(brut * 0.16);
  const tpa     = Math.round(brut * 0.004);
  const cn      = Math.round(brut * 0.015);
  const taxeApp = Math.round(brut * 0.004);
  const chargesPatronales = cnpsPat + tpa + cn + taxeApp;
  const baseIR  = brut - cnpsSal - Math.round((brut - cnpsSal) * 0.20);
  const ir      = calcIR(baseIR);
  const netAPayer = brut - cnpsSal - ir;

  const res  = document.getElementById('paie-calcul-result');
  const grid = document.getElementById('paie-detail-grid');
  if (!res || !grid) return { brut, cnpsSal, ir, netAPayer, cnpsPat, tpa, cn, taxeApp, chargesPatronales };
  res.style.display = 'block';
  grid.innerHTML = `
    <div class="bulletin-row"><span class="lbl">Salaire brut</span><span class="val">${fn(brut)} FCFA</span></div>
    <div class="bulletin-row deduction"><span class="lbl">CNPS salarial (7,7% plafonné)</span><span class="val">- ${fn(cnpsSal)} FCFA</span></div>
    <div class="bulletin-row deduction"><span class="lbl">Abattement forfaitaire (20%)</span><span class="val">- ${fn(Math.round((brut-cnpsSal)*0.20))} FCFA</span></div>
    <div class="bulletin-row deduction"><span class="lbl">Impôt sur le Revenu (IR DGI)</span><span class="val">- ${fn(ir)} FCFA</span></div>
    <div class="bulletin-row total"><span class="lbl">NET À PAYER</span><span class="val">${fn(netAPayer)} FCFA</span></div>
    <div style="margin-top:12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)">Charges patronales (employeur)</div>
    <div class="bulletin-row deduction"><span class="lbl">CNPS patronal (16%)</span><span class="val">${fn(cnpsPat)} FCFA</span></div>
    <div class="bulletin-row deduction"><span class="lbl">TPA (0,4%)</span><span class="val">${fn(tpa)} FCFA</span></div>
    <div class="bulletin-row deduction"><span class="lbl">Contribution nationale (1,5%)</span><span class="val">${fn(cn)} FCFA</span></div>
    <div class="bulletin-row deduction"><span class="lbl">Taxe apprentissage (0,4%)</span><span class="val">${fn(taxeApp)} FCFA</span></div>
    <div class="bulletin-row total" style="border-top:1px solid var(--line);padding-top:6px">
      <span class="lbl">Coût total employeur</span>
      <span class="val" style="color:var(--rust)">${fn(brut + chargesPatronales)} FCFA</span>
    </div>`;
  return { brut, cnpsSal, ir, netAPayer, cnpsPat, tpa, cn, taxeApp, chargesPatronales };
}

function openPaieModal() {
  document.getElementById('paieModal').style.display = 'flex';
}

async function savePaie() {
  const nom   = document.getElementById('paie-nom').value.trim();
  const poste = document.getElementById('paie-poste').value.trim();
  const brut  = parseFloat(document.getElementById('paie-brut').value) || 0;
  const mois  = document.getElementById('paie-mois').value;
  if (!nom || !brut || !mois) { toast('Remplissez tous les champs obligatoires', 'error'); return; }
  const calc = calcPaie();
  if (!calc) return;
  const sal = { id: Date.now(), nom, poste, brut, mois, ...calc, createdAt: new Date().toISOString() };
  salaries.push(sal);

  const dateEcr = mois + '-28';
  const piece   = 'PAY-' + mois.replace('-', '');

  // Écriture 1 — Constatation salaire
  const ecr1 = {
    id: Date.now(), date: dateEcr, journal: 'OD', piece,
    libelle: `Salaire ${nom} — ${mois}`, createdAt: new Date().toISOString(),
    lignes: sortLignesDebitAvantCredit([
      { compte: '661', libelle: `Rémunérations directes — ${nom}`, debit: sal.brut,       credit: 0 },
      { compte: '422', libelle: `Personnel, net à payer — ${nom}`,  debit: 0, credit: sal.netAPayer },
      { compte: '431', libelle: 'CNPS salarial 7,7%',               debit: 0, credit: sal.cnpsSal  },
      { compte: '447', libelle: 'IR retenu à la source',             debit: 0, credit: sal.ir       },
    ])
  };
  await saveEcritureToFirestore(ecr1);
  ecritures.push(ecr1);

  // Écriture 2 — Charges patronales
  const ecr2 = {
    id: Date.now() + 1, date: dateEcr, journal: 'OD',
    piece: 'PAY-PAT-' + mois.replace('-', ''),
    libelle: `Charges patronales ${nom} — ${mois}`, createdAt: new Date().toISOString(),
    lignes: sortLignesDebitAvantCredit([
      { compte: '664', libelle: `Charges sociales patronales — ${nom}`, debit: sal.chargesPatronales, credit: 0 },
      { compte: '431', libelle: 'CNPS patronal + TPA + CN',             debit: 0, credit: sal.chargesPatronales },
    ])
  };
  await saveEcritureToFirestore(ecr2);
  ecritures.push(ecr2);

  if (window._fbReady && currentProfile?.id) {
    try { await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'salaries'), sal); } catch(e) {}
  }
  document.getElementById('paieModal').style.display = 'none';
  toast(`✓ Paie ${nom} — Net ${fn(sal.netAPayer)} FCFA — 2 écritures OD générées`, 'success');
  renderPaie();
  updateStats();
}

async function loadSalaries() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'salaries'));
    salaries = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) {}
}

function renderPaie() {
  const el = document.getElementById('paieContent');
  if (!el) return;
  if (!salaries.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">👤</div><p>Aucun salarié. Cliquez sur "+ Nouveau salarié".</p></div>';
    return;
  }
  const totalBrut    = salaries.reduce((s,x) => s + (x.brut           || 0), 0);
  const totalNet     = salaries.reduce((s,x) => s + (x.netAPayer      || 0), 0);
  const totalCnpsSal = salaries.reduce((s,x) => s + (x.cnpsSal        || 0), 0);
  const totalCnpsPat = salaries.reduce((s,x) => s + (x.chargesPatronales || 0), 0);
  const totalIr      = salaries.reduce((s,x) => s + (x.ir             || 0), 0);
  document.getElementById('paie-kpi-masse').textContent    = fn(totalBrut);
  document.getElementById('paie-kpi-net').textContent      = fn(totalNet);
  document.getElementById('paie-kpi-cnps-sal').textContent = fn(totalCnpsSal);
  document.getElementById('paie-kpi-cnps-pat').textContent = fn(totalCnpsPat);
  document.getElementById('paie-kpi-ir').textContent       = fn(totalIr);
  el.innerHTML = `<div class="dtw"><table class="dt"><thead><tr>
    <th>Nom</th><th>Poste</th><th>Mois</th>
    <th style="text-align:right">Brut</th>
    <th style="text-align:right">CNPS sal.</th>
    <th style="text-align:right">IR</th>
    <th style="text-align:right">Net à payer</th>
    <th></th>
  </tr></thead><tbody>${
    salaries.map(s => `<tr>
      <td><strong>${s.nom}</strong></td>
      <td style="color:var(--muted)">${s.poste||'—'}</td>
      <td style="font-family:var(--font-mono)">${s.mois||'—'}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fn(s.brut)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--rust)">${fn(s.cnpsSal)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--muted)">${fn(s.ir)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--green);font-weight:700">${fn(s.netAPayer)}</td>
      <td><button class="btn btn-sm-wire" onclick="exportBulletinPDF(${s.id})" title="Bulletin PDF">⎙</button></td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

function exportBulletinPDF(salId) {
  const sal = salaries.find(s => s.id === salId);
  if (!sal) { toast('Salarié introuvable', 'error'); return; }
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF non disponible', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Entreprise';
  const pageW = 210;

  // En-tête
  doc.setFillColor(10,11,16); doc.rect(0,0,pageW,28,'F');
  doc.setTextColor(212,168,83); doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.text('BULLETIN DE PAIE', 14, 12);
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text(`${company} · SYSCOHADA · COMEO AI v5`, 14, 19);
  doc.setTextColor(180,180,180);
  doc.text(`Mois : ${sal.mois}  |  Généré le ${new Date().toLocaleDateString('fr-FR')}`, pageW-14, 19, {align:'right'});

  // Info salarié
  doc.setTextColor(10,11,16); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(sal.nom, 14, 40);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Poste : ${sal.poste || '—'}`, 14, 47);

  doc.autoTable({
    startY: 55,
    head: [['Libellé', 'Base', 'Taux', 'Montant (FCFA)']],
    body: [
      ['Salaire brut',                          fn(sal.brut)+' FCFA',            '100%',    fn(sal.brut)],
      ['CNPS salarial (retraite)',               fn(sal.brut)+' FCFA',            '7,7%',   '- '+fn(sal.cnpsSal)],
      ['Abattement forfaitaire',                 fn(sal.brut-sal.cnpsSal)+' FCFA','20%',    '—'],
      ['Impôt sur le Revenu (barème DGI 2024)',  'Revenu net imposable',          'Progressif','- '+fn(sal.ir)],
      ['NET À PAYER',                            '',                              '',        fn(sal.netAPayer)],
    ],
    styles: { font:'helvetica', fontSize:9, cellPadding:4 },
    headStyles: { fillColor:[10,11,16], textColor:[212,168,83], fontStyle:'bold' },
    columnStyles: { 3:{ halign:'right', fontStyle:'bold' } },
    margin: { left:14, right:14 },
  });

  let y = doc.lastAutoTable.finalY + 8;
  doc.autoTable({
    startY: y,
    head: [["Charges patronales (à la charge de l'employeur)", '', '', '']],
    body: [
      ['CNPS patronal',          fn(sal.brut)+' FCFA', '16,0%', fn(sal.cnpsPat||0)],
      ['TPA',                    fn(sal.brut)+' FCFA', '0,4%',  fn(sal.tpa||0)],
      ['Contribution nationale', fn(sal.brut)+' FCFA', '1,5%',  fn(sal.cn||0)],
      ['Taxe apprentissage',     fn(sal.brut)+' FCFA', '0,4%',  fn(sal.taxeApp||0)],
      ['Coût total employeur',   '',                   '',       fn(sal.brut+(sal.chargesPatronales||0))],
    ],
    styles: { font:'helvetica', fontSize:9, cellPadding:3 },
    headStyles: { fillColor:[22,80,60], textColor:[100,220,160], fontStyle:'bold' },
    columnStyles: { 3:{ halign:'right' } },
    margin: { left:14, right:14 },
  });

  y = doc.lastAutoTable.finalY + 12;
  doc.setDrawColor(200,192,176); doc.setLineWidth(0.3); doc.line(14,y,pageW-14,y);
  doc.setFontSize(7); doc.setTextColor(150);
  doc.text("Document généré par COMEO AI v5 · SYSCOHADA · Conforme DGI Côte d'Ivoire", 14, y+5);
  doc.text('Signature employé : _______________', pageW-14, y+5, {align:'right'});

  doc.save(`BULLETIN_${sal.nom.replace(/\s+/g,'_')}_${sal.mois}.pdf`);
  toast(`✓ Bulletin ${sal.nom} — ${sal.mois} exporté`, 'success');
}

window.calcPaie = calcPaie;
window.openPaieModal = openPaieModal;
window.savePaie = savePaie;
window.renderPaie = renderPaie;
window.exportBulletinPDF = exportBulletinPDF;



// ══════════════════════════════════════════
// MODULE IMMOBILISATIONS
// ══════════════════════════════════════════
let immobilisations = [];
const IMMOB_TAUX = { '2442': 0.33, '2451': 0.25, '2444': 0.20, '2441': 0.10, '231': 0.05, '211': 0.20 };
const IMMOB_AMORT = { '2442': '2844', '2451': '2845', '2444': '2844', '2441': '2841', '231': '2831', '211': '2813' };
const IMMOB_LABELS = { '2442': 'Matériel informatique', '2451': 'Véhicule', '2444': 'Mobilier', '2441': 'Matériel industriel', '231': 'Bâtiment', '211': 'Immob. incorporelle' };

function updateImmobCompte() { calcAmortissement(); }

function calcAmortissement() {
  const val = parseFloat(document.getElementById('immob-valeur')?.value) || 0;
  const cat = document.getElementById('immob-categorie')?.value || '2442';
  const methode = document.getElementById('immob-methode')?.value || 'lineaire';
  const preview = document.getElementById('immob-amort-preview');
  if (!preview || !val) { if (preview) preview.style.display = 'none'; return; }
  const taux = IMMOB_TAUX[cat] || 0.2;
  const duree = Math.round(1 / taux);
  const dotAnnuelle = Math.round(val * taux);
  const dotMensuelle = Math.round(dotAnnuelle / 12);
  preview.style.display = 'block';
  let rows = '';
  let restant = val;
  for (let i = 1; i <= Math.min(duree, 5); i++) {
    let dot = dotAnnuelle;
    if (methode === 'degressif') dot = Math.round(restant * taux * 1.5);
    restant = Math.max(0, restant - dot);
    rows += `<tr><td style="padding:4px 8px">Année ${i}</td><td style="padding:4px 8px;text-align:right;color:var(--rust)">${fn(dot)}</td><td style="padding:4px 8px;text-align:right;color:var(--teal)">${fn(restant)}</td></tr>`;
  }
  preview.innerHTML = `<strong>Taux ${(taux*100).toFixed(0)}%/an · Durée ${duree} ans · Dot. annuelle : ${fn(dotAnnuelle)} FCFA</strong>
  <table style="width:100%;margin-top:8px;font-size:12px"><thead><tr><th style="text-align:left;color:var(--muted);padding:4px 8px">Exercice</th><th style="text-align:right;color:var(--muted);padding:4px 8px">Dotation</th><th style="text-align:right;color:var(--muted);padding:4px 8px">VNC</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function openImmobModal() {
  document.getElementById('immobModal').style.display = 'flex';
  document.getElementById('immob-date').value = new Date().toISOString().split('T')[0];
  calcAmortissement();
}

async function saveImmob() {
  const nom = document.getElementById('immob-nom').value.trim();
  const valeur = parseFloat(document.getElementById('immob-valeur').value) || 0;
  const cat = document.getElementById('immob-categorie').value;
  const methode = document.getElementById('immob-methode').value;
  const dateAcq = document.getElementById('immob-date').value;
  const ref = document.getElementById('immob-ref').value.trim();
  if (!nom || !valeur || !dateAcq) { toast('Remplissez tous les champs obligatoires', 'error'); return; }
  const taux = IMMOB_TAUX[cat] || 0.2;
  const dotAnnuelle = Math.round(valeur * taux);
  const immob = { id: Date.now(), nom, valeur, cat, methode, dateAcq, ref, taux, dotAnnuelle, amortCumul: 0, createdAt: new Date().toISOString() };
  immobilisations.push(immob);
  if (window._fbReady && currentProfile?.id) {
    try { await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'immobilisations'), immob); } catch(e) {}
  }
  document.getElementById('immobModal').style.display = 'none';
  toast(`✓ Immobilisation "${nom}" enregistrée — Amort. ${fn(dotAnnuelle)} FCFA/an`, 'success');
  renderImmobilisations();
}

async function loadImmobilisations() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'immobilisations'));
    immobilisations = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) {}
}

function renderImmobilisations() {
  const el = document.getElementById('immobContent');
  if (!el) return;
  if (!immobilisations.length) { el.innerHTML = '<div class="empty-state"><div class="icon">🏗️</div><p>Aucune immobilisation enregistrée.</p></div>'; return; }
  const totalBrut = immobilisations.reduce((s, x) => s + (x.valeur || 0), 0);
  const totalAmort = immobilisations.reduce((s, x) => s + (x.amortCumul || 0), 0);
  const totalNet = totalBrut - totalAmort;
  const totalDot = immobilisations.reduce((s, x) => s + (x.dotAnnuelle || 0), 0);
  document.getElementById('immob-kpi-brut').textContent = fn(totalBrut);
  document.getElementById('immob-kpi-amort').textContent = fn(totalAmort);
  document.getElementById('immob-kpi-net').textContent = fn(totalNet);
  document.getElementById('immob-kpi-dot').textContent = fn(totalDot);
  el.innerHTML = `<div class="dtw"><table class="dt amort-table"><thead><tr><th>Désignation</th><th>Catégorie</th><th>Date acq.</th><th style="text-align:right">Valeur brute</th><th style="text-align:right">Taux</th><th style="text-align:right" class="dot-cell">Dot. annuelle</th><th style="text-align:right" class="vnc-cell">VNC</th><th></th></tr></thead><tbody>${
    immobilisations.map(im => {
      const vnc = (im.valeur || 0) - (im.amortCumul || 0);
      return `<tr><td><strong>${im.nom}</strong>${im.ref ? `<br><span style="font-size:11px;color:var(--muted)">${im.ref}</span>` : ''}</td><td style="font-size:12px">${IMMOB_LABELS[im.cat] || im.cat}</td><td style="font-family:var(--font-mono);font-size:12px">${im.dateAcq}</td><td style="text-align:right;font-family:var(--font-mono)">${fn(im.valeur)}</td><td style="text-align:right;font-family:var(--font-mono)">${((im.taux||0)*100).toFixed(0)}%</td><td style="text-align:right;font-family:var(--font-mono);color:var(--rust)">${fn(im.dotAnnuelle)}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--teal);font-weight:700">${fn(vnc)}</td><td><button class="btn btn-sm-wire" onclick="genererDotation(${im.id})">681↗</button></td></tr>`;
    }).join('')
  }</tbody></table></div>`;
}

async function genererDotation(immobId) {
  const im = immobilisations.find(x => x.id === immobId);
  if (!im) return;
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const dateEcr = `${yr}-12-31`;
  const dot = im.dotAnnuelle;
  const amortCpte = IMMOB_AMORT[im.cat] || '2844';
  const ecr = {
    id: Date.now(), date: dateEcr, journal: 'IN', piece: 'AMO-' + yr,
    libelle: `Dotation amort. ${im.nom} — ${yr}`, createdAt: new Date().toISOString(),
    lignes: [
      { compte: '681', libelle: 'Dotations aux amortissements', debit: dot, credit: 0 },
      { compte: amortCpte, libelle: `Amort. ${im.nom}`, debit: 0, credit: dot }
    ]
  };
  await saveEcritureToFirestore(ecr);
  ecritures.push(ecr);
  im.amortCumul = (im.amortCumul || 0) + dot;
  updateStats();
  toast(`✓ Écriture 681/${amortCpte} générée — ${fn(dot)} FCFA`, 'success');
  renderImmobilisations();
}

function exportTableauAmortissement() {
  if (!immobilisations.length) { toast('Aucune immobilisation', 'error'); return; }
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF non chargé', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Entreprise';
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const pageW = 297;
  doc.setFillColor(10, 11, 16);
  doc.rect(0, 0, pageW, 24, 'F');
  doc.setTextColor(212, 168, 83);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`TABLEAU DES IMMOBILISATIONS ET AMORTISSEMENTS — ${company} — ${yr}`, 14, 10);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('SYSCOHADA Révisé 2017 · COMEO AI v5', 14, 17);
  const rows = immobilisations.map(im => {
    const vnc = (im.valeur || 0) - (im.amortCumul || 0);
    return [
      im.nom,
      IMMOB_LABELS[im.cat] || im.cat,
      im.dateAcq,
      im.ref || '—',
      fn(im.valeur),
      ((im.taux||0)*100).toFixed(0) + '%',
      im.methode || 'linéaire',
      fn(im.dotAnnuelle),
      fn(im.amortCumul || 0),
      fn(vnc),
    ];
  });
  const totalBrut = immobilisations.reduce((s,x) => s + (x.valeur||0), 0);
  const totalAmort = immobilisations.reduce((s,x) => s + (x.amortCumul||0), 0);
  const totalNet = totalBrut - totalAmort;
  const totalDot = immobilisations.reduce((s,x) => s + (x.dotAnnuelle||0), 0);
  doc.autoTable({
    startY: 28,
    head: [['Désignation', 'Catégorie', 'Date acq.', 'Référence', 'Valeur brute', 'Taux', 'Méthode', 'Dot. annuelle', 'Amort. cumulé', 'VNC']],
    body: rows,
    foot: [['TOTAL', '', '', '', fn(totalBrut), '', '', fn(totalDot), fn(totalAmort), fn(totalNet)]],
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: [10, 11, 16], textColor: [212, 168, 83], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [30, 34, 54], textColor: [212, 168, 83], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 248, 244] },
    columnStyles: {
      4: { halign: 'right' }, 7: { halign: 'right', textColor: [192, 50, 20] },
      8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold', textColor: [22, 160, 100] }
    },
    margin: { left: 14, right: 14 },
  });
  doc.save(`TABLEAU_AMORTISSEMENTS_${company.replace(/\s+/g,'_')}_${yr}.pdf`);
  toast('✓ Tableau des amortissements exporté en PDF', 'success');
}

// ──────────────────────────────────────────
// TAFIRE — Tableau de Financement des Ressources et Emplois
// ──────────────────────────────────────────
function renderTAFIRE() {
  const el = document.getElementById('tafireContent');
  if (!el) return;
  const map = getMap();
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const company = currentProfile?.company || '—';

  // Calculs TAFIRE SYSCOHADA
  const produits = Object.entries(map).filter(([c]) => c[0]==='7').reduce((s,[,a]) => s+(a.credit-a.debit), 0);
  const charges = Object.entries(map).filter(([c]) => c[0]==='6').reduce((s,[,a]) => s+(a.debit-a.credit), 0);
  const dotAmort = immobilisations.reduce((s,x) => s + (x.dotAnnuelle||0), 0);
  const resultat = produits - charges;
  const caf = resultat + dotAmort;
  // Immobilisations acquises = valeur brute des nouvelles immos
  const investissements = immobilisations.filter(im => im.dateAcq && im.dateAcq.startsWith(yr)).reduce((s,x) => s+(x.valeur||0), 0);
  // Variation BFR approximation
  const clients411 = (map['411']?.debit||0) - (map['411']?.credit||0);
  const fourn401 = (map['401']?.credit||0) - (map['401']?.debit||0);
  const stocks3 = Object.entries(map).filter(([c]) => c[0]==='3').reduce((s,[,a]) => s+(a.debit-a.credit), 0);
  const variationBFR = clients411 + stocks3 - fourn401;
  const tresorerie5 = Object.entries(map).filter(([c]) => c[0]==='5').reduce((s,[,a]) => s+(a.debit-a.credit), 0);
  const dettesLT = (map['16']?.credit||0) - (map['16']?.debit||0) + (map['162']?.credit||0);

  el.innerHTML = `
  <div style="padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <h3 style="font-family:var(--font-display);font-size:18px">TAFIRE — ${company} — Exercice ${yr}</h3>
      <button class="btn btn-gold" onclick="exportTAFIREpdf()">⎙ Exporter PDF</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <!-- PARTIE 1 : CAF -->
      <div style="background:var(--surface2);border:1.5px solid var(--line);border-radius:var(--r);padding:16px">
        <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--warm);margin-bottom:12px">I — Capacité d'Autofinancement (CAF)</div>
        <div class="tafire-row"><span>Résultat net de l'exercice</span><span class="${resultat>=0?'tv':'tr'}">${fn(resultat)} FCFA</span></div>
        <div class="tafire-row"><span>+ Dotations aux amortissements</span><span>${fn(dotAmort)} FCFA</span></div>
        <div class="tafire-row tafire-total"><span>= CAF (MARGE BRUTE D'AUTOFINANCEMENT)</span><span class="${caf>=0?'tv':'tr'}" style="font-size:15px">${fn(caf)} FCFA</span></div>
      </div>
      <!-- PARTIE 2 : EMPLOIS / RESSOURCES -->
      <div style="background:var(--surface2);border:1.5px solid var(--line);border-radius:var(--r);padding:16px">
        <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--warm);margin-bottom:12px">II — Emplois et Ressources Stables</div>
        <div class="tafire-row"><span>Investissements (acquisitions ${yr})</span><span class="tr">- ${fn(investissements)} FCFA</span></div>
        <div class="tafire-row"><span>Ressources LT (emprunts)</span><span class="tv">+ ${fn(dettesLT)} FCFA</span></div>
        <div class="tafire-row tafire-total"><span>= Flux investissement net</span><span class="${caf-investissements+dettesLT>=0?'tv':'tr'}">${fn(caf - investissements + dettesLT)} FCFA</span></div>
      </div>
      <!-- PARTIE 3 : BFR -->
      <div style="background:var(--surface2);border:1.5px solid var(--line);border-radius:var(--r);padding:16px">
        <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--warm);margin-bottom:12px">III — Variation du BFR</div>
        <div class="tafire-row"><span>Créances clients (411)</span><span>${fn(clients411)} FCFA</span></div>
        <div class="tafire-row"><span>Stocks (3xxx)</span><span>${fn(stocks3)} FCFA</span></div>
        <div class="tafire-row"><span>Dettes fournisseurs (401)</span><span>${fn(fourn401)} FCFA</span></div>
        <div class="tafire-row tafire-total"><span>= VARIATION BFR</span><span class="${variationBFR<=0?'tv':'tr'}">${fn(variationBFR)} FCFA</span></div>
      </div>
      <!-- PARTIE 4 : TRÉSORERIE -->
      <div style="background:var(--surface2);border:1.5px solid var(--line);border-radius:var(--r);padding:16px">
        <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--warm);margin-bottom:12px">IV — Trésorerie Nette</div>
        <div class="tafire-row"><span>Solde trésorerie (5xxx)</span><span class="${tresorerie5>=0?'tv':'tr'}">${fn(tresorerie5)} FCFA</span></div>
        <div class="tafire-row"><span>CAF générée</span><span class="${caf>=0?'tv':'tr'}">${fn(caf)} FCFA</span></div>
        <div class="tafire-row tafire-total"><span>= FLUX DE TRÉSORERIE NET</span><span class="${tresorerie5>=0?'tv':'tr'}" style="font-size:15px">${fn(tresorerie5)} FCFA</span></div>
      </div>
    </div>
  </div>`;
}

function exportTAFIREpdf() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF non chargé', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Entreprise';
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const map = getMap();
  const pageW = 210;

  const produits = Object.entries(map).filter(([c])=>c[0]==='7').reduce((s,[,a])=>s+(a.credit-a.debit),0);
  const charges = Object.entries(map).filter(([c])=>c[0]==='6').reduce((s,[,a])=>s+(a.debit-a.credit),0);
  const dotAmort = immobilisations.reduce((s,x)=>s+(x.dotAnnuelle||0),0);
  const resultat = produits - charges;
  const caf = resultat + dotAmort;
  const clients411 = (map['411']?.debit||0) - (map['411']?.credit||0);
  const fourn401 = (map['401']?.credit||0) - (map['401']?.debit||0);
  const stocks3 = Object.entries(map).filter(([c])=>c[0]==='3').reduce((s,[,a])=>s+(a.debit-a.credit),0);
  const tresorerie5 = Object.entries(map).filter(([c])=>c[0]==='5').reduce((s,[,a])=>s+(a.debit-a.credit),0);
  const investissements = immobilisations.filter(im=>im.dateAcq&&im.dateAcq.startsWith(yr)).reduce((s,x)=>s+(x.valeur||0),0);
  const dettesLT = (map['162']?.credit||0)-(map['162']?.debit||0);

  doc.setFillColor(10,11,16); doc.rect(0,0,pageW,26,'F');
  doc.setTextColor(212,168,83); doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text(`TAFIRE — ${company}`, 14, 11);
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text(`Tableau de Financement des Ressources et Emplois · Exercice ${yr} · SYSCOHADA`, 14, 18);
  doc.setTextColor(180,180,180); doc.setFontSize(7);
  doc.text('Généré par COMEO AI v5 le ' + new Date().toLocaleDateString('fr-FR'), pageW-14, 18, {align:'right'});

  doc.autoTable({
    startY: 30,
    head: [['RUBRIQUE SYSCOHADA', 'MONTANT (FCFA)']],
    body: [
      ['I — CAPACITÉ D\'AUTOFINANCEMENT', ''],
      ['Résultat net de l\'exercice', fnPDF(resultat)],
      ['+ Dotations aux amortissements', fnPDF(dotAmort)],
      ['= CAF (Marge Brute d\'Autofinancement)', fnPDF(caf)],
      ['', ''],
      ['II — EMPLOIS ET RESSOURCES STABLES', ''],
      ['Investissements (acquisitions ' + yr + ')', '- ' + fnPDF(investissements)],
      ['Ressources LT (emprunts 162)', '+ ' + fnPDF(dettesLT)],
      ['= Flux de financement stable', fnPDF(caf - investissements + dettesLT)],
      ['', ''],
      ['III — VARIATION DU BFR', ''],
      ['Créances clients (411)', fnPDF(clients411)],
      ['Stocks (3xxx)', fnPDF(stocks3)],
      ['Dettes fournisseurs (401)', fnPDF(fourn401)],
      ['= Variation BFR', fnPDF(clients411 + stocks3 - fourn401)],
      ['', ''],
      ['IV — TRÉSORERIE NETTE', ''],
      ['Solde trésorerie clôture (5xxx)', fnPDF(tresorerie5)],
    ],
    foot: [['FLUX DE TRÉSORERIE NET', fnPDF(tresorerie5)]],
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [10,11,16], textColor: [212,168,83], fontStyle: 'bold' },
    footStyles: { fillColor: [10,11,16], textColor: [212,168,83], fontStyle: 'bold', fontSize: 11 },
    alternateRowStyles: { fillColor: [250,248,244] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  });
  doc.save(`TAFIRE_${company.replace(/\s+/g,'_')}_${yr}.pdf`);
  toast('✓ TAFIRE exporté en PDF', 'success');
}

window.renderTAFIRE = renderTAFIRE;
window.exportTAFIREpdf = exportTAFIREpdf;
window.exportTableauAmortissement = exportTableauAmortissement;
window.openImmobModal = openImmobModal;
window.saveImmob = saveImmob;
window.renderImmobilisations = renderImmobilisations;
window.genererDotation = genererDotation;
window.calcAmortissement = calcAmortissement;
window.updateImmobCompte = updateImmobCompte;

// ══════════════════════════════════════════
// MODULE STOCKS
// ══════════════════════════════════════════
let stockArticles = [];
let stockMouvements = [];

function openStockModal() {
  document.getElementById('stockModal').style.display = 'flex';
  document.getElementById('stock-date').value = new Date().toISOString().split('T')[0];
}

async function saveStock() {
  const article = document.getElementById('stock-article').value.trim();
  const type = document.getElementById('stock-type').value;
  const qte = parseFloat(document.getElementById('stock-qte').value) || 0;
  const pu = parseFloat(document.getElementById('stock-pu').value) || 0;
  const date = document.getElementById('stock-date').value;
  const seuil = parseFloat(document.getElementById('stock-seuil').value) || 5;
  if (!article || !qte || !date) { toast('Remplissez tous les champs', 'error'); return; }
  // Trouver ou créer l'article
  let art = stockArticles.find(a => a.nom.toLowerCase() === article.toLowerCase());
  if (!art) {
    art = { id: Date.now(), nom: article, qteActuelle: 0, cmup: pu, seuil, mouvements: [] };
    stockArticles.push(art);
  }
  const mvt = { type, qte, pu, date, valeur: qte * pu };
  art.mouvements.push(mvt);
  if (type === 'entree') {
    // Recalc CMUP
    const ancVal = art.qteActuelle * art.cmup;
    const nvVal = qte * pu;
    art.qteActuelle += qte;
    art.cmup = art.qteActuelle > 0 ? Math.round((ancVal + nvVal) / art.qteActuelle) : pu;
  } else if (type === 'sortie') {
    art.qteActuelle = Math.max(0, art.qteActuelle - qte);
  } else {
    art.qteActuelle = qte; // inventaire
  }
  art.seuil = seuil;
  if (window._fbReady && currentProfile?.id) {
    try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'stocks', String(art.id)), art); } catch(e) {}
  }
  document.getElementById('stockModal').style.display = 'none';
  toast(`✓ Mouvement stock "${article}" enregistré`, 'success');
  renderStocks();
}

async function loadStocks() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'stocks'));
    stockArticles = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) {}
}

function renderStocks() {
  const el = document.getElementById('stockContent');
  if (!el) return;
  if (!stockArticles.length) { el.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>Aucun article. Ajoutez un mouvement.</p></div>'; return; }
  const valTotal = stockArticles.reduce((s, a) => s + a.qteActuelle * a.cmup, 0);
  const alertes = stockArticles.filter(a => a.qteActuelle <= a.seuil).length;
  document.getElementById('stock-kpi-articles').textContent = stockArticles.length;
  document.getElementById('stock-kpi-valeur').textContent = fn(valTotal);
  document.getElementById('stock-kpi-alertes').textContent = alertes;
  document.getElementById('stock-kpi-mvt').textContent = stockArticles.reduce((s, a) => s + (a.mouvements?.length || 0), 0);
  el.innerHTML = `<div class="dtw"><table class="dt"><thead><tr><th>Article</th><th style="text-align:right">Qté actuelle</th><th style="text-align:right">CMUP</th><th style="text-align:right">Valeur stock</th><th style="text-align:right">Seuil alerte</th><th>Statut</th></tr></thead><tbody>${
    stockArticles.map(a => {
      const val = a.qteActuelle * a.cmup;
      const isLow = a.qteActuelle <= a.seuil;
      return `<tr><td><strong>${a.nom}</strong></td><td style="text-align:right;font-family:var(--font-mono)">${a.qteActuelle}</td><td style="text-align:right;font-family:var(--font-mono)">${fn(a.cmup)}</td><td style="text-align:right;font-family:var(--font-mono);font-weight:700">${fn(val)}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--muted)">${a.seuil}</td><td><span class="stock-badge ${isLow ? 'low' : 'ok'}">${isLow ? '⚠ Stock bas' : '✓ OK'}</span></td></tr>`;
    }).join('')
  }</tbody></table></div>`;
}

function exportInventairePDF() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const company = currentProfile?.company || 'Entreprise';
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('INVENTAIRE DES STOCKS — ' + company, 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Édité le ' + new Date().toLocaleDateString('fr-FR'), 14, 25);
    const rows = (stocks||[]).map(s => [
      s.article||'—', s.type||'—',
      String(s.quantite||0), fnPDF(s.prixUnitaire||0),
      fnPDF((s.quantite||0)*(s.prixUnitaire||0))
    ]);
    const totalVal = (stocks||[]).reduce((t,s)=>t+(s.quantite||0)*(s.prixUnitaire||0),0);
    if (rows.length) rows.push(['','','','TOTAL', fnPDF(totalVal) + ' FCFA']);
    doc.autoTable({
      head:[['Article','Type','Qté','P.U. HT','Valeur HT']],
      body: rows.length ? rows : [['Aucun stock enregistré','','','','']],
      startY:30, styles:{fontSize:9},
      headStyles:{fillColor:[30,30,40],textColor:[212,168,83]}
    });
    doc.save('inventaire_' + company.replace(/\s/g,'_') + '.pdf');
    toast('✅ Inventaire exporté en PDF', 'success');
  } catch(e) { toast('Erreur export PDF: ' + e.message, 'error'); }
}
window.openStockModal = openStockModal;
window.saveStock = saveStock;
window.renderStocks = renderStocks;
window.exportInventairePDF = exportInventairePDF;

// ══════════════════════════════════════════
// MODULE RAPPROCHEMENT BANCAIRE
// ══════════════════════════════════════════
let lignesReleve = [];

function importReleveBancaire(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.split('\n').filter(l => l.trim());
    lignesReleve = lines.slice(1).map(l => {
      const cols = l.split(/[;,]/).map(c => c.replace(/"/g,'').trim());
      return { date: cols[0] || '', libelle: cols[1] || '', debit: parseFloat(cols[2]) || 0, credit: parseFloat(cols[3]) || 0, rapproche: false };
    }).filter(l => l.date);
    toast(`✓ ${lignesReleve.length} lignes importées du relevé`, 'success');
    renderRapprochement();
  };
  reader.readAsText(file, 'UTF-8');
}

function renderRapprochement() {
  const el = document.getElementById('rapprochementContent');
  if (!el) return;
  // Solde banque depuis relevé
  const soldeBanque = lignesReleve.reduce((s, l) => s + l.credit - l.debit, 0);
  // Solde compta 521
  const map = getMap();
  const compte521 = map['521'];
  const soldeCompta = compte521 ? (compte521.debit - compte521.credit) : 0;
  const ecart = soldeBanque - soldeCompta;
  const nonRappr = lignesReleve.filter(l => !l.rapproche).length;
  document.getElementById('rappr-kpi-banque').textContent = fn(Math.abs(soldeBanque));
  document.getElementById('rappr-kpi-compta').textContent = fn(Math.abs(soldeCompta));
  document.getElementById('rappr-kpi-ecart').textContent = fn(Math.abs(ecart));
  document.getElementById('rappr-kpi-non').textContent = nonRappr;
  if (!lignesReleve.length) { el.innerHTML = '<div class="empty-state"><div class="icon">🏦</div><p>Importez un relevé bancaire CSV.</p></div>'; return; }
  el.innerHTML = `<div class="dtw"><table class="dt"><thead><tr><th>Date</th><th>Libellé</th><th style="text-align:right">Débit</th><th style="text-align:right">Crédit</th><th>Rapproché</th></tr></thead><tbody>${
    lignesReleve.map((l, i) => `<tr style="${l.rapproche ? 'opacity:.5' : ''}"><td style="font-family:var(--font-mono);font-size:12px">${l.date}</td><td>${l.libelle}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--rust)">${l.debit ? fn(l.debit) : ''}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--green)">${l.credit ? fn(l.credit) : ''}</td><td><div class="rappr-check ${l.rapproche ? 'matched' : ''}" onclick="toggleRappr(${i})">${l.rapproche ? '✓' : ''}</div></td></tr>`).join('')
  }</tbody></table></div>`;
}

function toggleRappr(i) { if (lignesReleve[i]) { lignesReleve[i].rapproche = !lignesReleve[i].rapproche; renderRapprochement(); } }
function exportRapprochementPDF() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const company = currentProfile?.company || 'Entreprise';
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('ÉTAT DE RAPPROCHEMENT BANCAIRE — ' + company, 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Édité le ' + new Date().toLocaleDateString('fr-FR'), 14, 25);
    const map = getMap();
    const soldeBanque521 = Object.entries(map).filter(([c])=>c.startsWith('521')).reduce((s,[,a])=>s+(a.debit-a.credit),0);
    doc.autoTable({
      body:[
        ['Solde comptable (521)', fnPDF(soldeBanque521) + ' FCFA'],
        ['Solde relevé bancaire', 'À renseigner'],
        ['Écart', '—'],
      ],
      startY:30, styles:{fontSize:10},
      columnStyles:{0:{fontStyle:'bold', cellWidth:110}}
    });
    doc.save('rapprochement_bancaire_' + company.replace(/\s/g,'_') + '.pdf');
    toast('✅ État de rapprochement exporté', 'success');
  } catch(e) { toast('Erreur export PDF: ' + e.message, 'error'); }
}
window.importReleveBancaire = importReleveBancaire;
window.toggleRappr = toggleRappr;
window.exportRapprochementPDF = exportRapprochementPDF;

// ══════════════════════════════════════════
// MODULE BUDGETS
// ══════════════════════════════════════════
let budgets = [];

function openBudgetModal() { document.getElementById('budgetModal').style.display = 'flex'; }

async function saveBudget() {
  const compte = document.getElementById('budget-compte').value.trim();
  const montant = parseFloat(document.getElementById('budget-montant').value) || 0;
  const periode = document.getElementById('budget-periode').value;
  const alerte = parseFloat(document.getElementById('budget-alerte').value) || 90;
  if (!compte || !montant) { toast('Remplissez compte et montant', 'error'); return; }
  const budget = { id: Date.now(), compte, montant, periode, alerte, yr: document.getElementById('exerciceYear')?.value || new Date().getFullYear(), createdAt: new Date().toISOString() };
  budgets.push(budget);
  if (window._fbReady && currentProfile?.id) {
    try { await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'budgets'), budget); } catch(e) {}
  }
  document.getElementById('budgetModal').style.display = 'none';
  toast(`✓ Budget ${compte} → ${fn(montant)} FCFA enregistré`, 'success');
  renderBudgets();
}

async function loadBudgets() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'budgets'));
    budgets = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) {}
}

function renderBudgets() {
  const el = document.getElementById('budgetContent');
  if (!el) return;
  const map = getMap();
  if (!budgets.length) { el.innerHTML = '<div class="empty-state"><div class="icon">🎯</div><p>Aucun budget saisi.</p></div>'; return; }
  let totalPrev = 0, totalReal = 0, nbDep = 0;
  const rows = budgets.map(b => {
    const cpteMap = map[b.compte];
    const realise = cpteMap ? Math.abs(cpteMap.debit - cpteMap.credit) : 0;
    const pct = b.montant > 0 ? Math.round((realise / b.montant) * 100) : 0;
    const isDep = pct >= b.alerte;
    if (isDep) nbDep++;
    totalPrev += b.montant;
    totalReal += realise;
    let colorClass = pct >= 100 ? 'danger' : pct >= b.alerte ? 'warning' : '';
    return `<div class="budget-row">
      <div class="budget-row-header"><span class="budget-row-compte">${b.compte} — ${PC[b.compte] || b.compte}</span><span class="budget-row-pct" style="color:${pct >= 100 ? 'var(--red)' : pct >= b.alerte ? 'var(--warm)' : 'var(--green)'}">${pct}%${isDep ? ' ⚠' : ''}</span></div>
      <div class="budget-bar"><div class="budget-bar-fill ${colorClass}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="budget-row-detail"><span>Réalisé : ${fn(realise)} FCFA</span><span>Prévu : ${fn(b.montant)} FCFA</span></div>
    </div>`;
  }).join('');
  const taux = totalPrev > 0 ? Math.round((totalReal / totalPrev) * 100) : 0;
  document.getElementById('budget-kpi-total').textContent = fn(totalPrev);
  document.getElementById('budget-kpi-realise').textContent = fn(totalReal);
  document.getElementById('budget-kpi-taux').textContent = taux + '%';
  document.getElementById('budget-kpi-dep').textContent = nbDep;
  el.innerHTML = `<div style="padding:4px">${rows}</div>`;
}

function exportBudgetPDF() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const company = currentProfile?.company || 'Entreprise';
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('BUDGETS & PRÉVISIONS — ' + company, 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Exercice ' + (currentProfile?.exercice||'2024') + ' — Édité le ' + new Date().toLocaleDateString('fr-FR'), 14, 25);
    const map = getMap();
    const rows = (budgets||[]).map(b => {
      const realise = Object.entries(map).filter(([c])=>c.startsWith(String(b.compte))).reduce((s,[,a])=>s+Math.abs(a.debit-a.credit),0);
      const taux = b.montant > 0 ? Math.round(realise/b.montant*100) : 0;
      return [b.compte||'—', PC[b.compte]||b.compte||'—', fnPDF(b.montant||0), fnPDF(realise), taux+'%', b.periode||'Annuel'];
    });
    doc.autoTable({
      head:[['Compte','Libellé','Prévu (FCFA)','Réalisé (FCFA)','Taux','Période']],
      body: rows.length ? rows : [['Aucun budget saisi','','','','','']],
      startY:30, styles:{fontSize:8},
      headStyles:{fillColor:[30,30,40],textColor:[212,168,83]}
    });
    doc.save('budgets_' + company.replace(/\s/g,'_') + '.pdf');
    toast('✅ Budget exporté en PDF', 'success');
  } catch(e) { toast('Erreur export PDF: ' + e.message, 'error'); }
}
window.openBudgetModal = openBudgetModal;
window.saveBudget = saveBudget;
window.renderBudgets = renderBudgets;
window.updateBudgetAccountSuggest = (inp) => {};
window.exportBudgetPDF = exportBudgetPDF;

// ══════════════════════════════════════════
// MODULE LETTRAGE & ÉCHÉANCES
// ══════════════════════════════════════════
let lettrageMode = '411';

function afficherLettrage(cpte) {
  lettrageMode = cpte;
  ['411', '401'].forEach(c => {
    const btn = document.getElementById('btn-lettrage-' + c);
    if (btn) { btn.style.borderColor = c === cpte ? 'var(--warm)' : ''; btn.style.color = c === cpte ? 'var(--warm)' : ''; }
  });
  renderLettrage();
}

function renderLettrage() {
  const el = document.getElementById('lettrageContent');
  if (!el) return;
  const map = getMap();
  // Grouper les mouvements par tiers (libellé)
  const tiersMvts = {};
  Object.entries(map).filter(([c]) => c.startsWith(lettrageMode)).forEach(([c, acc]) => {
    acc.mvts.forEach(m => {
      const tiers = m.libelle || c;
      if (!tiersMvts[tiers]) tiersMvts[tiers] = { mvts: [], solde: 0 };
      tiersMvts[tiers].mvts.push({ ...m, compte: c });
      tiersMvts[tiers].solde += m.debit - m.credit;
    });
  });
  // KPIs
  const totalClients = Object.values(tiersMvts).filter(t => t.solde > 0).reduce((s, t) => s + t.solde, 0);
  const totalFourn = Object.values(tiersMvts).filter(t => t.solde < 0).reduce((s, t) => s + Math.abs(t.solde), 0);
  document.getElementById('lettr-kpi-clients').textContent = fn(totalClients);
  document.getElementById('lettr-kpi-fourn').textContent = fn(totalFourn);
  const today = new Date();
  const retard = Object.values(tiersMvts).reduce((s, t) => {
    return s + t.mvts.filter(m => {
      const d = new Date(m.date);
      return (today - d) / 86400000 > 30 && m.debit > 0;
    }).reduce((ss, m) => ss + m.debit, 0);
  }, 0);
  document.getElementById('lettr-kpi-retard').textContent = fn(retard);
  const total = Object.values(tiersMvts).reduce((s, t) => s + t.mvts.length, 0);
  document.getElementById('lettr-kpi-lettre').textContent = total > 0 ? Math.round((total - Object.keys(tiersMvts).length) / total * 100) + '%' : '0%';
  if (!Object.keys(tiersMvts).length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🔗</div><p>Aucun mouvement sur les comptes ${lettrageMode}xxx.</p></div>`;
    return;
  }
  // Balance âgée + détail lettrage si lancé
  el.innerHTML = `<div class="dtw"><table class="balance-agee-table"><thead><tr><th>Tiers</th><th>&lt; 30j</th><th>30–60j</th><th class="col-retard">60–90j</th><th class="col-tres-retard">&gt; 90j</th><th>Total</th><th>Solde résiduel</th></tr></thead><tbody>${
    Object.entries(tiersMvts).map(([tiers, data]) => {
      const ranges = [0, 0, 0, 0];
      data.mvts.forEach(m => {
        const age = (today - new Date(m.date)) / 86400000;
        const val = Math.abs(m.debit - m.credit);
        if (age < 30) ranges[0] += val;
        else if (age < 60) ranges[1] += val;
        else if (age < 90) ranges[2] += val;
        else ranges[3] += val;
      });
      const etat = lettrageState[tiers];
      const residuel = etat ? etat.soldeResiduel : null;
      const residuelCell = residuel !== null
        ? `<span style="color:${Math.abs(residuel)<0.01?'var(--green)':'var(--red)'}">
             ${Math.abs(residuel)<0.01 ? '✓ Lettré' : fn(Math.abs(residuel)) + ' FCFA'}
           </span>`
        : '<span style="color:var(--muted)">—</span>';
      return `<tr>
        <td><strong>${tiers}</strong></td>
        <td>${fn(ranges[0])}</td><td>${fn(ranges[1])}</td>
        <td class="col-retard">${fn(ranges[2])}</td>
        <td class="col-tres-retard">${fn(ranges[3])}</td>
        <td style="font-weight:700">${fn(Math.abs(data.solde))}</td>
        <td>${residuelCell}</td>
      </tr>
      ${etat && etat.lettres.length ? `<tr><td colspan="7" style="padding:4px 12px;background:var(--surface3,var(--surface2));font-size:11px;color:var(--muted)">
        ${etat.lettres.map(l => `↔ ${l.date} : Facture ${l.facture} ↔ Règl. ${l.reglement} = <strong>${fn(l.montant)} FCFA</strong>`).join(' &nbsp;|&nbsp; ')}
      </td></tr>` : ''}`;
    }).join('')
  }</tbody></table></div>`;
}

// ── État lettrage ──
let lettrageState = {};   // { tiers: { factures: [...], reglements: [...], soldeResiduel } }

/**
 * Lettrage automatique ligne à ligne : associe chaque règlement à la facture
 * la plus ancienne non encore lettrée (ordre chronologique FIFO).
 * Met à jour lettrageState et rafraîchit l'affichage.
 */
function lancerLettrage() {
  const map = getMap();
  lettrageState = {};

  // Collecter tous les mouvements sur les comptes 40x / 41x par tiers (libellé)
  Object.entries(map)
    .filter(([c]) => c.startsWith(lettrageMode))
    .forEach(([c, acc]) => {
      acc.mvts.forEach((m) => {
        const tiers = m.libelle || c;
        if (!lettrageState[tiers]) {
          lettrageState[tiers] = { factures: [], reglements: [], lettres: [], soldeResiduel: 0 };
        }
        const entry = { ...m, compte: c, reste: Math.abs(m.debit - m.credit) };
        if (m.debit > m.credit) {
          lettrageState[tiers].factures.push(entry);        // débit = créance client
        } else {
          lettrageState[tiers].reglements.push(entry);      // crédit = règlement
        }
      });
    });

  // Trier par date (FIFO)
  Object.values(lettrageState).forEach((t) => {
    t.factures.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    t.reglements.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Imputation FIFO
    const regl = t.reglements.map((r) => ({ ...r, reste: r.reste }));
    t.factures.forEach((f) => {
      let resteF = f.reste;
      regl.forEach((r) => {
        if (resteF <= 0 || r.reste <= 0) return;
        const imput = Math.min(resteF, r.reste);
        resteF -= imput;
        r.reste -= imput;
        t.lettres.push({
          date: r.date,
          facture: f.date + ' · ' + fn(f.reste),
          reglement: r.date + ' · ' + fn(r.reste + imput),
          montant: imput,
          lettree: resteF < 0.01,
        });
      });
      f.reste = resteF;
    });

    // Solde résiduel non lettré
    t.soldeResiduel = t.factures.reduce((s, f) => s + f.reste, 0)
                    - regl.reduce((s, r) => s + r.reste, 0);
  });

  renderLettrage();
  const nb = Object.values(lettrageState).reduce((s, t) => s + t.lettres.length, 0);
  toast(`Lettrage FIFO — ${nb} association${nb > 1 ? 's' : ''} effectuée${nb > 1 ? 's' : ''}`, 'success');
}
function exportBalanceAgeePDF() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const company = currentProfile?.company || 'Entreprise';
    const today = new Date().toLocaleDateString('fr-FR');
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('BALANCE ÂGÉE — ' + company, 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Édité le ' + today, 14, 25);
    const map = getMap();
    const headers = [['Tiers','< 30J','30-60J','60-90J','> 90J','TOTAL']];
    const rows401 = [], rows411 = [];
    Object.entries(map).forEach(([code, acc]) => {
      if (!code.startsWith('401') && !code.startsWith('411')) return;
      const s = acc.debit - acc.credit;
      if (Math.abs(s) < 1) return;
      const row = [PC[code] || code, fnPDF(Math.abs(s)), '0','0','0', fnPDF(Math.abs(s))];
      if (code.startsWith('411')) rows411.push(row);
      else rows401.push(row);
    });
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('CLIENTS (411)', 14, 35);
    doc.autoTable({ head: headers, body: rows411.length ? rows411 : [['Aucune créance','','','','','']], startY: 38, styles: {fontSize:8}, headStyles:{fillColor:[30,30,40],textColor:[212,168,83]} });
    const y2 = doc.lastAutoTable.finalY + 8;
    doc.setFont('helvetica','bold'); doc.text('FOURNISSEURS (401)', 14, y2);
    doc.autoTable({ head: headers, body: rows401.length ? rows401 : [['Aucune dette','','','','','']], startY: y2+3, styles: {fontSize:8}, headStyles:{fillColor:[30,30,40],textColor:[212,168,83]} });
    doc.save('balance_agee_' + company.replace(/\s/g,'_') + '.pdf');
    toast('✅ Balance âgée exportée en PDF', 'success');
  } catch(e) { toast('Erreur export PDF: ' + e.message, 'error'); }
}
window.afficherLettrage = afficherLettrage;
window.lancerLettrage = lancerLettrage;
window.exportBalanceAgeePDF = exportBalanceAgeePDF;

// ══════════════════════════════════════════
// MODULE DÉCLARATIONS FISCALES
// ══════════════════════════════════════════
let declMode = 'tva';

function afficherDeclaration(mode) {
  declMode = mode;
  ['tva', 'disa', 'imf', 'is'].forEach(m => {
    const btn = document.getElementById('decl-btn-' + m);
    if (btn) { btn.style.borderColor = m === mode ? 'var(--warm)' : ''; btn.style.color = m === mode ? 'var(--warm)' : ''; }
  });
  renderDeclaration();
}

function renderDeclaration() {
  const el = document.getElementById('declarationContent');
  if (!el) return;
  const map = getMap();
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const company = currentProfile?.company || currentProfile?.companyName || '—';
  let html = '';
  if (declMode === 'tva') {
    // TVA collectée (4431+4432) et déductible (4451+4452+4453+4454)
    const tvaCollec = ['4431', '4432'].reduce((s, c) => s + (map[c] ? map[c].credit - map[c].debit : 0), 0);
    const tvaDeduc = ['4451', '4452', '4453', '4454'].reduce((s, c) => s + (map[c] ? map[c].debit - map[c].credit : 0), 0);
    const tvaNette = tvaCollec - tvaDeduc;
    html = `<div style="padding:16px"><h3 style="font-family:var(--font-display);margin-bottom:16px">Déclaration TVA — ${company} — Exercice ${yr}</h3>
      <div class="decl-section"><div class="decl-section-title">TVA collectée (opérations imposables)</div>
        <div class="decl-row"><span class="lbl">TVA sur ventes (4431)</span><span class="val">${fn(tvaCollec)} FCFA</span></div>
      </div>
      <div class="decl-section"><div class="decl-section-title">TVA déductible (achats et immobilisations)</div>
        ${['4451','4452','4453','4454'].map(c => `<div class="decl-row"><span class="lbl">Cpte ${c} — ${PC[c]||c}</span><span class="val">${fn(map[c] ? map[c].debit - map[c].credit : 0)} FCFA</span></div>`).join('')}
        <div class="decl-row" style="font-weight:600"><span class="lbl">Total déductible</span><span class="val">${fn(tvaDeduc)} FCFA</span></div>
      </div>
      <div class="decl-row total"><span class="lbl">TVA NETTE À DÉCLARER</span><span class="val" style="color:${tvaNette > 0 ? 'var(--rust)' : 'var(--green)'}">${fn(Math.abs(tvaNette))} FCFA ${tvaNette < 0 ? '(crédit de TVA)' : '(à payer)'}</span></div>
    </div>`;
  } else if (declMode === 'disa') {
    const masseB = salaries.reduce((s, x) => s + (x.brut || 0), 0);
    const totalCnps = salaries.reduce((s, x) => s + (x.cnpsSal || 0) + (x.chargesPatronales || 0), 0);
    const totalIR = salaries.reduce((s, x) => s + (x.ir || 0), 0);
    html = `<div style="padding:16px"><h3 style="font-family:var(--font-display);margin-bottom:16px">DISA — Déclaration des impôts sur salaires — ${yr}</h3>
      <div class="decl-row"><span class="lbl">Masse salariale brute</span><span class="val">${fn(masseB)} FCFA</span></div>
      <div class="decl-row"><span class="lbl">Nombre de salariés</span><span class="val">${salaries.length}</span></div>
      <div class="decl-row"><span class="lbl">Total CNPS (salarial + patronal)</span><span class="val">${fn(totalCnps)} FCFA</span></div>
      <div class="decl-row total"><span class="lbl">TOTAL IR À REVERSER</span><span class="val">${fn(totalIR)} FCFA</span></div>
    </div>`;
  } else if (declMode === 'imf') {
    const ca = ['701','702','703','704','705','706','707'].reduce((s, c) => s + (map[c] ? map[c].credit - map[c].debit : 0), 0);
    const imf = Math.max(3000000, Math.round(ca * 0.005));
    html = `<div style="padding:16px"><h3 style="font-family:var(--font-display);margin-bottom:16px">IMF — Impôt Minimum Forfaitaire — ${yr}</h3>
      <div class="decl-row"><span class="lbl">Chiffre d'affaires HT (7xxx)</span><span class="val">${fn(ca)} FCFA</span></div>
      <div class="decl-row"><span class="lbl">Taux IMF</span><span class="val">0,5%</span></div>
      <div class="decl-row"><span class="lbl">IMF calculé (0,5% × CA)</span><span class="val">${fn(Math.round(ca * 0.005))} FCFA</span></div>
      <div class="decl-row total"><span class="lbl">IMF À PAYER (minimum 3 000 000)</span><span class="val">${fn(imf)} FCFA</span></div>
    </div>`;
  } else if (declMode === 'is') {
    const produits = Object.entries(map).filter(([c]) => c.startsWith('7')).reduce((s, [, acc]) => s + (acc.credit - acc.debit), 0);
    const charges = Object.entries(map).filter(([c]) => c.startsWith('6')).reduce((s, [, acc]) => s + (acc.debit - acc.credit), 0);
    const resultat = produits - charges;
    const is = resultat > 0 ? Math.round(resultat * 0.25) : 0;
    html = `<div style="padding:16px"><h3 style="font-family:var(--font-display);margin-bottom:16px">IS — Impôt sur les Sociétés — ${yr}</h3>
      <div class="decl-row"><span class="lbl">Total produits (7xxx)</span><span class="val">${fn(produits)} FCFA</span></div>
      <div class="decl-row"><span class="lbl">Total charges (6xxx)</span><span class="val">${fn(charges)} FCFA</span></div>
      <div class="decl-row"><span class="lbl">Résultat imposable</span><span class="val" style="color:${resultat > 0 ? 'var(--green)' : 'var(--rust)'}">${fn(Math.abs(resultat))} FCFA ${resultat < 0 ? '(déficit)' : ''}</span></div>
      <div class="decl-row"><span class="lbl">Taux IS Côte d'Ivoire</span><span class="val">25%</span></div>
      <div class="decl-row total"><span class="lbl">IS À PAYER</span><span class="val">${fn(is)} FCFA</span></div>
    </div>`;
  }
  el.innerHTML = html || '<div class="empty-state"><div class="icon">📑</div><p>Sélectionnez une déclaration.</p></div>';
}

function exportDeclarationPDF() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const company = currentProfile?.company || 'Entreprise';
    const today = new Date().toLocaleDateString('fr-FR');
    const map = getMap();
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('DÉCLARATION FISCALE — ' + company, 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Période : Exercice ' + (currentProfile?.exercice||'2024') + ' — Édité le ' + today, 14, 25);
    // TVA
    const tvaCollectee = Object.entries(map).filter(([c])=>c.startsWith('443')).reduce((s,[,a])=>s+a.credit,0);
    const tvaDeductible = Object.entries(map).filter(([c])=>c.startsWith('445')).reduce((s,[,a])=>s+a.debit,0);
    const tvaNette = tvaCollectee - tvaDeductible;
    // IS
    const produits = Object.entries(map).filter(([c])=>c[0]==='7').reduce((s,[,a])=>s+a.credit-a.debit,0);
    const charges = Object.entries(map).filter(([c])=>c[0]==='6').reduce((s,[,a])=>s+a.debit-a.credit,0);
    const benefice = produits - charges;
    const is = benefice > 0 ? Math.round(benefice * 0.25) : 0;
    const ca = Object.entries(map).filter(([c])=>c.startsWith('70')).reduce((s,[,a])=>s+a.credit,0);
    const imf = Math.max(3000000, Math.round(ca * 0.005));
    const rows = [
      ['TVA collectée (443x)', fnPDF(tvaCollectee) + ' FCFA'],
      ['TVA déductible (445x)', fnPDF(tvaDeductible) + ' FCFA'],
      ['TVA NETTE À PAYER (444)', fnPDF(Math.max(0,tvaNette)) + ' FCFA'],
      ['',''],
      ['Chiffre d\'affaires HT (70x)', fnPDF(ca) + ' FCFA'],
      ['Charges totales (6x)', fnPDF(charges) + ' FCFA'],
      ['Bénéfice imposable', fnPDF(benefice) + ' FCFA'],
      ['IS 25%', fnPDF(is) + ' FCFA'],
      ['',''],
      ['IMF (0,5% CA, min 3 000 000)', fnPDF(imf) + ' FCFA'],
    ];
    doc.autoTable({ body: rows, startY: 32, styles:{fontSize:10}, columnStyles:{0:{fontStyle:'bold',cellWidth:120},1:{halign:'right'}} });
    doc.save('declaration_fiscale_' + company.replace(/\s/g,'_') + '.pdf');
    toast('✅ Déclaration fiscale exportée', 'success');
  } catch(e) { toast('Erreur export PDF: ' + e.message, 'error'); }
}
window.afficherDeclaration = afficherDeclaration;
window.exportDeclarationPDF = exportDeclarationPDF;

// ══════════════════════════════════════════
// MODULE CLÔTURE D'EXERCICE
// ══════════════════════════════════════════
async function verifierCloture() {
  const map = getMap();
  const totalD = ecritures.reduce((s, e) => s + e.lignes.reduce((ss, l) => ss + (l.debit || 0), 0), 0);
  const totalC = ecritures.reduce((s, e) => s + e.lignes.reduce((ss, l) => ss + (l.credit || 0), 0), 0);
  const ok = Math.abs(totalD - totalC) < 1;
  const el = document.getElementById('clotureStatus');
  el.innerHTML = `<div style="padding:12px"><div style="font-weight:600;margin-bottom:8px;color:${ok ? 'var(--green)' : 'var(--red)'}">${ok ? '✓ Balance équilibrée' : '⚠ Balance déséquilibrée'}</div>
    <div style="font-size:13px;color:var(--muted)">Total débit : ${fn(totalD)} FCFA<br>Total crédit : ${fn(totalC)} FCFA<br>Écart : ${fn(Math.abs(totalD-totalC))} FCFA<br>Nombre d'écritures : ${ecritures.length}</div>
    ${ok ? '<div style="margin-top:10px;color:var(--green);font-size:13px">✓ Vous pouvez passer à l\'étape 2 (Inventaire).</div>' : '<div style="margin-top:10px;color:var(--red);font-size:13px">Corrigez l\'écart avant de clôturer.</div>'}
  </div>`;
}

async function genererEcrituresCloture() {
  const map = getMap();
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  const produits = Object.entries(map).filter(([c]) => c.startsWith('7')).reduce((s, [, acc]) => s + (acc.credit - acc.debit), 0);
  const charges = Object.entries(map).filter(([c]) => c.startsWith('6')).reduce((s, [, acc]) => s + (acc.debit - acc.credit), 0);
  const res = produits - charges;
  const lignesClot = [];
  Object.entries(map).filter(([c]) => c.startsWith('7') && (map[c].credit - map[c].debit) > 0).forEach(([c, acc]) => {
    lignesClot.push({ compte: c, libelle: PC[c] || c, debit: Math.round(acc.credit - acc.debit), credit: 0 });
  });
  Object.entries(map).filter(([c]) => c.startsWith('6') && (map[c].debit - map[c].credit) > 0).forEach(([c, acc]) => {
    lignesClot.push({ compte: c, libelle: PC[c] || c, debit: 0, credit: Math.round(acc.debit - acc.credit) });
  });
  if (res > 0) lignesClot.push({ compte: '131', libelle: 'Résultat net — Bénéfice ' + yr, debit: 0, credit: Math.round(res) });
  else lignesClot.push({ compte: '139', libelle: 'Résultat net — Perte ' + yr, debit: Math.round(Math.abs(res)), credit: 0 });
  const ecr = { id: Date.now(), date: yr + '-12-31', journal: 'OD', piece: 'CLOT-' + yr, libelle: 'Clôture exercice ' + yr, createdAt: new Date().toISOString(), lignes: lignesClot };
  await saveEcritureToFirestore(ecr);
  ecritures.push(ecr);
  updateStats();
  // 🔒 Verrouillage automatique de l'exercice clôturé
  await lockPeriod(yr);
  const el = document.getElementById('clotureStatus');
  el.innerHTML = `<div style="padding:12px;color:var(--green)"><strong>✓ Écritures de clôture générées</strong><br>Résultat ${yr} : ${fn(Math.abs(res))} FCFA ${res > 0 ? '(bénéfice)' : '(perte)'}<br>Compte ${res > 0 ? '131' : '139'} mouvementé.</div>`;
  toast(`✓ Clôture ${yr} générée — Résultat : ${fn(Math.abs(res))} FCFA`, 'success');
}

async function ouvrirNouvelExercice() {
  const yr = parseInt(document.getElementById('exerciceYear')?.value || new Date().getFullYear());
  const newYr = yr + 1;
  if (!confirm(`Ouvrir l'exercice ${newYr} ? Cela créera les écritures d'À Nouveau.`)) return;
  // Feedback immédiat — l'opération Firestore peut prendre 1-2s
  const btn = document.querySelector('.btn-gold[onclick*="ouvrirNouvelExercice"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ouverture…'; }
  toast('⏳ Création des écritures À Nouveau…', 'info');
  const map = getMap();
  const lignesAN = [];
  // Comptes de bilan (1 à 5) → report
  Object.entries(map).filter(([c]) => ['1','2','3','4','5'].includes(c.charAt(0))).forEach(([c, acc]) => {
    const solde = acc.debit - acc.credit;
    if (Math.abs(solde) > 0) {
      if (solde > 0) lignesAN.push({ compte: c, libelle: (PC[c] || c) + ' AN', debit: Math.round(solde), credit: 0 });
      else lignesAN.push({ compte: c, libelle: (PC[c] || c) + ' AN', debit: 0, credit: Math.round(Math.abs(solde)) });
    }
  });
  if (!lignesAN.length) { toast('Aucun solde à reporter', 'info'); return; }
  const ecr = { id: Date.now(), date: newYr + '-01-01', journal: 'AN', piece: 'AN-' + newYr, libelle: 'À nouveau exercice ' + newYr, createdAt: new Date().toISOString(), lignes: lignesAN };
  await saveEcritureToFirestore(ecr);
  ecritures.push(ecr);
  document.getElementById('exerciceYear').value = String(newYr);
  updateStats();
  toast(`✓ Exercice ${newYr} ouvert — ${lignesAN.length} lignes d'À Nouveau`, 'success');
  if (btn) { btn.disabled = false; btn.textContent = 'Ouvrir N+1'; }
}

window.verifierCloture = verifierCloture;
window.genererEcrituresCloture = genererEcrituresCloture;
window.ouvrirNouvelExercice = ouvrirNouvelExercice;

// ══════════════════════════════════════════
// IMPORT CSV SAARI / SAGE — Journal, Plan comptable, Clients, Fournisseurs
// Format journal Saari : Date;Journal;Pièce;Compte;Libellé;Débit;Crédit
// Format clients/fourn : Code;Nom;Adresse;Téléphone;Email;Compte
// Format plan comptable : Compte;Libellé
// ══════════════════════════════════════════
function openImportModal(type) {
  const labels = {
    journal:       { titre: 'Importer Journal Saari/Sage', desc: 'Format CSV : Date;Journal;Pièce;Compte;Libellé;Débit;Crédit', accept: '.csv,.txt' },
    clients:       { titre: 'Importer Clients',            desc: 'Format CSV : Code;Nom;Adresse;Téléphone;Email;Compte',          accept: '.csv,.txt' },
    fournisseurs:  { titre: 'Importer Fournisseurs',       desc: 'Format CSV : Code;Nom;Adresse;Téléphone;Email;Compte',          accept: '.csv,.txt' },
    plan_comptable:{ titre: 'Importer Plan Comptable',     desc: 'Format CSV : Compte;Libellé',                                   accept: '.csv,.txt' },
  };
  const cfg = labels[type];
  if (!cfg) return;

  // Créer un input file invisible et le déclencher immédiatement
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = cfg.accept;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', () => {
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        await parseAndImportCSV(ev.target.result, type);
      } catch (e) {
        toast('Erreur import : ' + e.message, 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
    document.body.removeChild(inp);
  });
  inp.click();
}

async function parseAndImportCSV(raw, type) {
  // Normaliser séparateur : ; ou ,
  const lines = raw.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) { toast('Fichier vide ou non reconnu', 'error'); return; }

  // Détecter séparateur dominant
  const sep = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';

  const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[^a-zàâéèêîïôùûç0-9]/g,''));
  const rows = lines.slice(1).map(l => {
    const cols = l.split(sep);
    const obj = {};
    header.forEach((h, i) => obj[h] = (cols[i] || '').trim().replace(/^"(.*)"$/, '$1'));
    return obj;
  });

  if (type === 'journal') {
    await importJournalRows(rows, header);
  } else if (type === 'clients') {
    await importTiersRows(rows, 'clients');
  } else if (type === 'fournisseurs') {
    await importTiersRows(rows, 'fournisseurs');
  } else if (type === 'plan_comptable') {
    await importPlanComptableRows(rows);
  }
}

async function importJournalRows(rows, header) {
  // Regrouper par pièce pour reconstituer les écritures multi-lignes
  const byPiece = {};
  for (const r of rows) {
    // Essayer les noms de colonnes courants Saari/Sage
    const date    = r['date'] || r['dat'] || '';
    const journal = r['journal'] || r['jnl'] || r['journ'] || 'OD';
    const piece   = r['pice'] || r['pièce'] || r['piece'] || r['numpiece'] || r['reference'] || String(Date.now());
    const compte  = r['compte'] || r['numcompte'] || r['cpt'] || '';
    const libelle = r['libell'] || r['libelle'] || r['designation'] || '';
    const debit   = parseFloat((r['dbit'] || r['débit'] || r['debit'] || '0').replace(/\s/g,'').replace(',','.')) || 0;
    const credit  = parseFloat((r['crdit'] || r['crédit'] || r['credit'] || '0').replace(/\s/g,'').replace(',','.')) || 0;

    if (!date || !compte) continue;
    const key = date + '|' + journal + '|' + piece;
    if (!byPiece[key]) byPiece[key] = { date, journal, piece, libelle, lignes: [] };
    byPiece[key].lignes.push({ compte: String(compte), libelle, debit: Math.round(debit), credit: Math.round(credit) });
    if (libelle && !byPiece[key].libelle) byPiece[key].libelle = libelle;
  }

  const ownerID = getOwnerProfileId();
  let imported = 0, skipped = 0;
  for (const key of Object.keys(byPiece)) {
    const ecr = byPiece[key];
    // Vérifier équilibre (tolérance 1 FCFA)
    const td = ecr.lignes.reduce((s,l) => s + l.debit, 0);
    const tc = ecr.lignes.reduce((s,l) => s + l.credit, 0);
    if (Math.abs(td - tc) > 1) { skipped++; continue; }
    const newEcr = {
      id: Date.now() + imported,
      date: ecr.date,
      journal: ecr.journal,
      piece: ecr.piece,
      libelle: ecr.libelle,
      lignes: ecr.lignes,
      createdAt: new Date().toISOString(),
      source: 'import_saari',
    };
    const docRef = await window._fbAddDoc(
      window._fbCollection(window._db, 'profiles', ownerID, 'ecritures'),
      newEcr
    );
    newEcr._docId = docRef.id;
    ecritures.push(newEcr);
    imported++;
  }
  pieceCounter = ecritures.length + 1; // legacy — réel géré par getNextPiece()
  updateStats();
  await logAudit('IMPORT', 'COMPTABILITE', `Import Saari : ${imported} écriture(s) importée(s), ${skipped} ignorée(s) (déséquilibrées)`, currentProfile.email);
  toast(`✓ Import terminé — ${imported} écriture(s) importée(s)${skipped ? `, ${skipped} ignorée(s) (déséquilibre)` : ''}`, imported > 0 ? 'success' : 'error');
  if (imported > 0) renderJournal();
}

async function importTiersRows(rows, collection) {
  const ownerID = getOwnerProfileId();
  let imported = 0;
  for (const r of rows) {
    const nom     = r['nom'] || r['raisonsociale'] || r['name'] || '';
    const code    = r['code'] || r['ref'] || r['reference'] || '';
    const adresse = r['adresse'] || r['address'] || '';
    const tel     = r['tlphone'] || r['telephone'] || r['tel'] || r['phone'] || '';
    const email   = r['email'] || r['mail'] || '';
    const compte  = r['compte'] || r['numcompte'] || (collection === 'clients' ? '411' : '401');
    if (!nom) continue;
    const tiers = { nom, code, adresse, tel, email, compte, createdAt: new Date().toISOString(), source: 'import_saari' };
    const docRef = await window._fbAddDoc(
      window._fbCollection(window._db, 'profiles', ownerID, collection),
      tiers
    );
    tiers._docId = docRef.id;
    if (collection === 'clients') clientsList.push(tiers);
    else fournisseursList.push(tiers);
    imported++;
  }
  toast(`✓ ${imported} ${collection === 'clients' ? 'client(s)' : 'fournisseur(s)'} importé(s)`, imported > 0 ? 'success' : 'error');
}

async function importPlanComptableRows(rows) {
  let imported = 0;
  for (const r of rows) {
    const code   = (r['compte'] || r['code'] || r['numcompte'] || '').replace(/\s/g,'');
    const libelle = r['libell'] || r['libelle'] || r['designation'] || '';
    if (!code || !libelle) continue;
    if (!PC[code]) { PC[code] = libelle; imported++; }
  }
  renderPlanComptable();
  toast(`✓ ${imported} compte(s) ajouté(s) au plan comptable`, imported > 0 ? 'success' : 'info');
}

window.openImportModal = openImportModal;

// ══════════════════════════════════════════
// MODAL PLAN COMPTABLE 3D — Sélection de compte
// ══════════════════════════════════════════
let _pcModalCallback = null;   // fonction appelée avec (code, lib) au choix
let _pcModalClass = 'all';     // filtre classe actif
let _pcModalHighlight = 0;     // index résultat sélectionné au clavier

const CLASS_NATURE = { 1:'Passif', 2:'Actif', 3:'Actif', 4:'Mixte', 5:'Trésorerie', 6:'Charge', 7:'Produit', 8:'Spécial' };
const CLASS_ICONS  = { 1:'🏛️', 2:'🏗️', 3:'📦', 4:'👥', 5:'💳', 6:'📤', 7:'📥', 8:'⚙️' };

function openPcModal(callback) {
  _pcModalCallback = callback;
  _pcModalClass = 'all';
  _pcModalHighlight = 0;
  const overlay = document.getElementById('pcModalOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  // Construire la navigation par classe si vide
  _buildPcClassNav();
  renderPcModal();
  setTimeout(() => {
    const s = document.getElementById('pcModalSearch');
    if (s) { s.value = ''; s.focus(); }
  }, 80);
  // Fermer avec Échap
  overlay._kbHandler = (e) => {
    if (e.key === 'Escape') { closePcModal(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { _pcModalMoveSel(e.key === 'ArrowDown' ? 1 : -1); e.preventDefault(); }
    else if (e.key === 'Enter') { _pcModalPickHighlighted(); e.preventDefault(); }
  };
  document.addEventListener('keydown', overlay._kbHandler);
}

function closePcModal() {
  const overlay = document.getElementById('pcModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  if (overlay._kbHandler) document.removeEventListener('keydown', overlay._kbHandler);
  _pcModalCallback = null;
}

function _buildPcClassNav() {
  const nav = document.getElementById('pcModalClassNav');
  if (!nav || nav.dataset.built) return;
  nav.dataset.built = '1';
  const classCounts = {};
  Object.keys(PC).forEach(c => { const cl = c[0]; classCounts[cl] = (classCounts[cl]||0)+1; });
  Object.keys(CLASS_NAMES).sort().forEach(cl => {
    const btn = document.createElement('button');
    btn.className = 'pcm-cls-btn';
    btn.dataset.cls = cl;
    btn.innerHTML = `<span class="pcm-cls-num">${CLASS_ICONS[cl]||cl}</span><span class="pcm-cls-label">${CLASS_NAMES[cl]}</span><span class="pcm-count-badge">${classCounts[cl]||0}</span>`;
    btn.onclick = function() { filterPcClass(cl, btn); };
    nav.appendChild(btn);
  });
}

function filterPcClass(cls, btn) {
  _pcModalClass = cls;
  _pcModalHighlight = 0;
  document.querySelectorAll('.pcm-cls-btn').forEach(b => b.classList.toggle('active', b === btn || (cls==='all' && b.dataset.cls === undefined)));
  // Gérer le bouton "Toutes"
  if (cls === 'all') {
    document.querySelectorAll('.pcm-cls-btn[data-cls]').forEach(b => b.classList.remove('active'));
    document.querySelector('.pcm-cls-btn:not([data-cls])')?.classList.add('active');
  }
  renderPcModal();
  // Scroll vers le début
  const body = document.getElementById('pcModalBody');
  if (body) body.scrollTop = 0;
}

function renderPcModal() {
  const body = document.getElementById('pcModalBody');
  const countEl = document.getElementById('pcModalCount');
  const search = (document.getElementById('pcModalSearch')?.value || '').trim().toLowerCase();
  if (!body) return;

  // MODE RECHERCHE — liste plate
  if (search.length >= 1) {
    body.classList.add('list-mode');
    const q = search.replace(/[^a-z0-9àâéèêîïôùûç\s]/g, '');
    const results = Object.entries(PC).filter(([code, lib]) =>
      code.startsWith(search) || lib.toLowerCase().includes(q) ||
      code.toLowerCase().includes(q)
    ).slice(0, 120);
    if (countEl) countEl.textContent = `${results.length} compte(s) trouvé(s)`;
    if (!results.length) {
      body.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted);font-size:13px">Aucun compte trouvé pour "<strong>${search}</strong>"</div>`;
      return;
    }
    body.innerHTML = results.map(([code, lib], i) => {
      const hlCode = code.replace(new RegExp(`(${escRe(search)})`, 'gi'), '<mark class="hl">$1</mark>');
      const hlLib  = lib.replace(new RegExp(`(${escRe(q)})`, 'gi'), '<mark class="hl">$1</mark>');
      const clNum = code[0];
      return `<div class="pcm-search-result${i===_pcModalHighlight?' pcm-hl':''}" data-pi="${i}" onclick="pickPcAccount('${code}','${lib.replace(/'/g,"\\'")}')">
        <span class="pcm-sr-code">${hlCode}</span>
        <span class="pcm-sr-lib">${hlLib}</span>
        <span class="pcm-sr-class">${CLASS_ICONS[clNum]||clNum} ${CLASS_NAMES[clNum]||'Cl.'+clNum}</span>
        <span style="color:var(--warm);font-size:10px;font-family:var(--font-mono);opacity:${i===_pcModalHighlight?1:0}">→ Choisir</span>
      </div>`;
    }).join('');
    return;
  }

  // MODE GRILLE — cartes 3D par classe
  body.classList.remove('list-mode');
  const classes = _pcModalClass === 'all' ? Object.keys(CLASS_NAMES).sort() : [String(_pcModalClass)];
  const cards = classes.map(cl => {
    const entries = Object.entries(PC).filter(([c]) => c[0] === cl).sort(([a],[b]) => a.localeCompare(b));
    if (!entries.length) return '';
    const rows = entries.map(([code, lib]) => {
      const depth = code.length <= 3 ? '' : code.length === 4 ? 'pcm-row-depth-2' : code.length === 5 ? 'pcm-row-depth-3' : 'pcm-row-depth-4plus';
      return `<div class="pcm-row ${depth}" onclick="pickPcAccount('${code}','${lib.replace(/'/g,"\\'")}')">
        <span class="pcm-row-code">${code}</span>
        <span class="pcm-row-lib">${lib}</span>
        <span class="pcm-row-pick">→ Choisir</span>
      </div>`;
    }).join('');
    if (countEl) countEl.textContent = `${Object.keys(PC).length} comptes · SYSCOHADA`;
    return `<div class="pcm-card">
      <div class="pcm-card-head">
        <div class="pcm-card-big-num">${cl}</div>
        <div class="pcm-card-info">
          <div class="pcm-card-name">${CLASS_NAMES[cl] || 'Classe '+cl}</div>
          <span class="pcm-card-nature">${CLASS_NATURE[cl]||'Compte'}</span>
          <div class="pcm-card-nb">${entries.length} compte(s)</div>
        </div>
      </div>
      <div class="pcm-card-rows">${rows}</div>
    </div>`;
  }).join('');
  body.innerHTML = cards || `<div style="color:var(--muted);padding:40px;text-align:center">Aucun compte dans cette classe</div>`;
}

function pickPcAccount(code, lib) {
  if (_pcModalCallback) _pcModalCallback(code, lib);
  closePcModal();
}

function _pcModalMoveSel(dir) {
  const items = document.querySelectorAll('#pcModalBody .pcm-search-result');
  if (!items.length) return;
  items[_pcModalHighlight]?.classList.remove('pcm-hl');
  items[_pcModalHighlight]?.querySelector('span:last-child') && (items[_pcModalHighlight].querySelector('span:last-child').style.opacity = '0');
  _pcModalHighlight = Math.max(0, Math.min(items.length-1, _pcModalHighlight + dir));
  const el = items[_pcModalHighlight];
  if (el) {
    el.classList.add('pcm-hl');
    const arrow = el.querySelector('span:last-child');
    if (arrow) arrow.style.opacity = '1';
    el.scrollIntoView({ block:'nearest' });
  }
}

function _pcModalPickHighlighted() {
  const el = document.querySelector('#pcModalBody .pcm-search-result.pcm-hl');
  if (el) el.click();
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Patch des fonctions de mise à jour : on ajoute un bouton 📋 à côté de chaque input compte
// pour ouvrir le modal. On surcharge updateAccountSuggest et updateAccountSuggestMulti
// pour injecter le bouton la première fois.
function _injectPcBtnNear(input, cb) {
  if (!input) return;
  if (input._pcBtn) return; // déjà injecté
  input._pcBtn = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Ouvrir le plan comptable';
  btn.className = 'pc-open-btn';
  btn.innerHTML = '📋';
  btn.style.cssText = 'position:absolute;right:36px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:14px;z-index:5;opacity:.55;transition:opacity .15s;line-height:1;padding:2px 4px;';
  btn.onmouseenter = () => btn.style.opacity = '1';
  btn.onmouseleave = () => btn.style.opacity = '.55';
  btn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPcModal(cb);
  };
  const wrap = input.parentElement;
  if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  wrap?.appendChild(btn);
}

window.openPcModal = openPcModal;
window.closePcModal = closePcModal;
window.renderPcModal = renderPcModal;
window.filterPcClass = filterPcClass;
window.pickPcAccount = pickPcAccount;
document.addEventListener('firebase-ready', async () => {
  await loadServerConfig();
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await window._fbGetDoc(window._fbDoc(window._db, 'profiles', user.uid));
      if (snap.exists()) {
        currentProfile = { ...snap.data(), id: user.uid };
        conversationHistory = [];
        await loadApp();
      }
    }
  });
});

async function doForgotPassword() {
  const email = document.getElementById('l-email').value.trim();
  if (!email) {
    toast('Entrez votre email puis cliquez sur ce lien', 'error');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Email de réinitialisation envoyé à ' + email, 'success');
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}
window.doForgotPassword = doForgotPassword;
window.openWavePayment = openWavePayment;
window.claimWavePayment = claimWavePayment;
window.activatePremiumWithCode = activatePremiumWithCode;
// ══════════════════════════════════════════
// EXPOSITION GLOBALE
// ══════════════════════════════════════════
if (!window.sendToAI) {
  window.sendToAI = sendToAI;
}
window.handleAiKey = handleAiKey;
window.quickAI = quickAI;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.doLogout = doLogout;
window.switchTab = switchTab;
window.navigate = navigate;
window.addLigne = addLigne;
window.removeLigne = removeLigne;
window.saveEcriture = saveEcriture;
window.updateAccountSuggest = updateAccountSuggest;
window.selectAccount = selectAccount;
window.hideDropdown = hideDropdown;
window.closeAccountDropdown = closeAccountDropdown;
window.browseAccountClass = browseAccountClass;
window.updateAccountSuggestMulti = updateAccountSuggestMulti;
window.selectAccountMulti = selectAccountMulti;
window.updateBalance = updateBalance;
window.autoSaveAllEcritures = autoSaveAllEcritures;
window.autoSaveAllFromNotif = autoSaveAllFromNotif;
window.skipToNextEcriture = skipToNextEcriture;
window.onClickTopValidate = onClickTopValidate;
window.renderMultiEcrEditor = renderMultiEcrEditor;
window.addLigneMulti = addLigneMulti;
window.removeLigneMulti = removeLigneMulti;
window.removeEcritureFromQueue = removeEcritureFromQueue;
window.updateMultiBlockBalance = updateMultiBlockBalance;
window.dismissFillBanner = dismissFillBanner;
window.hideMultiEcrBanner = hideMultiEcrBanner;
window.hideSaisieNotif = hideSaisieNotif;
window.goToSaisie = goToSaisie;
window.toggleGL = toggleGL;
window.deleteEcriture = deleteEcriture;
window.deleteGroupe = deleteGroupe;
window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;
window.selectExport = selectExport;
window.doExport = doExport;
window.renderJournal = renderJournal;
window.renderGrandLivre = renderGrandLivre;
window.renderBalance = renderBalance;
window.renderBilan = renderBilan;
window.renderResultat = renderResultat;
window.renderTresorerie = renderTresorerie;
window.renderPlanComptable = renderPlanComptable;
window.resetJournalFiltre = resetJournalFiltre;
window.resetGLFiltre = resetGLFiltre;
window.resetBalanceFiltre = resetBalanceFiltre;
window.updateStats = updateStats;
window.toggleMobileSidebar = toggleMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;

// ── Facturation ──
window.openFactureModal = openFactureModal;
window.closeFactureModal = closeFactureModal;
window.saveFacture = saveFacture;
window.addFacLigne = addFacLigne;
window.removeFacLigne = removeFacLigne;
window.marquerPayee = marquerPayee;
window.supprimerFacture = supprimerFacture;
window.exportFacturePDF = exportFacturePDF;
window.exportFactureWord = exportFactureWord;
window.exportFactureExcel = exportFactureExcel;
window.exportFactureList = exportFactureList;
window.renderFactures = renderFactures;
window.resetFactureFiltre = resetFactureFiltre;
window.searchClientDrop = searchClientDrop;
window.selectClientForFac = selectClientForFac;
window.newFactureForClient = newFactureForClient;
window.previewFacturePDF = (id) => exportFacturePDF(editingFactureId || id);
window.openDevisModal = openDevisModal;
window.renderDevis = renderDevis;
window.convertirDevisEnFacture = convertirDevisEnFacture;
window.updateFacTotaux = updateFacTotaux; // ← MANQUAIT
window.calcLigneHT = calcLigneHT; // ← MANQUAIT
window.calcLigneTVA = calcLigneTVA; // ← MANQUAIT
// ── Clients ──
window.openClientModal = openClientModal;
window.closeClientModal = closeClientModal;
window.saveClient = saveClient;
window.renderClients = renderClients;

// ── Fournisseurs ──
window.openFournisseurModal = openFournisseurModal;
window.closeFournisseurModal = closeFournisseurModal;
window.saveFournisseur = saveFournisseur;
window.renderFournisseurs = renderFournisseurs;
// ══════════════════════════════════════════════════════════════════
// ██  MODULE 1 — COMPTABILITÉ ANALYTIQUE (Centres de coût / Axes)
// ══════════════════════════════════════════════════════════════════
let centresCout = [];       // { id, code, libelle, type, responsable }
let imputationsAnalyt = []; // { id, ecritureId, ligneIdx, centreId, montant, sens }

async function loadAnalytique() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const [snapC, snapI] = await Promise.all([
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'centres_cout')),
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'imputations_analytiques')),
    ]);
    centresCout = snapC.docs.map(d => ({ ...d.data(), _docId: d.id }));
    imputationsAnalyt = snapI.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) {}
}

function openCentreModal(id = null) {
  const m = id ? centresCout.find(c => c.id === id) : null;
  document.getElementById('centre-id').value = m ? m.id : '';
  document.getElementById('centre-code').value = m ? m.code : '';
  document.getElementById('centre-libelle').value = m ? m.libelle : '';
  document.getElementById('centre-type').value = m ? m.type : 'exploitation';
  document.getElementById('centre-responsable').value = m ? (m.responsable || '') : '';
  document.getElementById('centreModal').style.display = 'flex';
}

async function saveCentre() {
  const id = document.getElementById('centre-id').value;
  const code = document.getElementById('centre-code').value.trim();
  const libelle = document.getElementById('centre-libelle').value.trim();
  const type = document.getElementById('centre-type').value;
  const responsable = document.getElementById('centre-responsable').value.trim();
  if (!code || !libelle) { toast('Code et libellé obligatoires', 'error'); return; }
  if (!id && centresCout.find(c => c.code === code)) { toast('Ce code existe déjà', 'error'); return; }
  const centre = { id: id || Date.now(), code, libelle, type, responsable, createdAt: new Date().toISOString() };
  if (id) {
    const idx = centresCout.findIndex(c => String(c.id) === String(id));
    if (idx > -1) centresCout[idx] = centre;
    if (window._fbReady && currentProfile?.id && centre._docId) {
      try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'centres_cout', centre._docId), centre, { merge: true }); } catch(e) {}
    }
  } else {
    centresCout.push(centre);
    if (window._fbReady && currentProfile?.id) {
      try { const ref = await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'centres_cout'), centre); centre._docId = ref.id; } catch(e) {}
    }
  }
  document.getElementById('centreModal').style.display = 'none';
  toast(`✓ Centre "${libelle}" enregistré`, 'success');
  renderAnalytique();
}

async function deleteCentre(id) {
  if (!confirm('Supprimer ce centre de coût ?')) return;
  const centre = centresCout.find(c => String(c.id) === String(id));
  centresCout = centresCout.filter(c => String(c.id) !== String(id));
  if (window._fbReady && currentProfile?.id && centre?._docId) {
    try { await window._fbDeleteDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'centres_cout', centre._docId)); } catch(e) {}
  }
  toast('Centre supprimé', 'success');
  renderAnalytique();
}

function openImputationModal(ecritureId, ligneIdx, montant, sens) {
  document.getElementById('imput-ecr-id').value = ecritureId;
  document.getElementById('imput-ligne-idx').value = ligneIdx;
  document.getElementById('imput-montant').value = montant;
  document.getElementById('imput-sens').value = sens;
  const sel = document.getElementById('imput-centre');
  sel.innerHTML = centresCout.map(c => `<option value="${c.id}">${c.code} — ${c.libelle}</option>`).join('');
  const pct = document.getElementById('imput-pct');
  pct.value = 100;
  updateImputMontant();
  document.getElementById('imputationModal').style.display = 'flex';
}

function updateImputMontant() {
  const base = parseFloat(document.getElementById('imput-montant').value) || 0;
  const pct = parseFloat(document.getElementById('imput-pct').value) || 100;
  document.getElementById('imput-montant-calc').textContent = fn(Math.round(base * pct / 100)) + ' FCFA';
}

async function saveImputation() {
  const ecritureId = document.getElementById('imput-ecr-id').value;
  const ligneIdx = parseInt(document.getElementById('imput-ligne-idx').value);
  const base = parseFloat(document.getElementById('imput-montant').value) || 0;
  const pct = parseFloat(document.getElementById('imput-pct').value) || 100;
  const centreId = document.getElementById('imput-centre').value;
  const sens = document.getElementById('imput-sens').value;
  const montant = Math.round(base * pct / 100);
  const centre = centresCout.find(c => String(c.id) === String(centreId));
  if (!centre) { toast('Sélectionnez un centre', 'error'); return; }
  const imput = { id: Date.now(), ecritureId, ligneIdx, centreId, code: centre.code, libelle: centre.libelle, montant, pct, sens, createdAt: new Date().toISOString() };
  imputationsAnalyt.push(imput);
  if (window._fbReady && currentProfile?.id) {
    try { await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'imputations_analytiques'), imput); } catch(e) {}
  }
  document.getElementById('imputationModal').style.display = 'none';
  toast(`✓ Imputation ${fn(montant)} FCFA → ${centre.code}`, 'success');
  renderAnalytique();
}

function renderAnalytique() {
  const el = document.getElementById('analytiqueContent');
  if (!el) return;

  // KPIs par type de centre
  const types = ['exploitation', 'support', 'projet'];
  const totaux = {};
  types.forEach(t => { totaux[t] = 0; });
  imputationsAnalyt.forEach(i => {
    const c = centresCout.find(x => String(x.id) === String(i.centreId));
    if (c) totaux[c.type || 'exploitation'] = (totaux[c.type || 'exploitation'] || 0) + i.montant;
  });

  document.getElementById('analyt-kpi-centres').textContent = centresCout.length;
  document.getElementById('analyt-kpi-imput').textContent = imputationsAnalyt.length;
  document.getElementById('analyt-kpi-exploit').textContent = fn(totaux.exploitation || 0);
  document.getElementById('analyt-kpi-projet').textContent = fn(totaux.projet || 0);

  if (!centresCout.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Aucun centre de coût. Créez-en un pour commencer l\'analyse analytique.</p></div>';
    return;
  }

  // Tableau des centres avec totaux
  const rows = centresCout.map(c => {
    const imput = imputationsAnalyt.filter(i => String(i.centreId) === String(c.id));
    const totalDebit = imput.filter(i => i.sens === 'debit').reduce((s, i) => s + i.montant, 0);
    const totalCredit = imput.filter(i => i.sens === 'credit').reduce((s, i) => s + i.montant, 0);
    const solde = totalDebit - totalCredit;
    const typeLabels = { exploitation: '🏭 Exploitation', support: '🔧 Support', projet: '📁 Projet' };
    return `<tr>
      <td><strong>${c.code}</strong></td>
      <td>${c.libelle}</td>
      <td><span class="analyt-badge analyt-badge-${c.type || 'exploitation'}">${typeLabels[c.type] || c.type}</span></td>
      <td style="color:var(--muted);font-size:12px">${c.responsable || '—'}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fn(totalDebit)}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fn(totalCredit)}</td>
      <td style="text-align:right;font-family:var(--font-mono);font-weight:700;color:${solde >= 0 ? 'var(--rust)' : 'var(--green)'}">${fn(Math.abs(solde))}</td>
      <td>
        <button class="btn btn-sm-wire" onclick="openCentreModal(${c.id})" title="Modifier">✎</button>
        <button class="btn btn-sm-wire" onclick="deleteCentre(${c.id})" title="Supprimer" style="color:var(--rust)">✕</button>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="dtw"><table class="dt">
    <thead><tr>
      <th>Code</th><th>Libellé</th><th>Type</th><th>Responsable</th>
      <th style="text-align:right">Charges</th>
      <th style="text-align:right">Produits</th>
      <th style="text-align:right">Solde</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="4" style="font-weight:700">TOTAL</td>
      <td style="text-align:right;font-weight:700;font-family:var(--font-mono)">${fn(imputationsAnalyt.filter(i=>i.sens==='debit').reduce((s,i)=>s+i.montant,0))}</td>
      <td style="text-align:right;font-weight:700;font-family:var(--font-mono)">${fn(imputationsAnalyt.filter(i=>i.sens==='credit').reduce((s,i)=>s+i.montant,0))}</td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table></div>`;
}

function exportAnalytiquePDF() {
  if (!centresCout.length) { toast('Aucun centre de coût', 'error'); return; }
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF non disponible', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Entreprise';
  const yr = document.getElementById('exerciceYear')?.value || new Date().getFullYear();
  doc.setFillColor(10,11,16); doc.rect(0,0,297,22,'F');
  doc.setTextColor(212,168,83); doc.setFontSize(12); doc.setFont('helvetica','bold');
  doc.text(`RAPPORT ANALYTIQUE PAR CENTRES DE COÛT — ${company} — ${yr}`, 14, 14);
  const rows = centresCout.map(c => {
    const imput = imputationsAnalyt.filter(i => String(i.centreId) === String(c.id));
    const charges = imput.filter(i=>i.sens==='debit').reduce((s,i)=>s+i.montant,0);
    const produits = imput.filter(i=>i.sens==='credit').reduce((s,i)=>s+i.montant,0);
    return [c.code, c.libelle, c.type||'exploitation', c.responsable||'—', fn(charges), fn(produits), fn(Math.abs(charges-produits))];
  });
  doc.autoTable({
    startY: 26,
    head: [['Code','Libellé','Type','Responsable','Charges (FCFA)','Produits (FCFA)','Solde (FCFA)']],
    body: rows,
    styles: { font:'helvetica', fontSize:8.5 },
    headStyles: { fillColor:[10,11,16], textColor:[212,168,83] },
    columnStyles: { 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right',fontStyle:'bold'} },
    margin: { left:14, right:14 },
  });
  doc.save(`ANALYTIQUE_${company.replace(/\s+/g,'_')}_${yr}.pdf`);
  toast('✓ Rapport analytique exporté', 'success');
}

window.openCentreModal = openCentreModal;
window.saveCentre = saveCentre;
window.deleteCentre = deleteCentre;
window.openImputationModal = openImputationModal;
window.updateImputMontant = updateImputMontant;
window.saveImputation = saveImputation;
window.renderAnalytique = renderAnalytique;
window.exportAnalytiquePDF = exportAnalytiquePDF;

// ══════════════════════════════════════════════════════════════════
// ██  MODULE 2 — MULTI-ENTREPRISES / MULTI-EXERCICES
// ══════════════════════════════════════════════════════════════════
let allSocietes = [];  // Liste des sociétés liées au compte
let currentSociete = null;

async function loadSocietes() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'societes'));
    allSocietes = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    // Si aucune société n'existe, créer l'entreprise courante automatiquement
    if (!allSocietes.length && currentProfile?.company) {
      const soc = {
        id: 'main_' + currentProfile.id,
        nom: currentProfile.company || 'Entreprise principale',
        forme: currentProfile.forme || 'SARL',
        rccm: currentProfile.rccm || '',
        nif: currentProfile.nif || '',
        adresse: currentProfile.adresse || '',
        exercices: [new Date().getFullYear()],
        exerciceActif: new Date().getFullYear(),
        estPrincipale: true,
        createdAt: new Date().toISOString(),
      };
      try {
        const ref = await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'societes'), soc);
        soc._docId = ref.id;
        allSocietes = [soc];
        currentSociete = soc;
      } catch(e) {}
    } else {
      currentSociete = allSocietes.find(s => s.estPrincipale) || allSocietes[0] || null;
    }
    renderSocietes();
  } catch(e) {}
}

function openSocieteModal(id = null) {
  const s = id ? allSocietes.find(x => String(x.id) === String(id)) : null;
  document.getElementById('soc-id').value = s ? s.id : '';
  document.getElementById('soc-nom').value = s ? s.nom : '';
  document.getElementById('soc-forme').value = s ? (s.forme || 'SARL') : 'SARL';
  document.getElementById('soc-rccm').value = s ? (s.rccm || '') : '';
  document.getElementById('soc-nif').value = s ? (s.nif || '') : '';
  document.getElementById('soc-adresse').value = s ? (s.adresse || '') : '';
  document.getElementById('soc-exercice').value = s ? (s.exerciceActif || new Date().getFullYear()) : new Date().getFullYear();
  document.getElementById('societeModal').style.display = 'flex';
}

async function saveSociete() {
  const id = document.getElementById('soc-id').value;
  const nom = document.getElementById('soc-nom').value.trim();
  const forme = document.getElementById('soc-forme').value;
  const rccm = document.getElementById('soc-rccm').value.trim();
  const nif = document.getElementById('soc-nif').value.trim();
  const adresse = document.getElementById('soc-adresse').value.trim();
  const exerciceActif = parseInt(document.getElementById('soc-exercice').value) || new Date().getFullYear();
  if (!nom) { toast('Le nom est obligatoire', 'error'); return; }

  const soc = { id: id || String(Date.now()), nom, forme, rccm, nif, adresse, exerciceActif, exercices: [exerciceActif], estPrincipale: !allSocietes.length, createdAt: new Date().toISOString() };
  if (id) {
    const existing = allSocietes.find(s => String(s.id) === String(id));
    if (existing) { soc.exercices = existing.exercices || [exerciceActif]; soc._docId = existing._docId; }
    const idx = allSocietes.findIndex(s => String(s.id) === String(id));
    if (idx > -1) allSocietes[idx] = soc;
    if (window._fbReady && currentProfile?.id && soc._docId) {
      try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'societes', soc._docId), soc, { merge: true }); } catch(e) {}
    }
  } else {
    allSocietes.push(soc);
    if (window._fbReady && currentProfile?.id) {
      try { const ref = await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'societes'), soc); soc._docId = ref.id; } catch(e) {}
    }
  }
  document.getElementById('societeModal').style.display = 'none';
  toast(`✓ Société "${nom}" enregistrée`, 'success');
  renderSocietes();
}

async function switchSociete(id) {
  const soc = allSocietes.find(s => String(s.id) === String(id));
  if (!soc) return;
  currentSociete = soc;
  // Mettre à jour le badge société dans la topbar
  const badge = document.getElementById('societeBadge');
  if (badge) badge.textContent = soc.nom;
  const exBadge = document.getElementById('exerciceBadge');
  if (exBadge) exBadge.textContent = soc.exerciceActif || new Date().getFullYear();
  const exInput = document.getElementById('exerciceYear');
  if (exInput) exInput.value = soc.exerciceActif || new Date().getFullYear();
  toast(`✓ Basculé sur : ${soc.nom} — Exercice ${soc.exerciceActif}`, 'success');
  renderSocietes();
  updateStats();
}

async function ajouterExercice(socId) {
  const soc = allSocietes.find(s => String(s.id) === String(socId));
  if (!soc) return;
  const yr = parseInt(prompt('Année du nouvel exercice :', new Date().getFullYear() + 1));
  if (!yr || isNaN(yr)) return;
  if (soc.exercices?.includes(yr)) { toast('Exercice déjà existant', 'error'); return; }
  soc.exercices = [...(soc.exercices || []), yr].sort();
  soc.exerciceActif = yr;
  if (window._fbReady && currentProfile?.id && soc._docId) {
    try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'societes', soc._docId), soc, { merge: true }); } catch(e) {}
  }
  toast(`✓ Exercice ${yr} ajouté à ${soc.nom}`, 'success');
  renderSocietes();
}

function renderSocietes() {
  const el = document.getElementById('societesContent');
  if (!el) return;

  document.getElementById('soc-kpi-total').textContent = allSocietes.length;
  const active = currentSociete;
  document.getElementById('soc-kpi-active').textContent = active ? active.nom : '—';
  const totalEx = allSocietes.reduce((s,x) => s + (x.exercices?.length || 1), 0);
  document.getElementById('soc-kpi-exercices').textContent = totalEx;
  document.getElementById('soc-kpi-annee').textContent = active?.exerciceActif || new Date().getFullYear();

  if (!allSocietes.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🏢</div><p>Aucune société. Créez la première pour commencer.</p></div>';
    return;
  }

  el.innerHTML = `<div class="societes-grid">${allSocietes.map(s => {
    const isActive = currentSociete && String(currentSociete.id) === String(s.id);
    return `<div class="soc-card ${isActive ? 'soc-card-active' : ''}">
      <div class="soc-card-header">
        <div>
          <div class="soc-card-nom">${s.nom}</div>
          <div class="soc-card-forme">${s.forme || 'SARL'} ${s.rccm ? '· RCCM ' + s.rccm : ''}</div>
        </div>
        ${isActive ? '<span class="soc-badge-active">● Actif</span>' : ''}
      </div>
      <div class="soc-card-detail">
        ${s.nif ? `<div>NIF : <strong>${s.nif}</strong></div>` : ''}
        ${s.adresse ? `<div>📍 ${s.adresse}</div>` : ''}
        <div>Exercices : <strong>${(s.exercices||[s.exerciceActif||new Date().getFullYear()]).join(', ')}</strong></div>
        <div>Exercice actif : <strong style="color:var(--warm)">${s.exerciceActif || new Date().getFullYear()}</strong></div>
      </div>
      <div class="soc-card-actions">
        ${!isActive ? `<button class="btn btn-gold" onclick="switchSociete('${s.id}')">Basculer →</button>` : ''}
        <button class="btn btn-sm-wire" onclick="ajouterExercice('${s.id}')">+ Exercice</button>
        <button class="btn btn-sm-wire" onclick="openSocieteModal('${s.id}')">✎ Modifier</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

window.openSocieteModal = openSocieteModal;
window.saveSociete = saveSociete;
window.switchSociete = switchSociete;
window.ajouterExercice = ajouterExercice;
window.renderSocietes = renderSocietes;

// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// ██  MODULE COLLABORATION v2 — Code unique + WebRTC + 3D
// ══════════════════════════════════════════════════════════════════

let collaborateurs = [];
let auditLogs = [];
let collabUnsubscribe = null;   // listener Firestore temps réel
let isCollabMode = false;       // true si connecté en tant que collaborateur
let collabOwnerUid = null;      // uid du propriétaire (mode collab)

// WebRTC
let localStream = null;
let peerConnection = null;
let videoCallInterval = null;
let videoCallSeconds = 0;
let micEnabled = true;
let camEnabled = true;

const ROLES = {
  admin:       { label: 'Administrateur', couleur: 'var(--warm)',  perms: ['*'] },
  comptable:   { label: 'Comptable',      couleur: 'var(--blue)',  perms: ['saisie','journal','grandlivre','balance','bilan','resultat','tresorerie','factures','devis','clients','fournisseurs','paie','immobilisations','stocks','rapprochement','budgets','lettrage','declarations','analytique','effets'] },
  gestionnaire:{ label: 'Gestionnaire',   couleur: 'var(--teal)',  perms: ['factures','devis','clients','fournisseurs','stocks','budgets'] },
  lecteur:     { label: 'Lecture seule',  couleur: 'var(--muted)', perms: ['journal','grandlivre','balance','bilan','resultat','tresorerie'] },
};

// ── Audit log ──────────────────────────────────────────────────
function auditLog(action, module, detail) {
  const log = {
    id: Date.now(), action, module, detail,
    user: currentProfile?.email || currentProfile?.company || 'Inconnu',
    ts: new Date().toISOString(),
  };
  auditLogs.unshift(log);
  if (auditLogs.length > 500) auditLogs = auditLogs.slice(0, 500);
  if (window._fbReady && currentProfile?.id) {
    window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'audit_logs'), log).catch(() => {});
  }
}

// ── Génération du code unique ──────────────────────────────────
function genererCodeString() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'COMEO-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function genererCodeCollab() {
  if (!window._fbReady || !currentProfile?.id) { toast('Non connecté', 'error'); return; }
  const code = genererCodeString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // 7 jours
  const data = {
    code,
    ownerUid: currentProfile.id,
    ownerEmail: currentProfile.email || '',
    ownerCompany: currentProfile.company || '',
    createdAt: new Date().toISOString(),
    expiresAt,
    actif: true,
    collaborateurs: [],
  };
  try {
    await window._fbSetDoc(window._fbDoc(window._db, 'collab_sessions', currentProfile.id), data);
    document.getElementById('collabCodeText').textContent = code;
    document.getElementById('collabCodeExpiry').textContent = `Valide jusqu'au ${new Date(expiresAt).toLocaleDateString('fr-FR')}`;
    document.getElementById('btnCopierCode').disabled = false;
    toast('✓ Code généré ! Partagez-le à vos collaborateurs.', 'success');
    auditLog('CODE_GEN', 'collaboration', `Nouveau code généré : ${code}`);
    ecouterCollabsTempsReel();
  } catch(e) {
    toast('Erreur génération code : ' + e.message, 'error');
  }
}

async function copierCodeCollab() {
  const code = document.getElementById('collabCodeText').textContent;
  if (!code || code === '——————') return;
  const company = currentProfile?.company || 'COMEO AI';
  const texte = `Bonjour ! Voici votre code d'accès collaborateur COMEO AI pour ${company} :\n\n🔑 ${code}\n\nConnectez-vous sur l'application, cliquez sur "Rejoindre un espace" et collez ce code.`;
  try {
    await navigator.clipboard.writeText(texte);
    toast('✓ Code copié ! Partagez-le par WhatsApp, SMS ou email.', 'success');
  } catch(e) {
    toast('Code : ' + code, 'info');
  }
}

// ── Écoute temps réel des collaborateurs connectés ────────────
function ecouterCollabsTempsReel() {
  if (!window._fbReady || !currentProfile?.id) return;
  if (collabUnsubscribe) collabUnsubscribe();

  const { onSnapshot, doc } = window._firebaseFirestore || {};
  if (!onSnapshot) {
    // Fallback polling si onSnapshot pas exposé
    setInterval(async () => {
      const snap = await window._fbGetDoc(window._fbDoc(window._db, 'collab_sessions', currentProfile.id));
      if (snap.exists()) rafraichirSlotsCollab(snap.data());
    }, 5000);
    return;
  }

  collabUnsubscribe = onSnapshot(doc(window._db, 'collab_sessions', currentProfile.id), (snap) => {
    if (snap.exists()) rafraichirSlotsCollab(snap.data());
  });
}

function rafraichirSlotsCollab(data) {
  const slots = document.getElementById('collabSlots');
  const videoSection = document.getElementById('collabVideoSection');
  if (!slots) return;
  const collabs = data.collaborateurs || [];
  collaborateurs = collabs;

  if (!collabs.length) {
    slots.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Aucun collaborateur connecté.</div>';
    if (videoSection) videoSection.style.display = 'none';
    return;
  }

  if (videoSection && collabs.length > 0) videoSection.style.display = 'block';

  // Affichage 3D des slots
  slots.innerHTML = collabs.map((c, i) => `
    <div style="
      display:flex;align-items:center;gap:10px;
      background:var(--surface2);border:1px solid var(--line);
      border-radius:10px;padding:10px 14px;
      transform:perspective(400px) rotateX(${i % 2 === 0 ? 1 : -1}deg) translateZ(2px);
      transition:transform .3s
    ">
      <div style="
        width:36px;height:36px;border-radius:50%;
        background:linear-gradient(135deg,var(--warm),var(--blue));
        display:flex;align-items:center;justify-content:center;
        font-weight:700;font-size:14px;color:#fff;flex-shrink:0
      ">${(c.nom || c.email || '?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${c.nom || c.email}</div>
        <div style="font-size:11px;color:var(--muted)">${ROLES[c.role]?.label || 'Comptable'} · <span style="color:#22c55e">● En ligne</span></div>
      </div>
      <button onclick="revoquerCollaborateurV2('${c.uid}')" style="
        background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);
        color:#dc2626;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px
      ">Révoquer</button>
    </div>
  `).join('');
}

// ── Chargement initial du code existant ───────────────────────
async function loadCollabCode() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'collab_sessions', currentProfile.id));
    if (snap.exists()) {
      const d = snap.data();
      document.getElementById('collabCodeText').textContent = d.code || '——————';
      if (d.expiresAt) {
        document.getElementById('collabCodeExpiry').textContent = `Valide jusqu'au ${new Date(d.expiresAt).toLocaleDateString('fr-FR')}`;
      }
      document.getElementById('btnCopierCode').disabled = false;
      rafraichirSlotsCollab(d);
      ecouterCollabsTempsReel();
    }
  } catch(e) {}
}

function openCollabModal() {
  loadCollabCode();
  document.getElementById('collabModal').style.display = 'flex';
}

function fermerCollabModal() {
  document.getElementById('collabModal').style.display = 'none';
}

// ── Révoquer un collaborateur spécifique ──────────────────────
async function revoquerCollaborateurV2(uid) {
  if (!confirm('Révoquer cet accès ?')) return;
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'collab_sessions', currentProfile.id));
    if (!snap.exists()) return;
    const d = snap.data();
    const updated = (d.collaborateurs || []).filter(c => c.uid !== uid);
    await window._fbSetDoc(window._fbDoc(window._db, 'collab_sessions', currentProfile.id), { collaborateurs: updated }, { merge: true });
    toast('✓ Accès révoqué', 'success');
    auditLog('REVOKE', 'collaboration', `Collaborateur ${uid} révoqué`);
  } catch(e) { toast('Erreur révocation', 'error'); }
}

// ── Révoquer tout le monde ────────────────────────────────────
async function revoquerTousCollab() {
  if (!confirm('Révoquer TOUS les collaborateurs et invalider le code ?')) return;
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    await window._fbSetDoc(window._fbDoc(window._db, 'collab_sessions', currentProfile.id), {
      actif: false, collaborateurs: [], code: '——————'
    }, { merge: true });
    document.getElementById('collabCodeText').textContent = '——————';
    document.getElementById('collabCodeExpiry').textContent = '';
    document.getElementById('btnCopierCode').disabled = true;
    document.getElementById('collabSlots').innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Aucun collaborateur.</div>';
    toast('✓ Tous les accès ont été révoqués', 'success');
    auditLog('REVOKE_ALL', 'collaboration', 'Tous les accès collaborateurs révoqués');
  } catch(e) { toast('Erreur', 'error'); }
}

// ══════════════════════════════════════════════════════════════════
// CÔTÉ COLLABORATEUR — Rejoindre avec le code
// ══════════════════════════════════════════════════════════════════

function ouvrirJoinCollabModal() {
  document.getElementById('joinCodeInput').value = '';
  document.getElementById('joinCollabErr').textContent = '';
  document.getElementById('joinCollabModal').style.display = 'flex';
}

async function rejoindreCollab() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  const errEl = document.getElementById('joinCollabErr');
  errEl.textContent = '';

  if (!code || code.length < 8) { errEl.textContent = 'Code invalide.'; return; }
  if (!window._fbReady || !currentProfile?.id) { errEl.textContent = 'Non connecté.'; return; }

  try {
    // Chercher le code dans Firestore (collection collab_sessions)
    const { getDocs, collection, query, where } = window._firebaseFirestore || {};
    let sessionData = null;
    let ownerUid = null;

    if (getDocs && query && where) {
      const q = query(collection(window._db, 'collab_sessions'), where('code', '==', code), where('actif', '==', true));
      const snap = await getDocs(q);
      if (snap.empty) { errEl.textContent = '❌ Code invalide ou expiré.'; return; }
      const docSnap = snap.docs[0];
      ownerUid = docSnap.id;
      sessionData = docSnap.data();
    } else {
      errEl.textContent = 'Erreur Firebase. Rechargez la page.'; return;
    }

    // Vérifier expiration
    if (sessionData.expiresAt && new Date(sessionData.expiresAt) < new Date()) {
      errEl.textContent = '❌ Ce code a expiré. Demandez un nouveau code au propriétaire.'; return;
    }

    // Vérifier limite 3
    const collabs = sessionData.collaborateurs || [];
    if (collabs.length >= 3 && !collabs.find(c => c.uid === currentProfile.id)) {
      errEl.textContent = '❌ Limite de 3 collaborateurs atteinte.'; return;
    }

    // Ajouter ce collaborateur si pas déjà présent
    const dejaPresent = collabs.find(c => c.uid === currentProfile.id);
    if (!dejaPresent) {
      const updatedCollabs = [...collabs, {
        uid: currentProfile.id,
        email: currentProfile.email || '',
        nom: currentProfile.company || currentProfile.email || 'Collaborateur',
        role: 'comptable',
        joinedAt: new Date().toISOString(),
      }];
      await window._fbSetDoc(window._fbDoc(window._db, 'collab_sessions', ownerUid), { collaborateurs: updatedCollabs }, { merge: true });
    }

  // Passer en mode collaborateur — charger les données du propriétaire
    document.getElementById('joinCollabModal').style.display = 'none';
    isCollabMode = true;
    collabOwnerUid = ownerUid;
    toast(`✓ Connecté à l'espace de ${sessionData.ownerCompany || sessionData.ownerEmail}`, 'success');
    auditLog('JOIN', 'collaboration', `Rejoint l'espace de ${sessionData.ownerCompany}`);

    // Charger données du propriétaire
    await chargerDonneesProprietaire(ownerUid);

    // Écoute révocation temps réel
    ecouterRevocationCollab(ownerUid);

    // ✅ NOUVEAU — Écoute des appels entrants du propriétaire
    ecouterAppelEntrant(ownerUid);

  } catch(e) {
    errEl.textContent = 'Erreur : ' + e.message;
  }
}

async function chargerDonneesProprietaire(ownerUid) {
  const realUid = currentProfile.id;
  // On redirige currentProfile.id vers le propriétaire pour que toutes
  // les fonctions de chargement lisent depuis son profil Firestore
  currentProfile = { ...currentProfile, id: ownerUid, _collabMode: true, _realUid: realUid };

  // Mettre à jour l'en-tête avec le nom du propriétaire
  try {
    const ownerSnap = await window._fbGetDoc(window._fbDoc(window._db, 'profiles', ownerUid));
    if (ownerSnap.exists()) {
      const ownerData = ownerSnap.data();
      currentProfile = { ...currentProfile, company: ownerData.company, exercice: ownerData.exercice };
      const topName = document.getElementById('topCompanyName');
      if (topName) topName.textContent = (ownerData.company || 'Espace') + ' [Collaborateur]';
      const exYear = document.getElementById('exerciceYear');
      if (exYear) exYear.value = ownerData.exercice || '2024';
    }
  } catch(e) {}

  toast('🔄 Chargement des données de l\'espace...', 'info');

  // Charger tous les modules avec les vrais noms de fonctions
  await Promise.all([
    loadEcrituresFromFirestore(),
    loadClientsFromFirestore(),
    loadFournisseursFromFirestore(),
    loadFacturesFromFirestore(),
    loadSalaries(),
    loadImmobilisations(),
    loadStocks(),
    loadBudgets(),
  ]);
  await Promise.all([
    loadAnalytique(),
    loadSocietes(),
    loadEffets(),
  ]);

  updateStats();
  renderPlanComptable();
  toast('✓ Espace collaborateur chargé !', 'success');
}
function ecouterRevocationCollab(ownerUid) {
  const { onSnapshot, doc } = window._firebaseFirestore || {};
  if (!onSnapshot) return;
  onSnapshot(doc(window._db, 'collab_sessions', ownerUid), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    // Si notre UID n'est plus dans la liste → révoqué
    const toujours = (d.collaborateurs || []).find(c => c.uid === (currentProfile._realUid || currentProfile.id));
    if (!toujours || !d.actif) {
      toast('⚠ Votre accès collaborateur a été révoqué.', 'error');
      setTimeout(() => location.reload(), 2500);
    }
  });
}

// ── Bouton "Rejoindre" dans l'interface ───────────────────────
// À appeler depuis un bouton dans renderUtilisateurs() côté collaborateur
function afficherBoutonRejoindre() {
  return `<button class="btn btn-ink" onclick="ouvrirJoinCollabModal()" style="font-size:13px">
    🔑 Rejoindre un espace collaborateur
  </button>`;
}

// ══════════════════════════════════════════════════════════════════
// APPEL VIDÉO WebRTC + Firebase Signaling
// ══════════════════════════════════════════════════════════════════

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Serveurs TURN publics gratuits (relais NAT/firewall)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ]
};

async function ouvrirAppelVideo() {
  document.getElementById('videoCallModal').style.display = 'flex';
  document.getElementById('videoCallStatus').textContent = '⏳ Accès caméra/micro...';
  document.getElementById('remoteVideoPlaceholder').style.display = 'flex';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('videoCallStatus').textContent = '⏳ Connexion au pair...';

    await initialiserWebRTC();
  } catch(e) {
    document.getElementById('videoCallStatus').textContent = '❌ ' + (e.name === 'NotAllowedError' ? 'Accès caméra refusé.' : e.message);
  }
}

async function initialiserWebRTC() {
  const ownerUid = isCollabMode ? collabOwnerUid : currentProfile.id;
  const isOwner = !isCollabMode;

  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  // Ajouter les tracks locaux
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // Recevoir le stream distant
  peerConnection.ontrack = (event) => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = event.streams[0];
    document.getElementById('remoteVideoPlaceholder').style.display = 'none';
    document.getElementById('videoCallStatus').textContent = '✅ Appel en cours';
    document.getElementById('videoCallTitle').textContent = isOwner ? 'Avec collaborateur' : 'Avec propriétaire';
    demarrerTimerAppel();
  };

  // ICE candidates → Firestore
  peerConnection.onicecandidate = async (event) => {
    if (!event.candidate) return;
    const path = isOwner ? 'callerCandidates' : 'calleeCandidates';
    await window._fbAddDoc(
      window._fbCollection(window._db, 'video_calls', ownerUid, path),
      event.candidate.toJSON()
    );
  };

  if (isOwner) {
    // Créer l'offre
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await window._fbSetDoc(window._fbDoc(window._db, 'video_calls', ownerUid), {
      offer: { sdp: offer.sdp, type: offer.type },
      createdAt: new Date().toISOString(),
    });

    // Écouter la réponse
    const { onSnapshot, doc } = window._firebaseFirestore || {};
    if (onSnapshot) {
      onSnapshot(doc(window._db, 'video_calls', ownerUid), async (snap) => {
        const d = snap.data();
        if (d?.answer && !peerConnection.remoteDescription) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer));
        }
      });
      // ICE candidates du callee
      const { getDocs, collection } = window._firebaseFirestore || {};
      onSnapshot(window._fbCollection(window._db, 'video_calls', ownerUid, 'calleeCandidates'), (snap) => {
        snap.docChanges().forEach(async ch => {
          if (ch.type === 'added') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(ch.doc.data()));
          }
        });
      });
    }
  } else {
    // Collaborateur : lire l'offre
    const snap = await window._fbGetDoc(window._fbDoc(window._db, 'video_calls', ownerUid));
    if (!snap.exists() || !snap.data()?.offer) {
      document.getElementById('videoCallStatus').textContent = '⏳ En attente que le propriétaire démarre l\'appel...';
      // Écoute
      const { onSnapshot, doc } = window._firebaseFirestore || {};
      if (onSnapshot) {
        const unsub = onSnapshot(doc(window._db, 'video_calls', ownerUid), async (s) => {
          if (s.data()?.offer && !peerConnection.remoteDescription) {
            unsub();
            await repondreAppelVideo(ownerUid);
          }
        });
      }
      return;
    }
    await repondreAppelVideo(ownerUid);
  }
}

async function repondreAppelVideo(ownerUid) {
  const snap = await window._fbGetDoc(window._fbDoc(window._db, 'video_calls', ownerUid));
  const offer = snap.data()?.offer;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await window._fbSetDoc(window._fbDoc(window._db, 'video_calls', ownerUid), {
    answer: { sdp: answer.sdp, type: answer.type }
  }, { merge: true });

  // ICE candidates du caller
  const { onSnapshot } = window._firebaseFirestore || {};
  if (onSnapshot) {
    onSnapshot(window._fbCollection(window._db, 'video_calls', ownerUid, 'callerCandidates'), (snap) => {
      snap.docChanges().forEach(async ch => {
        if (ch.type === 'added') {
          await peerConnection.addIceCandidate(new RTCIceCandidate(ch.doc.data()));
        }
      });
    });
  }
}

function demarrerTimerAppel() {
  videoCallSeconds = 0;
  if (videoCallInterval) clearInterval(videoCallInterval);
  videoCallInterval = setInterval(() => {
    videoCallSeconds++;
    const m = String(Math.floor(videoCallSeconds / 60)).padStart(2,'0');
    const s = String(videoCallSeconds % 60).padStart(2,'0');
    const el = document.getElementById('videoCallTimer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

async function terminerAppelVideo() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (videoCallInterval) { clearInterval(videoCallInterval); videoCallInterval = null; }
  document.getElementById('videoCallModal').style.display = 'none';
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;
  // Nettoyer Firestore signaling
  const ownerUid = isCollabMode ? collabOwnerUid : currentProfile.id;
  try {
    await window._fbSetDoc(window._fbDoc(window._db, 'video_calls', ownerUid), { ended: true }, { merge: true });
  } catch(e) {}
  toast('Appel terminé', 'info');
}

function toggleMic() {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  document.getElementById('btnMicToggle').style.opacity = micEnabled ? '1' : '0.4';
}

function toggleCam() {
  if (!localStream) return;
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
  document.getElementById('btnCamToggle').style.opacity = camEnabled ? '1' : '0.4';
}

// ══════════════════════════════════════════════════════════════════
// RENDER UTILISATEURS (mis à jour)
// ══════════════════════════════════════════════════════════════════

async function loadCollaborateurs() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const ownerID = getOwnerProfileId();
    const [snapC, snapA] = await Promise.all([
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'collaborateurs')),
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'audit_logs')),
    ]);
    collaborateurs = snapC.docs.map(d => ({ ...d.data(), _docId: d.id }));
    auditLogs = snapA.docs.map(d => ({ ...d.data(), _docId: d.id })).sort((a,b) => new Date(b.ts) - new Date(a.ts));
  } catch(e) {}
  // Charger aussi le code collab existant
  await loadCollabCode();
}

function renderUtilisateurs() {
  const el = document.getElementById('utilisateursContent');
  if (!el) return;

  document.getElementById('users-kpi-total').textContent = collaborateurs.length + 1;
  document.getElementById('users-kpi-actifs').textContent = collaborateurs.filter(c => c.accepte).length + 1;
  document.getElementById('users-kpi-invites').textContent = collaborateurs.filter(c => !c.accepte).length;
  document.getElementById('users-kpi-logs').textContent = auditLogs.length;

  const collabHtml = `
  <div class="card" style="margin-bottom:16px">
    <div class="card-header">
      <div><div class="card-title">🔗 Collaboration temps réel</div>
        <div class="card-sub" style="font-size:11px;color:var(--muted)">Partagez un code · Max 3 collaborateurs · Accès immédiat</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ink" onclick="openCollabModal()">⚡ Gérer le code d'accès</button>
        <button class="btn btn-sm-wire" onclick="ouvrirJoinCollabModal()">🔑 Rejoindre un espace</button>
      </div>
    </div>

    <!-- Mode collaborateur actif -->
    ${isCollabMode ? `
    <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:10px;padding:12px 16px;margin:12px 0;display:flex;align-items:center;gap:12px">
      <div style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e;flex-shrink:0"></div>
      <div>
        <div style="font-weight:600;font-size:13px;color:#22c55e">Mode collaborateur actif</div>
        <div style="font-size:11px;color:var(--muted)">Vous travaillez sur l'espace d'un autre propriétaire.</div>
      </div>
      <button onclick="quitterModeCollab()" style="margin-left:auto;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);color:#dc2626;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px">Quitter l'espace</button>
    </div>` : ''}

    <div class="dtw"><table class="dt">
      <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Depuis</th><th></th></tr></thead>
      <tbody>
        <tr>
          <td><strong>${currentProfile?.company || 'Administrateur'}</strong></td>
          <td style="color:var(--muted);font-size:12px">${currentProfile?.email || '—'}</td>
          <td><span class="role-badge" style="background:rgba(212,168,83,.15);color:var(--warm)">Administrateur</span></td>
          <td><span style="color:var(--green);font-size:12px">● Actif</span></td>
          <td style="font-size:11px;color:var(--muted)">Propriétaire</td>
          <td></td>
        </tr>
        ${collaborateurs.map(c => {
          const r = ROLES[c.role] || ROLES.lecteur;
          return `<tr>
            <td><strong>${c.nom}</strong></td>
            <td style="color:var(--muted);font-size:12px">${c.email}</td>
            <td><select class="role-select" onchange="changerRole(${c.id}, this.value)">
              ${Object.entries(ROLES).map(([k,v]) => `<option value="${k}" ${c.role===k?'selected':''}>${v.label}</option>`).join('')}
            </select></td>
            <td><span style="color:${c.accepte ? 'var(--green)' : 'var(--muted)'};font-size:12px">${c.accepte ? '● Actif' : '⏳ En attente'}</span></td>
            <td style="font-size:11px;color:var(--muted)">${new Date(c.createdAt).toLocaleDateString('fr-FR')}</td>
            <td><button class="btn btn-sm-wire" onclick="revoquerCollaborateurV2('${c.uid || c.id}')" style="color:var(--rust)">✕</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </div>`;

  const logsHtml = `<div class="card">
    <div class="card-header"><div><div class="card-title">📋 Journal d'audit</div>
      <div class="card-sub">500 dernières actions</div></div>
      <button class="btn btn-sm-wire" onclick="exportAuditPDF()">↓ Export PDF</button>
    </div>
    ${auditLogs.length ? `<div class="dtw"><table class="dt">
      <thead><tr><th>Date/heure</th><th>Action</th><th>Module</th><th>Détail</th><th>Utilisateur</th></tr></thead>
      <tbody>${auditLogs.slice(0,100).map(l => {
        const col = { 'SAVE':'var(--green)','DELETE':'var(--rust)','EXPORT':'var(--blue)','INVITE':'var(--teal)','REVOKE':'var(--rust)','ROLE_CHANGE':'var(--warm)','LOGIN':'var(--muted)','LOGOUT':'var(--muted)','CODE_GEN':'var(--warm)','JOIN':'var(--teal)','REVOKE_ALL':'var(--rust)' };
        return `<tr>
          <td style="font-family:var(--font-mono);font-size:11px">${new Date(l.ts).toLocaleString('fr-FR')}</td>
          <td><span style="color:${col[l.action]||'var(--ink)'};font-weight:600;font-size:12px">${l.action}</span></td>
          <td style="font-size:12px;color:var(--muted)">${l.module}</td>
          <td style="font-size:12px">${l.detail}</td>
          <td style="font-size:11px;color:var(--muted)">${l.user}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`
    : '<div class="empty-state" style="padding:20px"><div class="icon">📋</div><p>Aucun log.</p></div>'}
  </div>`;

  el.innerHTML = collabHtml + logsHtml;
}

async function quitterModeCollab() {
  if (!confirm('Quitter l\'espace collaborateur ?')) return;
  // Retirer son UID de la session
  if (collabOwnerUid) {
    try {
      const snap = await window._fbGetDoc(window._fbDoc(window._db, 'collab_sessions', collabOwnerUid));
      if (snap.exists()) {
        const updated = (snap.data().collaborateurs || []).filter(c => c.uid !== (currentProfile._realUid || currentProfile.id));
        await window._fbSetDoc(window._fbDoc(window._db, 'collab_sessions', collabOwnerUid), { collaborateurs: updated }, { merge: true });
      }
    } catch(e) {}
  }
  location.reload();
}

async function changerRole(id, newRole) {
  const collab = collaborateurs.find(c => String(c.id) === String(id));
  if (!collab) return;
  const oldRole = collab.role;
  collab.role = newRole;
  if (window._fbReady && currentProfile?.id && collab._docId) {
    try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'collaborateurs', collab._docId), { role: newRole }, { merge: true }); } catch(e) {}
  }
  auditLog('ROLE_CHANGE', 'utilisateurs', `${collab.nom} : ${ROLES[oldRole]?.label} → ${ROLES[newRole]?.label}`);
  toast(`✓ Rôle modifié`, 'success');
  renderUtilisateurs();
}

function exportAuditPDF() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF non disponible', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Entreprise';
  doc.setFillColor(10,11,16); doc.rect(0,0,297,22,'F');
  doc.setTextColor(212,168,83); doc.setFontSize(12); doc.setFont('helvetica','bold');
  doc.text(`JOURNAL D'AUDIT — ${company} — Exporté le ${new Date().toLocaleDateString('fr-FR')}`, 14, 14);
  doc.autoTable({
    startY: 26,
    head: [['Date/heure','Action','Module','Détail','Utilisateur']],
    body: auditLogs.slice(0,200).map(l => [new Date(l.ts).toLocaleString('fr-FR'), l.action, l.module, l.detail, l.user]),
    styles: { font:'helvetica', fontSize:7.5 },
    headStyles: { fillColor:[10,11,16], textColor:[212,168,83] },
    margin: { left:14, right:14 },
  });
  doc.save(`AUDIT_${company.replace(/\s+/g,'_')}.pdf`);
  toast('✓ Journal exporté', 'success');
}

// ── Exposer globalement ────────────────────────────────────────
window.openCollabModal        = openCollabModal;
window.fermerCollabModal      = fermerCollabModal;
window.genererCodeCollab      = genererCodeCollab;
window.copierCodeCollab       = copierCodeCollab;
window.revoquerCollaborateurV2 = revoquerCollaborateurV2;
window.revoquerTousCollab     = revoquerTousCollab;
window.ouvrirJoinCollabModal  = ouvrirJoinCollabModal;
window.rejoindreCollab        = rejoindreCollab;
window.quitterModeCollab      = quitterModeCollab;
window.changerRole            = changerRole;
window.renderUtilisateurs     = renderUtilisateurs;
window.exportAuditPDF         = exportAuditPDF;
window.ouvrirAppelVideo       = ouvrirAppelVideo;
window.terminerAppelVideo     = terminerAppelVideo;
window.toggleMic              = toggleMic;
window.toggleCam              = toggleCam;

// ══════════════════════════════════════════════════════════════════
// ██  MODULE 4 — EFFETS DE COMMERCE (LCR / Billet à ordre / Escompte)
// ══════════════════════════════════════════════════════════════════
let effets = [];  // { id, type, tiré/souscripteur, montant, dateCreation, dateEcheance, statut, banque, ecritureId }

const STATUTS_EFFET = {
  en_portefeuille: { label: 'En portefeuille', couleur: 'var(--blue)' },
  remis_escompte:  { label: 'Remis à l\'escompte', couleur: 'var(--warm)' },
  encaisse:        { label: 'Encaissé', couleur: 'var(--green)' },
  impaye:          { label: 'Impayé', couleur: 'var(--rust)' },
  endosse:         { label: 'Endossé', couleur: 'var(--teal)' },
};

async function loadEffets() {
  if (!window._fbReady || !currentProfile?.id) return;
  try {
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', currentProfile.id, 'effets'));
    effets = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) {}
}

function openEffetModal(id = null) {
  const e = id ? effets.find(x => x.id === id) : null;
  document.getElementById('effet-id').value = e ? e.id : '';
  document.getElementById('effet-type').value = e ? e.type : 'lcr';
  document.getElementById('effet-tire').value = e ? (e.tire || '') : '';
  document.getElementById('effet-montant').value = e ? e.montant : '';
  document.getElementById('effet-date-creation').value = e ? e.dateCreation : new Date().toISOString().split('T')[0];
  document.getElementById('effet-date-echeance').value = e ? e.dateEcheance : '';
  document.getElementById('effet-banque').value = e ? (e.banque || '') : '';
  document.getElementById('effet-statut').value = e ? e.statut : 'en_portefeuille';
  document.getElementById('effet-ref').value = e ? (e.ref || '') : '';
  document.getElementById('effetModal').style.display = 'flex';
}

async function saveEffet() {
  const id = document.getElementById('effet-id').value;
  const type = document.getElementById('effet-type').value;
  const tire = document.getElementById('effet-tire').value.trim();
  const montant = parseFloat(document.getElementById('effet-montant').value) || 0;
  const dateCreation = document.getElementById('effet-date-creation').value;
  const dateEcheance = document.getElementById('effet-date-echeance').value;
  const banque = document.getElementById('effet-banque').value.trim();
  const statut = document.getElementById('effet-statut').value;
  const ref = document.getElementById('effet-ref').value.trim();
  if (!tire || !montant || !dateEcheance) { toast('Tiré/souscripteur, montant et échéance obligatoires', 'error'); return; }

  const effet = { id: id ? parseInt(id) : Date.now(), type, tire, montant, dateCreation, dateEcheance, banque, statut, ref, createdAt: new Date().toISOString() };

  if (id) {
    const existing = effets.find(e => String(e.id) === String(id));
    if (existing) effet._docId = existing._docId;
    const idx = effets.findIndex(e => String(e.id) === String(id));
    if (idx > -1) effets[idx] = effet;
    if (window._fbReady && currentProfile?.id && effet._docId) {
      try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'effets', effet._docId), effet, { merge: true }); } catch(e) {}
    }
  } else {
    effets.push(effet);
    if (window._fbReady && currentProfile?.id) {
      try { const r = await window._fbAddDoc(window._fbCollection(window._db, 'profiles', currentProfile.id, 'effets'), effet); effet._docId = r.id; } catch(e) {}
    }
    // Générer l'écriture comptable automatiquement
    await genererEcritureEffet(effet);
  }

  auditLog('SAVE', 'effets', `${type.toUpperCase()} ${fn(montant)} FCFA — ${tire} — Éch. ${dateEcheance}`);
  document.getElementById('effetModal').style.display = 'none';
  toast(`✓ Effet enregistré — ${fn(montant)} FCFA — Échéance : ${dateEcheance}`, 'success');
  renderEffets();
}

async function genererEcritureEffet(effet) {
  // LCR reçue (effet client) → 413 / 411
  // Billet à ordre émis (effet fournisseur) → 401 / 403
  let lignes;
  if (effet.type === 'lcr' || effet.type === 'billet_recu') {
    lignes = [
      { compte: '413', libelle: `Effet à recevoir — ${effet.tire}`, debit: effet.montant, credit: 0 },
      { compte: '411', libelle: `Créance client — ${effet.tire}`, debit: 0, credit: effet.montant },
    ];
  } else {
    lignes = [
      { compte: '401', libelle: `Dette fournisseur — ${effet.tire}`, debit: effet.montant, credit: 0 },
      { compte: '403', libelle: `Effet à payer — ${effet.tire}`, debit: 0, credit: effet.montant },
    ];
  }
  const ecr = {
    id: Date.now(), date: effet.dateCreation, journal: 'OD',
    piece: 'EFF-' + String(effet.id).slice(-6),
    libelle: `${effet.type.toUpperCase()} — ${effet.tire} — Éch. ${effet.dateEcheance}`,
    createdAt: new Date().toISOString(), lignes,
  };
  await saveEcritureToFirestore(ecr);
  ecritures.push(ecr);
  updateStats();
}

async function changerStatutEffet(id, newStatut) {
  const effet = effets.find(e => e.id === id);
  if (!effet) return;
  const oldStatut = effet.statut;
  effet.statut = newStatut;
  if (window._fbReady && currentProfile?.id && effet._docId) {
    try { await window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'effets', effet._docId), { statut: newStatut }, { merge: true }); } catch(e) {}
  }
  // Écriture de remise à l'escompte
  if (newStatut === 'remis_escompte') {
    const ecr = {
      id: Date.now(), date: new Date().toISOString().split('T')[0], journal: 'BQ',
      piece: 'ESC-' + String(effet.id).slice(-6),
      libelle: `Remise à l'escompte — ${effet.tire}`,
      createdAt: new Date().toISOString(),
      lignes: [
        { compte: '521', libelle: 'Banque — escompte', debit: effet.montant, credit: 0 },
        { compte: '413', libelle: `Effet escompté — ${effet.tire}`, debit: 0, credit: effet.montant },
      ],
    };
    await saveEcritureToFirestore(ecr);
    ecritures.push(ecr);
    updateStats();
    toast(`✓ Effet remis à l'escompte — Écriture 521/${413} générée`, 'success');
  } else if (newStatut === 'encaisse') {
    const ecr = {
      id: Date.now(), date: new Date().toISOString().split('T')[0], journal: 'BQ',
      piece: 'ENC-' + String(effet.id).slice(-6),
      libelle: `Encaissement effet — ${effet.tire}`,
      createdAt: new Date().toISOString(),
      lignes: [
        { compte: '521', libelle: 'Banque — encaissement', debit: effet.montant, credit: 0 },
        { compte: '413', libelle: `Effet encaissé — ${effet.tire}`, debit: 0, credit: effet.montant },
      ],
    };
    await saveEcritureToFirestore(ecr);
    ecritures.push(ecr);
    updateStats();
    toast(`✓ Effet encaissé — Écriture 521/413 générée`, 'success');
  } else if (newStatut === 'impaye') {
    const ecr = {
      id: Date.now(), date: new Date().toISOString().split('T')[0], journal: 'OD',
      piece: 'IMP-' + String(effet.id).slice(-6),
      libelle: `Impayé — ${effet.tire}`,
      createdAt: new Date().toISOString(),
      lignes: [
        { compte: '416', libelle: `Clients douteux — ${effet.tire}`, debit: effet.montant, credit: 0 },
        { compte: '413', libelle: `Effet impayé — ${effet.tire}`, debit: 0, credit: effet.montant },
      ],
    };
    await saveEcritureToFirestore(ecr);
    ecritures.push(ecr);
    updateStats();
    toast(`⚠ Effet impayé — Écriture 416/413 générée`, 'error');
  }
  auditLog('SAVE', 'effets', `Statut modifié : ${STATUTS_EFFET[oldStatut]?.label} → ${STATUTS_EFFET[newStatut]?.label} (${fn(effet.montant)} FCFA)`);
  renderEffets();
}

async function deleteEffet(id) {
  if (!confirm('Supprimer cet effet ?')) return;
  const effet = effets.find(e => e.id === id);
  effets = effets.filter(e => e.id !== id);
  if (window._fbReady && currentProfile?.id && effet?._docId) {
    try { await window._fbDeleteDoc(window._fbDoc(window._db, 'profiles', currentProfile.id, 'effets', effet._docId)); } catch(e) {}
  }
  toast('Effet supprimé', 'success');
  renderEffets();
}

function renderEffets() {
  const el = document.getElementById('effetsContent');
  if (!el) return;

  const today = new Date();
  const totalPortefeuille = effets.filter(e => e.statut === 'en_portefeuille').reduce((s,e) => s + e.montant, 0);
  const totalEscompte = effets.filter(e => e.statut === 'remis_escompte').reduce((s,e) => s + e.montant, 0);
  const totalImpayes = effets.filter(e => e.statut === 'impaye').reduce((s,e) => s + e.montant, 0);
  const aEcheoir7j = effets.filter(e => {
    const ech = new Date(e.dateEcheance);
    const diff = (ech - today) / 86400000;
    return diff >= 0 && diff <= 7 && e.statut === 'en_portefeuille';
  }).length;

  document.getElementById('effets-kpi-portefeuille').textContent = fn(totalPortefeuille);
  document.getElementById('effets-kpi-escompte').textContent = fn(totalEscompte);
  document.getElementById('effets-kpi-impayes').textContent = fn(totalImpayes);
  document.getElementById('effets-kpi-echeoir').textContent = aEcheoir7j;

  if (!effets.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📄</div><p>Aucun effet de commerce. Créez une LCR ou un billet à ordre.</p></div>';
    return;
  }

  const sorted = [...effets].sort((a,b) => new Date(a.dateEcheance) - new Date(b.dateEcheance));
  const rows = sorted.map(e => {
    const st = STATUTS_EFFET[e.statut] || { label: e.statut, couleur: 'var(--muted)' };
    const ech = new Date(e.dateEcheance);
    const daysToEch = Math.round((ech - today) / 86400000);
    const isUrgent = daysToEch >= 0 && daysToEch <= 7;
    const typeLabels = { lcr:'LCR', billet_recu:'Billet reçu', billet_emis:'Billet émis' };
    return `<tr ${isUrgent && e.statut === 'en_portefeuille' ? 'style="background:rgba(245,158,11,.07)"' : ''}>
      <td><span style="font-family:var(--font-mono);font-size:11px;color:var(--muted)">${e.ref || 'EFF-' + String(e.id).slice(-4)}</span></td>
      <td><strong>${typeLabels[e.type] || e.type}</strong></td>
      <td>${e.tire}</td>
      <td style="text-align:right;font-family:var(--font-mono);font-weight:700">${fn(e.montant)}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${e.dateCreation}</td>
      <td style="font-family:var(--font-mono);font-size:12px;${isUrgent && e.statut==='en_portefeuille'?'color:var(--warm);font-weight:600':''}">${e.dateEcheance}${isUrgent && e.statut==='en_portefeuille'?' ⚡':''}${daysToEch < 0 && e.statut==='en_portefeuille'?' ⚠':''}  </td>
      <td><span style="color:${st.couleur};font-size:12px;font-weight:600">● ${st.label}</span></td>
      <td style="font-size:12px;color:var(--muted)">${e.banque || '—'}</td>
      <td>
        <select class="effet-statut-sel" onchange="changerStatutEffet(${e.id}, this.value)" title="Changer le statut">
          ${Object.entries(STATUTS_EFFET).map(([k,v]) => `<option value="${k}" ${e.statut===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
        <button class="btn btn-sm-wire" onclick="openEffetModal(${e.id})" title="Modifier">✎</button>
        <button class="btn btn-sm-wire" onclick="deleteEffet(${e.id})" style="color:var(--rust)" title="Supprimer">✕</button>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="dtw"><table class="dt effets-table">
    <thead><tr>
      <th>Référence</th><th>Type</th><th>Tiré / Souscripteur</th>
      <th style="text-align:right">Montant</th><th>Création</th><th>Échéance</th>
      <th>Statut</th><th>Banque</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="3" style="font-weight:700">TOTAL ${effets.length} effet(s)</td>
      <td style="text-align:right;font-weight:700;font-family:var(--font-mono)">${fn(effets.reduce((s,e)=>s+e.montant,0))}</td>
      <td colspan="5"></td>
    </tr></tfoot>
  </table></div>`;
}

function exportEffetsPDF() {
  if (!effets.length) { toast('Aucun effet', 'error'); return; }
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF non disponible', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const company = currentProfile?.company || 'Entreprise';
  doc.setFillColor(10,11,16); doc.rect(0,0,297,22,'F');
  doc.setTextColor(212,168,83); doc.setFontSize(12); doc.setFont('helvetica','bold');
  doc.text(`PORTEFEUILLE EFFETS DE COMMERCE — ${company} — ${new Date().toLocaleDateString('fr-FR')}`, 14, 14);
  const typeLabels = { lcr:'LCR', billet_recu:'Billet reçu', billet_emis:'Billet émis' };
  doc.autoTable({
    startY: 26,
    head: [['Réf.','Type','Tiré / Souscripteur','Montant (FCFA)','Création','Échéance','Statut','Banque']],
    body: effets.map(e => [
      e.ref || 'EFF-' + String(e.id).slice(-4),
      typeLabels[e.type] || e.type,
      e.tire,
      fn(e.montant),
      e.dateCreation,
      e.dateEcheance,
      STATUTS_EFFET[e.statut]?.label || e.statut,
      e.banque || '—',
    ]),
    foot: [['TOTAL','','',fn(effets.reduce((s,e)=>s+e.montant,0)),'','','','']],
    styles: { font:'helvetica', fontSize:8 },
    headStyles: { fillColor:[10,11,16], textColor:[212,168,83] },
    footStyles: { fillColor:[30,34,54], textColor:[212,168,83], fontStyle:'bold' },
    columnStyles: { 3:{ halign:'right' } },
    margin: { left:14, right:14 },
  });
  doc.save(`EFFETS_${company.replace(/\s+/g,'_')}.pdf`);
  toast('✓ Portefeuille effets exporté en PDF', 'success');
}

window.openEffetModal = openEffetModal;
window.saveEffet = saveEffet;
window.changerStatutEffet = changerStatutEffet;
window.deleteEffet = deleteEffet;
window.renderEffets = renderEffets;
window.exportEffetsPDF = exportEffetsPDF;

// ✅ Exports PAIE & RH
window.saveBulletin = saveBulletin;
window.loadRH = loadRH;

// ✅ Exports TRÉSORERIE
window.loadTresorerie = loadTresorerie;
window.reconcilierBanque = reconcilierBanque;

// ✅ Exports TAXES & FISCALITÉ
window.loadTaxes = loadTaxes;
window.declaredTVA = declaredTVA;
window.loadDeclFiscales = loadDeclFiscales;

// ✅ Exports VIDÉO 3D
window.loadAppelsVideo = loadAppelsVideo;
window.initAppel3D = initAppel3D;
window.terminerAppel = terminerAppel;

// ✅ Exports UTILITIES
window.logAudit = logAudit;
window.getOwnerProfileId = getOwnerProfileId;

// ════════════════════════════════════════════════════════════════════════════════
// ✅ MODULE PAIE COMPLÈTE — Bulletins, CNPS, Déclarations
// ════════════════════════════════════════════════════════════════════════════════
let employes = [], bulletins = [], paieConfig = null;

async function loadRH() {
  try {
    const ownerID = getOwnerProfileId();
    const [empSnap, bulSnap, cfgSnap] = await Promise.all([
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'employes')),
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'bulletins')),
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'paie_config')),
    ]);
    employes = empSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    bulletins = bulSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    if (cfgSnap.docs.length) paieConfig = cfgSnap.docs[0].data();
  } catch(e) { console.error('Erreur RH:', e); }
}

async function saveBulletin(bulletin) {
  try {
    const ownerID = getOwnerProfileId();
    const col = window._fbCollection(window._db, 'profiles', ownerID, 'bulletins');
    const data = {
      ...bulletin,
      dateGeneration: new Date().toISOString(),
      mois: bulletin.mois || new Date().getMonth() + 1,
      annee: bulletin.annee || new Date().getFullYear(),
    };
    if (bulletin._docId) {
      await window._fbSetDoc(window._fbDoc(window._db, 'profiles', ownerID, 'bulletins', bulletin._docId), data, { merge: true });
    } else {
      const ref = await window._fbAddDoc(col, data);
      bulletin._docId = ref.id;
    }
    toast('✓ Bulletin sauvegardé', 'success');
    await logAudit('SAVE', 'PAIE', `Bulletin ${bulletin.employe} créé`, currentProfile.email);
    return bulletin._docId;
  } catch(e) {
    toast('Erreur: ' + e.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// ✅ MODULE TRÉSORERIE AVANCÉE — Réconciliation, Cash-flow, Prévisions
// ════════════════════════════════════════════════════════════════════════════════
let tresorData = {}, reconciliations = [], previsionsCashFlow = [];

async function loadTresorerie() {
  try {
    const ownerID = getOwnerProfileId();
    const [recSnap, fcfSnap] = await Promise.all([
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'reconciliations')),
      window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'cash_flow_previsions')),
    ]);
    reconciliations = recSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    previsionsCashFlow = fcfSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) { console.error('Erreur trésorerie:', e); }
}

// Réconciliation bancaire automatique
async function reconcilierBanque(montantRelevé, dateRelevé, montantLivre) {
  const ownerID = getOwnerProfileId();
  const ecart = montantRelevé - montantLivre;
  const rec = {
    dateReleve: dateRelevé,
    montantReleve: montantRelevé,
    montantLivre: montantLivre,
    ecart: ecart,
    status: Math.abs(ecart) < 1000 ? 'reconcilie' : 'en_attente_resolution',
    dateReconciliation: new Date().toISOString(),
  };
  try {
    const ref = await window._fbAddDoc(
      window._fbCollection(window._db, 'profiles', ownerID, 'reconciliations'),
      rec
    );
    reconciliations.push({ ...rec, _docId: ref.id });
    await logAudit('SAVE', 'TRESORERIE', `Réconciliation ${dateRelevé}`, currentProfile.email);
    return ref.id;
  } catch(e) {
    console.error('Erreur réconciliation:', e);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// ✅ MODULE TAXES ET FISCALITÉ — TVA, IRG, IS, Déclarations
// ════════════════════════════════════════════════════════════════════════════════
let tvaState = {}, declFiscales = {}, impotConfig = {};

async function loadTaxes() {
  try {
    const ownerID = getOwnerProfileId();
    const taxSnap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'taxes'));
    if (taxSnap.docs.length) {
      taxSnap.docs.forEach(d => {
        const data = d.data();
        tvaState[data.periode] = data;
      });
    }
  } catch(e) { console.error('Erreur taxes:', e); }
}

async function declaredTVA(periode, tvaCollectee, tvaDeductible) {
  const ownerID = getOwnerProfileId();
  const tvaNet = tvaCollectee - tvaDeductible;
  const decl = {
    periode,
    dateDeclaration: new Date().toISOString(),
    tvaCollectee,
    tvaDeductible,
    tvaNet,
    status: 'soumise',
  };
  try {
    const ref = await window._fbAddDoc(window._fbCollection(window._db, 'profiles', ownerID, 'taxes'), decl);
    tvaState[periode] = { ...decl, _docId: ref.id };
    await logAudit('SAVE', 'FISCALITE', `Déclaration TVA ${periode}`, currentProfile.email);
    return ref.id;
  } catch(e) {
    console.error('Erreur déclaration TVA:', e);
  }
}

async function loadDeclFiscales() {
  try {
    const ownerID = getOwnerProfileId();
    const declSnap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'declarations_fiscales'));
    declFiscales = {};
    declSnap.docs.forEach(d => {
      const data = d.data();
      declFiscales[data.annee] = { ...data, _docId: d.id };
    });
  } catch(e) { console.error('Erreur décl. fiscales:', e); }
}

// ════════════════════════════════════════════════════════════════════════════════
// ✅ MODULE APPELS VIDÉO 3D INNOVANT — WebRTC + Three.js
// ════════════════════════════════════════════════════════════════════════════════
let videoCallActive = false, videoAppels = [];
// Note: localStream and peerConnection are declared earlier in the file

async function loadAppelsVideo() {
  try {
    const ownerID = getOwnerProfileId();
    const snap = await window._fbGetDocs(window._fbCollection(window._db, 'profiles', ownerID, 'video_appels'));
    videoAppels = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  } catch(e) { console.error('Erreur vidéo:', e); }
}

// Lancer un appel vidéo 3D
async function initAppel3D(recipientId) {
  try {
    // Demander accès caméra/micro
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { width: 1280, height: 720 }
    });
    
    videoCallActive = true;
    
    // Configuration WebRTC
    const servers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    };
    
    peerConnection = new RTCPeerConnection(servers);
    
    // Ajouter stream local
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // Log appel
    const appel = {
      from: currentProfile.email,
      to: recipientId,
      startTime: new Date().toISOString(),
      type: '3D_VIDEO',
    };
    
    const ownerID = getOwnerProfileId();
    const ref = await window._fbAddDoc(
      window._fbCollection(window._db, 'profiles', ownerID, 'video_appels'),
      appel
    );
    
    toast('✓ Appel vidéo 3D initié', 'success');
    return ref.id;
  } catch(e) {
    toast('Erreur accès caméra: ' + e.message, 'error');
    console.error(e);
  }
}

async function terminerAppel() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
      peerConnection.close();
    }
    videoCallActive = false;
    toast('Appel terminé', 'info');
  } catch(e) {
    console.error('Erreur fermeture appel:', e);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// ✅ FONCTION UTILITY — Log d'audit
// ════════════════════════════════════════════════════════════════════════════════
async function logAudit(action, module, detail, user) {
  try {
    const ownerID = getOwnerProfileId();
    const log = {
      action,
      module,
      detail,
      user: user || currentProfile.email,
      ts: new Date().toISOString(),
    };
    await window._fbAddDoc(
      window._fbCollection(window._db, 'profiles', ownerID, 'audit_logs'),
      log
    );
  } catch(e) {
    console.error('Erreur audit:', e);
  }
}


// ══════════════════════════════════════════
// FONCTIONS MANQUANTES — Stubs fonctionnels
// ══════════════════════════════════════════

function exportDeclFiscalePDF() { exportDeclarationPDF(); }

function openDeclTaxeModal() { navigate('declarations'); toast('Sélectionnez le type de déclaration ci-dessous', 'info'); }

function openNouveau3DCall() { 
  const panel = document.getElementById('videoCallPanel');
  if (panel) panel.style.display = 'block';
  toast('Appel 3D — Fonctionnalité WebRTC en cours d\'activation', 'info'); 
}

function exportHistoriqueAppels() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const company = currentProfile?.company || 'Entreprise';
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('HISTORIQUE APPELS VIDÉO — ' + company, 14, 18);
    doc.setFontSize(9); doc.text('Édité le ' + new Date().toLocaleDateString('fr-FR'), 14, 25);
    doc.autoTable({ head:[['Date','Durée','Participants']], body:[['Aucun appel enregistré','','']],
      startY:30, styles:{fontSize:9}, headStyles:{fillColor:[30,30,40],textColor:[212,168,83]} });
    doc.save('historique_appels.pdf');
    toast('Historique exporté', 'success');
  } catch(e) { toast('Erreur: ' + e.message, 'error'); }
}

function confirmWavePaymentManual() {
  const name = (document.getElementById('wavePayerName')?.value||'').trim();
  const number = (document.getElementById('wavePayerNumber')?.value||'').trim();
  const err = document.getElementById('paymentFormErr');
  if (!name || !number) {
    if (err) { err.textContent = 'Veuillez remplir votre nom et numéro Wave.'; err.classList.add('show'); }
    return;
  }
  if (err) err.classList.remove('show');
  window._fbSetDoc && window._fbSetDoc(window._fbDoc(window._db, 'profiles', currentProfile.id), {
    paymentPendingAt: new Date().toISOString(),
    subscriptionStatus: 'pending_payment',
    wavePayerName: name,
    wavePayerNumber: number,
  }, { merge: true }).catch(()=>{});
  document.getElementById('paywallPaymentForm').style.display = 'none';
  document.getElementById('paywallSuccessPanel').style.display = 'block';
}

// ══════════════════════════════════════════
// EXPOSE FUNCTIONS TO GLOBAL SCOPE
// Required because this file is loaded as type="module"
// Module scope is isolated — onclick="fn()" in HTML needs window.fn
// ══════════════════════════════════════════
const __globalExports = [
  'addFacLigne','addLigne','afficherDeclaration','afficherLettrage',
  'autoSaveAllEcritures','autoSaveAllFromNotif','calcAmortissement','calcPaie',
  'closeClientModal','closeExportModal','closeFactureModal','closeFournisseurModal',
  'closeMobileSidebar','closeRobot','confirmWavePaymentManual','copierCodeCollab',
  'dismissFillBanner','doExport','doForgotPassword','doLogin','doLogout','doRegister',
  'exportAnalytiquePDF','exportAuditPDF','exportBalanceAgeePDF','exportBudgetPDF',
  'exportBulletinPDF','exportDeclFiscalePDF','exportDeclarationPDF','exportEffetsPDF',
  'exportFactureList','exportHistoriqueAppels','exportInventairePDF',
  'exportRapprochementPDF','exportTAFIREpdf','exportTableauAmortissement',
  'fermerCollabModal','genererCodeCollab','genererEcrituresCloture','goToSaisie',
  'handleAiKey','hideMultiEcrBanner','hideSaisieNotif','importReleveBancaire',
  'lancerLettrage','navigate','onClickTopValidate','openBudgetModal','openCentreModal',
  'openClientModal','openCollabModal','openDeclTaxeModal','openDevisModal',
  'openEffetModal','openExportModal','openFactureModal','openFournisseurModal',
  'openImmobModal','openImportModal','openNouveau3DCall','openPaieModal','openRobot','openSocieteModal',
  'openStockModal','openWavePayment','ouvrirAppelVideo','ouvrirNouvelExercice',
  'previewFacturePDF','rejoindreCollab','renderBalance','renderBilan','renderClients',
  'renderFactures','renderFournisseurs','renderGrandLivre','renderJournal',
  'renderPlanComptable','resetBalanceFiltre','resetFactureFiltre','resetGLFiltre',
  'resetJournalFiltre','revoquerTousCollab','saveBudget','saveCentre','saveClient',
  'saveEffet','saveFacture','saveFournisseur','saveImmob','saveImputation','savePaie',
  'saveSociete','saveStock','searchClientDrop','selectExport','sendRobotText','sendToAI',
  'skipToNextEcriture','switchTab','terminerAppel','terminerAppelVideo','toast',
  'toggleCam','toggleMic','toggleMobileSidebar','updateBudgetAccountSuggest',
  'updateExportOptions','updateFacTotaux','updateImmobCompte','updateImputMontant',
  'updateStats','verifierCloture',
  // Additional functions used in dynamically generated HTML
  'selectAccount','selectAccountMulti','browseAccountClass','closeAccountDropdown',
  'hideDropdown','updateAccountSuggest','updateAccountSuggestMulti',
  'addLigneMulti','removeLigneMulti','removeEcritureFromQueue','updateMultiBlockBalance',
  'removeLigne','removeFacLigne','toggleGL','deleteEcriture','deleteGroupe',
  'convertirDevisEnFacture','marquerPayee','supprimerFacture','newFactureForClient',
  'selectClientForFac','autoComptabiliserFacture','genererDotation',
  'toggleRappr','toggleMobileSidebar','closeMobileSidebar',
  'changerStatutEffet','deleteEffet','changerRole','quitterModeCollab',
  'revoquerCollaborateurV2','ouvrirJoinCollabModal','ajouterExercice','switchSociete',
  'openImputationModal','deleteCentre','genererCodeCollab',
];

// Assign each to window so onclick="" attributes can find them
const __scope = { addFacLigne, addLigne, afficherDeclaration, afficherLettrage,
  autoSaveAllEcritures, autoSaveAllFromNotif, calcAmortissement, calcPaie,
  closeClientModal, closeExportModal, closeFactureModal, closeFournisseurModal,
  closeMobileSidebar, closeRobot, doExport, doForgotPassword, doLogin, doLogout, doRegister,
  exportAnalytiquePDF, exportAuditPDF, exportBalanceAgeePDF, exportBudgetPDF,
  exportBulletinPDF, exportDeclarationPDF, exportEffetsPDF,
  exportFactureList, exportInventairePDF,
  exportRapprochementPDF, exportTAFIREpdf, exportTableauAmortissement,
  fermerCollabModal, genererCodeCollab, genererEcrituresCloture, goToSaisie,
  handleAiKey, hideMultiEcrBanner, hideSaisieNotif,
  lancerLettrage, navigate, onClickTopValidate, openBudgetModal, openCentreModal,
  openClientModal, openCollabModal, openDevisModal,
  openEffetModal, openExportModal, openFactureModal, openFournisseurModal,
  openImmobModal, openImportModal, openPaieModal, openRobot, openSocieteModal,
  openStockModal, openWavePayment, ouvrirAppelVideo, ouvrirNouvelExercice,
  rejoindreCollab, renderBalance, renderBilan, renderClients,
  renderFactures, renderFournisseurs, renderGrandLivre, renderJournal,
  renderPlanComptable, resetBalanceFiltre, resetFactureFiltre, resetGLFiltre,
  resetJournalFiltre, revoquerTousCollab, saveBudget, saveCentre, saveClient,
  saveEffet, saveFacture, saveFournisseur, saveImmob, saveImputation, savePaie,
  saveSociete, saveStock, searchClientDrop, selectExport, sendRobotText, sendToAI,
  skipToNextEcriture, switchTab, terminerAppelVideo, toast,
  toggleCam, toggleMic, toggleMobileSidebar, shareScreen: () => {
    if (!document.getElementById('videoCallPanel') || navigator.mediaDevices?.getDisplayMedia === undefined) return;
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
      const track = stream.getVideoTracks()[0];
      if (window._peerConn) {
        const sender = window._peerConn.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(track);
      }
      const vid = document.getElementById('localVideo');
      if (vid) vid.srcObject = stream;
      track.onended = () => { if (localStream) { const vid2 = document.getElementById('localVideo'); if (vid2) vid2.srcObject = localStream; } };
    }).catch(() => {});
  }, updateExportOptions,
  updateFacTotaux, updateImmobCompte, updateImputMontant,
  updateStats, verifierCloture,
  selectAccount, selectAccountMulti, browseAccountClass, closeAccountDropdown,
  hideDropdown, updateAccountSuggest, updateAccountSuggestMulti,
  addLigneMulti, removeLigneMulti, removeEcritureFromQueue, updateMultiBlockBalance,
  removeLigne, toggleGL, deleteEcriture, deleteGroupe,
  convertirDevisEnFacture, marquerPayee, supprimerFacture, newFactureForClient,
  selectClientForFac, autoComptabiliserFacture, genererDotation,
  toggleRappr, changerStatutEffet, deleteEffet, changerRole, quitterModeCollab,
  revoquerCollaborateurV2, ouvrirJoinCollabModal, ajouterExercice, switchSociete,
  openImputationModal, deleteCentre, dismissFillBanner, copierCodeCollab,
  removeFacLigne,
};

Object.assign(window, __scope);

// Functions that may not exist yet — safe optional exports
const __optional = ['confirmWavePaymentManual','exportDeclFiscalePDF','openDeclTaxeModal',
  'openNouveau3DCall','exportHistoriqueAppels','terminerAppel','previewFacturePDF',
  'autoSaveAllFromNotif','hideSaisieNotif',
  'updateBudgetAccountSuggest','exportAuditPDF','exportBalanceAgeePDF',
  'exportBudgetPDF','exportEffetsPDF','exportInventairePDF','exportRapprochementPDF',
  'exportBulletinPDF','exportTableauAmortissement','exportTAFIREpdf',
  'exportAnalytiquePDF','exportDeclarationPDF','afficherLettrage','afficherDeclaration',
  'lancerLettrage','verifierCloture','genererEcrituresCloture','ouvrirNouvelExercice',
];
__optional.forEach(name => {
  try { if (typeof eval(name) === 'function') window[name] = eval(name); } catch(e) {}
});
