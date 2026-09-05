// Generación de identificadores no adivinables para tableros y grupos.
// Módulo puro: usa crypto.getRandomValues (disponible tanto en navegadores
// modernos como en Node vía globalThis.crypto).

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/l/I).
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/**
 * Genera un id aleatorio de `len` caracteres sobre ALPHABET.
 * No es criptográficamente "secreto" en el sentido de una contraseña,
 * pero con 10 caracteres sobre un alfabeto de 33 símbolos (~33^10 ≈ 1.6e15
 * combinaciones) la probabilidad de colisión o de adivinarlo por fuerza
 * bruta es despreciable para este caso de uso (enlace de un grupo cerrado).
 */
export function newId(len = 10) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export { ALPHABET };
