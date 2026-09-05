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

### Qué se reutiliza del prototipo

| Elemento | Reutilización |
|---|---|
| Paleta, tipografías, layout, animaciones | **Íntegra** (copiar el `<style>` tal cual a `styles.css`) |
| `computeScores` / `bestWindow` | **Íntegra**, moviéndolas a un módulo puro y testeable |
| `dateRangeArray`, `weekdayShort`, `monthShort` | Íntegras **salvo un bug** (ver abajo) |
| Vistas `renderSetup` / `renderJoin` / `renderBoard` | Estructura HTML sí; hay que refactorizar a módulos |
| `window.storage` (get/set/list/delete) | **Se tira entera** y se sustituye por una interfaz propia |
| `setInterval` de 8 s | Se sustituye por `onSnapshot` (tiempo real de verdad) |

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

Este bug debe quedar **cubierto por un test de regresión**.

---

## 1. Decisiones de arquitectura (ya tomadas — no las replantees)

| Decisión | Elección | Motivo |
|---|---|---|
| Backend | **Firebase Firestore** | Recomendación del README; capa gratuita sobrada; tiempo real nativo |
| Identidad | **Firebase Anonymous Auth** | Única forma de tener reglas de seguridad reales sin pedir registro |
| Frontend | **HTML + CSS + JS vanilla con ES Modules** | Sin bundler → despliegue trivial en GitHub Pages, cero mantenimiento |
| SDK Firebase | Import ESM desde `gstatic.com` | Sin `npm install` en runtime, sin build step |
| Hosting | **GitHub Pages vía GitHub Actions** | Gratis; el workflow permite publicar una subcarpeta sin reestructurar el repo |
| Tests | **`node:test` nativo (Node 20+)** | Cero dependencias; solo se testea el núcleo puro |
| Idioma de la UI | **Español** | Igual que el prototipo |
| Un tablero por URL | `?b=<id>` con id aleatorio de 10 chars | URL-capacidad, sin listado público de tableros |

**No introduzcas** React, Vite, Tailwind, TypeScript ni ningún bundler. Si en
algún momento crees que hace falta, para y pregunta en vez de decidirlo solo.

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
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── main.js                 # bootstrap + router
│       ├── config.js               # config pública de Firebase
│       ├── core/
│       │   ├── dates.js            # puro: rangos, formateo, parseo
│       │   └── scoring.js          # puro: computeScores, bestWindow, topWindows
│       ├── data/
│       │   ├── store.js            # fábrica: elige backend según config/flag
│       │   ├── firestore-store.js  # adaptador Firestore + auth anónima
│       │   └── local-store.js      # adaptador localStorage (dev y offline)
│       └── ui/
│           ├── view-setup.js       # crear tablero
│           ├── view-join.js        # pedir nombre
│           ├── view-board.js       # rejilla + heatmap + mejor ventana
│           └── components.js       # el(), toasts, estados de carga/error
├── test/
│   ├── dates.test.js
│   └── scoring.test.js
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
boards/{boardId}
  tripName:   string   (1..80 chars)
  startDate:  string   "YYYY-MM-DD"
  endDate:    string   "YYYY-MM-DD"
  tripLength: number   (1..30)
  ownerUid:   string   (uid anónimo del creador)
  createdAt:  timestamp

boards/{boardId}/responses/{uid}      ← el docId ES el uid anónimo
  name:      string   (1..40 chars)
  days:      map      { "YYYY-MM-DD": "none" | "partial" | "full" }
  updatedAt: timestamp
```

Notas de diseño:

- **`docId == uid`**: cada persona solo puede escribir su propia fila, y las
  reglas lo pueden verificar sin más lógica.
- **El nombre es un campo, no la clave** (a diferencia del prototipo). Así se
  puede renombrar sin duplicar filas, y dos "Ana" no se pisan.
- Solo se guardan los días **distintos de `none`** en el mapa `days`; `none`
  es el valor por defecto al leer. Ahorra escrituras y tamaño de documento.
- `boardId`: 10 caracteres de `abcdefghijkmnopqrstuvwxyz23456789` (sin
  caracteres ambiguos) generados con `crypto.getRandomValues`.
- El rango de fechas se limita a **120 días** (igual que el prototipo) y el
  número de participantes a **50**, para acotar el tamaño del documento y el
  coste de lectura.

---

## 4. Reglas de seguridad (implementar tal cual en `firestore.rules`)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function str(v, min, max) {
      return v is string && v.size() >= min && v.size() <= max;
    }
    function isDate(v) {
      return v is string && v.matches('^\\d{4}-\\d{2}-\\d{2}$');
    }

    match /boards/{boardId} {
      allow read: if true;

      allow create: if isSignedIn()
        && request.resource.data.keys().hasOnly(
             ['tripName','startDate','endDate','tripLength','ownerUid','createdAt'])
        && str(request.resource.data.tripName, 1, 80)
        && isDate(request.resource.data.startDate)
        && isDate(request.resource.data.endDate)
        && request.resource.data.startDate <= request.resource.data.endDate
        && request.resource.data.tripLength is int
        && request.resource.data.tripLength >= 1
        && request.resource.data.tripLength <= 30
        && request.resource.data.ownerUid == request.auth.uid;

      allow update, delete: if isSignedIn()
        && resource.data.ownerUid == request.auth.uid;

      match /responses/{uid} {
        allow read: if true;

        allow write: if isSignedIn()
          && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['name','days','updatedAt'])
          && str(request.resource.data.name, 1, 40)
          && request.resource.data.days is map
          && request.resource.data.days.size() <= 120;

        allow delete: if isSignedIn()
          && (request.auth.uid == uid
              || get(/databases/$(database)/documents/boards/$(boardId)).data.ownerUid == request.auth.uid);
      }
    }
  }
}
```

Limitación aceptada: las reglas no pueden validar los **valores** del mapa
`days` uno a uno de forma barata. La validación del enum
(`none|partial|full`) se hace en cliente; el peor caso de un abuso es un
valor basura en un tablero cuyo enlace ya se compartió. Es aceptable para el
caso de uso (grupo cerrado, enlace no indexado).

---

## 5. Protocolo de trabajo para Sonnet

1. **Rama**: trabaja siempre sobre `claude/sonnet-development-plan-r8lllu`
   (o la que indique Marcos). Nunca pushees a `main`.
2. **Un commit por fase como mínimo**, con mensaje descriptivo en español:
   `feat(core): extrae scoring y dates a módulos puros con tests`.
3. **Push al final de cada fase**, no solo al final de todo.
4. **Antes de cerrar una fase**: ejecuta `npm test` y comprueba que pasa.
   Si una fase toca UI, arranca el servidor local y verifica el flujo a mano.
5. **No abras un Pull Request** salvo que Marcos lo pida explícitamente.
6. **Al llegar a un `⛔ STOP`**: para de trabajar y escribe un mensaje con
   este formato exacto:

   ```
   ⛔ STOP — ACCIÓN NECESARIA POR TU PARTE (STOP #N)

   Qué necesito que hagas:
     1. ...
     2. ...

   Qué necesito que me devuelvas:
     - ...

   Estado: fases 0–X completadas y pusheadas. Espero tu confirmación
   para continuar con la fase X+1.
   ```

   Y **termina el turno ahí**. No adelantes trabajo de fases posteriores
   "por si acaso", salvo que la fase siguiente sea explícitamente
   independiente del STOP y este documento lo indique.
7. **No inventes credenciales ni IDs de proyecto Firebase.** Si te falta un
   dato de configuración, es un STOP, no una suposición.
8. Si una decisión de este plan choca con la realidad del código, **dilo y
   propón** en vez de improvisar en silencio.

---

## 6. Fases

### Fase 0 — Andamiaje del repositorio
*Sin STOP. Duración estimada: pequeña.*

- Crear la estructura de carpetas de la sección 2 (vacías/placeholder).
- `package.json` sin dependencias, con:
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
- `.github/workflows/ci.yml`: Node 20, `npm test` en push y PR.

**Criterio de aceptación**: `npm test` corre (aunque no haya tests aún) y el
workflow de CI aparece en verde en GitHub.

---

### Fase 1 — Núcleo puro y testeado
*Sin STOP.*

- `app/js/core/dates.js`: `fmtDate` (**corregido**, sin `toISOString`),
  `parseDate`, `addDays`, `dateRangeArray` (tope 120), `weekdayShort`,
  `monthShort`, `dayNum`, `isValidRange`.
- `app/js/core/scoring.js`: `computeScores` y `bestWindow` copiadas del
  prototipo, más `topWindows(dates, scores, breakdown, length, n=3)` que
  devuelve las N mejores ventanas **no solapadas** (se usará en la Fase 9;
  impleméntala ya porque el desempate es la parte delicada).
- `test/dates.test.js`: incluye el **test de regresión del bug de zona
  horaria** (ejecutar con `TZ=Europe/Madrid` y con `TZ=America/New_York`;
  el CI debe correr ambos).
- `test/scoring.test.js`: casos de puntuación, ventana ganadora, los dos
  criterios de desempate, rango más corto que `tripLength` (→ `null`),
  cero participantes.

**Criterio de aceptación**: `npm test` verde con ≥ 15 asserts; los módulos no
importan nada del DOM ni de Firebase.

---

### Fase 2 — Interfaz de almacenamiento + backend local
*Sin STOP.*

Define la interfaz que ambos backends implementarán:

```js
// app/js/data/store.js
// createBoard(config) -> Promise<boardId>
// getBoard(boardId) -> Promise<config|null>
// updateBoard(boardId, patch) -> Promise<void>
// deleteBoard(boardId) -> Promise<void>
// subscribeResponses(boardId, cb) -> unsubscribe()   // cb(responses[])
// saveMyResponse(boardId, {name, days}) -> Promise<void>
// deleteResponse(boardId, uid) -> Promise<void>
// getMyId() -> Promise<string>
```

- `local-store.js`: implementación completa sobre `localStorage`
  (`subscribeResponses` emite al suscribirse y en el evento `storage`, lo que
  permite probar el multi-usuario con dos pestañas).
- `store.js`: elige backend según `config.js` (`backend: 'local' | 'firestore'`)
  o el parámetro de URL `?store=local` para depurar.

**Criterio de aceptación**: se puede crear un tablero, obtener su id y
guardar respuestas desde consola del navegador, sin Firebase.

---

### Fase 3 — Aplicación completa sobre el backend local
*Termina en `⛔ STOP #1` (revisión de UI — no bloqueante si Marcos delega).*

- `index.html` + `css/styles.css` con el CSS del prototipo **tal cual**.
- Router en `main.js`: sin `?b=` → vista de creación; con `?b=<id>` → carga
  el tablero (o pantalla de "tablero no encontrado").
- `view-setup.js`: formulario del prototipo + validaciones
  (`endDate >= startDate`, rango ≤ 120 días, `tripLength ≤` días del rango).
  Al crear → redirige a `?b=<id>` y muestra la **pantalla de compartir** con
  el enlace y un botón "Copiar enlace".
- `view-join.js`: pedir nombre; recordar en `localStorage` por tablero para
  no volver a preguntar.
- `view-board.js`: heatmap + rejilla + caja de mejor ventana del prototipo,
  con estas mejoras obligatorias:
  - **Móvil**: por debajo de 640 px, rejilla transpuesta (una fila por día,
    columnas = participantes) o carrusel semanal. El scroll horizontal de 64 px
    por día es inusable en móvil con 60 días.
  - **Accesibilidad**: cada celda editable es un `<button>` real con
    `aria-label` ("12 de julio: disponible"), no un `div` con `tabindex`.
  - **Estados**: cargando, error de red, tablero vacío (0 participantes),
    guardando (indicador optimista).
  - **Escrituras**: agrupar (debounce ~400 ms) los clics rápidos en un solo
    `saveMyResponse` en lugar de escribir en cada clic.
  - Quitar el enlace "Restablecer tablero" del pie: pasa a ser una acción
    solo visible para el creador del tablero (Fase 5).

**Criterio de aceptación**: con `?store=local`, dos pestañas del navegador se
ven mutuamente en tiempo real y la mejor ventana se recalcula al vuelo.

```
⛔ STOP #1 — Revisión de UI
```
Sonnet: para aquí, pushea, y pide a Marcos que abra la app en local
(`npm run serve` → http://localhost:8080) y confirme diseño y flujo antes de
conectar Firebase. Si Marcos ya ha dicho que confía y prefiere no revisar,
esta parada se puede saltar — pero **pregúntalo, no lo asumas**.

---

### Fase 4 — Alta de Firebase
*Esta fase **es** un STOP. Sonnet no puede hacerla.*

```
⛔ STOP #2 — BLOQUEANTE: crear el proyecto Firebase
```
Ver instrucciones detalladas en la sección 7 (acción **A1**). Sonnet no
continúa a la Fase 5 sin el objeto `firebaseConfig`.

---

### Fase 5 — Adaptador Firestore + tiempo real
*Sin STOP.*

- `config.js` con el `firebaseConfig` que dé Marcos y `backend: 'firestore'`.
  (Esta config es **pública por diseño** en apps web de Firebase; la
  seguridad la dan las reglas, no el secreto de la clave. Se commitea.)
- `firestore-store.js`:
  - Imports ESM desde `https://www.gstatic.com/firebasejs/10.14.1/…`
    (fija la versión, no uses `latest`).
  - `signInAnonymously` al arrancar; `getMyId()` devuelve el `uid`.
  - `subscribeResponses` con `onSnapshot` → **fuera el `setInterval` de 8 s**.
  - Manejo de errores: sin red → banner "sin conexión, reintentando";
    permiso denegado → mensaje claro, no un `alert` genérico.
  - Habilitar persistencia offline de Firestore (`enableIndexedDbPersistence`
    o `persistentLocalCache`) para que la app aguante cortes de red.
- Acciones de creador (visible solo si `ownerUid === miUid`): editar nombre y
  fechas del viaje, borrar un participante, borrar el tablero.

**Criterio de aceptación**: dos navegadores distintos (uno en incógnito) ven
los cambios del otro en menos de 2 s, sin recargar.

---

### Fase 6 — Reglas de seguridad en producción
*Termina en `⛔ STOP #3` (bloqueante).*

- Dejar `firestore.rules` en el repo con el contenido de la sección 4.
- Documentar en el README cómo publicarlas.
- Escribir un pequeño checklist de verificación manual: intentar escribir la
  fila de otro participante desde consola → debe fallar con
  `permission-denied`.

```
⛔ STOP #3 — BLOQUEANTE: publicar las reglas y restringir la API key
```
Acciones **A2** y **A3** de la sección 7. Sonnet no puede desplegar reglas
(requiere login interactivo de Firebase CLI).

---

### Fase 7 — Despliegue en GitHub Pages
*Termina en `⛔ STOP #4` (bloqueante).*

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
- Añadir `app/404.html` que redirija a `index.html` (por si se usan rutas).
- Verificar que **no hay rutas absolutas** (`/css/...`) que rompan bajo el
  subdirectorio `/TripSkeduler/` de Pages: todo relativo.

```
⛔ STOP #4 — BLOQUEANTE: activar GitHub Pages
```
Acción **A4** de la sección 7. Y **A5**: añadir el dominio de Pages a los
dominios autorizados de Firebase Auth (si no, la auth anónima falla en
producción con `auth/unauthorized-domain`).

---

### Fase 8 — Pruebas reales y pulido
*Termina en `⛔ STOP #5` (validación de Marcos).*

- Checklist de QA manual: móvil real (iOS y Android), rango largo (90 días),
  8+ participantes, nombre con emoji/acentos, dos pestañas simultáneas,
  modo avión y vuelta.
- Añadir `<meta>` de Open Graph para que el enlace se vea decente al
  compartirlo por WhatsApp (título, descripción, imagen).
- Revisar Lighthouse (objetivo: accesibilidad ≥ 95).
- Actualizar `README.md`: cómo desplegar, cómo configurar Firebase, cómo
  correr los tests, y marcar el prototipo como histórico.

```
⛔ STOP #5 — Validación con el grupo real
```
Acción **A6**: Marcos prueba el tablero con sus amigos y reporta problemas.

---

### Fase 9 — Backlog (solo bajo petición explícita)

No lo hagas por iniciativa propia. Está aquí para no perderlo:

- Top-3 ventanas alternativas (la función `topWindows` ya estará hecha).
- Exportar a `.ics` / Google Calendar la ventana ganadora.
- "Marcar rango" arrastrando en vez de clic día a día.
- Ponderar participantes (alguien imprescindible cuenta doble).
- Fecha límite de respuesta y aviso de quién falta por contestar.
- PWA instalable + notificaciones.
- Modo claro.
- Borrado automático de tableros con más de 12 meses sin actividad
  (Cloud Function o TTL de Firestore) para no acumular basura.

---

## 7. ⛔ Acciones necesarias por tu parte (Marcos)

Esto es lo único que **no puedo hacer yo**: requiere tu cuenta, tu tarjeta
(aunque todo esto es gratis) o tu criterio. Están en el orden en el que te
las voy a pedir.

### A1 · Crear el proyecto Firebase → *bloquea la Fase 5*

1. Entra en https://console.firebase.google.com y pulsa **Añadir proyecto**.
   - Nombre sugerido: `tripskeduler`.
   - **Desactiva Google Analytics** (no hace falta y añade fricción).
2. En el menú lateral → **Compilación › Firestore Database** → **Crear base
   de datos**.
   - Modo: **producción** (empieza cerrado; ya abriremos con reglas).
   - Ubicación: **`eur3` (europe-west)** — más cerca, y no se puede cambiar
     después.
3. Menú lateral → **Compilación › Authentication** → **Comenzar** →
   pestaña **Sign-in method** → habilita **Anónimo**.
4. Icono de engranaje → **Configuración del proyecto** → baja hasta *Tus
   aplicaciones* → icono **`</>`** (Web) → registra la app con el apodo
   `tablero-web`. **No** marques Firebase Hosting.
5. Copia el objeto `firebaseConfig` que te muestra.

**Lo que necesito que me pegues aquí:**

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

> Tranquilo: esta config es pública por diseño en cualquier app web de
> Firebase; va en el JS que descarga el navegador. La seguridad la dan las
> reglas de Firestore (A2), no el ocultar estas claves.

---

### A2 · Publicar las reglas de Firestore → *bloquea el uso real*

Te daré el fichero `firestore.rules` ya escrito en el repo. Dos opciones:

**Opción rápida (recomendada, 1 minuto):**
1. Consola de Firebase → **Firestore Database** → pestaña **Reglas**.
2. Borra lo que haya y pega el contenido de `tablero-viaje-grupal/firestore.rules`.
3. **Publicar**.

**Opción CLI (si prefieres reproducibilidad):**
```bash
npm i -g firebase-tools
firebase login          # ← requiere navegador, por eso no puedo hacerlo yo
firebase use --add      # elige el proyecto
firebase deploy --only firestore:rules
```

**Lo que necesito que me confirmes:** "reglas publicadas".

---

### A3 · Restringir la API key (opcional pero recomendado, 2 min)

1. https://console.cloud.google.com/apis/credentials (mismo proyecto).
2. Localiza la clave **Browser key (auto created by Firebase)** → editar.
3. *Restricciones de aplicación* → **Sitios web** → añade:
   - `https://marcoss-r.github.io/*`
   - `http://localhost:8080/*` (para desarrollo)
4. Guardar.

Esto evita que alguien copie tu clave y consuma tu cuota desde otro dominio.

**Confirmación:** "API key restringida" (o "lo dejo para luego").

---

### A4 · Activar GitHub Pages → *bloquea el despliegue*

1. En el repo → **Settings › Pages**.
2. En *Build and deployment* → **Source: GitHub Actions**
   (⚠️ **no** "Deploy from a branch" — el workflow que voy a escribir usa
   Actions).
3. Guarda. La URL será, previsiblemente:
   `https://marcoss-r.github.io/TripSkeduler/`

**Lo que necesito:** la URL exacta que te muestre GitHub una vez desplegado.

---

### A5 · Autorizar el dominio de Pages en Firebase Auth → *bloquea la auth en producción*

1. Consola de Firebase → **Authentication › Settings › Dominios autorizados**.
2. **Añadir dominio** → `marcoss-r.github.io`.

Sin esto, la app funcionará en `localhost` pero fallará en producción con
`auth/unauthorized-domain`.

**Confirmación:** "dominio autorizado".

---

### A6 · Probar con el grupo real → *cierra el proyecto*

Crea un tablero de verdad, pásalo por WhatsApp a 4-5 amigos y dime:
- ¿Alguien no supo qué hacer sin explicación?
- ¿Se ve bien en su móvil?
- ¿Hay algo que se guardó mal o desapareció?

---

### A7 · Decisiones que puedes cambiar si no te convencen

Estas ya las he decidido yo por defecto (sección 1). Dímelo **antes de la
Fase 4** si quieres otra cosa, porque después cuesta más:

| Decisión por defecto | Alternativa |
|---|---|
| Firebase Firestore | Supabase (Postgres) — más portable, algo más de setup |
| Auth anónima obligatoria | Sin auth, reglas abiertas — más simple, sin protección real |
| Todo el rango visible con scroll | Vista por semanas/mes con paginación |
| UI solo en español | i18n es/en |
| El enlace es la única protección | Añadir PIN de 4 dígitos por tablero |

---

## 8. Resumen de paradas

| # | Fase | Bloqueante | Qué necesito de ti |
|---|---|---|---|
| 1 | Fin de Fase 3 | No | Revisar la UI en local (o delegar) |
| 2 | Fase 4 | **Sí** | `firebaseConfig` (acción A1) |
| 3 | Fin de Fase 6 | **Sí** | Publicar reglas (A2) + API key (A3) |
| 4 | Fin de Fase 7 | **Sí** | Activar Pages (A4) + dominio Auth (A5) |
| 5 | Fin de Fase 8 | **Sí** | Probar con el grupo (A6) |

**Fases que Sonnet puede hacer del tirón sin molestarte: 0, 1, 2 y 3.**
Empieza por ahí.

---

## 9. Riesgos y cosas a vigilar

| Riesgo | Mitigación |
|---|---|
| Bug de zona horaria (ya detectado) | Test de regresión en dos TZ en CI (Fase 1) |
| Rutas absolutas rompen bajo `/TripSkeduler/` | Todo relativo; verificar en Fase 7 |
| Escritura por clic → muchas escrituras Firestore | Debounce de 400 ms (Fase 3) |
| Documento `days` crece sin control | Solo se guardan días ≠ `none`; tope 120 |
| Colisión de `boardId` | 10 chars sobre alfabeto de 33 → despreciable; aun así, comprobar existencia antes de crear |
| Enlace filtrado fuera del grupo | Reglas + id no adivinable; PIN opcional en A7 |
| Alguien borra el tablero sin querer | Confirmación doble + solo el creador puede |
| Cuota gratuita de Firestore | Con `onSnapshot` y un grupo pequeño está a órdenes de magnitud del límite |
