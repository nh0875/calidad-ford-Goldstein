import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { redisConnection } from "../config/redis";

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
    checks,
    timestamp: new Date().toISOString(),
  });
}
