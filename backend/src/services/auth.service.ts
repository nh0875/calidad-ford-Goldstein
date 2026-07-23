import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { RolUsuario } from "@prisma/client";
import { env } from "../config/env";

const RONDAS_HASH = 10;

export function hashPassword(passwordPlano: string): Promise<string> {
  return bcrypt.hash(passwordPlano, RONDAS_HASH);
}

export function compararPassword(passwordPlano: string, hash: string): Promise<boolean> {
  return bcrypt.compare(passwordPlano, hash);
}

export interface PayloadToken {
  sub: string; // id del usuario
  email: string;
  nombre: string;
  rol: RolUsuario;
}

// Claims estándar que agrega jsonwebtoken al firmar/verificar.
export type TokenVerificado = PayloadToken & {
  jti: string; // id único del token, para poder revocarlo (denylist en Redis)
  iat: number; // emitido (epoch seg)
  exp: number; // expira (epoch seg)
};

export function generarToken(payload: PayloadToken): string {
  // jwtid → claim jti: identifica el token para poder revocarlo al hacer logout.
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
    jwtid: randomUUID(),
  } as SignOptions);
}

export function verificarToken(token: string): TokenVerificado {
  // jwt.verify valida firma y expiración; tira si alguna falla
  return jwt.verify(token, env.jwt.secret) as TokenVerificado;
}

// Requisito mínimo de contraseñas nuevas (alta de usuario y cambio de clave)
export function motivoPasswordInvalida(password: string): string | null {
  if (password.length < 8) return "La contraseña tiene que tener al menos 8 caracteres.";
  return null;
}
