// Tests del adaptador local-store.js.
//
// Node no tiene `localStorage` global por defecto, así que se inyecta un
// shim mínimo en memoria antes de importar el módulo (import dinámico,
// para garantizar que el shim ya está en `globalThis` cuando el módulo se
// evalúa). No es una dependencia externa: es un stub de ~10 líneas para
// el entorno de test.

import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  #map = new Map();
  get length() {
    return this.#map.size;
  }
  key(i) {
    return Array.from(this.#map.keys())[i] ?? null;
  }
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }
  setItem(k, v) {
    this.#map.set(k, String(v));
  }
  removeItem(k) {
    this.#map.delete(k);
  }
  clear() {
    this.#map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
// `window` se deja sin definir a propósito: local-store.js comprueba
// `typeof window !== 'undefined'` antes de registrar el listener de
// 'storage' (evento cross-tab, solo relevante en un navegador real). El
// pub-sub en memoria que sí se testea aquí es independiente de eso.

const { localStore } = await import('../app/js/data/local-store.js');

test.beforeEach(() => {
  globalThis.localStorage.clear();
});

test('getMyId genera un id y lo persiste entre llamadas', async () => {
  const id1 = await localStore.getMyId();
  const id2 = await localStore.getMyId();
  assert.equal(id1, id2);
  assert.equal(typeof id1, 'string');
  assert.ok(id1.length > 0);
});

test('getProfile devuelve null si no hay perfil, y refleja saveProfile', async () => {
  assert.equal(await localStore.getProfile(), null);
  await localStore.saveProfile({ displayName: 'Ana' });
  assert.deepEqual(await localStore.getProfile(), { displayName: 'Ana' });
});

test('createBoard / getBoard: guarda el config con ownerUid y createdAt', async () => {
  const boardId = await localStore.createBoard({
    tripName: 'Escapada a Lisboa',
    startDate: '2026-07-01',
    endDate: '2026-08-15',
    tripLength: 5,
  });
  assert.equal(typeof boardId, 'string');

  const board = await localStore.getBoard(boardId);
  const myUid = await localStore.getMyId();
  assert.equal(board.tripName, 'Escapada a Lisboa');
  assert.equal(board.groupId, null);
  assert.equal(board.ownerUid, myUid);
  assert.equal(typeof board.createdAt, 'number');
});

test('getBoard de un id inexistente devuelve null', async () => {
  assert.equal(await localStore.getBoard('no-existe'), null);
});

test('updateBoard hace merge sobre el config existente', async () => {
  const boardId = await localStore.createBoard({
    tripName: 'Viaje', startDate: '2026-07-01', endDate: '2026-07-10', tripLength: 3,
  });
  await localStore.updateBoard(boardId, { tripName: 'Viaje renombrado' });
  const board = await localStore.getBoard(boardId);
  assert.equal(board.tripName, 'Viaje renombrado');
  assert.equal(board.tripLength, 3); // el resto de campos no se toca
});

test('updateBoard sobre un tablero inexistente lanza error', async () => {
  await assert.rejects(() => localStore.updateBoard('no-existe', { tripName: 'x' }));
});

test('deleteBoard borra el tablero y todas sus respuestas', async () => {
  const boardId = await localStore.createBoard({
    tripName: 'Viaje', startDate: '2026-07-01', endDate: '2026-07-10', tripLength: 3,
  });
  await localStore.saveMyResponse(boardId, { name: 'Ana', days: {} });
  await localStore.deleteBoard(boardId);

  assert.equal(await localStore.getBoard(boardId), null);
  let responses = null;
  const unsub = localStore.subscribeResponses(boardId, (r) => (responses = r));
  unsub();
  assert.deepEqual(responses, []);
});

test('saveMyResponse + subscribeResponses: primer valor inmediato y notificación tras guardar', async () => {
  const boardId = await localStore.createBoard({
    tripName: 'Viaje', startDate: '2026-07-01', endDate: '2026-07-10', tripLength: 3,
  });

  const snapshots = [];
  const unsub = localStore.subscribeResponses(boardId, (r) => snapshots.push(r));
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0], []); // nadie ha respondido aún

  await localStore.saveMyResponse(boardId, { name: 'Ana', days: { '2026-07-02': 'full' } });
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].length, 1);
  assert.equal(snapshots[1][0].name, 'Ana');
  assert.deepEqual(snapshots[1][0].days, { '2026-07-02': 'full' });

  unsub();
  await localStore.saveMyResponse(boardId, { name: 'Ana', days: { '2026-07-03': 'partial' } });
  assert.equal(snapshots.length, 2); // tras unsubscribe, no llegan más notificaciones
});

test('subscribeResponses incluye el uid de cada fila (necesario para saber cuál es "mía")', async () => {
  const boardId = await localStore.createBoard({
    tripName: 'Viaje', startDate: '2026-07-01', endDate: '2026-07-10', tripLength: 3,
  });
  const myUid = await localStore.getMyId();
  await localStore.saveMyResponse(boardId, { name: 'Ana', days: {} });

  let responses = null;
  localStore.subscribeResponses(boardId, (r) => (responses = r))();
  assert.equal(responses.length, 1);
  assert.equal(responses[0].uid, myUid);
  assert.equal(responses[0].name, 'Ana');
});

test('deleteResponse quita solo la fila indicada', async () => {
  const boardId = await localStore.createBoard({
    tripName: 'Viaje', startDate: '2026-07-01', endDate: '2026-07-10', tripLength: 3,
  });
  const myUid = await localStore.getMyId();
  await localStore.saveMyResponse(boardId, { name: 'Ana', days: {} });
  await localStore.deleteResponse(boardId, myUid);

  let responses = null;
  localStore.subscribeResponses(boardId, (r) => (responses = r))();
  assert.deepEqual(responses, []);
});

test('listMyBoards / rememberBoard / forgetBoard', async () => {
  await localStore.rememberBoard('board1', { tripName: 'Lisboa', groupId: null, role: 'owner' });
  await localStore.rememberBoard('board2', { tripName: 'Roma', groupId: null, role: 'participant' });

  let mine = await localStore.listMyBoards();
  assert.equal(mine.length, 2);
  assert.ok(mine.some((b) => b.boardId === 'board1' && b.tripName === 'Lisboa'));

  await localStore.forgetBoard('board1');
  mine = await localStore.listMyBoards();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].boardId, 'board2');
});

test('createGroup / getGroup', async () => {
  const groupId = await localStore.createGroup({ name: 'Los de siempre' });
  const group = await localStore.getGroup(groupId);
  const myUid = await localStore.getMyId();
  assert.equal(group.name, 'Los de siempre');
  assert.equal(group.ownerUid, myUid);
});

test('joinGroup falla si el grupo no existe', async () => {
  await assert.rejects(() => localStore.joinGroup('no-existe', { name: 'Ana' }));
});

test('joinGroup añade el miembro y lo refleja en subscribeMembers; leaveGroup lo quita', async () => {
  const groupId = await localStore.createGroup({ name: 'Los de siempre' });

  const snapshots = [];
  const unsub = localStore.subscribeMembers(groupId, (m) => snapshots.push(m));
  assert.deepEqual(snapshots[0], []);

  await localStore.joinGroup(groupId, { name: 'Ana' });
  assert.equal(snapshots.at(-1).length, 1);
  assert.equal(snapshots.at(-1)[0].name, 'Ana');

  await localStore.leaveGroup(groupId);
  assert.deepEqual(snapshots.at(-1), []);
  unsub();
});

test('joinGroup añade el grupo a listMyGroups', async () => {
  const groupId = await localStore.createGroup({ name: 'Los de siempre' });
  await localStore.joinGroup(groupId, { name: 'Ana' });

  const mine = await localStore.listMyGroups();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].groupId, groupId);
  assert.equal(mine[0].name, 'Los de siempre');
});

test('listGroupBoards devuelve solo los tableros del grupo, no confunde claves de respuestas', async () => {
  const groupId = await localStore.createGroup({ name: 'Los de siempre' });
  const boardInGroup = await localStore.createBoard({
    tripName: 'Estocolmo', startDate: '2026-07-01', endDate: '2026-07-10', tripLength: 5, groupId,
  });
  const boardLoose = await localStore.createBoard({
    tripName: 'Suelto', startDate: '2026-08-01', endDate: '2026-08-10', tripLength: 3,
  });
  // Esto crea claves "tsk:board:{boardInGroup}:resp:{uid}", que comparten
  // el prefijo "tsk:board:" con las claves de config de tablero — es
  // justo el caso que listGroupBoards debe filtrar correctamente.
  await localStore.saveMyResponse(boardInGroup, { name: 'Ana', days: {} });
  await localStore.saveMyResponse(boardLoose, { name: 'Ana', days: {} });

  const boards = await localStore.listGroupBoards(groupId);
  assert.equal(boards.length, 1);
  assert.equal(boards[0].boardId, boardInGroup);
  assert.equal(boards[0].tripName, 'Estocolmo');
});
