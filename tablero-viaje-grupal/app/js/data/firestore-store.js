// Adaptador de almacenamiento sobre Firestore — backend real (Fase 5).
//
// ⚠️ Escrito a partir de la especificación del plan (sección "Fase 5") y de
// la API pública y estable del SDK modular de Firebase v10; NO se ha podido
// probar contra un proyecto real todavía porque ese proyecto no existe hasta
// que se complete la Fase 4 (acción A1, ver PLAN-DESARROLLO.md). En cuanto
// haya un `firebaseConfig` real en config.js, esto necesita una prueba de
// humo de verdad (crear tablero, unirse desde dos pestañas/dos dispositivos,
// ver que llegan los cambios) antes de considerarlo terminado.
//
// Versión del SDK fijada (nunca 'latest'): si se sube, hacerlo a propósito.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  getRedirectResult,
  signInWithCredential,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import { newId } from '../core/ids.js';

/**
 * Crea el store de Firestore. Async porque espera a que la autenticación
 * anónima resuelva un uid antes de devolver nada — así ningún método del
 * store necesita comprobar "¿ya hay usuario?" en cada llamada.
 */
export async function createFirestoreStore(firebaseConfig) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initFirestoreWithOfflinePersistence(app);

  await ensureSignedIn(auth);

  // Resultado pendiente de un `linkGoogleAccount()` que cayó al fallback de
  // `linkWithRedirect` (popup bloqueado) — ver consumeGoogleRedirectOutcome.
  let pendingRedirectOutcome = null;

  // Completa un `linkGoogleAccount()` que cayó al fallback de redirect: si
  // el usuario volvió de Google tras un `linkWithRedirect`, aquí es donde
  // el SDK entrega el resultado (o el error, p. ej.
  // `credential-already-in-use`, que se resuelve igual que en el caso de
  // popup). Si no había ningún redirect pendiente, `getRedirectResult`
  // devuelve `null` sin más.
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      pendingRedirectOutcome = { ok: true, pending: false, merged: false, displayName: result.user.displayName, email: result.user.email };
    }
  } catch (err) {
    if (err.code === 'auth/credential-already-in-use') {
      try {
        pendingRedirectOutcome = await finishWithExistingGoogleAccount(err);
      } catch (err2) {
        console.error(err2);
        pendingRedirectOutcome = { ok: false, error: err2 };
      }
    } else {
      console.error(err);
      pendingRedirectOutcome = { ok: false, error: err };
    }
  }

  function myUid() {
    return auth.currentUser.uid;
  }

  async function ensureUniqueId(collectionName, makeId) {
    let id;
    do {
      id = makeId();
      // eslint-disable-next-line no-await-in-loop
    } while ((await getDoc(doc(db, collectionName, id))).exists());
    return id;
  }

  // --- identidad y perfil ---------------------------------------------------

  async function getMyId() {
    return myUid();
  }

  async function getProfile() {
    const snap = await getDoc(doc(db, 'users', myUid()));
    return snap.exists() ? snap.data() : null;
  }

  async function saveProfile({ displayName }) {
    await setDoc(doc(db, 'users', myUid()), { displayName }, { merge: true });
  }

  // --- cuenta opcional con Google (Fase 10) ------------------------------
  //
  // ⚠️ Igual que el resto de este fichero: escrito contra la API pública y
  // estable del SDK, sin poder probarlo contra un login real de Google
  // todavía (necesita un dominio autorizado en Firebase Auth — acción A5 —
  // y ejecutarse en un navegador real, no en este entorno). Probar a mano
  // en cuanto A5 esté hecho: vincular, cerrar y volver a abrir la app, y el
  // caso de "esta cuenta ya está vinculada a otro dispositivo".
  //
  // No hay una función `signInWithGoogle`: la única entrada es
  // `linkGoogleAccount()`, que siempre parte del usuario anónimo ya
  // existente y usa `linkWithPopup`/`linkWithRedirect` — el uid nunca
  // cambia salvo en el caso "feo" de la sección 1.1 del plan (la cuenta de
  // Google ya estaba vinculada a OTRO uid), donde no queda otra que
  // adoptar ese uid ya existente.

  function getAuthInfo() {
    const user = auth.currentUser;
    return {
      uid: user.uid,
      isAnonymous: user.isAnonymous,
      displayName: user.displayName,
      email: user.email,
    };
  }

  /**
   * Intenta vincular Google al usuario anónimo actual. Devuelve:
   *   { ok: true, pending: true }                                  -> se fue a signInWithRedirect (popup bloqueado); el resultado real llega más tarde a consumeGoogleRedirectOutcome() cuando la app vuelva a cargar
   *   { ok: true, pending: false, merged: false, displayName, email } -> vinculado con éxito, MISMO uid de siempre
   *   { ok: true, pending: false, merged: true, displayName, email }  -> esa cuenta de Google YA estaba vinculada a otro uid (el "caso feo" de la sección 1.1); se ha iniciado sesión con ese uid existente en su lugar. Documentado y aceptado: no se copian automáticamente las respuestas del uid anónimo anterior, la UI debe avisar.
   *   { ok: false, cancelled: true }                                 -> el usuario cerró el popup, no es un error real
   */
  async function linkGoogleAccount() {
    const provider = new GoogleAuthProvider();
    try {
      const result = await linkWithPopup(auth.currentUser, provider);
      return { ok: true, pending: false, merged: false, displayName: result.user.displayName, email: result.user.email };
    } catch (err) {
      if (err.code === 'auth/popup-blocked') {
        await linkWithRedirect(auth.currentUser, provider);
        return { ok: true, pending: true };
      }
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return { ok: false, cancelled: true };
      }
      if (err.code === 'auth/credential-already-in-use') {
        return finishWithExistingGoogleAccount(err);
      }
      throw err;
    }
  }

  async function finishWithExistingGoogleAccount(err) {
    const cred = GoogleAuthProvider.credentialFromError(err);
    const result = await signInWithCredential(auth, cred);
    return { ok: true, pending: false, merged: true, displayName: result.user.displayName, email: result.user.email };
  }

  /** Cierra sesión y vuelve a un anónimo limpio (uid nuevo, sin historial). */
  async function signOutToAnonymous() {
    await signOut(auth);
    await ensureSignedIn(auth);
  }

  /**
   * `linkGoogleAccount()` puede acabar en `linkWithRedirect` (fallback si el
   * popup está bloqueado): la página navega fuera y vuelve más tarde. El
   * resultado de ESE intento se recoge aquí, una sola vez, la próxima vez
   * que la app arranque — `createFirestoreStore` ya llama a
   * `getRedirectResult` al inicializarse y guarda lo que devuelva aquí,
   * porque en ese momento (carga de página) todavía no hay ninguna vista
   * escuchando; se guarda en una variable de este cierre (no del módulo:
   * cada `createFirestoreStore()` tiene la suya) hasta que algo la pida.
   */
  function consumeGoogleRedirectOutcome() {
    const outcome = pendingRedirectOutcome;
    pendingRedirectOutcome = null;
    return outcome;
  }

  // --- tableros ---------------------------------------------------------

  async function createBoard(config) {
    const boardId = await ensureUniqueId('boards', () => newId(10));
    await setDoc(doc(db, 'boards', boardId), {
      ...config,
      groupId: config.groupId ?? null,
      ownerUid: myUid(),
      createdAt: serverTimestamp(),
    });
    return boardId;
  }

  async function getBoard(boardId) {
    const snap = await getDoc(doc(db, 'boards', boardId));
    return snap.exists() ? snap.data() : null;
  }

  async function updateBoard(boardId, patch) {
    await updateDoc(doc(db, 'boards', boardId), patch);
  }

  async function deleteBoard(boardId) {
    const responsesSnap = await getDocs(collection(db, 'boards', boardId, 'responses'));
    const batch = writeBatch(db);
    for (const d of responsesSnap.docs) batch.delete(d.ref);
    batch.delete(doc(db, 'boards', boardId));
    await batch.commit();
  }

  /**
   * `onError` es una extensión respecto a la interfaz local (que nunca
   * puede fallar): con un backend real sí hay errores de red o de permisos
   * que la UI necesita mostrar (Fase 5, "banner de sin conexión"). Es
   * opcional y compatible hacia atrás — local-store.js simplemente lo
   * ignora si se le pasa.
   */
  function subscribeResponses(boardId, cb, onError) {
    return onSnapshot(
      collection(db, 'boards', boardId, 'responses'),
      (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      (err) => {
        console.error(err);
        if (onError) onError(err);
      }
    );
  }

  async function saveMyResponse(boardId, { name, days }) {
    await setDoc(doc(db, 'boards', boardId, 'responses', myUid()), {
      name,
      days,
      updatedAt: serverTimestamp(),
    });
  }

  async function deleteResponse(boardId, uid) {
    await deleteDoc(doc(db, 'boards', boardId, 'responses', uid));
  }

  // --- índice "mis viajes" ----------------------------------------------

  async function listMyBoards() {
    const snap = await getDocs(collection(db, 'users', myUid(), 'boards'));
    return snap.docs.map((d) => ({ boardId: d.id, ...d.data() }));
  }

  async function rememberBoard(boardId, meta) {
    await setDoc(doc(db, 'users', myUid(), 'boards', boardId), {
      ...meta,
      savedAt: serverTimestamp(),
    });
  }

  async function forgetBoard(boardId) {
    await deleteDoc(doc(db, 'users', myUid(), 'boards', boardId));
  }

  // --- grupos -------------------------------------------------------------

  async function createGroup({ name }) {
    const groupId = await ensureUniqueId('groups', () => newId(10));
    await setDoc(doc(db, 'groups', groupId), {
      name,
      ownerUid: myUid(),
      createdAt: serverTimestamp(),
    });
    return groupId;
  }

  async function getGroup(groupId) {
    const snap = await getDoc(doc(db, 'groups', groupId));
    return snap.exists() ? snap.data() : null;
  }

  async function updateGroup(groupId, patch) {
    await updateDoc(doc(db, 'groups', groupId), patch);
  }

  // Solo borra groups/{groupId}/members/{uid}. NO se toca el índice privado
  // users/{uid}/groups del miembro expulsado: las reglas solo dejan escribir
  // ahí a su propio dueño (me() == uid), así que el dueño del grupo no puede
  // limpiarlo. Queda como índice desincronizado — aceptado por diseño (ver
  // PLAN-DESARROLLO.md, sección 3): la vista de "mis grupos" del expulsado
  // lo ignora en silencio la próxima vez que ya no pueda actuar como miembro.
  async function removeMember(groupId, uid) {
    await deleteDoc(doc(db, 'groups', groupId, 'members', uid));
  }

  async function joinGroup(groupId, { name }) {
    const group = await getGroup(groupId);
    if (!group) throw new Error(`El grupo ${groupId} no existe`);

    await setDoc(doc(db, 'groups', groupId, 'members', myUid()), {
      name,
      joinedAt: serverTimestamp(),
    });
    // Índice "mis grupos" — ver PLAN-DESARROLLO.md sección 3 (users/{uid}/groups).
    await setDoc(doc(db, 'users', myUid(), 'groups', groupId), {
      name: group.name,
      savedAt: serverTimestamp(),
    });
  }

  async function leaveGroup(groupId) {
    await deleteDoc(doc(db, 'groups', groupId, 'members', myUid()));
    await deleteDoc(doc(db, 'users', myUid(), 'groups', groupId));
  }

  function subscribeMembers(groupId, cb, onError) {
    return onSnapshot(
      collection(db, 'groups', groupId, 'members'),
      (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      (err) => {
        console.error(err);
        if (onError) onError(err);
      }
    );
  }

  async function listGroupBoards(groupId) {
    // Sin índice dedicado: se filtra con una query de igualdad simple sobre
    // `boards.groupId`, que Firestore indexa automáticamente sin configurar
    // nada. Si algún día esto no escala (grupos con muchísimos tableros),
    // el backlog es añadir groups/{groupId}/boards como índice explícito.
    const snap = await getDocs(query(collection(db, 'boards'), where('groupId', '==', groupId)));
    return snap.docs.map((d) => ({ boardId: d.id, ...d.data() }));
  }

  async function listMyGroups() {
    const snap = await getDocs(collection(db, 'users', myUid(), 'groups'));
    return snap.docs.map((d) => ({ groupId: d.id, ...d.data() }));
  }

  return {
    kind: 'firestore',

    getMyId,
    getProfile,
    saveProfile,
    getAuthInfo,
    linkGoogleAccount,
    signOutToAnonymous,
    consumeGoogleRedirectOutcome,
    createBoard,
    getBoard,
    updateBoard,
    deleteBoard,
    subscribeResponses,
    saveMyResponse,
    deleteResponse,
    listMyBoards,
    rememberBoard,
    forgetBoard,
    createGroup,
    getGroup,
    updateGroup,
    joinGroup,
    leaveGroup,
    removeMember,
    subscribeMembers,
    listGroupBoards,
    listMyGroups,
  };
}

function initFirestoreWithOfflinePersistence(app) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // Falla si Firestore ya se inicializó antes en este mismo proceso (p.ej.
    // recarga en caliente durante desarrollo) o si el navegador no soporta
    // IndexedDB. Se cae a la instancia normal, sin persistencia offline —
    // la app sigue funcionando, solo pierde la caché local sin conexión.
    console.warn('No se pudo habilitar la persistencia offline de Firestore:', err);
    return getFirestore(app);
  }
}

function ensureSignedIn(auth) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      },
      (err) => {
        unsubscribe();
        reject(err);
      }
    );
    signInAnonymously(auth).catch((err) => {
      unsubscribe();
      reject(err);
    });
  });
}
