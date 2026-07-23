import IORedis from "ioredis";
import { env } from "./env";

// Conexión compartida para BullMQ (requiere maxRetriesPerRequest: null)
export const redisConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

// Sin este handler, cada reintento de conexión fallido inunda el log
let lastRedisErrorLog = 0;
redisConnection.on("error", (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLog > 10_000) {
    lastRedisErrorLog = now;
    console.error(`[redis] error de conexión: ${err.message}`);
  }
});
