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
  };
}

// Ford es el default: si la consulta falla (backend caído, red), el sistema se
// comporta como el que ya está en producción en vez de quedarse sin pestañas.
const POR_DEFECTO: InfoMarca = {
  codigo: "FORD",
  nombre: "Ford",
  escala: "SEMAFORO",
  estrellasSinRqr: null,
  modulos: { fidelizacion: true, refuerzo: true },
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
