// Cliente mínimo para la API. Las rutas /api las resuelve nginx (Docker)
// o el proxy de Vite (desarrollo local). Todas las llamadas mandan el JWT
// guardado por auth.ts; un 401 fuerza un login nuevo desde un único lugar.

import { forzarRelogin, getToken } from "./auth";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function conAuth(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function manejarRespuesta<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    forzarRelogin();
    throw new ApiError("Tu sesión expiró. Iniciá sesión de nuevo.", 401);
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // sin cuerpo JSON
  }
  if (!res.ok) {
    throw new ApiError(body?.message ?? `Error del servidor (código ${res.status}).`, res.status);
  }
  return body as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: conAuth() });
  return manejarRespuesta<T>(res);
}

export async function apiPostJson<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: conAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  return manejarRespuesta<T>(res);
}

export async function apiPatchJson<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: conAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  return manejarRespuesta<T>(res);
}

export async function apiPostForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: conAuth(), body: form });
  return manejarRespuesta<T>(res);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE", headers: conAuth() });
  return manejarRespuesta<T>(res);
}

export async function apiDeleteJson<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: conAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  return manejarRespuesta<T>(res);
}

// Para exportaciones (Excel/Word): la respuesta es un binario, no JSON, y una
// descarga por <a href> o window.location no puede llevar el header de auth.
// Se pide con fetch, se arma un blob y se dispara la descarga a mano,
// respetando el nombre de archivo que sugiere el backend.
export async function apiDescargarArchivo(url: string, nombrePorDefecto: string): Promise<void> {
  const res = await fetch(url, { headers: conAuth() });

  if (res.status === 401) {
    forzarRelogin();
    throw new ApiError("Tu sesión expiró. Iniciá sesión de nuevo.", 401);
  }
  if (!res.ok) {
    let mensaje = `Error del servidor (código ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.message) mensaje = body.message;
    } catch {
      // el error no vino en JSON
    }
    throw new ApiError(mensaje, res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const nombre = disposition.match(/filename="?([^"]+)"?/)?.[1] ?? nombrePorDefecto;

  const objectUrl = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = objectUrl;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(objectUrl);
}
