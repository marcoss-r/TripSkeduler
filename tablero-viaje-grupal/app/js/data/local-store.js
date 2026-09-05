// Adaptador de almacenamiento sobre localStorage.
//
// Uso: desarrollo sin Firebase (?store=local) y depuración del
// multiusuario abriendo dos pestañas del navegador — el evento nativo
// 'storage' se dispara en las DEMÁS pestañas cuando una escribe en
// localStorage, lo que simula el tiempo real de Firestore. Como ese
// evento NO se dispara en la propia pestaña que escribe, además de
// escuchar 'storage' mantenemos un pequeño pub-sub en memoria para que
// la pestaña que hace el cambio se entere al instante también.
//
// Todo el estado vive bajo claves con el prefijo "tsk:" para no chocar
// con otras apps que compartan origen en local.

import { newId } from '../core/ids.js';

const PREFIX = 'tsk:';

// --- utilidades de bajo nivel -----------------------------------------------

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function removeKey(key) {
  localStorage.removeItem(key);
}

/** Devuelve [{key, value}] para todas las claves que empiezan por `prefix`. */
function scanPrefix(prefix) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      const value = readJSON(key);
      if (value !== null) out.push({ key, value });
    }
  }
  return out;
}

// --- pub-sub en memoria (para la propia pestaña) ----------------------------

const localListeners = new Map(); // topic -> Set<callback>

function notify(topic) {
  const set = localListeners.get(topic);
  if (set) for (const cb of set) cb();
}

function subscribeTopic(topic, onChange) {
  if (!localListeners.has(topic)) localListeners.set(topic, new Set());
  localListeners.get(topic).add(onChange);
  return () => localListeners.get(topic)?.delete(onChange);
}

// Un único listener global de 'storage' (eventos de OTRAS pestañas) que
// redirige al topic correspondiente según el prefijo de la clave que cambió.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    // Los topics son "board:{boardId}" y "group:{groupId}"; basta con
    // notificar a todos los topics registrados y dejar que cada suscriptor
    // relea sus propios datos (es barato: son lecturas de localStorage).
    for (const topic of localListeners.keys()) notify(topic);
  });
}

// --- identidad local ---------------------------------------------------------

const MY_ID_KEY = `${PREFIX}myId`;

function getMyIdSync() {
  let id = localStorage.getItem(MY_ID_KEY);
  if (!id) {
    id = newId(16);
    localStorage.setItem(MY_ID_KEY, id);
  }
  return id;
}

async function getMyId() {
  return getMyIdSync();
}

// --- perfil -------------------------------------------------------------

async function getProfile() {
  const uid = getMyIdSync();
  return readJSON(`${PREFIX}profile:${uid}`);
}

async function saveProfile({ displayName }) {
  const uid = getMyIdSync();
  writeJSON(`${PREFIX}profile:${uid}`, { displayName });
}

// --- tableros -------------------------------------------------------------

async function createBoard(config) {
  let boardId;
  do {
    boardId = newId(10);
  } while (readJSON(`${PREFIX}board:${boardId}`) !== null);

  const ownerUid = getMyIdSync();
  writeJSON(`${PREFIX}board:${boardId}`, {
    ...config,
    groupId: config.groupId ?? null,
    ownerUid,
    createdAt: Date.now(),
  });
  return boardId;
}

async function getBoard(boardId) {
  return readJSON(`${PREFIX}board:${boardId}`);
}

async function updateBoard(boardId, patch) {
  const key = `${PREFIX}board:${boardId}`;
  const current = readJSON(key);
  if (!current) throw new Error(`El tablero ${boardId} no existe`);
  writeJSON(key, { ...current, ...patch });
}

async function deleteBoard(boardId) {
  removeKey(`${PREFIX}board:${boardId}`);
  for (const { key } of scanPrefix(`${PREFIX}board:${boardId}:resp:`)) {
    removeKey(key);
  }
  notify(`board:${boardId}`);
}

function listResponsesSync(boardId) {
  const prefix = `${PREFIX}board:${boardId}:resp:`;
  // El uid no se guarda dentro del valor (ya está codificado en la clave,
  // igual que el docId de Firestore); se añade aquí para que la UI pueda
  // distinguir "mi fila" sin depender del nombre (dos personas podrían
  // escribir el mismo nombre).
  return scanPrefix(prefix).map(({ key, value }) => ({ uid: key.slice(prefix.length), ...value }));
}

function subscribeResponses(boardId, cb) {
  const topic = `board:${boardId}`;
  const emit = () => cb(listResponsesSync(boardId));
  emit(); // primer valor inmediato, como pide la interfaz
  return subscribeTopic(topic, emit);
}

async function saveMyResponse(boardId, { name, days }) {
  const uid = getMyIdSync();
  writeJSON(`${PREFIX}board:${boardId}:resp:${uid}`, {
    name,
    days,
    updatedAt: Date.now(),
  });
  notify(`board:${boardId}`);
}

async function deleteResponse(boardId, uid) {
  removeKey(`${PREFIX}board:${boardId}:resp:${uid}`);
  notify(`board:${boardId}`);
}

// --- índice "mis viajes" ----------------------------------------------------

async function listMyBoards() {
  const uid = getMyIdSync();
  return scanPrefix(`${PREFIX}mine:${uid}:boards:`).map(({ key, value }) => ({
    boardId: key.slice(`${PREFIX}mine:${uid}:boards:`.length),
    ...value,
  }));
}

async function rememberBoard(boardId, meta) {
  const uid = getMyIdSync();
  writeJSON(`${PREFIX}mine:${uid}:boards:${boardId}`, { ...meta, savedAt: Date.now() });
}

async function forgetBoard(boardId) {
  const uid = getMyIdSync();
  removeKey(`${PREFIX}mine:${uid}:boards:${boardId}`);
}

// --- grupos -------------------------------------------------------------

async function createGroup({ name }) {
  let groupId;
  do {
    groupId = newId(10);
  } while (readJSON(`${PREFIX}group:${groupId}`) !== null);

  const ownerUid = getMyIdSync();
  writeJSON(`${PREFIX}group:${groupId}`, { name, ownerUid, createdAt: Date.now() });
  return groupId;
}

async function getGroup(groupId) {
  return readJSON(`${PREFIX}group:${groupId}`);
}

async function updateGroup(groupId, patch) {
  const key = `${PREFIX}group:${groupId}`;
  const current = readJSON(key);
  if (!current) throw new Error(`El grupo ${groupId} no existe`);
  writeJSON(key, { ...current, ...patch });
  notify(`group:${groupId}`);
}

async function removeMember(groupId, uid) {
  removeKey(`${PREFIX}group:${groupId}:member:${uid}`);
  removeKey(`${PREFIX}mine:${uid}:groups:${groupId}`);
  notify(`group:${groupId}`);
}

async function joinGroup(groupId, { name }) {
  const group = readJSON(`${PREFIX}group:${groupId}`);
  if (!group) throw new Error(`El grupo ${groupId} no existe`);

  const uid = getMyIdSync();
  writeJSON(`${PREFIX}group:${groupId}:member:${uid}`, { name, joinedAt: Date.now() });
  writeJSON(`${PREFIX}mine:${uid}:groups:${groupId}`, { name: group.name, savedAt: Date.now() });
  notify(`group:${groupId}`);
}

async function leaveGroup(groupId) {
  const uid = getMyIdSync();
  removeKey(`${PREFIX}group:${groupId}:member:${uid}`);
  removeKey(`${PREFIX}mine:${uid}:groups:${groupId}`);
  notify(`group:${groupId}`);
}

function listMembersSync(groupId) {
  const prefix = `${PREFIX}group:${groupId}:member:`;
  return scanPrefix(prefix).map(({ key, value }) => ({
    uid: key.slice(prefix.length),
    ...value,
  }));
}

function subscribeMembers(groupId, cb) {
  const topic = `group:${groupId}`;
  const emit = () => cb(listMembersSync(groupId));
  emit();
  return subscribeTopic(topic, emit);
}

async function listGroupBoards(groupId) {
  // ⚠️ scanPrefix(`${PREFIX}board:`) también matchea las claves de
  // respuestas (`tsk:board:{id}:resp:{uid}`), que comparten el mismo
  // prefijo. Se filtran con una regex que exige "sin más ':' después
  // del id" para quedarnos solo con documentos de configuración de
  // tablero.
  const boardKeyRe = new RegExp(`^${PREFIX}board:[^:]+$`);
  return scanPrefix(`${PREFIX}board:`)
    .filter(({ key, value }) => boardKeyRe.test(key) && value.groupId === groupId)
    .map(({ key, value }) => ({ boardId: key.slice(`${PREFIX}board:`.length), ...value }));
}

async function listMyGroups() {
  const uid = getMyIdSync();
  return scanPrefix(`${PREFIX}mine:${uid}:groups:`).map(({ key, value }) => ({
    groupId: key.slice(`${PREFIX}mine:${uid}:groups:`.length),
    ...value,
  }));
}

export const localStore = {
  kind: 'local',

  getMyId,
  getProfile,
  saveProfile,

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
