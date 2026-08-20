import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { redisConnection } from "../config/redis";
import { marca } from "../config/marca";

// Commit del código que está CORRIENDO. Lo inyecta el build (ver Dockerfile.prod
// y el arg GIT_COMMIT del compose).
//
// Existe por un problema real: se arreglaba algo, se rebuildeaba en la PC de la
// agencia, y el error seguía — porque el rebuild se había hecho SIN traer los
// cambios (`git pull`). Todo se veía bien y no había forma de darse cuenta.
// Ahora se pregunta y el sistema contesta qué versión tiene puesta.
const VERSION = (process.env.GIT_COMMIT ?? "").trim() || "desconocida";

// Si Redis está caído, ioredis encola los comandos indefinidamente
// (maxRetriesPerRequest: null); sin timeout el healthcheck se colgaría.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

export async function getHealth(_req: Request, res: Response) {
  const checks: Record<string, string> = {
    api: "ok",
    database: "error",
    redis: "error",
  };

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 3000);
    checks.database = "ok";
  } catch {
    // se reporta abajo
  }

  try {
    const pong = await withTimeout(redisConnection.ping(), 3000);
    if (pong === "PONG") checks.redis = "ok";
  } catch {
    // se reporta abajo
  }

  const healthy = Object.values(checks).every((v) => v === "ok");

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    marca: marca.codigo,
    version: VERSION,
    checks,
    timestamp: new Date().toISOString(),
  });
}
