// Gestión de cuentas del equipo, solo visible para ADMIN (el backend además
// lo exige con requireAdmin, así que esta pantalla es la puerta, no la reja).
import { Fragment, FormEvent, useCallback, useEffect, useState } from "react";
import { UserPlus, Users as UsersIcon } from "lucide-react";
import { apiGet, apiPatchJson, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";
import { etiquetaArea } from "../lib/area";

type AreaUsuario = "VENTAS" | "POSVENTA" | "AMBAS";

interface UsuarioFila {
  id: string;
  nombre: string;
  email: string;
  rol: "ADMIN" | "CALIDAD";
  area: AreaUsuario;
  sucursal: string | null; // provincia; null = todas
  activo: boolean;
  participaEnRefuerzos: boolean;
  createdAt: string;
}

const ROL_LABEL: Record<string, string> = { ADMIN: "Administrador", CALIDAD: "Calidad" };
const AREAS_USUARIO: AreaUsuario[] = ["AMBAS", "VENTAS", "POSVENTA"];
const TODAS_PROVINCIAS = "__todas__"; // valor del select "Todas" (el back recibe "")

export default function Usuarios() {
  const usuarioActual = getUsuario();
  const [usuarios, setUsuarios] = useState<UsuarioFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Alta de cuenta
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<"ADMIN" | "CALIDAD">("CALIDAD");
  const [areaNueva, setAreaNueva] = useState<AreaUsuario>("AMBAS");
  const [sucursalNueva, setSucursalNueva] = useState(""); // "" = todas las provincias
  const [creando, setCreando] = useState(false);

  // Provincias existentes (de los casos), para el selector de provincia.
  const [sucursales, setSucursales] = useState<string[]>([]);
  useEffect(() => {
    apiGet<{ sucursales: string[] }>("/api/casos/opciones")
      .then((r) => setSucursales(r.sucursales ?? []))
      .catch(() => {});
  }, []);

  // Restablecer contraseña (inline por fila)
  const [resetAbierto, setResetAbierto] = useState<string | null>(null);
  const [passwordReset, setPasswordReset] = useState("");
  const [reseteando, setReseteando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const { data } = await apiGet<{ data: UsuarioFila[] }>("/api/usuarios");
      setUsuarios(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el listado de usuarios.");
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crearUsuario(e: FormEvent) {
    e.preventDefault();
    setCreando(true);
    setError(null);
    setMensaje(null);
    try {
      const { message } = await apiPostJson<{ message: string }>("/api/usuarios", {
        nombre,
        email,
        password,
        rol,
        area: areaNueva,
        sucursal: sucursalNueva.trim(), // "" = todas las provincias
      });
      setMensaje(message);
      setNombre("");
      setEmail("");
      setPassword("");
      setRol("CALIDAD");
      setAreaNueva("AMBAS");
      setSucursalNueva("");
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear el usuario.");
    } finally {
      setCreando(false);
    }
  }

  async function confirmarReset(id: string) {
    setReseteando(true);
    setError(null);
    setMensaje(null);
    try {
      const { message } = await apiPatchJson<{ message: string }>(`/api/usuarios/${id}/resetear-password`, {
        passwordNueva: passwordReset,
      });
      setMensaje(message);
      setResetAbierto(null);
      setPasswordReset("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos restablecer la contraseña.");
    } finally {
      setReseteando(false);
    }
  }

  async function toggleActivo(u: UsuarioFila) {
    setError(null);
    setMensaje(null);
    try {
      const { message } = await apiPatchJson<{ message: string }>(`/api/usuarios/${u.id}`, {
        activo: !u.activo,
      });
      setMensaje(message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos actualizar el usuario.");
    }
  }

  async function toggleRefuerzos(u: UsuarioFila) {
    setError(null);
    setMensaje(null);
    try {
      await apiPatchJson<{ message: string }>(`/api/usuarios/${u.id}`, {
        participaEnRefuerzos: !u.participaEnRefuerzos,
      });
      setMensaje(
        `${u.nombre} ${!u.participaEnRefuerzos ? "ahora participa" : "ya no participa"} del reparto de refuerzos.`
      );
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos actualizar el usuario.");
    }
  }

  async function cambiarArea(u: UsuarioFila, nuevaArea: AreaUsuario) {
    if (nuevaArea === u.area) return;
    setError(null);
    setMensaje(null);
    try {
      // El backend avisa en el message si quedan tareas abiertas de la otra área.
      const { message } = await apiPatchJson<{ message: string }>(`/api/usuarios/${u.id}`, { area: nuevaArea });
      setMensaje(message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el área.");
    }
  }

  async function cambiarSucursal(u: UsuarioFila, valorSelect: string) {
    const nueva = valorSelect === TODAS_PROVINCIAS ? "" : valorSelect;
    if (nueva === (u.sucursal ?? "")) return;
    setError(null);
    setMensaje(null);
    try {
      const { message } = await apiPatchJson<{ message: string }>(`/api/usuarios/${u.id}`, { sucursal: nueva });
      setMensaje(message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar la provincia.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      <Card padding="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
          <UserPlus className="h-4 w-4 text-accent" aria-hidden="true" />
          Crear cuenta nueva
        </h3>
        <form onSubmit={crearUsuario} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Nombre">
            <Input required value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo etiqueta="Email">
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <Campo etiqueta="Contraseña inicial" hint="Mínimo 8 caracteres">
            <Input
              required
              type="text"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </Campo>
          <Campo etiqueta="Rol">
            <Select value={rol} onChange={(e) => setRol(e.target.value as "ADMIN" | "CALIDAD")}>
              <option value="CALIDAD">Calidad</option>
              <option value="ADMIN">Administrador</option>
            </Select>
          </Campo>
          {/* El administrador ve/gestiona todo: no se le pide área ni provincia. */}
          {rol === "ADMIN" ? (
            <Campo etiqueta="Alcance">
              <Input disabled value="Todas las áreas y provincias" />
            </Campo>
          ) : (
            <>
              <Campo etiqueta="Área" hint="Qué gestiona (Ventas / Posventa / Ambas)">
                <Select value={areaNueva} onChange={(e) => setAreaNueva(e.target.value as AreaUsuario)}>
                  {AREAS_USUARIO.map((a) => (
                    <option key={a} value={a}>
                      {etiquetaArea(a)}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo etiqueta="Provincia" hint="Dejar vacío = todas. Un refuerzo de otra provincia no se le asigna.">
                <Input
                  list="provincias-lista"
                  value={sucursalNueva}
                  onChange={(e) => setSucursalNueva(e.target.value)}
                  placeholder="Todas las provincias"
                />
                <datalist id="provincias-lista">
                  {sucursales.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Campo>
            </>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={creando} className={claseBoton("primario")}>
              {creando ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-ink-muted">
          Todavía no hay envío de mail: comunicale la contraseña inicial a la persona por otro medio. Puede
          cambiarla apenas entra, desde "Cambiar contraseña" en el menú superior.
        </p>
      </Card>

      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Provincia</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Refuerzos</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(usuarios ?? []).map((u) => (
              <Fragment key={u.id}>
                <tr className="border-b border-gray-100 transition-colors hover:bg-gray-50">
                  <td className="px-3 py-2 text-ink">{u.nombre}</td>
                  <td className="px-3 py-2 text-ink-muted">{u.email}</td>
                  <td className="px-3 py-2 text-ink-muted">{ROL_LABEL[u.rol]}</td>
                  <td className="px-3 py-2">
                    {u.rol === "ADMIN" ? (
                      <span className="text-xs text-ink-muted" title="El administrador ve todas las áreas">
                        todas
                      </span>
                    ) : (
                      <Select value={u.area} onChange={(e) => cambiarArea(u, e.target.value as AreaUsuario)}>
                        {AREAS_USUARIO.map((a) => (
                          <option key={a} value={a}>
                            {etiquetaArea(a)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.rol === "ADMIN" ? (
                      <span className="text-xs text-ink-muted" title="El administrador ve todas las provincias">
                        todas
                      </span>
                    ) : (
                      <Select
                        value={u.sucursal ?? TODAS_PROVINCIAS}
                        onChange={(e) => cambiarSucursal(u, e.target.value)}
                      >
                        <option value={TODAS_PROVINCIAS}>Todas</option>
                        {/* La provincia actual, aunque no esté en la lista de casos */}
                        {u.sucursal && !sucursales.includes(u.sucursal) && (
                          <option value={u.sucursal}>{u.sucursal}</option>
                        )}
                        {sucursales.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tono={u.activo ? "verde" : "gris"}>{u.activo ? "Activo" : "Desactivado"}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {u.rol === "CALIDAD" ? (
                      <button
                        onClick={() => toggleRefuerzos(u)}
                        className="text-xs font-medium hover:underline"
                        title="Participa del reparto equitativo de tareas de refuerzo"
                      >
                        <Badge tono={u.participaEnRefuerzos ? "verde" : "gris"}>
                          {u.participaEnRefuerzos ? "Participa" : "No participa"}
                        </Badge>
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="space-x-3 px-3 py-2">
                    <button
                      onClick={() => {
                        setResetAbierto(resetAbierto === u.id ? null : u.id);
                        setPasswordReset("");
                      }}
                      className="text-xs font-medium text-accent-dark hover:underline"
                    >
                      Restablecer contraseña
                    </button>
                    <button
                      onClick={() => toggleActivo(u)}
                      disabled={u.id === usuarioActual?.id && u.activo}
                      title={
                        u.id === usuarioActual?.id && u.activo
                          ? "No podés desactivar tu propia cuenta"
                          : undefined
                      }
                      className="text-xs font-medium text-ink-muted hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {u.activo ? "Desactivar" : "Reactivar"}
                    </button>
                  </td>
                </tr>
                {resetAbierto === u.id && (
                  <tr className="border-b border-gray-100 bg-accent-light/50">
                    <td colSpan={8} className="px-3 py-3">
                      <div className="flex items-end gap-2">
                        <Campo etiqueta={`Nueva contraseña para ${u.nombre}`}>
                          <Input
                            type="text"
                            minLength={8}
                            value={passwordReset}
                            onChange={(e) => setPasswordReset(e.target.value)}
                            placeholder="Mínimo 8 caracteres"
                            className="w-64"
                          />
                        </Campo>
                        <button
                          onClick={() => confirmarReset(u.id)}
                          disabled={reseteando || passwordReset.length < 8}
                          className={claseBoton("primario", "!py-1.5")}
                        >
                          Confirmar
                        </button>
                        <button onClick={() => setResetAbierto(null)} className={claseBoton("fantasma", "!py-1.5 border border-gray-300")}>
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {usuarios && usuarios.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState icono={UsersIcon} titulo="Todavía no hay usuarios cargados" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
