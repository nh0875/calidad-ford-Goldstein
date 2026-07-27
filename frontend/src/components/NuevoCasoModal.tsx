import { FormEvent, useState } from "react";
import { Pencil, UserPlus } from "lucide-react";
import { apiPatchJson, apiPostJson } from "../lib/api";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { AREAS, etiquetaArea } from "../lib/area";
import { Alert } from "./ui/Alert";
import { claseBoton } from "./ui/Button";
import { Campo, Input, Select, Textarea } from "./ui/Field";

// Modal de caso, en dos modos:
//  - ALTA: cliente que no vino en el Excel (llamó, se traspapeló, entró tarde).
//  - EDICIÓN: corregir datos mal cargados de un caso existente.
// Misma normalización que la importación (la hace el backend), así no ensucia
// los rankings de asesores.

// Datos mínimos del caso a editar (vienen del listado de /casos).
export interface CasoEditable {
  id: string;
  nombrePropietario: string;
  whatsapp: string;
  celular: string;
  modelo: string;
  patente: string;
  asesor: string;
  sucursal: string;
  fechaProgramacion: string; // ISO
  numeroOrden: string;
  emailPropietario: string | null;
  origenAgendamiento: string;
  area: string;
  comentarioAsesor: string | null;
}

interface Props {
  // Valores ya presentes en la base, para no tipear a mano y evitar
  // "San Juan" / "san juan " como dos sucursales distintas.
  sucursales: string[];
  asesores: string[];
  // Si viene un caso, el modal está en modo EDICIÓN; si no, en modo ALTA.
  caso?: CasoEditable | null;
  onCancelar: () => void;
  onGuardado: (mensaje: string) => void;
}

const ORIGENES = ["DEALER", "FORDPASS", "ONLINEBOOKING", "OTRO"];

function hoyISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function NuevoCasoModal({ sucursales, asesores, caso, onCancelar, onGuardado }: Props) {
  const usuario = getUsuario();
  const eligeArea = veTodasLasAreas(usuario); // si está restringido, el backend fuerza la suya
  const esEdicion = !!caso;

  const [form, setForm] = useState({
    nombrePropietario: caso?.nombrePropietario ?? "",
    whatsapp: caso?.whatsapp ?? "",
    celular: caso?.celular ?? "",
    modelo: caso?.modelo ?? "",
    patente: caso?.patente ?? "",
    asesor: caso?.asesor ?? "",
    sucursal: caso?.sucursal ?? (sucursales.length === 1 ? sucursales[0] : ""),
    fechaProgramacion: caso ? caso.fechaProgramacion.slice(0, 10) : hoyISO(),
    // "S/N" es el placeholder de "sin orden": en el form se muestra vacío.
    numeroOrden: caso && caso.numeroOrden !== "S/N" ? caso.numeroOrden : "",
    emailPropietario: caso?.emailPropietario ?? "",
    origenAgendamiento: caso?.origenAgendamiento ?? "DEALER",
    area: caso?.area ?? (usuario && usuario.area !== "AMBAS" ? usuario.area : "POSVENTA"),
    comentarioAsesor: caso?.comentarioAsesor ?? "",
  });
  // Sucursal y asesor: desplegable con los valores existentes + opción de
  // escribir uno nuevo. Al editar, si el valor actual no está en la lista, se
  // arranca en modo "escribir" con el valor cargado para no perderlo.
  const [sucursalNueva, setSucursalNueva] = useState(
    sucursales.length === 0 || (esEdicion && !!caso && !sucursales.includes(caso.sucursal))
  );
  const [asesorNuevo, setAsesorNuevo] = useState(
    asesores.length === 0 || (esEdicion && !!caso && !asesores.includes(caso.asesor))
  );

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cambiar<K extends keyof typeof form>(campo: K, valor: string) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.whatsapp.trim() && !form.celular.trim()) {
      setError("Ingresá al menos un teléfono: sin número no se puede contactar al cliente.");
      return;
    }

    setGuardando(true);
    try {
      const cuerpo: Record<string, unknown> = {
        nombrePropietario: form.nombrePropietario.trim(),
        modelo: form.modelo.trim(),
        asesor: form.asesor.trim(),
        sucursal: form.sucursal.trim(),
        fechaProgramacion: form.fechaProgramacion,
        origenAgendamiento: form.origenAgendamiento,
      };
      if (form.whatsapp.trim()) cuerpo.whatsapp = form.whatsapp.trim();
      if (form.celular.trim()) cuerpo.celular = form.celular.trim();
      if (form.patente.trim()) cuerpo.patente = form.patente.trim();
      if (form.numeroOrden.trim()) cuerpo.numeroOrden = form.numeroOrden.trim();
      if (form.emailPropietario.trim()) cuerpo.emailPropietario = form.emailPropietario.trim();
      if (form.comentarioAsesor.trim()) cuerpo.comentarioAsesor = form.comentarioAsesor.trim();
      if (eligeArea) cuerpo.area = form.area;

      const { message } = esEdicion
        ? await apiPatchJson<{ message: string }>(`/api/casos/${caso!.id}`, cuerpo)
        : await apiPostJson<{ message: string }>("/api/casos", cuerpo);
      onGuardado(message);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : esEdicion
            ? "No pudimos guardar los cambios. Probá de nuevo."
            : "No pudimos crear el caso. Probá de nuevo."
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/50 p-4">
      <form
        onSubmit={guardar}
        className="my-8 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl motion-safe:animate-fade-slide-in"
      >
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          {esEdicion ? (
            <>
              <Pencil className="h-5 w-5 text-accent" aria-hidden="true" />
              Editar caso
            </>
          ) : (
            <>
              <UserPlus className="h-5 w-5 text-accent" aria-hidden="true" />
              Agregar caso manualmente
            </>
          )}
        </h3>
        <p className="mt-2 text-sm text-ink-muted">
          {esEdicion ? (
            <>Corregí los datos que estén mal cargados. No cambia el estado de contacto ni la conversación.</>
          ) : (
            <>
              Para el cliente que no vino en el Excel. Queda en estado <strong>Pendiente</strong>: no se le manda
              nada hasta que lo selecciones y confirmes el envío.
            </>
          )}
        </p>

        {error && (
          <div className="mt-4">
            <Alert tono="error">{error}</Alert>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Campo etiqueta="Nombre del cliente *">
              <Input
                autoFocus
                required
                value={form.nombrePropietario}
                onChange={(e) => cambiar("nombrePropietario", e.target.value)}
                placeholder="Ej: María González"
              />
            </Campo>
          </div>

          <Campo etiqueta="WhatsApp" hint="Con característica, sin 0 ni 15. Ej: 2615604200">
            <Input
              value={form.whatsapp}
              onChange={(e) => cambiar("whatsapp", e.target.value)}
              placeholder="2615604200"
              inputMode="tel"
            />
          </Campo>
          <Campo etiqueta="Celular alternativo" hint="Opcional, si el WhatsApp es otro número">
            <Input
              value={form.celular}
              onChange={(e) => cambiar("celular", e.target.value)}
              placeholder="2614000000"
              inputMode="tel"
            />
          </Campo>

          <Campo etiqueta="Modelo *">
            <Input
              required
              value={form.modelo}
              onChange={(e) => cambiar("modelo", e.target.value)}
              placeholder="Ej: Ranger XLT"
            />
          </Campo>
          <Campo etiqueta="Patente">
            <Input
              value={form.patente}
              onChange={(e) => cambiar("patente", e.target.value.toUpperCase())}
              placeholder="AB123CD"
            />
          </Campo>

          {/* Asesor: preferimos el desplegable para que el nombre coincida con
              los que ya están cargados y el ranking no se parta en dos. */}
          <Campo
            etiqueta="Asesor *"
            hint={asesorNuevo && asesores.length > 0 ? "Escribilo igual que en el Excel para que no se duplique" : undefined}
          >
            {asesorNuevo ? (
              <Input
                required
                value={form.asesor}
                onChange={(e) => cambiar("asesor", e.target.value)}
                placeholder="Ej: Carla Campora"
              />
            ) : (
              <Select required value={form.asesor} onChange={(e) => cambiar("asesor", e.target.value)}>
                <option value="">Elegí un asesor…</option>
                {asesores.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            )}
            {asesores.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAsesorNuevo((v) => !v);
                  cambiar("asesor", "");
                }}
                className="mt-1 text-xs font-medium text-accent-dark hover:underline"
              >
                {asesorNuevo ? "Elegir uno de la lista" : "Escribir un asesor nuevo"}
              </button>
            )}
          </Campo>

          <Campo etiqueta="Sucursal *">
            {sucursalNueva ? (
              <Input
                required
                value={form.sucursal}
                onChange={(e) => cambiar("sucursal", e.target.value)}
                placeholder="Ej: San Juan"
              />
            ) : (
              <Select required value={form.sucursal} onChange={(e) => cambiar("sucursal", e.target.value)}>
                <option value="">Elegí una sucursal…</option>
                {sucursales.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
            {sucursales.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSucursalNueva((v) => !v);
                  cambiar("sucursal", "");
                }}
                className="mt-1 text-xs font-medium text-accent-dark hover:underline"
              >
                {sucursalNueva ? "Elegir una de la lista" : "Escribir una sucursal nueva"}
              </button>
            )}
          </Campo>

          <Campo etiqueta="Fecha de la visita *" hint="Define el período al que se imputa el caso">
            <Input
              required
              type="date"
              value={form.fechaProgramacion}
              onChange={(e) => cambiar("fechaProgramacion", e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Número de orden" hint="Si no lo tenés, queda como S/N">
            <Input
              value={form.numeroOrden}
              onChange={(e) => cambiar("numeroOrden", e.target.value)}
              placeholder="Ej: 123456"
            />
          </Campo>

          <Campo etiqueta="Email del cliente">
            <Input
              type="email"
              value={form.emailPropietario}
              onChange={(e) => cambiar("emailPropietario", e.target.value)}
              placeholder="cliente@mail.com"
            />
          </Campo>
          <Campo etiqueta="Origen del agendamiento">
            <Select
              value={form.origenAgendamiento}
              onChange={(e) => cambiar("origenAgendamiento", e.target.value)}
            >
              {ORIGENES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Campo>

          {eligeArea ? (
            <Campo etiqueta="Área *">
              <Select value={form.area} onChange={(e) => cambiar("area", e.target.value)}>
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {etiquetaArea(a)}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : (
            <Campo etiqueta="Área">
              <Input disabled value={etiquetaArea(usuario?.area)} />
            </Campo>
          )}

          <div className="sm:col-span-2">
            <Campo etiqueta="Comentario del asesor" hint="Opcional: contexto del servicio, reclamos previos, etc.">
              <Textarea
                rows={2}
                value={form.comentarioAsesor}
                onChange={(e) => cambiar("comentarioAsesor", e.target.value)}
              />
            </Campo>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={guardando}
            className={claseBoton("fantasma", "border border-gray-300")}
          >
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className={claseBoton("primario")}>
            {guardando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Crear caso"}
          </button>
        </div>
      </form>
    </div>
  );
}
