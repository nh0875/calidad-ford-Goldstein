// EL ÚNICO LUGAR donde viven las diferencias entre las marcas.
//
// El sistema corre el mismo código para Ford y para Volkswagen, cada uno en su
// propio proceso y contra su propia base (ver docker-compose.prod.yml). Lo que
// cambia entre las dos NO se desparrama por el código con `if marca === ...`:
// se declara acá una sola vez y el resto del sistema consulta este perfil.
//
// Si mañana entra una tercera marca, se agrega una entrada acá y se completa lo
// que falte; no hay que salir a buscar condicionales por todos lados.
//
// La marca la fija la variable de entorno MARCA al arrancar el proceso. Por
// defecto FORD, así que el sistema que YA está en producción no cambia en nada
// aunque no se defina la variable.

/** Cómo se mide la satisfacción del cliente en esta marca. */
export type EscalaSatisfaccion =
  | "SEMAFORO" // Ford: VERDE / AMARILLO / ROJO + severidad
  | "ESTRELLAS"; // Volkswagen: 1 a 5, 5 el más alto

export type CodigoMarca = "FORD" | "VOLKSWAGEN";

export interface PerfilMarca {
  codigo: CodigoMarca;
  /** Nombre para mostrar en pantallas, reportes y documentos. */
  nombre: string;
  escala: EscalaSatisfaccion;
  /**
   * Puntaje MÁXIMO que NO abre un RQR automático. Todo lo que esté por debajo
   * escala. En Volkswagen es 5: cualquier caso que no sea 5 estrellas abre RQR
   * (decisión del área de Calidad; genera bastante volumen a propósito).
   * En Ford no aplica: la regla la maneja el semáforo (ver aplicarReglaRQR).
   */
  estrellasSinRqr: number | null;
  /** Módulo de Fidelización (recordatorio para que el cliente vuelva al taller). */
  fidelizacion: boolean;
  /**
   * El RQR se clasifica por ÁREA + SUBÁREA (Volkswagen) además de por causa
   * raíz. Ford no lo usa: su RQR se clasifica solo por causa raíz.
   */
  rqrConSubareas: boolean;
  /**
   * Refuerzo de la encuesta de fábrica. Las dos marcas lo tienen (fábrica manda
   * la encuesta al mail del cliente), pero se gestiona distinto:
   *  - Ford: los asesores entran al sistema y trabajan sus tareas.
   *  - Volkswagen: los vendedores NO entran; la administradora asigna y el
   *    sistema le manda a cada vendedor un mail con sus clientes.
   */
  refuerzo: {
    habilitado: boolean;
    notificarPorMail: boolean;
    /**
     * Formato del Excel de la encuesta que baja de fábrica. Son dos archivos
     * distintos y se leen con lectores distintos:
     *  - "FORD": un export con "ID encuesta" y "Estado de la invitación". Trae
     *    teléfono, así que se cruza contra los Casos que ya existen.
     *  - "VW": una hoja por sucursal con los PENDIENTES, más una hoja con los
     *    nombres de los vendedores. NO trae teléfono: esos clientes no pueden
     *    entrar al circuito de WhatsApp y viven en una lista aparte.
     */
    formatoExcel: "FORD" | "VW";
  };
  /** Color institucional para los títulos de los documentos que se exportan. */
  colorDocumento: string;
  /** Nombre del archivo del logo dentro de backend/assets (ver su README). */
  logoArchivo: string;
}

const PERFILES: Record<CodigoMarca, PerfilMarca> = {
  FORD: {
    codigo: "FORD",
    nombre: "Ford",
    escala: "SEMAFORO",
    estrellasSinRqr: null,
    fidelizacion: true,
    rqrConSubareas: false,
    refuerzo: { habilitado: true, notificarPorMail: false, formatoExcel: "FORD" },
    colorDocumento: "003478", // azul Ford
    logoArchivo: "logo-ford.png",
  },
  VOLKSWAGEN: {
    codigo: "VOLKSWAGEN",
    nombre: "Volkswagen",
    escala: "ESTRELLAS",
    // "Todo lo que no sea 5 abre RQR".
    estrellasSinRqr: 5,
    // Volkswagen no usa Fidelización: las pantallas no se muestran y sus
    // endpoints responden 404 (ver requireModulo en middlewares/marca.ts).
    fidelizacion: false,
    rqrConSubareas: true,
    refuerzo: { habilitado: true, notificarPorMail: true, formatoExcel: "VW" },
    colorDocumento: "001E50", // azul Volkswagen
    logoArchivo: "logo-volkswagen.png",
  },
};

function resolverMarca(): PerfilMarca {
  const crudo = (process.env.MARCA ?? "FORD").trim().toUpperCase();
  // Se aceptan alias cómodos para no pelear con el .env ("VW", "vw").
  const codigo: CodigoMarca =
    crudo === "VW" || crudo === "VOLKSWAGEN" ? "VOLKSWAGEN" : "FORD";
  if (crudo !== "FORD" && codigo === "FORD" && crudo !== "") {
    // Un typo en la variable (ej. MARCA=VOLSKWAGEN) dejaría el sistema corriendo
    // como Ford en silencio: mejor avisarlo fuerte en el arranque.
    console.warn(
      `[marca] MARCA="${crudo}" no se reconoce. Valores válidos: FORD, VOLKSWAGEN (o VW). Se usa FORD.`
    );
  }
  return PERFILES[codigo];
}

export const marca: PerfilMarca = resolverMarca();

/** true si esta instancia usa estrellas (Volkswagen) en vez de semáforo (Ford). */
export const usaEstrellas = (): boolean => marca.escala === "ESTRELLAS";

/**
 * ¿Este puntaje en estrellas abre un RQR automático?
 * Devuelve false si la marca no usa estrellas o si no vino puntaje.
 */
export function estrellasAbrenRqr(estrellas: number | null | undefined): boolean {
  if (!usaEstrellas() || estrellas === null || estrellas === undefined) return false;
  const tope = marca.estrellasSinRqr;
  if (tope === null) return false;
  return estrellas < tope;
}
