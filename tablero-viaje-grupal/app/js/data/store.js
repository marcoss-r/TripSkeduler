// Fábrica de backend de almacenamiento.
//
// La interfaz que cualquier backend debe implementar (ver
// PLAN-DESARROLLO.md, sección "Fase 2"):
//
//   getMyId()                                  -> Promise<string>
//   getProfile()                               -> Promise<{displayName}|null>
//   saveProfile({displayName})                 -> Promise<void>
//
//   createBoard(config)                        -> Promise<boardId>
//   getBoard(boardId)                          -> Promise<config|null>
//   updateBoard(boardId, patch)                -> Promise<void>
//   deleteBoard(boardId)                       -> Promise<void>
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
//   joinGroup(groupId, {name})                 -> Promise<void>
//   leaveGroup(groupId)                        -> Promise<void>
//   subscribeMembers(groupId, cb, onError?)    -> unsubscribe()
//   listGroupBoards(groupId)                   -> Promise<Array>
//   listMyGroups()                             -> Promise<Array>
//
// `onError` en subscribeResponses/subscribeMembers es una extensión sobre
// el diseño original (añadida al escribir firestore-store.js, Fase 5):
// local-store nunca falla y lo ignora si se le pasa; con un backend real sí
// hay errores de red/permisos que la UI necesita poder mostrar.
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
