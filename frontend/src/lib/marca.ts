// Identidad de la instancia: de qué marca es este sistema y qué módulos tiene.
// La define el backend (variable MARCA del proceso), no el usuario ni el login:
// cada marca corre su propia copia del sistema contra su propia base.
//
// Se consulta UNA vez al arrancar la app y queda cacheada en memoria. El
// frontend la usa para mostrar el nombre correcto, ocultar las pestañas de los
// módulos que la marca no usa, y saber si la satisfacción se muestra con
// semáforo (Ford) o con estrellas (Volkswagen).
//
// Ocultar una pestaña acá es SOLO cosmético: el backend además responde 404 en
// los endpoints de los módulos apagados.
import { apiGet } from "./api";

export type CodigoMarca = "FORD" | "VOLKSWAGEN";
export type EscalaSatisfaccion = "SEMAFORO" | "ESTRELLAS";

export interface InfoMarca {
  codigo: CodigoMarca;
  nombre: string;
  escala: EscalaSatisfaccion;
  estrellasSinRqr: number | null;
  modulos: {
    fidelizacion: boolean;
    refuerzo: boolean;
    // Pantalla propia de encuestas de fábrica (Volkswagen).
    encuestaFabrica: boolean;
    // Pantalla de desempeño de Posventa por ítems (Volkswagen).
    desempenoPosventa: boolean;
  };
  // Los 5 ítems que mide la encuesta de Posventa. Vacío en las marcas que no la usan.
  posventa: {
    porItems: boolean;
    items: Array<{ item: string; etiqueta: string; pregunta: string; descripcion: string }>;
  };
  // Catálogo del RQR de las marcas que clasifican por área + subárea (VW).
  // En las demás viene con porSubareas=false y las listas vacías.
  rqr: {
    porSubareas: boolean;
    /** El formulario de RQR permite marcar al cliente como anónimo. */
    clienteAnonimo: boolean;
    areas: Array<{
      valor: string;
      etiqueta: string;
      subareas: Array<{ valor: string; etiqueta: string }>;
    }>;
    origenes: Array<{ valor: string; etiqueta: string }>;
  };
}

// Ford es el default: si la consulta falla (backend caído, red), el sistema se
// comporta como el que ya está en producción en vez de quedarse sin pestañas.
const POR_DEFECTO: InfoMarca = {
  codigo: "FORD",
  nombre: "Ford",
  escala: "SEMAFORO",
  estrellasSinRqr: null,
  modulos: { fidelizacion: true, refuerzo: true, encuestaFabrica: false, desempenoPosventa: false },
  posventa: { porItems: false, items: [] },
  rqr: { porSubareas: false, clienteAnonimo: false, areas: [], origenes: [] },
};

let cache: InfoMarca = POR_DEFECTO;

/** La marca ya conocida. Sincrónico: sirve para renderizar sin esperar. */
export function getMarca(): InfoMarca {
  return cache;
}

/** Consulta la marca al backend y la deja cacheada. Se llama al arrancar la app. */
export async function cargarMarca(): Promise<InfoMarca> {
  try {
    cache = await apiGet<InfoMarca>("/api/marca");
  } catch {
    cache = POR_DEFECTO;
  }
  return cache;
}

/** true si esta marca mide con estrellas (1 a 5) en vez de semáforo. */
export function usaEstrellas(): boolean {
  return cache.escala === "ESTRELLAS";
}
