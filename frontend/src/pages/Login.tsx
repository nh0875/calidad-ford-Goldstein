// Pantalla de login: sin sidebar ni header, pensada para verse bien sola.
import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { apiPostJson } from "../lib/api";
import { getToken, guardarModoDemo, guardarSesion, UsuarioSesion } from "../lib/auth";
import { Alert } from "../components/ui/Alert";
import { Campo, Input } from "../components/ui/Field";
import { claseBoton } from "../components/ui/Button";
import TechGridBackground from "../components/ui/TechGridBackground";

interface RespuestaLogin {
  token: string;
  usuario: UsuarioSesion;
  modoDemo?: boolean;
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Ya hay sesión activa: no tiene sentido mostrar el formulario de nuevo
  if (getToken()) {
    return <Navigate to="/dashboard" replace />;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const { token, usuario, modoDemo } = await apiPostJson<RespuestaLogin>("/api/auth/login", { email, password });
      guardarSesion(token, usuario);
      guardarModoDemo(Boolean(modoDemo));
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar sesión. Probá de nuevo en un momento.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-4">
      <TechGridBackground className="text-white" />
      <div className="relative w-full max-w-sm motion-safe:animate-fade-slide-in">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            <ShieldCheck className="h-6 w-6 text-accent" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Calidad Ford</h1>
          <p className="text-sm text-white/60">Contacto Posterior &amp; RQR</p>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-xl">
          <form onSubmit={enviar} className="space-y-4">
            <Campo etiqueta="Email">
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Contraseña">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Campo>

            {error && <Alert tono="error">{error}</Alert>}

            <button type="submit" disabled={cargando} className={claseBoton("primario", "w-full")}>
              {cargando ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
