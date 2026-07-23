import { useCallback, useEffect, useState } from "react";
import { GitMerge, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPostJson } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select } from "../components/ui/Field";

interface Valor {
  nombre: string;
  codigo: string | null;
  clave: string;
  casos: number;
}
interface Alias {
  id: string;
  tipo: string;
  claveOrigen: string;
  valorCanonico: string;
  codigoCanonico: string | null;
  creadoEn: string;
  creadoPor: { nombre: string } | null;
}

export default function Normalizacion() {
  const [tipo, setTipo] = useState<"ASESOR" | "SUCURSAL">("ASESOR");
  const [valores, setValores] = useState<Valor[]>([]);
  const [alias, setAlias] = useState<Alias[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [variante, setVariante] = useState("");
  const [canonico, setCanonico] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [v, a] = await Promise.all([
        apiGet<{ valores: Valor[] }>(`/api/normalizacion/valores?tipo=${tipo}`),
        apiGet<{ data: Alias[] }>("/api/normalizacion/alias"),
      ]);
      setValores(v.valores);
      setAlias(a.data.filter((x) => x.tipo === tipo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar los datos.");
    }
  }, [tipo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Detecta posibles variantes NO unificadas: claves que se parecen (una es
  // prefijo/está contenida en otra). Es una ayuda visual, no automática.
  const claves = valores.map((v) => v.clave);
  const sospechosa = (v: Valor) =>
    claves.some((k) => k !== v.clave && (k.includes(v.clave) || v.clave.includes(k)));

  async function crearAlias() {
    if (!variante.trim() || !canonico.trim()) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/normalizacion/alias", {
        tipo,
        valorVariante: variante.trim(),
        valorCanonico: canonico.trim(),
      });
      setMensaje(r.message);
      setVariante("");
      setCanonico("");
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear el alias.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrarAlias(id: string) {
    setError(null);
    try {
      const r = await apiDelete<{ message: string }>(`/api/normalizacion/alias/${id}`);
      setMensaje(r.message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos borrar el alias.");
    }
  }

  return (
    <div className="space-y-4">
      <Alert tono="info">
        <p className="flex items-center gap-2 font-medium">
          <GitMerge className="h-4 w-4" aria-hidden="true" />
          Normalización de {tipo === "ASESOR" ? "asesores" : "sucursales"}
        </p>
        <p className="mt-1 text-sm">
          El sistema unifica automáticamente las variantes de formato (mayúsculas, código al final). Acá podés revisar los
          valores que quedaron y, si ves dos que son la misma persona pero no se unificaron (ej. "C. Campora" y "Carla
          Campora"), declarar un alias. Se aplica a los reportes, los rankings y las importaciones futuras.
        </p>
      </Alert>

      <div className="flex items-center gap-3">
        <Campo etiqueta="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as "ASESOR" | "SUCURSAL")}>
            <option value="ASESOR">Asesor</option>
            <option value="SUCURSAL">Sucursal</option>
          </Select>
        </Campo>
      </div>

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Crear alias */}
      <Card className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Valor variante (a unificar)">
          <Input value={variante} placeholder='Ej: "C. Campora"' onChange={(e) => setVariante(e.target.value)} />
        </Campo>
        <Campo etiqueta="Valor correcto (canónico)">
          <Input value={canonico} placeholder='Ej: "Carla Campora"' onChange={(e) => setCanonico(e.target.value)} />
        </Campo>
        <button onClick={crearAlias} disabled={guardando || !variante.trim() || !canonico.trim()} className={claseBoton("primario")}>
          <GitMerge className="h-4 w-4" aria-hidden="true" />
          {guardando ? "Unificando…" : "Unificar"}
        </button>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Valores distintos */}
        <Card padding="p-0" className="overflow-x-auto">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold text-ink">
            <Users className="h-4 w-4 text-accent" aria-hidden="true" />
            Valores en la base ({valores.length})
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2 text-right">Casos</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {valores.map((v) => (
                <tr key={v.clave + v.nombre} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-ink">
                    {v.nombre}
                    {sospechosa(v) && (
                      <Badge tono="amarillo" className="ml-2" title="Se parece a otro valor: revisá si es la misma persona">
                        revisar
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{v.codigo ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium text-ink">{v.casos}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setVariante(v.nombre)} className="text-xs text-accent-dark hover:underline">
                      unificar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Alias declarados */}
        <Card padding="p-0" className="overflow-x-auto">
          <div className="border-b px-3 py-2 text-sm font-semibold text-ink">Alias declarados ({alias.length})</div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                <th className="px-3 py-2">Variante (clave)</th>
                <th className="px-3 py-2">Se unifica como</th>
                <th className="px-3 py-2 text-center">Acción</th>
              </tr>
            </thead>
            <tbody>
              {alias.map((a) => (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-ink-muted">{a.claveOrigen}</td>
                  <td className="px-3 py-2 text-ink">{a.valorCanonico}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => borrarAlias(a.id)} className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {alias.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-ink-muted">
                    Todavía no hay alias declarados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
