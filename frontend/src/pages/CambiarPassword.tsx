// Autoservicio para que cualquier usuario cambie su propia contraseña
// (en particular, la inicial que le asignó el admin al crear la cuenta).
import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { apiPostJson } from "../lib/api";
import { Alert } from "../components/ui/Alert";
import { Campo, Input } from "../components/ui/Field";
import { Card } from "../components/ui/Card";
import { claseBoton } from "../components/ui/Button";

export default function CambiarPassword() {
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (passwordNueva !== confirmacion) {
      setError("La confirmación no coincide con la contraseña nueva. Volvé a escribirla.");
      return;
    }
    setGuardando(true);
    try {
      const { message } = await apiPostJson<{ message: string }>("/api/auth/cambiar-password", {
        passwordActual,
        passwordNueva,
      });
      setMensaje(message);
      setPasswordActual("");
      setPasswordNueva("");
      setConfirmacion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar la contraseña. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card padding="p-6">
        <h3 className="mb-4 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
          <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
          Cambiar mi contraseña
        </h3>
        <form onSubmit={enviar} className="space-y-3">
          <Campo etiqueta="Contraseña actual">
            <Input required type="password" value={passwordActual} onChange={(e) => setPasswordActual(e.target.value)} />
          </Campo>
          <Campo etiqueta="Contraseña nueva" hint="Mínimo 8 caracteres">
            <Input
              required
              type="password"
              minLength={8}
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Repetir contraseña nueva">
            <Input required type="password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
          </Campo>

          {error && <Alert tono="error">{error}</Alert>}
          {mensaje && <Alert tono="exito">{mensaje}</Alert>}

          <button type="submit" disabled={guardando} className={claseBoton("primario", "w-full")}>
            {guardando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      </Card>
    </div>
  );
}
