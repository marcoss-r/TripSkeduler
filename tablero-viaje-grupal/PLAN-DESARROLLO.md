# Plan de desarrollo — Tablero de disponibilidad para viajes en grupo

> **Documento de trabajo para Claude Sonnet.**
> Léelo entero antes de empezar. Ejecuta las fases **en orden**. Cuando
> llegues a un bloque `⛔ STOP`, **para y no continúes** hasta que Marcos
> confirme que ha hecho la acción.

---

## 0. Estado actual del repositorio

```
tablero-viaje-grupal/
├── README.md                                  # visión, modelo de datos, algoritmo
└── prototipo/
    └── tablero-disponibilidad-viaje.html      # prototipo de 314 líneas (Claude Artifact)
```

No hay código de aplicación, ni build, ni tests, ni despliegue. El prototipo
es un único HTML con CSS + JS inline que depende de `window.storage`, una API
que **solo existe dentro de Artifacts de Claude.ai** y que no funciona en un
navegador normal.

> ⚠️ El README describe la versión original (un solo tablero, sin grupos ni
> identidad). **Este documento manda sobre el README** donde se contradigan.
> El README se actualizará en la Fase 11.

### Qué se reutiliza del prototipo

| Elemento | Reutilización |
|---|---|
| Paleta, tipografías, layout, animaciones | **Íntegra** (copiar el `<style>` tal cual a `styles.css`) |
| `computeScores` / `bestWindow` | **Íntegra**, moviéndolas a un módulo puro y testeable |
| `dateRangeArray`, `weekdayShort`, `monthShort` | Íntegras **salvo un bug** (ver abajo) |
| Vistas `renderSetup` / `renderJoin` / `renderBoard` | Estructura HTML sí; hay que refactorizar a módulos |
| `window.storage` (get/set/list/delete) | **Se tira entera** y se sustituye por una interfaz propia |
| `setInterval` de 8 s | Se sustituye por `onSnapshot` (tiempo real de verdad) |
| Identidad por nombre (`resp:<nombre>`) | **Se tira**: la identidad pasa a ser el `uid` (ver sección 1.1) |

### 🐞 Bug conocido a corregir en Fase 1

```js
function fmtDate(d){ return d.toISOString().slice(0,10); }
```

`parseDate` construye fechas en **hora local**, pero `fmtDate` las serializa
en **UTC**. En España (UTC+1/+2) `new Date(2026,6,10)` → `2026-07-09T22:00Z`
→ devuelve `"2026-07-09"`, **un día menos**. Esto desplaza todo el rango de
fechas y la ventana calculada. Hay que formatear con componentes locales:

```js
const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
```

Este bug debe quedar **cubierto por un test de regresión** en dos zonas horarias.

---

## 1. Decisiones de arquitectura (ya tomadas — no las replantees)

| Decisión | Elección | Motivo |
|---|---|---|
| Backend | **Firebase Firestore** | Recomendación del README; capa gratuita sobrada; tiempo real nativo |
| Identidad | **Auth anónima + vinculación opcional a Google** | Cero fricción para quien solo responde; continuidad real para quien organiza |
| Agrupación | **Grupos con enlace permanente**, tableros opcionalmente dentro de un grupo | "Los de siempre" → varios viajes sin reescribir nombres |
| Frontend | **HTML + CSS + JS vanilla con ES Modules** | Sin bundler → despliegue trivial en GitHub Pages, cero mantenimiento |
| SDK Firebase | Import ESM desde `gstatic.com`, versión fijada | Sin `npm install` en runtime, sin build step |
| Hosting | **GitHub Pages vía GitHub Actions** | Gratis; el workflow permite publicar una subcarpeta sin reestructurar el repo |
| Tests | **`node:test` nativo (Node 20+)** | Cero dependencias; solo se testea el núcleo puro |
| Idioma de la UI | **Español** | Igual que el prototipo |
| URLs | `?b=<boardId>` tablero · `?g=<groupId>` grupo · sin nada → inicio | IDs aleatorios de 10 chars, no adivinables |

**No introduzcas** React, Vite, Tailwind, TypeScript ni ningún bundler. Si en
algún momento crees que hace falta, para y pregunta en vez de decidirlo solo.

### 1.1 Modelo de identidad (léelo con atención, es lo más delicado)

Tres niveles, y el usuario sube de nivel solo si quiere:

| Nivel | Cómo se consigue | Qué obtiene |
|---|---|---|
| **Anónimo** | Automático al abrir un enlace | Marcar disponibilidad, editar solo su fila. Atado a ese navegador. |
| **Con perfil** | Escribe su nombre una vez | El nombre se recuerda entre tableros; lista privada de "mis viajes". Sigue atado al navegador. |
| **Con cuenta** | Botón "Continuar con Google" (opcional, nunca obligatorio) | Lo mismo, pero **en todos sus dispositivos** y sin perderlo al limpiar el navegador. |

Regla de oro: **nunca se pide registro para responder a un tablero.** El botón
de Google aparece como oferta ("guarda tus viajes"), jamás como muro.

La clave técnica: `linkWithPopup(auth.currentUser, new GoogleAuthProvider())`
**conserva el mismo `uid`**. Es decir, quien ya marcó su disponibilidad como
anónimo y luego vincula Google no pierde nada: sus filas siguen siendo suyas.

**El caso feo, y cómo se evita.** Si alguien ya vinculó Google en el portátil y
en el móvil entra como anónimo y luego intenta vincular la *misma* cuenta,
Firebase falla con `auth/credential-already-in-use` (esa cuenta ya pertenece a
otro `uid`). Mitigación, por orden:

1. **Prevención (es lo que resuelve el 90%)**: en la pantalla de "¿cómo te
   llamas?" ofrecer **"Continuar con Google"** *junto a* "solo escribir mi
   nombre". Quien ya tiene cuenta entra con ella **antes** de crear una fila
   anónima, y nunca se duplica nada.
2. **Fallback**: si aun así ocurre, iniciar sesión con esa cuenta de Google y
   copiar las respuestas del `uid` anónimo a las del `uid` real (el cliente las
   tiene en memoria). La fila anónima huérfana **no se puede borrar sola** —las
   reglas no lo permiten—, así que se avisa al dueño del tablero de que hay un
   duplicado y se le ofrece borrarlo. Documenta esta limitación en el código.

No intentes una fusión automática perfecta. Es un caso raro y el coste de
hacerlo bien no compensa.

---

## 2. Estructura objetivo

```
tablero-viaje-grupal/
├── README.md
├── PLAN-DESARROLLO.md              # este documento
├── package.json                    # solo scripts (test, serve). Sin dependencias.
├── prototipo/
│   └── tablero-disponibilidad-viaje.html
├── app/                            # ← lo que se publica en GitHub Pages
│   ├── index.html
│   ├── 404.html
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── main.js                 # bootstrap + router
│       ├── config.js               # config pública de Firebase
│       ├── core/
│       │   ├── dates.js            # puro: rangos, formateo, parseo
│       │   ├── scoring.js          # puro: computeScores, bestWindow, topWindows
│       │   └── ids.js              # puro: generación de ids no adivinables
│       ├── data/
│       │   ├── store.js            # fábrica: elige backend según config/flag
│       │   ├── firestore-store.js  # adaptador Firestore + auth
│       │   ├── local-store.js      # adaptador localStorage (dev y offline)
│       │   └── auth.js             # anónimo, vinculación Google, perfil
│       └── ui/
│           ├── view-home.js        # "mis viajes" + "mis grupos" + crear
│           ├── view-setup.js       # crear tablero
│           ├── view-join.js        # nombre o Google
│           ├── view-board.js       # calendario (meses/semanas) + mejor ventana
│           ├── view-group.js       # grupo: miembros + viajes del grupo
│           └── components.js       # el(), toasts, estados de carga/error
├── test/
│   ├── dates.test.js
│   ├── scoring.test.js
│   └── ids.test.js
├── firestore.rules                 # reglas versionadas en el repo
└── .github/workflows/
    ├── ci.yml                      # corre los tests en cada push
    └── pages.yml                   # despliega app/ a GitHub Pages
```

> `.github/workflows/` va en la **raíz del repositorio**, no dentro de
> `tablero-viaje-grupal/`. GitHub solo lee workflows de la raíz.

---

## 3. Modelo de datos en Firestore

```
users/{uid}                              ← perfil, privado
  displayName: string   (1..40)          # nombre por defecto al entrar a tableros
  createdAt:   timestamp

users/{uid}/boards/{boardId}             ← índice privado "mis viajes"
  tripName:  string
  groupId:   string | null
  role:      "owner" | "participant"
  savedAt:   timestamp

users/{uid}/groups/{groupId}             ← índice privado "mis grupos"
  name:     string                       # nombre del grupo, cacheado
  savedAt:  timestamp

groups/{groupId}
  name:      string   (1..60)            # "Los de siempre"
  ownerUid:  string
  createdAt: timestamp

groups/{groupId}/members/{uid}
  name:     string    (1..40)
  joinedAt: timestamp

boards/{boardId}
  tripName:   string   (1..80)
  startDate:  string   "YYYY-MM-DD"
  endDate:    string   "YYYY-MM-DD"
  tripLength: number   (1..30)
  groupId:    string | null              # null = tablero suelto
  ownerUid:   string
  createdAt:  timestamp
  expiresAt:  timestamp                  # borrado automático (backlog); se fija al
                                          # crear y se empuja 8 meses hacia adelante
                                          # con cada respuesta guardada — ver sección 6, Fase 12
  weights:    map { uid: number } | ausente  # backlog: "cuenta doble"; ausente == 1 para todos

boards/{boardId}/responses/{uid}         ← el docId ES el uid
  name:      string   (1..40)
  days:      map      { "YYYY-MM-DD": "none" | "unavailable" | "partial" | "full" }
             # none = no definido (por defecto, gris) · unavailable = no
             # disponible explícito (rojo) · partial = amarillo · full = verde.
             # "none" y "unavailable" puntúan igual (0); la diferencia es de
             # cara al usuario, no del algoritmo.
  updatedAt: timestamp
```

Notas de diseño:

- **`docId == uid`** en `responses` y en `members`: cada persona solo puede
  escribir su propia fila y las reglas lo verifican sin lógica extra.
- **El nombre es un campo, no la clave** (a diferencia del prototipo). Así se
  puede renombrar sin duplicar filas y dos "Ana" no se pisan.
- Solo se guardan los días **distintos de `none`**; `none` es el valor por
  defecto al leer. Ahorra escrituras y tamaño de documento.
- `users/{uid}/boards` y `users/{uid}/groups` son **índices denormalizados**:
  se escriben al crear/unirse a un tablero o grupo. Si se quedan
  desincronizados (p. ej. el tablero se borró), la vista lo ignora en
  silencio; no son fuente de verdad.
- IDs: 10 caracteres de `abcdefghijkmnopqrstuvwxyz23456789` (sin caracteres
  ambiguos) generados con `crypto.getRandomValues`. **Comprueba que no existe
  antes de crear.**
- Límites: rango ≤ 180 días, participantes ≤ 50, miembros de grupo ≤ 50,
  tableros por grupo ≤ 50.

---

## 4. Reglas de seguridad (implementar tal cual en `firestore.rules`)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function me() { return request.auth.uid; }
    function str(v, min, max) {
      return v is string && v.size() >= min && v.size() <= max;
    }
    function isDate(v) {
      return v is string && v.matches('^\\d{4}-\\d{2}-\\d{2}$');
    }
    function isGroupMember(groupId) {
      return exists(/databases/$(database)/documents/groups/$(groupId)/members/$(me()));
    }
    function isGroupOwner(groupId) {
      return get(/databases/$(database)/documents/groups/$(groupId)).data.ownerUid == me();
    }

    // --- Perfil privado e índices "mis viajes" / "mis grupos" ---------------
    match /users/{uid} {
      allow read, write: if isSignedIn() && me() == uid;
      match /boards/{boardId} {
        allow read, write: if isSignedIn() && me() == uid;
      }
      match /groups/{groupId} {
        allow read, write: if isSignedIn() && me() == uid;
      }
    }

    // --- Grupos ------------------------------------------------------------
    match /groups/{groupId} {
      // `get` (leer un grupo cuyo id ya conoces) es público: el enlace es la
      // credencial. `list` no: `allow read` cubre TAMBIÉN las consultas a la
      // colección entera, así que un `read: if true` sin más dejaba volcar
      // todos los grupos existentes sin conocer ningún enlace. La app nunca
      // consulta la colección `groups` entera (usa el índice privado
      // users/{uid}/groups), así que `list` se deniega sin más.
      allow get: if true;
      allow list: if false;

      allow create: if isSignedIn()
        && request.resource.data.keys().hasOnly(['name','ownerUid','createdAt'])
        && str(request.resource.data.name, 1, 60)
        && request.resource.data.ownerUid == me();

      allow update, delete: if isSignedIn() && resource.data.ownerUid == me();

      match /members/{uid} {
        allow read: if true;
        allow write: if isSignedIn()
          && me() == uid
          && request.resource.data.keys().hasOnly(['name','joinedAt'])
          && str(request.resource.data.name, 1, 40);
        allow delete: if isSignedIn() && (me() == uid || isGroupOwner(groupId));
      }
    }

    // --- Tableros ----------------------------------------------------------
    match /boards/{boardId} {
      // Mismo razonamiento que en /groups: `get` público, `list` restringido
      // a quien ya es miembro del grupo del tablero (la única consulta real
      // de la app sobre esta colección). Los tableros sueltos (groupId ==
      // null) no son listables nunca, solo accesibles por enlace directo.
      allow get: if true;
      allow list: if isSignedIn() && isGroupMember(resource.data.groupId);

      allow create: if isSignedIn()
        && request.resource.data.keys().hasOnly(
             ['tripName','startDate','endDate','tripLength','groupId','ownerUid','createdAt','expiresAt','weights'])
        && str(request.resource.data.tripName, 1, 80)
        && isDate(request.resource.data.startDate)
        && isDate(request.resource.data.endDate)
        && request.resource.data.startDate <= request.resource.data.endDate
        && request.resource.data.tripLength is int
        && request.resource.data.tripLength >= 1
        && request.resource.data.tripLength <= 30
        && request.resource.data.ownerUid == me()
        && (request.resource.data.groupId == null
            || isGroupMember(request.resource.data.groupId));

      // El dueño edita cualquier campo (nombre/fechas, Fase 5; `weights`,
      // backlog Fase 12). Cualquier persona autenticada puede, además,
      // EXCLUSIVAMENTE empujar `expiresAt` hacia delante — así se marca
      // "actividad" para el TTL sin que solo el dueño pueda mantener vivo
      // su propio tablero. El `> request.time` es imprescindible: sin él,
      // cualquiera con el enlace podría poner `expiresAt` en el pasado y
      // provocar que el TTL de Firestore borrase el tablero de otra persona.
      allow update: if isSignedIn() && (
        resource.data.ownerUid == me()
        || (
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(['expiresAt'])
          && request.resource.data.expiresAt is timestamp
          && request.resource.data.expiresAt > request.time
        )
      );
      allow delete: if isSignedIn() && resource.data.ownerUid == me();

      match /responses/{uid} {
        allow read: if true;

        allow write: if isSignedIn()
          && me() == uid
          && request.resource.data.keys().hasOnly(['name','days','updatedAt'])
          && str(request.resource.data.name, 1, 40)
          && request.resource.data.days is map
          && request.resource.data.days.size() <= 180;

        allow delete: if isSignedIn()
          && (me() == uid
              || get(/databases/$(database)/documents/boards/$(boardId)).data.ownerUid == me());
      }
    }
  }
}
```

Dos limitaciones aceptadas, documéntalas en el código:

1. Las reglas no validan los **valores** del mapa `days` uno a uno de forma
   barata. El enum (`none|unavailable|partial|full`) se valida en cliente. Peor caso: un
   valor basura en un tablero cuyo enlace ya se compartió. Aceptable para un
   grupo cerrado.
2. `get: if true` en grupos y tableros: **el enlace es la credencial**. Quien
   tiene el id, ve. Es el mismo modelo que un Google Doc "con el enlace".
   `list` sí está restringido (ver comentarios arriba): permitir `read` sin
   más también habría permitido volcar la colección entera sin conocer
   ningún enlace, un agujero real que se encontró y cerró en la revisión de
   seguridad de Fase 12.

---

## 5. Protocolo de trabajo para Sonnet

1. **Rama**: trabaja siempre sobre `claude/sonnet-development-plan-r8lllu`
   (o la que indique Marcos). Nunca pushees a `main`.
2. **Un commit por fase como mínimo**, con mensaje descriptivo en español:
   `feat(core): extrae scoring y dates a módulos puros con tests`.
3. **Push al final de cada fase**, no solo al final de todo.
4. **Antes de cerrar una fase**: ejecuta `npm test` y comprueba que pasa. Si la
   fase toca UI, arranca el servidor local y verifica el flujo a mano.
5. **No abras un Pull Request** salvo que Marcos lo pida explícitamente.
6. **Al llegar a un `⛔ STOP`**: para y escribe un mensaje con este formato:

   ```
   ⛔ STOP — ACCIÓN NECESARIA POR TU PARTE (STOP #N)

   Qué necesito que hagas:
     1. ...

   Qué necesito que me devuelvas:
     - ...

   Estado: fases 0–X completadas y pusheadas. Espero tu confirmación
   para continuar con la fase X+1.
   ```

   Y **termina el turno ahí**. No adelantes trabajo de fases posteriores.
7. **No inventes credenciales ni IDs de proyecto Firebase.** Si te falta un
   dato de configuración, es un STOP, no una suposición.
8. Si una decisión de este plan choca con la realidad del código, **dilo y
   propón** en vez de improvisar en silencio.

---

## 6. Fases

### Fase 0 — Andamiaje del repositorio
*Sin STOP.*

- Crear la estructura de carpetas de la sección 2 (vacías/placeholder).
- `package.json` sin dependencias:
  ```json
  {
    "name": "tablero-viaje-grupal",
    "private": true,
    "type": "module",
    "scripts": {
      "test": "node --test test/",
      "serve": "python3 -m http.server 8080 --directory app"
    },
    "engines": { "node": ">=20" }
  }
  ```
- `.gitignore` (node_modules, .DS_Store, .firebase/, *.log).
- `.github/workflows/ci.yml`: Node 20, `npm test` en push y PR, ejecutado con
  `TZ=Europe/Madrid` **y** con `TZ=America/New_York` (matriz).

**Aceptación**: `npm test` corre y el CI aparece en verde en GitHub.

---

### Fase 1 — Núcleo puro y testeado
*Sin STOP.*

- `core/dates.js`: `fmtDate` (**corregido**), `parseDate`, `addDays`,
  `dateRangeArray` (tope 180), `weekdayShort`, `monthShort`, `dayNum`,
  `isValidRange`, `mondayIndex` (posición L=0…D=6, para alinear un
  calendario real) y `groupByMonth` (agrupa el rango en bloques por mes,
  para pintar un bloque de calendario por mes en vez de una tira de días).
- `core/scoring.js`: `computeScores` y `bestWindow` del prototipo, más
  `topWindows(dates, scores, breakdown, length, n=3)` → las N mejores ventanas
  **no solapadas** (se usa en la Fase 12; hazla ya porque el desempate es la
  parte delicada).
- `core/ids.js`: `newId(len=10)` con `crypto.getRandomValues` sobre el alfabeto
  sin caracteres ambiguos.
- Tests: regresión del bug de zona horaria; puntuación; ventana ganadora; los
  dos criterios de desempate; rango < `tripLength` → `null`; cero
  participantes; distribución y longitud de `newId`.

**Aceptación**: `npm test` verde con ≥ 20 asserts; los módulos no importan nada
del DOM ni de Firebase.

---

### Fase 2 — Interfaz de almacenamiento + backend local
*Sin STOP.*

Interfaz que ambos backends implementarán (`data/store.js`):

```js
// --- identidad y perfil
getMyId()                                  -> Promise<string>
getProfile()                               -> Promise<{displayName}|null>
saveProfile({displayName})                 -> Promise<void>

// --- tableros
createBoard(config)                        -> Promise<boardId>
getBoard(boardId)                          -> Promise<config|null>
updateBoard(boardId, patch)                -> Promise<void>
deleteBoard(boardId)                       -> Promise<void>
subscribeResponses(boardId, cb)            -> unsubscribe()
saveMyResponse(boardId, {name, days})      -> Promise<void>
deleteResponse(boardId, uid)               -> Promise<void>

// --- índice "mis viajes"
listMyBoards()                             -> Promise<Array>
rememberBoard(boardId, meta)               -> Promise<void>
forgetBoard(boardId)                       -> Promise<void>

// --- grupos
createGroup({name})                        -> Promise<groupId>
getGroup(groupId)                          -> Promise<group|null>
joinGroup(groupId, {name})                 -> Promise<void>
leaveGroup(groupId)                        -> Promise<void>
subscribeMembers(groupId, cb)              -> unsubscribe()
listGroupBoards(groupId)                   -> Promise<Array>
listMyGroups()                             -> Promise<Array>
```

- `local-store.js`: implementación **completa** de todo lo anterior sobre
  `localStorage`. `subscribe*` emite al suscribirse y en el evento `storage`
  → se puede probar el multiusuario con dos pestañas.
- `store.js`: elige backend según `config.js` (`backend: 'local' | 'firestore'`)
  o el parámetro de URL `?store=local` para depurar.

> Implementa la interfaz **entera** ahora aunque grupos y perfil no tengan UI
> hasta las fases 8–10. Así el adaptador de Firestore se escribe una sola vez.

**Aceptación**: desde la consola del navegador se puede crear un tablero, un
grupo, unirse y guardar respuestas, sin Firebase.

---

### Fase 3 — Aplicación completa sobre el backend local
*Termina en `⛔ STOP #1` (revisión de UI).*

Solo el flujo de **tablero suelto** (sin grupos ni "mis viajes" todavía).

- `index.html` + `css/styles.css` con el CSS del prototipo **tal cual**.
- Router en `main.js`: `?b=<id>` → tablero (o "tablero no encontrado");
  sin parámetros → crear tablero.
- `view-setup.js`: formulario del prototipo + validaciones (`endDate >=
  startDate`, rango ≤ 180 días, `tripLength ≤` días del rango). Al crear →
  redirige a `?b=<id>` y muestra la **pantalla de compartir** con el enlace y
  botón "Copiar enlace".
- `view-join.js`: pedir nombre; recordarlo en el perfil local.
- `view-board.js`: **calendario real** (no una tira de casillas en fila —
  la v1 de esta fase se hizo así y resultó ilegible pasadas 2-3 semanas e
  inusable en móvil; se corrigió tras probarlo). Un bloque por mes, semana
  de lunes a domingo en rejilla de 7 columnas (`core/dates.js` expone
  `groupByMonth` y `mondayIndex` para esto). Cada casilla es a la vez la
  edición de mi disponibilidad (color = mi estado, clic para ciclar) y un
  vistazo al grupo (badge con la puntuación agregada, borde si cae en la
  mejor ventana); el detalle por persona va aparte en una lista compacta
  bajo el calendario (nombre + nº de días disponible/parcial), no en un
  calendario por participante — eso no escala con grupos grandes ni con
  180 días. Además:
  - **Móvil**: no requiere un layout distinto del de escritorio — al ser
    siempre 7 columnas, la rejilla cabe en cualquier ancho sin scroll
    horizontal, con 5 días o con 180.
  - **Accesibilidad**: cada casilla es un `<button>` real con `aria-label`
    ("12 de julio: tú — disponible. Grupo: 3 completa · 1 parcial..."), no
    un `div` con `tabindex`.
  - **Estados**: cargando, error de red, tablero vacío, guardando (optimista).
  - **Escrituras**: debounce ~400 ms para agrupar clics rápidos en un solo
    `saveMyResponse`.
  - Fuera el enlace "Restablecer tablero" del pie: pasa a ser acción exclusiva
    del creador (Fase 5).

**Aceptación**: con `?store=local`, dos pestañas se ven mutuamente en tiempo
real y la mejor ventana se recalcula al vuelo.

```
⛔ STOP #1 — Revisión de UI
```
Pushea y pide a Marcos que abra la app en local (`npm run serve` →
http://localhost:8080) y confirme diseño y flujo antes de conectar Firebase.
Si prefiere no revisar, se puede saltar — **pregúntalo, no lo asumas**.

---

### Fase 4 — Alta de Firebase
*Esta fase **es** un STOP. Sonnet no puede hacerla.*

```
⛔ STOP #2 — BLOQUEANTE: crear el proyecto Firebase
```
Instrucciones en la sección 7, acción **A1**. Sin el `firebaseConfig` no se
continúa.

---

### Fase 5 — Adaptador Firestore + tiempo real
*Sin STOP.*

- `config.js` con el `firebaseConfig` de Marcos y `backend: 'firestore'`.
  (Esta config es **pública por diseño**; la seguridad la dan las reglas. Se
  commitea.)
- `data/auth.js`: `signInAnonymously` al arrancar, `onAuthStateChanged`,
  `getMyId()`. La vinculación con Google llega en la Fase 10 — deja el hueco.
- `firestore-store.js`: implementa la interfaz de la Fase 2 completa.
  - Imports ESM desde `https://www.gstatic.com/firebasejs/10.14.1/…`
    (**versión fijada**, nunca `latest`).
  - `subscribeResponses` / `subscribeMembers` con `onSnapshot` → **fuera el
    `setInterval` de 8 s**.
  - Persistencia offline (`persistentLocalCache`) para aguantar cortes de red.
  - Errores: sin red → banner "sin conexión, reintentando"; `permission-denied`
    → mensaje claro, nunca un `alert` genérico.
- Acciones de creador (visibles solo si `ownerUid === miUid`): editar nombre y
  fechas, borrar un participante, borrar el tablero (con confirmación doble).

**Aceptación**: dos navegadores distintos (uno en incógnito) ven los cambios
del otro en < 2 s sin recargar.

---

### Fase 6 — Reglas de seguridad en producción
*Termina en `⛔ STOP #3` (bloqueante).*

- `firestore.rules` en el repo con el contenido de la sección 4.
- Documentar en el README cómo publicarlas.
- Checklist de verificación manual: desde la consola, intentar escribir la fila
  de otro participante → debe fallar con `permission-denied`. Intentar leer
  `users/{otroUid}` → debe fallar.

```
⛔ STOP #3 — BLOQUEANTE: publicar las reglas y restringir la API key
```
Acciones **A2** y **A3**. Sonnet no puede desplegar reglas (requiere login
interactivo de Firebase CLI).

---

### Fase 7 — Despliegue en GitHub Pages
*Termina en `⛔ STOP #4` (bloqueante).*

Se despliega **antes** de grupos y cuentas: así hay algo usable en producción
cuanto antes y las fases siguientes se validan sobre la app real.

- `.github/workflows/pages.yml`:
  ```yaml
  name: Deploy to GitHub Pages
  on:
    push:
      branches: [main]
    workflow_dispatch:
  permissions:
    contents: read
    pages: write
    id-token: write
  concurrency:
    group: pages
    cancel-in-progress: true
  jobs:
    deploy:
      environment:
        name: github-pages
        url: ${{ steps.deployment.outputs.page_url }}
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/configure-pages@v5
        - uses: actions/upload-pages-artifact@v3
          with:
            path: tablero-viaje-grupal/app
        - id: deployment
          uses: actions/deploy-pages@v4
  ```
- `app/404.html` que redirija a `index.html` conservando la query string.
- Verificar que **no hay rutas absolutas** (`/css/...`): todo relativo, porque
  Pages sirve bajo `/TripSkeduler/`.

```
⛔ STOP #4 — BLOQUEANTE: activar GitHub Pages
```
Acciones **A4** (activar Pages) y **A5** (autorizar el dominio en Firebase
Auth; sin esto la auth falla en producción con `auth/unauthorized-domain`).

---

### Fase 8 — Perfil y "mis viajes"
*Sin STOP.*

- `users/{uid}` con `displayName`: al escribir el nombre por primera vez se
  guarda y se prerrellena en todos los tableros siguientes.
- `users/{uid}/boards`: se escribe al crear un tablero y al unirse a uno.
- `view-home.js`: pantalla de inicio con "Mis viajes" (los que creaste y
  aquellos a los que respondiste), y botones "Crear viaje" / "Crear grupo".
- Quitar de la lista los tableros borrados, sin ruido.
- Aviso honesto en la pantalla de inicio: *"Estos viajes se guardan en este
  navegador. Entra con Google para tenerlos en todos tus dispositivos."* (el
  botón llega en la Fase 10; hasta entonces, solo el aviso).

**Aceptación**: creas dos tableros, cierras y vuelves a abrir el navegador, y
los dos siguen en "Mis viajes" con tu nombre ya puesto.

---

### Fase 9 — Grupos
*Sin STOP.*

- `view-group.js` en `?g=<groupId>`: nombre del grupo, lista de miembros,
  lista de viajes del grupo, botón "Crear viaje con este grupo".
- Crear grupo desde la home. Enlace permanente + botón "Copiar enlace".
- Unirse: al abrir `?g=` sin ser miembro → pedir nombre (prerrellenado desde el
  perfil) → alta en `groups/{id}/members/{uid}`.
- Crear un tablero **dentro** de un grupo: hereda `groupId`, y en el tablero
  cada miembro aparece con su nombre del grupo ya puesto **sin necesidad de
  pasar por la pantalla de "¿cómo te llamas?"**. Esa es la razón de ser de todo
  esto: el segundo viaje del grupo es un clic.
- Un tablero de grupo muestra **quién falta por responder** (miembros del grupo
  sin fila en `responses`).
- Salir del grupo; el dueño puede expulsar a un miembro y renombrar el grupo.

**Aceptación**: creas "Los de siempre", entran 3 personas, creas "Viaje a
Estocolmo" dentro del grupo y las 3 aparecen listadas en el tablero desde el
primer momento, con su nombre, marcadas como "pendiente de responder".

---

### Fase 10 — Cuenta opcional con Google
*Sin STOP (el proveedor ya quedó habilitado en A1).*

- Botón **"Continuar con Google"** en dos sitios:
  1. Pantalla de "¿cómo te llamas?", **junto a** la opción de solo escribir el
     nombre (nunca en lugar de ella). Esto es lo que previene los duplicados.
  2. Pantalla de inicio, como "guarda tus viajes en todos tus dispositivos".
- `linkWithPopup` sobre el usuario anónimo → **mismo `uid`**, no se pierde nada.
- Manejo explícito de `auth/credential-already-in-use` según la sección 1.1:
  iniciar sesión con la cuenta existente, copiar respuestas en memoria, avisar
  del posible duplicado. Con comentario en el código explicando la limitación.
- Manejo de `auth/popup-blocked` → fallback a `signInWithRedirect`.
- Cerrar sesión → vuelve a anónimo limpio.
- Si el perfil ya tiene `displayName`, no se pisa con el nombre de Google sin
  preguntar.

**Aceptación**: marcas disponibilidad como anónimo, vinculas Google, y tus
filas y tus viajes siguen ahí. Abres la app en otro navegador, entras con
Google, y ves los mismos viajes y grupos.

---

### Fase 11 — Pruebas reales y pulido
*Termina en `⛔ STOP #5`.*

- QA manual: móvil real (iOS y Android), rango de 90 días, 8+ participantes,
  nombres con emoji y acentos, dos pestañas simultáneas, modo avión y vuelta,
  grupo con 2 viajes, vincular Google desde un segundo dispositivo.
- `<meta>` de Open Graph para que el enlace se vea decente en WhatsApp.
- Lighthouse: accesibilidad ≥ 95.
- **Actualizar `README.md`**: modelo de datos real (grupos e identidad
  incluidos), cómo desplegar, cómo configurar Firebase, cómo correr los tests,
  y marcar el prototipo como histórico.

```
⛔ STOP #5 — Validación con el grupo real
```
Acción **A6**.

---

### Fase 12 — Backlog (solo bajo petición explícita)

No lo hagas por iniciativa propia salvo que se pida explícitamente (como
ocurrió con los 4 primeros ítems, ya hechos):

- ✅ Top-3 ventanas alternativas (`topWindows` + sección "Otras ventanas
  posibles" bajo la mejor ventana, en `view-board.js`).
- ✅ "Marcar rango" arrastrando en vez de clic día a día (mousedown +
  mouseenter + mouseup global sobre el calendario; solo ratón — en móvil
  se sigue tocando día a día).
- ✅ Ponderar participantes: el dueño marca a alguien como "cuenta doble"
  (`boards/{id}.weights`); afecta solo a `computeScores`, nunca al
  desglose de disponibilidad por persona.
- ✅ Borrado automático de tableros sin actividad — implementado como TTL
  de Firestore, no como código propio: `boards/{id}.expiresAt` se fija al
  crear (8 meses vista) y se empuja otros 8 meses con cada respuesta
  guardada. **Necesita una acción manual de Marcos para activarse de
  verdad** — ver acción **A8** en la sección 7. Sin esa política de TTL
  configurada, el campo se escribe pero no borra nada por sí solo
  (inofensivo, no bloquea nada mientras tanto).
- Exportar la ventana ganadora a `.ics` / Google Calendar.
- Fecha límite de respuesta y recordatorio de quién falta.
- PWA instalable + notificaciones push al grupo.
- Modo claro. i18n es/en.

---

## 7. ⛔ Acciones necesarias por tu parte (Marcos)

Lo único que **no puedo hacer yo**: requiere tu cuenta o tu criterio. En el
orden en que te las voy a pedir. Todo es gratis.

### A1 · Crear el proyecto Firebase → *bloquea la Fase 5*

1. https://console.firebase.google.com → **Añadir proyecto**.
   - Nombre sugerido: `tripskeduler`.
   - **Desactiva Google Analytics** (no hace falta y añade fricción).
2. **Compilación › Firestore Database** → **Crear base de datos**.
   - Modo: **producción** (empieza cerrado; ya abriremos con reglas).
   - Ubicación: **`eur3` (europe-west)** — más cerca, y **no se puede cambiar
     después**.
3. **Compilación › Authentication** → **Comenzar** → pestaña
   **Sign-in method** → habilita **dos** proveedores:
   - **Anónimo** ← imprescindible.
   - **Google** ← para la cuenta opcional de la Fase 10. Te pedirá un "correo
     de asistencia del proyecto": pon el tuyo. Habilítalo ahora aunque no se
     use hasta la Fase 10, así no tienes que volver.
4. Engranaje → **Configuración del proyecto** → *Tus aplicaciones* → icono
   **`</>`** (Web) → apodo `tablero-web`. **No** marques Firebase Hosting.
5. Copia el objeto `firebaseConfig`.

**Lo que necesito que me pegues:**

```js
const firebaseConfig = {
  apiKey: "…",
  authDomain: "…",
  projectId: "…",
  storageBucket: "…",
  messagingSenderId: "…",
  appId: "…"
};
```

> Tranquilo: esta config es pública por diseño en cualquier app web de Firebase
> (va en el JS que descarga el navegador). La seguridad la dan las reglas de
> Firestore (A2), no ocultar estas claves.

---

### A2 · Publicar las reglas de Firestore → *bloquea el uso real*

Te dejaré `firestore.rules` escrito en el repo. Dos opciones:

**Rápida (recomendada, 1 minuto):**
1. Consola → **Firestore Database** → pestaña **Reglas**.
2. Borra lo que haya y pega `tablero-viaje-grupal/firestore.rules`.
3. **Publicar**.

**CLI (si prefieres reproducibilidad):**
```bash
npm i -g firebase-tools
firebase login          # ← requiere navegador, por eso no puedo hacerlo yo
firebase use --add
firebase deploy --only firestore:rules
```

**Confírmame:** "reglas publicadas".

---

### A3 · Restringir la API key (opcional, 2 min)

1. https://console.cloud.google.com/apis/credentials (mismo proyecto).
2. **Browser key (auto created by Firebase)** → editar.
3. *Restricciones de aplicación* → **Sitios web** → añade:
   - `https://marcoss-r.github.io/*`
   - `http://localhost:8080/*`
4. Guardar.

Evita que alguien copie tu clave y consuma tu cuota desde otro dominio.

**Confírmame:** "API key restringida" (o "lo dejo para luego").

---

### A4 · Activar GitHub Pages → *bloquea el despliegue*

1. Repo → **Settings › Pages**.
2. *Build and deployment* → **Source: GitHub Actions**
   (⚠️ **no** "Deploy from a branch" — el workflow usa Actions).
3. URL previsible: `https://marcoss-r.github.io/TripSkeduler/`

**Necesito:** la URL exacta que te muestre GitHub tras el primer despliegue.

---

### A5 · Autorizar el dominio en Firebase Auth → *bloquea la auth en producción*

1. Consola → **Authentication › Settings › Dominios autorizados**.
2. **Añadir dominio** → `marcoss-r.github.io`.

Sin esto la app funciona en `localhost` y falla en producción con
`auth/unauthorized-domain`.

**Confírmame:** "dominio autorizado".

---

### A6 · Probar con el grupo real → *cierra el proyecto*

Crea un grupo de verdad ("Los de siempre"), mete a 4-5 amigos, crea un viaje
dentro y dime:
- ¿Alguien no supo qué hacer sin explicación?
- ¿Se ve bien en su móvil?
- ¿Alguien acabó duplicado en la lista? (es el riesgo conocido, ver 1.1)
- ¿Alguien usó el botón de Google, o todos se quedaron en anónimo?

---

### A7 · Decisiones que puedes cambiar si no te convencen

Ya decididas por defecto. Dímelo **antes de la Fase 4** si quieres otra cosa,
porque después cuesta más:

| Decisión por defecto | Alternativa |
|---|---|
| Firebase Firestore | Supabase (Postgres) — más portable, algo más de setup |
| Cuenta opcional con Google | Login obligatorio (más simple de razonar, mucha más fricción) o solo anónimo |
| Google como único proveedor | Añadir enlace mágico por email (más trabajo, útil si tu grupo no usa Google) |
| El enlace es la única protección | Añadir PIN de 4 dígitos por tablero o por grupo |
| Todo el rango visible con scroll | Vista por semanas/mes con paginación |
| UI solo en español | i18n es/en |

---

### A8 · Activar el borrado automático de tableros (opcional, 2 min)

Backlog Fase 12: `boards/{id}.expiresAt` ya se escribe (8 meses desde la
creación o desde la última respuesta guardada), pero **nada lo borra**
hasta que actives la política de TTL — Firestore no la expone por API,
solo por consola/gcloud, así que esto es cosa tuya:

1. Consola de Firebase → **Firestore Database** → pestaña **TTL** (o
   "Time-to-live" según el idioma de la consola).
2. **Crear política** → colección `boards` → campo `expiresAt`.
3. Guardar.

Firestore revisa y borra los documentos caducados en un plazo de hasta 72
horas tras cumplirse `expiresAt` — no es instantáneo, es normal que un
tablero "caducado" tarde uno o dos días en desaparecer.

**Confírmame:** "TTL activado" (o "lo dejo para luego" — mientras tanto no
pasa nada, los tableros simplemente no caducan).

---

## 8. Resumen de paradas

| # | Fase | Bloqueante | Qué necesito de ti |
|---|---|---|---|
| 1 | Fin de Fase 3 | No | Revisar la UI en local (o delegar) |
| 2 | Fase 4 | **Sí** | `firebaseConfig` + proveedores Anónimo y Google (A1) |
| 3 | Fin de Fase 6 | **Sí** | Publicar reglas (A2) + API key (A3) |
| 4 | Fin de Fase 7 | **Sí** | Activar Pages (A4) + dominio Auth (A5) |
| 5 | Fin de Fase 11 | **Sí** | Probar con el grupo (A6) |
| 6 | Backlog (Fase 12) | No | Activar TTL en Firestore para el borrado automático (A8) — opcional, nada se rompe si no lo haces |

**Fases que Sonnet puede hacer del tirón sin molestarte: 0, 1, 2 y 3.**
Después del STOP #2, también 5–11 salvo los tres STOPs intermedios.

---

## 9. Riesgos y cosas a vigilar

| Riesgo | Mitigación |
|---|---|
| Bug de zona horaria (ya detectado) | Test de regresión en dos TZ en CI (Fase 1) |
| **Misma persona duplicada desde dos dispositivos** | Ofrecer Google **antes** de crear la fila anónima (Fase 10); el dueño puede borrar duplicados |
| **`credential-already-in-use` al vincular Google** | Flujo de fallback documentado en la sección 1.1; no se intenta fusión automática perfecta |
| Perder el navegador = perder los viajes | Aviso explícito en la home + oferta de vincular Google |
| Rutas absolutas rompen bajo `/TripSkeduler/` | Todo relativo; verificar en Fase 7 |
| Escritura por clic → muchas escrituras Firestore | Debounce de 400 ms (Fase 3) |
| Documento `days` crece sin control | Solo se guardan días ≠ `none`; tope 180 |
| `users/{uid}/boards` desincronizado | Es un índice, no fuente de verdad; se ignoran las entradas rotas |
| Reglas con `exists()`/`get()` cuestan lecturas | Solo en `create` de tablero de grupo y en borrados; despreciable |
| Colisión de ids | 10 chars sobre alfabeto de 33 → despreciable; aun así, comprobar existencia antes de crear |
| Enlace filtrado fuera del grupo | Ids no adivinables; PIN opcional en A7 |
| Alguien borra el tablero o el grupo sin querer | Confirmación doble + solo el dueño |
| Cuota gratuita de Firestore | Con `onSnapshot` y grupos pequeños, órdenes de magnitud por debajo del límite |
