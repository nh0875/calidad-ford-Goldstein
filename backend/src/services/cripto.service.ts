import crypto from "crypto";
import { env } from "../config/env";

// Cifrado simétrico (AES-256-GCM) para guardar secretos en la base (credenciales
// de Meta cargadas desde /configuracion). La clave viene de CONFIG_ENCRYPTION_KEY
// (32 bytes en hex o base64). El formato del blob es "v1:iv:tag:datos" (base64).

function clave(): Buffer | null {
  const k = env.configEncryptionKey.trim();
  if (!k) return null;
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(k)) buf = Buffer.from(k, "hex");
  else {
    try {
      buf = Buffer.from(k, "base64");
    } catch {
      return null;
    }
  }
  return buf.length === 32 ? buf : null;
}

/** true si hay una CONFIG_ENCRYPTION_KEY válida (32 bytes) cargada. */
export function cifradoDisponible(): boolean {
  return clave() !== null;
}

export function cifrar(texto: string): string {
  const key = clave();
  if (!key) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY no configurada o inválida (se requieren 32 bytes en hex o base64). Generá una con `openssl rand -hex 32`."
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function descifrar(blob: string): string {
  const key = clave();
  if (!key) throw new Error("CONFIG_ENCRYPTION_KEY no configurada.");
  const partes = blob.split(":");
  if (partes.length !== 4 || partes[0] !== "v1") {
    throw new Error("Formato de secreto cifrado desconocido.");
  }
  const [, ivB, tagB, dataB] = partes;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}
