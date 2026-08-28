// Sesión del usuario logueado, persistida en localStorage para sobrevivir
// recargas de página. No hay refresh token: cuando el JWT expira (8hs) o el
// servidor devuelve 401, se limpia la sesión y se vuelve a /login.

export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: "ADMIN" | "CALIDAD" | "FIDELIZACION";
  area: "VENTAS" | "POSVENTA" | "AMBAS";
}

// ¿El usuario ve más de un área? (ADMIN o CALIDAD con área AMBAS). Se usa para
// mostrar el filtro y el desglose por área; el backend igual valida todo.
export function veTodasLasAreas(u: UsuarioSesion | null): boolean {
  return !!u && (u.rol === "ADMIN" || u.area === "AMBAS");
}

// El puesto acotado de Fidelizacion: solo su pantalla y el Seguimiento de esos
// clientes. El backend lo corta igual (middlewares/auth.ts, acotarPorRol); esto
// es para no mostrarle puertas que le van a dar 403.
export function esSoloFidelizacion(u: UsuarioSesion | null): boolean {
  return u?.rol === "FIDELIZACION";
}

const CLAVE_TOKEN = "calidad.token";
const CLAVE_USUARIO = "calidad.usuario";
const CLAVE_DEMO = "calidad.modoDemo";

export function getToken(): string | null {
  return localStorage.getItem(CLAVE_TOKEN);
}

// Modo demo: lo informa el backend en el login (y en /auth/yo). Se guarda para
// poder mostrar el indicador y el botón de simular sin un fetch extra.
export function getModoDemo(): boolean {
  return localStorage.getItem(CLAVE_DEMO) === "true";
}

export function guardarModoDemo(modoDemo: boolean) {
  localStorage.setItem(CLAVE_DEMO, modoDemo ? "true" : "false");
}

export function getUsuario(): UsuarioSesion | null {
  const crudo = localStorage.getItem(CLAVE_USUARIO);
  if (!crudo) return null;
  try {
    return JSON.parse(crudo) as UsuarioSesion;
  } catch {
    return null;
  }
}

export function guardarSesion(token: string, usuario: UsuarioSesion) {
  localStorage.setItem(CLAVE_TOKEN, token);
  localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
}

export function limpiarSesion() {
  localStorage.removeItem(CLAVE_TOKEN);
  localStorage.removeItem(CLAVE_USUARIO);
  localStorage.removeItem(CLAVE_DEMO);
}

// Único punto de salida ante una sesión inválida: cualquier pantalla que lo
// dispare termina en el mismo lugar, con la sesión ya limpia.
export function forzarRelogin() {
  limpiarSesion();
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}
