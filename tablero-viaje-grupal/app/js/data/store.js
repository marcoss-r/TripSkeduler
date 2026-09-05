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
//   subscribeResponses(boardId, cb)            -> unsubscribe()
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
//   subscribeMembers(groupId, cb)              -> unsubscribe()
//   listGroupBoards(groupId)                   -> Promise<Array>
//   listMyGroups()                             -> Promise<Array>
//
// Dos adaptadores la implementan: local-store.js (localStorage, para
// desarrollo sin Firebase y para depurar el multiusuario con varias
// pestañas) y firestore-store.js (Fase 5, backend real de producción).
//
// Selección de backend:
//   - ?store=local en la URL fuerza el backend local (para depurar).
//   - si no, se usa el `backend` definido en config.js.

import { localStore } from './local-store.js';

let cachedStore = null;

export function getStore() {
  if (cachedStore) return cachedStore;

  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const forced = params ? params.get('store') : null;

  if (forced === 'local') {
    cachedStore = localStore;
    return cachedStore;
  }

  // La Fase 5 añade firestore-store.js y config.js con `backend`.
  // Hasta entonces, el único backend disponible es el local.
  cachedStore = localStore;
  return cachedStore;
}
