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
   * El formulario de RQR permite marcar que el cliente NO quiso identificarse.
   * Lo pidió Calidad de Volkswagen: les entran reclamos de gente que no da el
   * nombre, y hasta ahora quedaban como "(sin datos)", igual que un dato que
   * alguien se olvidó de cargar. Prenderlo en Ford es cambiar este false.
   */
  rqrClienteAnonimo: boolean;
  /**
   * La encuesta de POSVENTA se mide por ÍTEMS (trato, organización, calidad de
   * reparación, lavado y satisfacción general) en vez de con una sola nota.
   *
   * Es un pedido de Calidad de VW: Posventa pasa por varias manos distintas y
   * con una nota sola no se sabe cuál falló. Ventas sigue con la clasificación
   * de siempre —es otro circuito, con otra gente y otros tiempos—, así que esto
   * aplica SOLO a los casos de área POSVENTA.
   */
  posventaPorItems: boolean;
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
  /**
   * La separación por PROVINCIA se aplica en TODO el sistema (listados, tableros,
   * reportes, campañas) además de por área.
   *
   * En Volkswagen sí: se pidió expresamente que alguien de Mendoza no vea nada de
   * San Juan. En Ford NO, y no es un descuido: es una decisión del dueño de agosto
   * 2026 —"provincia solo en Seguimiento"— para que los tableros den panorama
   * completo. Ford sigue filtrando por provincia únicamente donde lo hacía:
   * Seguimiento, Refuerzos y Fidelización, que tienen su propio filtro.
   */
  visibilidadPorProvincia: boolean;
  /**
   * Avisar cuando entra un caso del mismo auto (mismo chasis o patente) con OTRO
   * número de orden. Es un pedido de Volkswagen; en Ford el cartel no aparece.
   */
  avisoPosibleDuplicado: boolean;
  /**
   * El circuito de INSISTENCIA: si el cliente no contesta el primer contacto a
   * las 24 h se le manda la plantilla "segundo_contacto"; si a las 24 h de esa
   * tampoco contestó, el caso queda para que lo llame Calidad por teléfono.
   *
   * En Ford está apagado y no es un olvido: allá un caso sin respuesta pasa a
   * NO_RESPONDIO y se termina ahí, que es como viene funcionando. Prenderlo
   * significaría empezar a mandarle un segundo WhatsApp a clientes reales de
   * Ford sin que nadie lo haya pedido.
   */
  segundoContacto: boolean;
  /**
   * Las sucursales REALES de esta marca, en el orden en que se ofrecen.
   *
   * Es una lista CERRADA a propósito. Antes la sucursal se escribía a mano y las
   * opciones salían de lo que ya había en la base, así que un typo hecho una vez
   * ("San juan", "SAN JUAN ", "Sanjuan") quedaba como opción para siempre y
   * rompía en silencio las reglas de visibilidad: un usuario asignado a "San
   * Juan" deja de ver todo lo que quedó cargado como "San juan ", y la pantalla
   * no da ninguna pista de por qué. Ya pasó, y costó días encontrarlo.
   *
   * "General" NO va acá: no es una sucursal sino la ausencia de una, y cada
   * pantalla decide si ofrecerla y cómo llamarla (en las cargas es "General", en
   * los usuarios es "todas las provincias").
   */
  sucursales: string[];
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
    rqrClienteAnonimo: false,
    posventaPorItems: false,
    refuerzo: { habilitado: true, notificarPorMail: false, formatoExcel: "FORD" },
    visibilidadPorProvincia: false,
    avisoPosibleDuplicado: false,
    segundoContacto: false,
    sucursales: ["Mendoza", "San Juan"],
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
    rqrClienteAnonimo: true,
    posventaPorItems: true,
    refuerzo: { habilitado: true, notificarPorMail: true, formatoExcel: "VW" },
    visibilidadPorProvincia: true,
    avisoPosibleDuplicado: true,
    segundoContacto: true,
    sucursales: ["Mendoza", "San Juan"],
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

/**
 * Lo que se guarda cuando una carga no pertenece a una sucursal en particular.
 *
 * OJO CON LO QUE SIGNIFICA: un registro rotulado así NO lo ve nadie que tenga una
 * provincia asignada, porque "General" no coincide con "Mendoza" ni con "San
 * Juan". Solo lo ven los usuarios sin provincia (que ven todo). Es correcto, pero
 * sorprende, así que las pantallas lo avisan al elegirlo.
 */
export const SUCURSAL_GENERAL = "General";

/** Todo lo que se acepta como sucursal al guardar: las reales más "General". */
export function sucursalesValidas(): string[] {
  return [...marca.sucursales, SUCURSAL_GENERAL];
}

/**
 * Devuelve la sucursal ESCRITA COMO CORRESPONDE, o null si no es una de las
 * válidas.
 *
 * Compara sin distinguir mayúsculas, tildes ni espacios de más, así que
 * "SAN JUAN", "san  juan" y "San Juán" entran todas como "San Juan". Lo que NO
 * hace es adivinar: "Sanjuan" o "Mendosa" devuelven null y el pedido se rechaza.
 *
 * Va acá y no en una pantalla porque el desplegable ordena lo que se ve, pero
 * cualquiera puede mandar un pedido a mano; esto es lo que realmente cierra la
 * puerta antes de guardar.
 */
export function sucursalCanonica(raw: unknown): string | null {
  const limpio = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // saca tildes
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!limpio) return null;
  return (
    sucursalesValidas().find(
      (s) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase() === limpio
    ) ?? null
  );
}

/** El mensaje que ve la persona cuando manda una sucursal que no existe. */
export function mensajeSucursalInvalida(): string {
  const validas = sucursalesValidas();
  return `La sucursal tiene que ser una de: ${validas.slice(0, -1).join(", ")} o ${validas.at(-1)}.`;
}
