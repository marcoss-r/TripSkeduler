// Fábrica de backend de almacenamiento.
//
// La interfaz que cualquier backend debe implementar (ver
// PLAN-DESARROLLO.md, sección "Fase 2"):
//
//   getMyId()                                  -> Promise<string>
//   getProfile()                               -> Promise<{displayName}|null>
//   saveProfile({displayName})                 -> Promise<void>
//
//   --- solo backend Firestore (Fase 10, cuenta opcional con Google) ---
//   getAuthInfo()                    -> {uid, isAnonymous, displayName, email}
//   linkGoogleAccount()              -> Promise<{ok, pending?, merged?, cancelled?, displayName?, email?}>
//   signOutToAnonymous()             -> Promise<void>
//   consumeGoogleRedirectOutcome()   -> mismo shape que linkGoogleAccount(), o null
//
//   createBoard(config)                        -> Promise<boardId>
//   getBoard(boardId)                          -> Promise<config|null>
//   updateBoard(boardId, patch)                -> Promise<void>
//   deleteBoard(boardId)                       -> Promise<void>
//   subscribeBoard(boardId, cb, onError?)      -> unsubscribe()
//   subscribeResponses(boardId, cb, onError?)  -> unsubscribe()
//   saveMyResponse(boardId, {name, days})      -> Promise<void>
//   deleteResponse(boardId, uid)               -> Promise<void>
//
//   listMyBoards()                             -> Promise<Array>
//   rememberBoard(boardId, meta)               -> Promise<void>
//   forgetBoard(boardId)                       -> Promise<void>
//
//   createGroup({name})                        -> Promise<groupId>
//   getGroup(groupId)                          -> Promise<group|null>
//   updateGroup(groupId, patch)                -> Promise<void>
//   joinGroup(groupId, {name})                 -> Promise<void>
//   leaveGroup(groupId)                        -> Promise<void>
//   removeMember(groupId, uid)                 -> Promise<void>
//   subscribeMembers(groupId, cb, onError?)    -> unsubscribe()
//   listGroupBoards(groupId)                   -> Promise<Array>
//   listMyGroups()                             -> Promise<Array>
//
// `subscribeBoard` es una extensión sobre el diseño original de la Fase 2.
// Hasta añadirlo, el documento del tablero se leía UNA vez al entrar
// (getBoard) y nunca se volvía a mirar: si el creador cambiaba el nombre,
// las fechas o marcaba a alguien como imprescindible, el resto del grupo
// seguía viendo lo viejo — y las puntuaciones calculadas con lo viejo —
// hasta recargar la página. Ojo al usarlo: `expiresAt` se reescribe cada
// vez que alguien guarda una respuesta (marcar actividad para el TTL), así
// que este callback se dispara constantemente; quien lo consuma debe
// comparar los campos que de verdad muestra antes de repintar nada.
//
// `onError` en subscribeResponses/subscribeMembers es una extensión sobre
// el diseño original (añadida al escribir firestore-store.js, Fase 5):
// local-store nunca falla y lo ignora si se le pasa; con un backend real sí
// hay errores de red/permisos que la UI necesita poder mostrar.
//
// `updateGroup` y `removeMember` son extensión sobre el diseño original de
// la Fase 2 (añadida en la Fase 9): el creador del grupo puede renombrarlo
// y expulsar a un miembro, igual que ya podía editar/borrar un tablero
// (Fase 5). `removeMember` solo borra groups/{id}/members/{uid}; el índice
// privado users/{uid}/groups del expulsado queda desincronizado a propósito
// (las reglas no dejan que nadie más lo toque) — ver nota en
// firestore-store.js.
//
// Los 4 métodos de cuenta con Google no existen en local-store: no tiene
// sentido "vincular Google" sin un backend real. La UI comprueba
// `store.kind === 'firestore'` antes de mostrar cualquier botón de Google o
// de llamarlos — igual que ya hace con el aviso de "modo local" en
// view-board.js.
//
// Dos adaptadores la implementan: local-store.js (localStorage, para
// desarrollo sin Firebase y para depurar el multiusuario con varias
// pestañas) y firestore-store.js (backend real de producción).
//
// Selección de backend:
//   - ?store=local en la URL fuerza el backend local (para depurar), pase
//     lo que pase en config.js.
//   - si no, se usa el `backend` definido en config.js ('local' hasta que
//     se complete la Fase 4 del plan y se rellene firebaseConfig).
//
// getStore() es async y memoiza la promesa: el SDK de Firebase solo se
// descarga (import dinámico) la primera vez que de verdad hace falta, nunca
// mientras se sigue trabajando en local.

import { localStore } from './local-store.js';
import { backend, firebaseConfig } from '../config.js';

let cachedStorePromise = null;

export function getStore() {
  if (cachedStorePromise) return cachedStorePromise;

  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const forced = params ? params.get('store') : null;

  if (forced === 'local' || backend !== 'firestore') {
    cachedStorePromise = Promise.resolve(localStore);
    return cachedStorePromise;
  }

  cachedStorePromise = import('./firestore-store.js').then(({ createFirestoreStore }) =>
    createFirestoreStore(firebaseConfig)
  );
  return cachedStorePromise;
}
