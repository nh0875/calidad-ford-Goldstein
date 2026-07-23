import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import {
  compararPassword,
  generarToken,
  hashPassword,
  motivoPasswordInvalida,
} from "../services/auth.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { revocarToken } from "../services/token-denylist.service";
import {
  limpiarLoginFallidos,
  registrarLoginFallido,
  segundosDeBloqueo,
} from "../services/login-throttle.service";

function minutosDeSegundos(seg: number): number {
  return Math.max(1, Math.ceil(seg / 60));
}

// ---------- POST /api/auth/login ----------

const loginSchema = z.object({
  email: z.string().trim().min(1, "Ingresá el email.").email("El email no es válido."),
  password: z.string().min(1, "Ingresá la contraseña."),
});

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.errors[0]?.message ?? "Revisá el email y la contraseña.",
    });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Rate limiting anti fuerza bruta: si el email está bloqueado por acumular
  // intentos fallidos, se rechaza sin siquiera mirar la contraseña.
  const bloqueoSeg = await segundosDeBloqueo(email);
  if (bloqueoSeg > 0) {
    await auditar(req, {
      accion: ACCIONES.LOGIN_BLOQUEADO,
      entidad: "Auth",
      usuarioId: null,
      detalles: { emailIntentado: email, restanteMin: minutosDeSegundos(bloqueoSeg) },
    });
    return res.status(429).json({
      message: `Demasiados intentos fallidos. Probá de nuevo en ${minutosDeSegundos(bloqueoSeg)} minuto(s).`,
    });
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });

  // Mismo mensaje exista o no el usuario: no revelar cuáles emails están registrados
  const credencialesInvalidas = () =>
    res.status(401).json({ message: "Email o contraseña incorrectos." });

  // Un fallo (usuario inexistente o password incorrecta) cuenta para el bloqueo
  // y queda auditado con el email intentado y la IP.
  const registrarFallo = async (motivo: string) => {
    const { bloqueado, restanteSeg } = await registrarLoginFallido(email);
    await auditar(req, {
      accion: ACCIONES.LOGIN_FALLIDO,
      entidad: "Auth",
      usuarioId: usuario?.id ?? null,
      detalles: { emailIntentado: email, motivo },
    });
    if (bloqueado) {
      return res.status(429).json({
        message: `Demasiados intentos fallidos. La cuenta quedó bloqueada ${minutosDeSegundos(restanteSeg)} minuto(s).`,
      });
    }
    return credencialesInvalidas();
  };

  if (!usuario) return registrarFallo("usuario_inexistente");
  if (!usuario.activo) {
    // Cuenta desactivada: no se cuenta como intento de fuerza bruta, pero se audita.
    await auditar(req, {
      accion: ACCIONES.LOGIN_FALLIDO,
      entidad: "Auth",
      usuarioId: usuario.id,
      detalles: { emailIntentado: email, motivo: "usuario_desactivado" },
    });
    return res.status(401).json({
      message: "Este usuario está desactivado. Pedile a un administrador que lo reactive.",
    });
  }

  const passwordOk = await compararPassword(parsed.data.password, usuario.passwordHash);
  if (!passwordOk) return registrarFallo("password_incorrecta");

  // Login exitoso: limpia el contador de intentos y audita.
  await limpiarLoginFallidos(email);

  const token = generarToken({
    sub: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
  });

  await auditar(req, {
    accion: ACCIONES.LOGIN,
    entidad: "Auth",
    usuarioId: usuario.id,
    entidadId: usuario.id,
  });

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      area: usuario.area,
    },
    modoDemo: env.modoDemo,
  });
}

// ---------- POST /api/auth/logout ----------
// Revoca el token en curso (denylist en Redis con TTL = vida restante del JWT),
// así cerrar sesión es efectivo del lado del servidor y no solo en el navegador.

export async function logout(req: Request, res: Response) {
  if (req.token?.jti) {
    const ahoraSeg = Math.floor(Date.now() / 1000);
    const restante = req.token.exp - ahoraSeg;
    if (restante > 0) {
      await revocarToken(req.token.jti, restante);
    }
    await auditar(req, { accion: ACCIONES.LOGOUT, entidad: "Auth", entidadId: req.usuario?.id });
  }
  res.json({ message: "Sesión cerrada." });
}

// ---------- GET /api/auth/yo ----------
// Para que el frontend rehidrate la sesión al recargar la página (valida el
// token guardado y devuelve los datos actuales del usuario).

export async function yo(req: Request, res: Response) {
  res.json({ usuario: req.usuario, modoDemo: env.modoDemo });
}

// ---------- POST /api/auth/cambiar-password ----------

const cambiarPasswordSchema = z.object({
  passwordActual: z.string().min(1, "Ingresá tu contraseña actual."),
  passwordNueva: z.string().min(1, "Ingresá la contraseña nueva."),
});

export async function cambiarPassword(req: Request, res: Response) {
  const parsed = cambiarPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.errors[0]?.message ?? "Revisá los datos del formulario.",
    });
  }

  const errorFormato = motivoPasswordInvalida(parsed.data.passwordNueva);
  if (errorFormato) {
    return res.status(400).json({ message: errorFormato });
  }

  // requireAuth ya corrió antes de esta ruta, así que req.usuario existe
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: req.usuario!.id } });

  const passwordActualOk = await compararPassword(parsed.data.passwordActual, usuario.passwordHash);
  if (!passwordActualOk) {
    return res.status(400).json({ message: "La contraseña actual no es correcta." });
  }

  const passwordHash = await hashPassword(parsed.data.passwordNueva);
  await prisma.usuario.update({ where: { id: usuario.id }, data: { passwordHash } });

  await auditar(req, {
    accion: ACCIONES.PASSWORD_CAMBIADA,
    entidad: "Usuario",
    entidadId: usuario.id,
  });

  res.json({ message: "Contraseña actualizada correctamente." });
}
