import { redisConnection } from "../config/redis";

// Anti fuerza bruta en el login, con Redis (funciona aunque haya varias
// instancias del backend). Regla: hasta 5 intentos fallidos por email en 15
// minutos; al llegar a 5, ese email queda bloqueado 15 minutos más. Un login
// exitoso limpia el contador. La clave es el email (no la IP) para no dejar que
// un atacante detrás de muchas IPs siga probando contra la misma cuenta.

export const LOGIN_MAX_INTENTOS = 5;
const VENTANA_SEG = 15 * 60;
const BLOQUEO_SEG = 15 * 60;

const claveIntentos = (email: string) => `login:intentos:${email}`;
const claveBloqueo = (email: string) => `login:bloqueo:${email}`;

/** Segundos que le quedan al bloqueo del email, o 0 si no está bloqueado. */
export async function segundosDeBloqueo(email: string): Promise<number> {
  const ttl = await redisConnection.ttl(claveBloqueo(email.toLowerCase()));
  return ttl > 0 ? ttl : 0;
}

/**
 * Registra un intento fallido. Devuelve si el email quedó bloqueado y cuántos
 * segundos. Al 5º fallo activa el bloqueo de 15 minutos y reinicia el contador.
 */
export async function registrarLoginFallido(
  email: string
): Promise<{ bloqueado: boolean; restanteSeg: number; intentos: number }> {
  const e = email.toLowerCase();
  const intentos = await redisConnection.incr(claveIntentos(e));
  if (intentos === 1) {
    await redisConnection.expire(claveIntentos(e), VENTANA_SEG);
  }
  if (intentos >= LOGIN_MAX_INTENTOS) {
    await redisConnection.set(claveBloqueo(e), "1", "EX", BLOQUEO_SEG);
    await redisConnection.del(claveIntentos(e)); // desde acá manda el bloqueo
    return { bloqueado: true, restanteSeg: BLOQUEO_SEG, intentos };
  }
  return { bloqueado: false, restanteSeg: 0, intentos };
}

/** Limpia contador y bloqueo tras un login exitoso. */
export async function limpiarLoginFallidos(email: string): Promise<void> {
  const e = email.toLowerCase();
  await redisConnection.del(claveIntentos(e), claveBloqueo(e));
}
