// Configuración pública de Firebase.
//
// Esta config ES pública por diseño en cualquier app web de Firebase: viaja
// tal cual en el JS que descarga el navegador. La seguridad de verdad la dan
// las reglas de Firestore (firestore.rules), no ocultar estas claves — así
// que no pasa nada por commitear este archivo con los valores reales.
//
// PENDIENTE (Fase 4 del plan, acción A1): crea el proyecto en
// https://console.firebase.google.com, registra una app web, y pega aquí el
// objeto `firebaseConfig` que te da la consola. Luego cambia `backend` a
// 'firestore'.
//
// Hasta que hagas eso, `backend` se queda en 'local' y la app sigue
// funcionando exactamente igual que ahora (localStorage) — nada se rompe
// mientras tanto, y '?store=local' en la URL sigue forzando el backend local
// para depurar aunque `backend` ya esté en 'firestore'.

export const backend = 'firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyC2saqjXGWYZ7LhvV_QKR44y7gk2sgN-SY',
  authDomain: 'tripskeduler.firebaseapp.com',
  projectId: 'tripskeduler',
  storageBucket: 'tripskeduler.firebasestorage.app',
  messagingSenderId: '680193549192',
  appId: '1:680193549192:web:a31c80c9bdc7f72434103d',
};
