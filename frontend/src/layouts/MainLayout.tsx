import { useEffect, useState } from "react";
import {
  ClipboardCheck,
  ClipboardList,
  GitBranch,
  Gift,
  KeyRound,
  LayoutDashboard,
  LogOut,
  LucideIcon,
  GitMerge,
  MessageSquareWarning,
  MessagesSquare,
  MonitorPlay,
  PhoneOff,
  ScrollText,
  Settings,
  ShieldCheck,
  SmilePlus,
  UploadCloud,
  Users,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getModoDemo, getUsuario, limpiarSesion, veTodasLasAreas } from "../lib/auth";
import { etiquetaArea } from "../lib/area";
import { apiGet, apiPostJson } from "../lib/api";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import PageTransition from "../components/ui/PageTransition";
import CartelAvisos from "../components/CartelAvisos";

const navItems: Array<{ to: string; label: string; icono: LucideIcon }> = [
  { to: "/dashboard", label: "Dashboard", icono: LayoutDashboard },
  { to: "/upload", label: "Carga de Excel", icono: UploadCloud },
  { to: "/casos", label: "Casos", icono: ClipboardList },
  { to: "/reportes/sentimiento", label: "Reporte de Sentimiento", icono: SmilePlus },
  { to: "/reportes/causas-raiz", label: "Causas Raíz", icono: GitBranch },
  { to: "/rqr", label: "RQR", icono: MessageSquareWarning },
  { to: "/seguimiento", label: "Seguimiento", icono: MessagesSquare },
  { to: "/refuerzos", label: "Refuerzo Ford", icono: ClipboardCheck },
  { to: "/fidelizacion", label: "Fidelización", icono: Gift },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/upload": "Carga de Excel — Contacto Posterior",
  "/casos": "Casos de Seguimiento",
  "/reportes/sentimiento": "Reporte de Sentimiento",
  "/reportes/causas-raiz": "Reporte de Causas Raíz",
  "/rqr": "Reclamos / Quejas / Reportes (RQR)",
  "/seguimiento": "Seguimiento — chat con el cliente",
  "/usuarios": "Usuarios del sistema",
  "/normalizacion": "Normalización de asesores / sucursales",
  "/supresion": "Lista de supresión (no contactar)",
  "/auditoria": "Auditoría del sistema",
  "/configuracion": "Configuración",
  "/refuerzos": "Refuerzo de encuesta Ford",
  "/fidelizacion": "Fidelización — recordatorio de service pendiente",
  "/cambiar-password": "Cambiar mi contraseña",
};

export default function MainLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const usuario = getUsuario();

  // Badge del sidebar: tareas de refuerzo PENDIENTES del usuario logueado
  const [pendientesRefuerzo, setPendientesRefuerzo] = useState(0);
  // Badge del sidebar: casos que esperan clasificación manual (del área del usuario)
  const [pendientesRevision, setPendientesRevision] = useState(0);
  useEffect(() => {
    apiGet<{ pendientes: number }>("/api/refuerzos/mias/pendientes")
      .then((r) => setPendientesRefuerzo(r.pendientes))
      .catch(() => {});
    apiGet<{ pendientes: number }>("/api/seguimiento/pendientes")
      .then((r) => setPendientesRevision(r.pendientes))
      .catch(() => {});
  }, [pathname]);

  const title =
    pageTitles[pathname] ??
    (pathname === "/rqr/nuevo"
      ? "Nuevo RQR"
      : pathname.startsWith("/rqr/")
        ? "Detalle de RQR"
        : "Calidad");

  // Los links de administración solo aparecen para ADMIN (el backend también lo
  // exige, así que ocultarlos acá es cosmético, no la protección real)
  const items =
    usuario?.rol === "ADMIN"
      ? [
          ...navItems,
          { to: "/usuarios", label: "Usuarios", icono: Users },
          { to: "/normalizacion", label: "Normalización", icono: GitMerge },
          { to: "/supresion", label: "Supresión", icono: PhoneOff },
          { to: "/auditoria", label: "Auditoría", icono: ScrollText },
          { to: "/configuracion", label: "Configuración", icono: Settings },
        ]
      : navItems;

  async function cerrarSesion() {
    // Logout efectivo del lado del servidor: revoca el token (denylist en Redis)
    // para que no siga siendo válido aunque quede copiado en algún lado.
    try {
      await apiPostJson("/api/auth/logout", {});
    } catch {
      // Aunque falle (token ya inválido, sin red), igual limpiamos la sesión local
    }
    limpiarSesion();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen bg-canvas">
      {/* Sidebar: navy sólido (sin degradé), indicador de sección activa lateral */}
      <aside className="flex w-64 flex-col bg-navy text-white">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-6 py-5">
          <ShieldCheck className="h-6 w-6 text-accent" aria-hidden="true" />
          <div>
            <h1 className="font-display text-base font-bold tracking-wide">Calidad Ford</h1>
            <p className="text-xs text-white/50">Contacto Posterior &amp; RQR</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-md border-l-[3px] py-2 pl-3 pr-3 text-sm transition-colors ${
                  isActive
                    ? "border-accent bg-white/[0.06] font-semibold text-white"
                    : "border-transparent text-white/60 hover:border-white/20 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <item.icono className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/refuerzos" && pendientesRefuerzo > 0 && (
                <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
                  {pendientesRefuerzo}
                </span>
              )}
              {item.to === "/seguimiento" && pendientesRevision > 0 && (
                <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
                  {pendientesRevision}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-4 text-xs text-white/40">v0.1.0 — Área de Calidad</div>
      </aside>

      {/* Contenido */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
            {!veTodasLasAreas(usuario) && usuario && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-navy/20 bg-navy/5 px-2.5 py-1 text-xs font-medium text-navy"
                title="Ves y gestionás solo los casos de tu área. Un administrador puede cambiarla."
              >
                Área: {etiquetaArea(usuario.area)}
              </span>
            )}
            {getModoDemo() && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-light px-2.5 py-1 text-xs font-medium text-accent-dark"
                title="Modo demostración: los envíos de WhatsApp están simulados."
              >
                <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />
                Modo demostración
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <div className="flex items-center justify-end gap-1.5 font-medium text-ink">
                {usuario?.nombre ?? "Usuario"}
                {usuario?.rol === "ADMIN" && <Badge tono="azul">Admin</Badge>}
              </div>
              <NavLink
                to="/cambiar-password"
                className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-accent-dark hover:underline"
              >
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                Cambiar contraseña
              </NavLink>
            </div>
            <button onClick={cerrarSesion} className={claseBoton("secundario", "!py-1.5 !text-xs")}>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Cerrar sesión
            </button>
          </div>
        </header>
        {/* Cartel rojo: RQR sin atender, clientes que escalaron, amarillos.
            Va debajo del encabezado y arriba del contenido, en todas las
            pantallas, hasta que alguien lo agarre. */}
        <CartelAvisos />
        <main className="flex-1 overflow-y-auto p-6">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
