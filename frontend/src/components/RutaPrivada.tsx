import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getToken } from "../lib/auth";

// Solo verifica que haya un token guardado localmente. Si el token es
// inválido o expiró en el servidor, la primera llamada a la API dispara
// forzarRelogin() (ver lib/api.ts) y termina igual en /login.
export default function RutaPrivada({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
