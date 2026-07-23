import { redisConnection } from "../config/redis";

// Lista de tokens revocados (denylist) en Redis. Al cerrar sesión, el jti del
// JWT se guarda acá hasta que el token expiraría naturalmente; requireAuth
// rechaza cualquier token cuyo jti esté en la lista. Así el logout es efectivo
// del lado del servidor y no solo un borrado del navegador.

const PREFIJO = "jwt:revocado:";

/**
 * Revoca un token por su jti. El TTL se fija en los segundos que le quedan de
 * vida al token, de modo que Redis limpia la entrada sola cuando ya no importa.
 */
export async function revocarToken(jti: string, segundosRestantes: number): Promise<void> {
  const ttl = Math.max(1, Math.ceil(segundosRestantes));
  await redisConnection.set(PREFIJO + jti, "1", "EX", ttl);
}

export async function tokenRevocado(jti: string): Promise<boolean> {
  const existe = await redisConnection.exists(PREFIJO + jti);
  return existe === 1;
}
