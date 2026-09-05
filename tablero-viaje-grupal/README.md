# Tablero de disponibilidad para viajes en grupo

## Qué es

Una web sencilla para que un grupo de amigos decida cuándo hacer un viaje.
Alguien crea un "tablero" con un rango de fechas y una duración de viaje
(p. ej. 5 días). Cada persona del grupo entra al enlace y marca, día a día,
si ese día está **disponible**, **parcialmente disponible** o **no
disponible**. La app calcula sola cuál es la mejor ventana de días
consecutivos para todo el grupo.

## Problema que resuelve

Cuadrar fechas de viaje entre varias personas normalmente se hace a mano
por chat ("¿del 12 al 16 os va bien? ¿y del 19?"), lo cual escala fatal a
partir de 4-5 personas. Herramientas como When2meet o Doodle resuelven el
"encontrar hueco común" en general, pero:

- No calculan automáticamente la mejor ventana de **varios días
  consecutivos** (solo muestran solapamiento día a día).
- No distinguen bien entre "disponible del todo" y "podría, con esfuerzo"
  (disponibilidad parcial), que es información valiosa para decidir.

## Cómo funciona (flujo de usuario)

1. **Crear tablero**: nombre del viaje, rango de fechas a valorar (p. ej.
   "todo julio y agosto"), duración del viaje en días (p. ej. 5).
2. **Compartir enlace** con el grupo.
3. Cada persona entra, escribe su nombre y marca su disponibilidad para
   cada día del rango (clic para ciclar entre los 3 estados).
4. La app **calcula automáticamente** la ventana de N días consecutivos
   con mejor puntuación agregada y la resalta.

## Modelo de datos

```
Config (uno por tablero):
  tripName: string
  startDate: "YYYY-MM-DD"
  endDate: "YYYY-MM-DD"
  tripLength: number        // duración del viaje en días

Response (uno por participante):
  name: string
  days: { "YYYY-MM-DD": "none" | "partial" | "full" }
```

## Algoritmo de puntuación

- `full` = 1 punto, `partial` = 0.5 puntos, `none` = 0 puntos.
- Para cada día del rango, se suman los puntos de todos los participantes.
- Se recorre el rango con una ventana deslizante de `tripLength` días
  consecutivos y se elige la de mayor suma total.
- Desempate: 1) más respuestas "disponible completo" dentro de la
  ventana, 2) menos respuestas "no disponible".

Esta lógica ya está implementada en JS puro dentro del prototipo
(funciones `computeScores` y `bestWindow`) y es directamente reutilizable.

## Prototipo incluido

`prototipo/tablero-disponibilidad-viaje.html`

- Prototipo funcional construido como un Claude Artifact (se puede abrir
  directamente en un navegador para ver el diseño y la interacción).
- Usa una API `window.storage` (get/set/list/delete, con datos
  "compartidos") propia del entorno de Artifacts de Claude.ai para
  simular un backend en tiempo real entre varios usuarios. **Esa API no
  existe en un navegador normal** — hay que sustituirla por un backend
  real (ver siguiente sección).
- Sirve como referencia completa de UI/UX, paleta de color, tipografías
  y de la lógica de puntuación, que sí es reutilizable tal cual.

## Qué falta para una versión real y desplegable

1. **Sustituir `window.storage` por un backend real.** Opciones, de más
   a menos recomendada para este caso (grupo pequeño, gratis):
   - **Firebase (Firestore)** — capa gratuita de sobra para esto,
     tiempo real "out of the box" con `onSnapshot`.
   - **Supabase** (Postgres) — también con capa gratuita, alternativa
     open-source-friendly a Firebase.
   - Alternativa más casera: una Google Sheet + Apps Script como API.
2. **Hosting del frontend en GitHub Pages** (estático, gratis). El
   frontend (HTML/CSS/JS del prototipo) no necesita cambios grandes de
   estructura, solo la capa de almacenamiento.
3. **Un tablero por URL**: usar un identificador en la URL (p. ej.
   `?board=abc123`) o en la ruta, para poder tener varios viajes
   distintos con la misma app desplegada, en vez de un tablero único
   como en el prototipo.
4. **(Opcional)** tiempo real de verdad con listeners de Firestore en
   vez del refresco por `setInterval` que usa el prototipo.
5. **(Opcional)** algo de validación/anti-abuso básico si el enlace va a
   circular más allá de un grupo cerrado de confianza.

## Objetivo de este proyecto

Construir la versión desplegable en GitHub Pages + Firebase (o Supabase),
reutilizando el diseño, la interacción y la lógica de puntuación del
prototipo adjunto, sustituyendo únicamente la capa de almacenamiento por
un backend real y añadiendo soporte para múltiples tableros por URL.
