import { RequestHandler } from "express";
import { env } from "../config/env";
import { redisConnection } from "../config/redis";
import { ipDe } from "../services/audit.service";

// Limitador general por IP con ventana fija de 1 minuto en Redis. Protege toda
// la API de abuso o de loops de script accidentales. Ante un fallo de Redis
// deja pasar la request: un problema de Redis no debe voltear la API entera.

const VENTANA_SEG = 60;

export const rateLimitGlobal: RequestHandler = async (req, res, next) => {
  try {
    const clave = `rate:global:${ipDe(req)}`;
    const n = await redisConnection.incr(clave);
    if (n === 1) {
      await redisConnection.expire(clave, VENTANA_SEG);
    }
    if (n > env.rateLimitPorMinuto) {
      const ttl = await redisConnection.ttl(clave);
      res.setHeader("Retry-After", String(ttl > 0 ? ttl : VENTANA_SEG));
      return res.status(429).json({
        message: "Estás haciendo demasiadas solicitudes. Esperá un momento y volvé a intentar.",
      });
    }
    next();
  } catch {
    next(); // fail-open: si Redis falla, no bloqueamos el tráfico legítimo
  }
};
