# Tablero de disponibilidad para viajes en grupo

Web para que un grupo decida cuándo hacer un viaje: cada persona marca su
disponibilidad día a día sobre un calendario y la app calcula sola cuál es
la mejor ventana de días consecutivos para todo el grupo.

> El desarrollo completo de esta versión está documentado fase a fase en
> [`PLAN-DESARROLLO.md`](./PLAN-DESARROLLO.md). Este README es el resumen
> para quien solo quiere usar o desplegar la app; el plan es la referencia
> técnica completa (arquitectura, modelo de datos, reglas de seguridad,
> protocolo de trabajo).

## Qué hace

- **Tableros sueltos o dentro de un grupo.** Un tablero suelto es un enlace
  de usar y tirar. Un grupo ("Los de siempre") es un enlace permanente:
  quien ya es miembro entra a cualquier viaje nuevo del grupo con su
  nombre ya puesto, sin volver a presentarse.
- **4 estados de disponibilidad por día**: disponible (verde), parcial
  (amarillo), no disponible (rojo) y no definido/sin marcar (gris, el
  estado por defecto).
- **Cálculo automático de la mejor ventana** de N días consecutivos
  (duración del viaje) según la disponibilidad agregada del grupo, más las
  2 siguientes mejores ventanas alternativas (no solapadas con la
  principal).
- **Marcar varios días a la vez**: arrastra el ratón sobre el calendario
  para pintar un rango entero con un solo estado, en vez de ir día a día
  (en móvil se sigue tocando casilla a casilla).
- **Ponderar participantes**: el creador del tablero puede marcar a
  alguien como "cuenta doble" en la puntuación (por ejemplo, la persona
  sin la que el viaje no tiene sentido).
- **Identidad sin fricción, en 3 niveles**: anónimo (automático), con
  perfil (solo escribes tu nombre una vez) y, opcionalmente, con cuenta de
  Google para tener tus viajes en todos tus dispositivos. Nunca hace falta
  registrarse para responder a un tablero.
- **Tiempo real**: los cambios de cualquier participante se ven al
  instante en el navegador de los demás.

## Cómo funciona (flujo de usuario)

1. Desde el inicio, **crear un viaje suelto** o **crear un grupo**.
2. Compartir el enlace. Cada persona entra, escribe su nombre (o entra con
   Google) y marca su disponibilidad día a día sobre el calendario
   (clic para ciclar entre los 4 estados).
3. La app resalta la ventana de días con mejor puntuación agregada y
   muestra quién falta por responder (en tableros de grupo).

## Ejecutar en local

Requiere Node ≥ 20. Sin dependencias de build ni framework (HTML + CSS +
JS vanilla con ES Modules).

```bash
npm install   # solo instala http-server, el servidor estático de desarrollo
npm test      # corre los tests del núcleo puro (node:test)
npm run serve # sirve app/ en http://localhost:8080
```

Por defecto la app usa el backend de Firestore configurado en
`app/js/config.js`. Para probar sin conexión ni proyecto de Firebase, con
todo guardado en el navegador (`localStorage`), añade `?store=local` a la
URL: `http://localhost:8080?store=local`. Es también la forma de simular
varias personas abriendo pestañas del mismo navegador (el propio backend
local implementa "tiempo real" con el evento `storage`).

## Desplegar

La app se publica en GitHub Pages vía GitHub Actions
(`.github/workflows/pages.yml`, publica el contenido de `app/`).

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub
   Actions** (no "Deploy from a branch").
2. Cualquier push a `main` que toque `tablero-viaje-grupal/app/` dispara el
   despliegue.
3. La URL será `https://<usuario>.github.io/<repo>/`.

## Configurar Firebase

La app necesita un proyecto de Firebase (Firestore + Authentication) para
funcionar con datos reales y compartidos entre dispositivos.

1. [Consola de Firebase](https://console.firebase.google.com) → crear
   proyecto → **Firestore Database** (modo producción, región `eur3` o la
   que prefieras — no se puede cambiar después) → **Authentication →
   Sign-in method** → habilitar **Anónimo** y **Google**.
2. **Configuración del proyecto → Tus aplicaciones → `</>` (Web)** → copiar
   el objeto `firebaseConfig` y pegarlo en `app/js/config.js`, con
   `backend: 'firestore'`. Esta config es pública por diseño (viaja en el
   JS del navegador); la seguridad la dan las reglas de Firestore, no
   ocultar estas claves.
3. Publicar las reglas del repo (`firestore.rules`) en **Firestore
   Database → Reglas** (copiar y pegar) o vía `firebase deploy --only
   firestore:rules` con el [Firebase CLI](https://firebase.google.com/docs/cli).
4. **Authentication → Settings → Dominios autorizados** → añadir el
   dominio de GitHub Pages (si no, el login con Google falla en
   producción con `auth/unauthorized-domain`; el anónimo funciona igual).
5. (Opcional, recomendado) restringir la API key de Firebase a tu dominio
   de Pages y a `localhost` en [Google Cloud Console → Credenciales](https://console.cloud.google.com/apis/credentials).
6. (Opcional) borrado automático de tableros sin actividad: **Firestore
   Database → pestaña TTL → Crear política** sobre la colección `boards`,
   campo `expiresAt`. La app ya escribe ese campo (8 meses desde la
   creación o desde la última respuesta); sin esta política, simplemente
   no se borra nada.

## Modelo de datos (Firestore)

```
users/{uid}                          perfil privado: displayName
users/{uid}/boards/{boardId}         índice "mis viajes"
users/{uid}/groups/{groupId}         índice "mis grupos"

groups/{groupId}                     name, ownerUid
groups/{groupId}/members/{uid}       name, joinedAt

boards/{boardId}                     tripName, startDate, endDate,
                                      tripLength, groupId (o null), ownerUid,
                                      expiresAt (borrado automático), weights (ponderar)
boards/{boardId}/responses/{uid}     name, days: { "YYYY-MM-DD": estado }
```

Estados de `days`: `"full"` (disponible), `"partial"`, `"unavailable"` (no
disponible explícito) o ausente/`"none"` (no definido, el valor por
defecto — solo se guardan los días distintos de `none`, para ahorrar
espacio). `none` y `unavailable` puntúan igual en el algoritmo; la
diferencia es solo de cara al usuario, para poder marcar "ya sé que no
puedo" en vez de dejarlo en blanco.

Detalle completo (por qué cada campo, límites, índices denormalizados) en
`PLAN-DESARROLLO.md`, sección 3.

## Algoritmo de puntuación

- `full` = 1 punto, `partial` = 0.5, `unavailable`/`none` = 0.
- Para cada día del rango se suman los puntos de todos los participantes.
- Se recorre el rango con una ventana deslizante de `tripLength` días
  consecutivos y se elige la de mayor suma total.
- Desempate: 1) más respuestas "disponible completo" dentro de la
  ventana, 2) menos respuestas "no disponible" (`unavailable`).

Implementado en JS puro y testeado en `app/js/core/scoring.js` /
`test/scoring.test.js`, junto con el resto del núcleo (`dates.js`,
`ids.js`) libre de dependencias del DOM o de Firebase.

## Estructura del proyecto

```
app/                    lo que se publica en GitHub Pages
  js/core/              lógica pura y testeada (fechas, puntuación, ids)
  js/data/              interfaz de almacenamiento + adaptadores
                        (local-store.js para desarrollo, firestore-store.js
                        para producción — mismo contrato en ambos)
  js/ui/                vistas: inicio, crear tablero, unirse, tablero,
                        grupo
test/                   tests del núcleo puro (node:test, sin dependencias)
firestore.rules         reglas de seguridad versionadas
.github/workflows/      CI (tests) y despliegue a GitHub Pages
```

## Prototipo histórico

`prototipo/tablero-disponibilidad-viaje.html` es el Claude Artifact
original a partir del cual se diseñó esta app. Se conserva como referencia
de la paleta, tipografías e interacción originales, pero **no es
funcional fuera de Artifacts de Claude.ai** (depende de una API
`window.storage` que no existe en un navegador normal) y su modelo de
datos —un único tablero, sin grupos ni identidad— quedó sustituido por el
descrito arriba. No se mantiene ni se actualiza.
