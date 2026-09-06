// Arranque de sesión: decidir con qué usuario entra la app.
//
// Vive fuera de firestore-store.js para poder probarlo en Node: ese fichero
// importa el SDK de Firebase desde gstatic y no se puede cargar sin
// navegador, así que las dos funciones del SDK que hacen falta se pasan
// como argumento.

/**
 * ensureSignedIn(auth, { onAuthStateChanged, signInAnonymously })
 *   -> Promise<user>
 *
 * Reutiliza la sesión guardada del arranque anterior, sea anónima o con
 * Google, y solo crea un usuario anónimo nuevo si no hay ninguna.
 *
 * ⚠️ Aquí hubo un fallo serio en producción: esto llamaba a
 * `signInAnonymously(auth)` SIEMPRE, en paralelo a `onAuthStateChanged`. Y
 * `signInAnonymously` solo reutiliza al usuario actual si es anónimo — si es
 * uno con Google vinculado, crea uno anónimo NUEVO y tira la sesión de
 * Google por la borda. Consecuencias, las dos que se vieron:
 *
 *   1. cada arranque en frío pedía volver a entrar con Google;
 *   2. y como el uid era nuevo, los tableros en los que ya habías entrado
 *      volvían a pedir el nombre (tu fila vive en `responses/{uid}`).
 *
 * La clave es que `onAuthStateChanged` emite su primer evento también
 * cuando NO hay sesión que restaurar (con `user === null`), así que se puede
 * esperar a ese primer evento y decidir con la respuesta en la mano, sin
 * adelantarse.
 */
export function ensureSignedIn(auth, { onAuthStateChanged, signInAnonymously }) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        if (user) {
          resolve(user);
          return;
        }
        signInAnonymously(auth).then((cred) => resolve(cred.user), reject);
      },
      (err) => {
        unsubscribe();
        reject(err);
      }
    );
  });
}
