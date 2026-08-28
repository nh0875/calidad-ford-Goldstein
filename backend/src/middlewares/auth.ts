import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { verificarToken } from "../services/auth.service";
import { tokenRevocado } from "../services/token-denylist.service";

// Verifica el JWT y vuelve a buscar el usuario en la base (no solo confía en
// el payload firmado) para que un usuario desactivado por el admin pierda el
// acceso de inmediato, sin esperar a que el token expire.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const [esquema, token] = header.split(" ");

  if (esquema !== "Bearer" || !token) {
    return res.status(401).json({ message: "Sesión requerida. Iniciá sesión para continuar." });
  }

  let payload;
  try {
    payload = verificarToken(token);
  } catch (err) {
    const expirado = err instanceof jwt.TokenExpiredError;
    return res.status(401).json({
      message: expirado
        ? "La sesión expiró. Iniciá sesión de nuevo."
        : "La sesión no es válida. Iniciá sesión de nuevo.",
    });
  }

  // Logout efectivo del lado del servidor: si el token fue revocado (cierre de
  // sesión), se rechaza aunque la firma siga siendo válida y no haya expirado.
  if (payload.jti && (await tokenRevocado(payload.jti))) {
    return res.status(401).json({ message: "La sesión se cerró. Iniciá sesión de nuevo." });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, nombre: true, email: true, rol: true, activo: true, area: true, sucursal: true },
  });

  if (!usuario || !usuario.activo) {
    return res.status(401).json({ message: "La sesión ya no es válida. Iniciá sesión de nuevo." });
  }

  req.usuario = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    area: usuario.area,
    sucursal: usuario.sucursal,
  };
  req.token = { jti: payload.jti, exp: payload.exp };
  next();
}

// Lo que puede tocar el rol FIDELIZACION. Es una LISTA BLANCA a proposito.
//
// El resto del backend PERMITE POR DEFECTO: solo requireAdmin cierra puertas, y
// todo lo demas queda abierto a cualquier usuario autenticado. Con una lista
// negra ruta por ruta, cada endpoint que se agregue en el futuro nace abierto
// para este rol y nadie se entera. Asi, nace cerrado.
const RUTAS_FIDELIZACION = [
  /^\/fidelizacion(\/|$)/,  // su pantalla: cargas y destinatarios
  /^\/seguimiento(\/|$)/,   // el chat con esos clientes (el controller acota a fidelizacion)
  /^\/auth(\/|$)/,          // login, cambiar su propia contrasena
  /^\/marca(\/|$)/,         // que marca es el sistema, para dibujar la pantalla
];

/**
 * Encierra al rol FIDELIZACION en sus dos pantallas.
 *
 * Va montado JUNTO a requireAuth, antes que cualquier ruta, para que valga para
 * todas de una sola vez y no haya que acordarse de nada al agregar la proxima.
 */
export function acotarPorRol(req: Request, res: Response, next: NextFunction) {
  if (req.usuario?.rol !== "FIDELIZACION") return next();
  const ruta = req.path || "";
  if (RUTAS_FIDELIZACION.some((patron) => patron.test(ruta))) return next();
  return res.status(403).json({
    message: "Tu usuario es de Fidelizacion: solo tiene acceso a Fidelizacion y a Seguimiento.",
  });
}

// Va después de requireAuth: exige rol ADMIN para las rutas de gestión de usuarios
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.usuario?.rol !== "ADMIN") {
    return res.status(403).json({
      message: "Esta acción es solo para administradores del sistema.",
    });
  }
  next();
}
