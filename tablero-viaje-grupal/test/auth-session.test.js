import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSignedIn } from '../app/js/data/auth-session.js';

/** Doble del SDK. `restored` es lo que emite onAuthStateChanged al arrancar:
 *  un usuario si había sesión guardada, o null si no había ninguna. */
function fakeAuth({ restored }) {
  const calls = { signInAnonymously: 0, unsubscribed: 0 };
  const api = {
    onAuthStateChanged(auth, next) {
      queueMicrotask(() => next(restored));
      return () => {
        calls.unsubscribed++;
      };
    },
    async signInAnonymously() {
      calls.signInAnonymously++;
      return { user: { uid: 'anon-nuevo', isAnonymous: true } };
    },
  };
  return { api, calls };
}

test('con sesión de Google guardada NO se crea un anónimo nuevo (el fallo de producción)', async () => {
  const google = { uid: 'uid-de-siempre', isAnonymous: false, email: 'a@b.c' };
  const { api, calls } = fakeAuth({ restored: google });

  const user = await ensureSignedIn({}, api);

  assert.equal(user, google, 'debe devolver el usuario restaurado, no uno nuevo');
  assert.equal(calls.signInAnonymously, 0, 'signInAnonymously habría tirado la sesión de Google');
});

test('con sesión anónima guardada tampoco se crea otra: el uid se conserva', async () => {
  const anon = { uid: 'anon-de-siempre', isAnonymous: true };
  const { api, calls } = fakeAuth({ restored: anon });

  const user = await ensureSignedIn({}, api);

  assert.equal(user.uid, 'anon-de-siempre');
  assert.equal(calls.signInAnonymously, 0);
});

test('sin ninguna sesión guardada sí se entra como anónimo', async () => {
  const { api, calls } = fakeAuth({ restored: null });

  const user = await ensureSignedIn({}, api);

  assert.equal(user.uid, 'anon-nuevo');
  assert.equal(calls.signInAnonymously, 1);
});

test('se desuscribe del listener en los tres casos', async () => {
  for (const restored of [{ uid: 'x', isAnonymous: false }, { uid: 'y', isAnonymous: true }, null]) {
    const { api, calls } = fakeAuth({ restored });
    await ensureSignedIn({}, api);
    assert.equal(calls.unsubscribed, 1);
  }
});

test('si el login anónimo falla, la promesa se rechaza', async () => {
  const { api } = fakeAuth({ restored: null });
  api.signInAnonymously = async () => {
    throw new Error('sin red');
  };
  await assert.rejects(() => ensureSignedIn({}, api), /sin red/);
});

test('un error del propio listener se propaga y también se desuscribe', async () => {
  let unsubscribed = 0;
  const api = {
    onAuthStateChanged(auth, next, onError) {
      queueMicrotask(() => onError(new Error('auth rota')));
      return () => {
        unsubscribed++;
      };
    },
    async signInAnonymously() {
      throw new Error('no debería llegar aquí');
    },
  };
  await assert.rejects(() => ensureSignedIn({}, api), /auth rota/);
  assert.equal(unsubscribed, 1);
});
