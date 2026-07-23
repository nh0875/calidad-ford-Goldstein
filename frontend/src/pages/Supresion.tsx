import { useCallback, useEffect, useState } from "react";
import { PhoneOff, Plus, ShieldX, Trash2 } from "lucide-react";
import { apiDeleteJson, apiGet, apiPostJson } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";

interface Supresion {
  id: string;
  telefono: string;
  motivo: string;
  notas: string | null;
  creadoEn: string;
  creadoPor: { nombre: string } | null;
  casoOrigen: { numeroOrden: string; nombrePropietario: string } | null;
}

const MOTIVOS: Record<string, string> = {
  OPT_OUT_WHATSAPP: "Pidió la baja por WhatsApp",
  SOLICITUD_MANUAL: "Pidió la baja (manual)",
  NUMERO_INVALIDO: "Número inválido",
  OTRO: "Otro",
};

function fechaHora(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}

export default function Supresion() {
  const [data, setData] = useState<Supresion[]>([]);
  const [total, setTotal] = useState(0);
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Alta manual
  const [nuevoTel, setNuevoTel] = useState("");
  const [nuevoMotivo, setNuevoMotivo] = useState("SOLICITUD_MANUAL");
  const [nuevaNota, setNuevaNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "200" });
      if (filtroMotivo) params.set("motivo", filtroMotivo);
      if (q.trim()) params.set("q", q.trim());
      const r = await apiGet<{ data: Supresion[]; pagination: { total: number } }>(`/api/supresion?${params}`);
      setData(r.data);
      setTotal(r.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar la lista.");
    }
  }, [filtroMotivo, q]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agregar() {
    if (!nuevoTel.trim()) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/supresion", {
        telefono: nuevoTel.trim(),
        motivo: nuevoMotivo,
        ...(nuevaNota.trim() ? { notas: nuevaNota.trim() } : {}),
      });
      setMensaje(r.message);
      setNuevoTel("");
      setNuevaNota("");
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos agregar el teléfono.");
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(s: Supresion) {
    const motivo = window.prompt(
      `Vas a quitar ${s.telefono} de la lista de supresión, así que podrá volver a recibir campañas.\n\nIndicá el motivo (obligatorio):`
    );
    if (motivo === null) return;
    if (motivo.trim().length < 3) {
      setError("El motivo para quitar de la lista es obligatorio (mínimo 3 caracteres).");
      return;
    }
    setError(null);
    try {
      const r = await apiDeleteJson<{ message: string }>(`/api/supresion/${s.id}`, { motivo: motivo.trim() });
      setMensaje(r.message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos quitar el teléfono.");
    }
  }

  return (
    <div className="space-y-4">
      <Alert tono="info">
        <p className="flex items-center gap-2 font-medium">
          <ShieldX className="h-4 w-4" aria-hidden="true" />
          Lista de supresión por teléfono
        </p>
        <p className="mt-1 text-sm">
          Ningún teléfono de esta lista recibe campañas de WhatsApp, aunque el mes siguiente el Excel le genere un caso
          nuevo. Los opt-out por WhatsApp (BAJA/STOP) se agregan solos; acá el ADMIN puede cargar bajas pedidas por otro
          canal o quitar a alguien que pidió volver a recibir mensajes.
        </p>
      </Alert>

      {/* Alta manual */}
      <Card className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo etiqueta="Teléfono">
          <Input value={nuevoTel} placeholder="Ej: 261 155 123456" onChange={(e) => setNuevoTel(e.target.value)} />
        </Campo>
        <Campo etiqueta="Motivo">
          <Select value={nuevoMotivo} onChange={(e) => setNuevoMotivo(e.target.value)}>
            {Object.entries(MOTIVOS)
              .filter(([k]) => k !== "OPT_OUT_WHATSAPP")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </Select>
        </Campo>
        <Campo etiqueta="Nota (opcional)">
          <Input value={nuevaNota} placeholder="Ej: pidió la baja por teléfono" onChange={(e) => setNuevaNota(e.target.value)} />
        </Campo>
        <button onClick={agregar} disabled={guardando || !nuevoTel.trim()} className={claseBoton("primario")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {guardando ? "Agregando…" : "Agregar"}
        </button>
      </Card>

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Filtros */}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Buscar teléfono">
          <Input value={q} placeholder="Parte del número" onChange={(e) => setQ(e.target.value)} />
        </Campo>
        <Campo etiqueta="Motivo">
          <Select value={filtroMotivo} onChange={(e) => setFiltroMotivo(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(MOTIVOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Campo>
        <div className="flex items-end text-sm text-ink-muted">{total} teléfono(s) en la lista</div>
      </Card>

      {/* Tabla */}
      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2">Origen</th>
              <th className="px-3 py-2">Agregado</th>
              <th className="px-3 py-2">Por</th>
              <th className="px-3 py-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{s.telefono}</td>
                <td className="px-3 py-2">
                  <Badge tono={s.motivo === "OPT_OUT_WHATSAPP" ? "rojo" : "amarillo"}>{MOTIVOS[s.motivo] ?? s.motivo}</Badge>
                </td>
                <td className="px-3 py-2 text-ink-muted">
                  {s.casoOrigen ? `${s.casoOrigen.numeroOrden} · ${s.casoOrigen.nombrePropietario}` : s.notas || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{fechaHora(s.creadoEn)}</td>
                <td className="px-3 py-2 text-ink-muted">{s.creadoPor?.nombre ?? "sistema"}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => quitar(s)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline"
                    title="Quitar de la lista (podrá volver a recibir campañas)"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icono={PhoneOff}
                    titulo="No hay teléfonos suprimidos"
                    descripcion="Cuando un cliente pida la baja (por WhatsApp o a mano), va a aparecer acá."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
