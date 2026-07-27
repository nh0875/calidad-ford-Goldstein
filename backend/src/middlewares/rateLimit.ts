import { RequestHandler } from "express";
import { env } from "../config/env";
import { redisConnection } from "../config/redis";
import { ipDe } from "../services/audit.service";

// Limitador general por IP con ventana fija de 1 minuto en Redis. Protege toda
// la API de abuso o de loops de script accidentales. Ante un fallo de Redis
// deja pasar la request: un problema de Redis no debe voltear la API entera.

const VENTANA_SEG = 60;

// Fábrica de limitadores por IP con ventana fija en Redis. Fail-open: ante un
// fallo de Redis deja pasar la request (un problema de Redis no debe voltear la
// API ni hacernos perder mensajes de Meta).
function limitadorPorIp(namespace: string, maximo: number): RequestHandler {
  return async (req, res, next) => {
    try {
      const clave = `rate:${namespace}:${ipDe(req)}`;
      const n = await redisConnection.incr(clave);
      if (n === 1) {
        await redisConnection.expire(clave, VENTANA_SEG);
      }
      if (n > maximo) {
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
}

export const rateLimitGlobal: RequestHandler = limitadorPorIp("global", env.rateLimitPorMinuto);

// El webhook no pasa por el límite global (Meta entrega en ráfagas y no debe
// verse frenado), pero un pico anómalo o un loop igual debe tener techo. El
// límite es holgado (muy por encima del tráfico real de Meta) y solo corta un
// abuso claro. El GET de verificación de Meta queda fuera (no incrementa).
export const rateLimitWebhook: RequestHandler = limitadorPorIp("webhook", env.rateLimitWebhookPorMinuto);
