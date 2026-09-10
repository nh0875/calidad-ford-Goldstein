// ---------------------------------------------------------------------------
// El Excel de Contacto Posventa que baja de la plataforma de Volkswagen
// ---------------------------------------------------------------------------
//
// Es un export de fábrica, con nada que ver con el de Ford. Sin esto, el sistema
// reconocía DOS de sus veintinueve columnas (el mail y el celular) y rechazaba el
// archivo entero por "falta el nombre del propietario".
//
// Las diferencias que lo hacían ilegible, y que este módulo resuelve:
//
//   EL NOMBRE VIENE PARTIDO en "Apellido" y "Nombre". El mapeo de columnas
//   asocia UNA columna a UN campo, así que por diseño no podía juntarlas. Ojo con
//   las empresas: vienen con la razón social entera en "Apellido" y "Nombre"
//   vacío ("AGC INGENIERIA BIOMEDICA SRL"), y la columna "Nombre de la Compañía"
//   viene vacía aunque exista. Pegar apellido + nombre resuelve los dos casos.
//
//   EL ASESOR TAMBIÉN viene partido, por la misma razón.
//
//   FILAS REPETIDAS. La misma orden aparece una vez por TIPO DE VISITA (I, G, A,
//   C): mismo auto, misma fecha, mismo motivo. En el archivo de prueba eran 32
//   filas para 27 órdenes. Si entraran tal cual, al cliente le llegarían dos
//   WhatsApp por la misma visita. Se agrupan por número de orden.
//
//   LAS FECHAS SON NÚMEROS de la forma aaaammdd (20260909), no fechas de Excel.
//
//   LOS TELÉFONOS VIENEN SIN PAÍS (92613041047). El normalizador argentino ya los
//   resuelve a +5492613041047; las columnas de laboral y privado traen "0" cuando
//   no hay dato, y ese "0" se descarta solo.
//
//   NO TRAE PATENTE, solo VIN. La patente queda vacía y Calidad la completa desde
//   la pantalla si hace falta; el VIN se guarda en su propio campo.
//
// CÓMO SE INTEGRA. No se toca el importador: se traduce el libro a las columnas
// que el sistema YA entiende y el resto del circuito sigue igual. Es el mismo
// enfoque que usa el Excel interno de encuestas, y evita tener dos importadores
// que se van separando con el tiempo.

import * as XLSX from "xlsx";
import { leerFilasCrudas } from "./excel.service";
import { normalizarTexto } from "./excel.service";

/**
 * Los autos de la propia concesionaria.
 *
 * En el archivo de prueba eran DIEZ de treinta y dos filas: órdenes a nombre de
 * la agencia, no de un cliente. Entran al sistema como INTERNO —se ven en la
 * lista pero no reciben WhatsApp—, que es exactamente para lo que ese estado
 * existe. Mandarle un mensaje de "¿cómo te atendimos?" a la propia agencia sería,
 * además de inútil, algo que un cliente real podría llegar a ver en un reporte.
 *
 * Se compara sobre el texto normalizado (sin acentos, sin mayúsculas, sin
 * puntuación), así "MARIO GOLDSTEIN S.A.C.I." y "Mario Goldstein SACI" caen los
 * dos. Si mañana se suma otra razón social propia, se agrega acá.
 */
const NOMBRES_PROPIOS = ["mario goldstein"];

/** Las columnas del export de VW, por su título. */
const COL = {
  concesionario: "Código Concesionario/taller",
  vin: "VIN",
  modelo: "Modelo texto",
  fechaCierre: "Fecha de CIERRE de orden de reparación",
  apellido: "Apellido",
  nombre: "Nombre",
  compania: "Nombre de la Compañía",
  telLaboral: "Teléfono (laboral)",
  telPrivado: "Teléfono (privado)",
  telCelular: "Teléfono (celular)",
  apellidoAsesor: "Apellido Asesor de servicio",
  nombreAsesor: "Nombre Asesor de servicio",
  tipoVisita: "Tipo de visita",
  email: "E-Mail",
  orden: "Orden de reparación",
  fechaApertura: "Fecha de APERTURA de orden de reparación",
  motivo: "MOTIVO DE VISITA",
} as const;

/**
 * Ubica cada columna por su título, tolerando que el encabezado venga cortado.
 *
 * Los títulos reales son largos y con explicaciones adentro ("Fecha de CIERRE de
 * orden de reparación AAAAMMDD", "Indicator (1 = Sr., 2 = Sra., ...)"), y fábrica
 * los cambia de a poco. Buscar por PREFIJO normalizado aguanta esos retoques sin
 * tener que tocar el código en cada export nuevo.
 */
function ubicarColumnas(encabezados: unknown[]): Map<string, number> | null {
  const norm = encabezados.map((h) => normalizarTexto(h));
  const indices = new Map<string, number>();
  for (const [clave, titulo] of Object.entries(COL)) {
    const buscado = normalizarTexto(titulo);
    const i = norm.findIndex((h) => h.startsWith(buscado));
    if (i >= 0) indices.set(clave, i);
  }
  // Sin estas cuatro no es este formato, o viene tan cambiado que adivinarlo
  // sería peor que rechazarlo con un mensaje claro.
  for (const obligatoria of ["vin", "apellido", "orden", "telCelular"]) {
    if (!indices.has(obligatoria)) return null;
  }
  return indices;
}

/** ¿Este libro es el export de Contacto Posventa de Volkswagen? */
export function esContactoPosventaVW(workbook: XLSX.WorkBook): boolean {
  return workbook.SheetNames.some((n) => {
    const hoja = workbook.Sheets[n];
    if (!hoja) return false;
    const encabezados = leerFilasCrudas(hoja, 60)[0] ?? [];
    return ubicarColumnas(encabezados) !== null;
  });
}

/** "20260909" -> "09/09/2026". Devuelve "" si no tiene esa forma. */
function fechaDesdeAaaammdd(valor: unknown): string {
  const s = String(valor ?? "").trim();
  if (!/^\d{8}$/.test(s)) return "";
  const anio = s.slice(0, 4);
  const mes = s.slice(4, 6);
  const dia = s.slice(6, 8);
  // Se entrega como texto dd/mm/aaaa porque es lo que el lector de fechas del
  // sistema ya interpreta; convertirlo a Date acá obligaría a decidir la zona
  // horaria dos veces, en dos lugares distintos.
  return `${dia}/${mes}/${anio}`;
}

/** Un teléfono que sirva, o "" si la celda trae el 0 de relleno. */
function telefonoUtil(valor: unknown): string {
  const s = String(valor ?? "").trim();
  if (!s || /^0+$/.test(s)) return "";
  return s;
}

function esVehiculoPropio(nombre: string): boolean {
  const n = normalizarTexto(nombre);
  return NOMBRES_PROPIOS.some((propio) => n.includes(propio));
}

// Los títulos que el sistema YA sabe mapear. No se inventan: son los que
// reconoce sugerirMapeo(), y "Fecha de Programación" + "Asesor" son además los
// dos que busca detectarFilaEncabezado() para encontrar la tabla.
const SALIDA = [
  "Fecha de Programación",
  "Fecha Salida",
  "Orden de Servicio",
  "Nombre Propietario",
  "Modelo",
  "Patente",
  "Chasis",
  "Asesor",
  "Whatsapp",
  "Celular",
  "E-Mail Propietario",
  "Comentario del Asesor",
  "Estado",
] as const;

export interface ResumenConversion {
  filasLeidas: number;
  casos: number;
  /** Filas que se juntaron con otra por ser la misma orden. */
  repetidasUnidas: number;
  /** Autos de la concesionaria: entran como INTERNO y no reciben WhatsApp. */
  internos: number;
  /** Códigos de concesionario encontrados (para avisar si vienen mezclados). */
  concesionarios: string[];
}

/**
 * Traduce el libro de VW a uno con las columnas que el sistema entiende.
 *
 * Devuelve un libro NUEVO: el original no se toca, así el archivo guardado en
 * disco sigue siendo el que subió la persona y se puede volver a leer.
 */
export function convertirContactoPosventaVW(
  workbook: XLSX.WorkBook
): { libro: XLSX.WorkBook; resumen: ResumenConversion } | { error: string } {
  const nombreHoja = workbook.SheetNames.find((n) => {
    const hoja = workbook.Sheets[n];
    return hoja && ubicarColumnas(leerFilasCrudas(hoja, 60)[0] ?? []) !== null;
  });
  if (!nombreHoja) return { error: "El archivo no tiene ninguna hoja con el formato de Contacto Posventa de Volkswagen." };

  const filas = leerFilasCrudas(workbook.Sheets[nombreHoja], 60);
  const col = ubicarColumnas(filas[0] ?? []);
  if (!col) return { error: "No se pudieron ubicar las columnas de la hoja." };

  const en = (fila: unknown[], clave: string): unknown => {
    const i = col.get(clave);
    return i === undefined ? "" : fila[i];
  };
  const txt = (fila: unknown[], clave: string): string => String(en(fila, clave) ?? "").trim();

  // Una entrada por ORDEN: las repetidas se juntan y sus tipos de visita se
  // acumulan, que es la única información que las distingue.
  const porOrden = new Map<string, { fila: unknown[]; tipos: string[] }>();
  let filasLeidas = 0;
  let repetidasUnidas = 0;
  const concesionarios = new Set<string>();

  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i] ?? [];
    const orden = txt(fila, "orden");
    const vin = txt(fila, "vin");
    // Sin orden ni VIN no hay nada que identificar: es una fila de relleno.
    if (!orden && !vin) continue;
    filasLeidas++;

    const conc = txt(fila, "concesionario");
    if (conc) concesionarios.add(conc);

    // Si no vino la orden se usa el VIN como clave, para no perder la fila ni
    // fusionar por error dos autos distintos.
    const clave = orden || `vin:${vin}`;
    const tipo = txt(fila, "tipoVisita");
    const previa = porOrden.get(clave);
    if (previa) {
      repetidasUnidas++;
      if (tipo && !previa.tipos.includes(tipo)) previa.tipos.push(tipo);
    } else {
      porOrden.set(clave, { fila, tipos: tipo ? [tipo] : [] });
    }
  }

  let internos = 0;
  const cuerpo: string[][] = [];

  for (const { fila, tipos } of porOrden.values()) {
    // Apellido + Nombre resuelve personas y empresas: en las empresas la razón
    // social entera viene en Apellido y Nombre queda vacío.
    const nombreCliente = [txt(fila, "apellido"), txt(fila, "nombre")].filter(Boolean).join(" ").trim();
    const propio = esVehiculoPropio(nombreCliente);
    if (propio) internos++;

    const asesor = [txt(fila, "apellidoAsesor"), txt(fila, "nombreAsesor")].filter(Boolean).join(" ").trim();

    const celular = telefonoUtil(en(fila, "telCelular"));
    // El de respaldo: el privado, y si no el laboral. Sirve para que quede
    // registrado y para la lista de no contactar, aunque el envío use el celular.
    const respaldo = telefonoUtil(en(fila, "telPrivado")) || telefonoUtil(en(fila, "telLaboral"));

    const motivo = txt(fila, "motivo");
    const comentario = [motivo, tipos.length > 0 ? `(Tipo de visita: ${tipos.join(", ")})` : ""]
      .filter(Boolean)
      .join(" ");

    cuerpo.push([
      // La APERTURA es cuando el auto entró: es la fecha con la que se ordena y
      // se arma el período. El CIERRE es cuando se lo llevó.
      fechaDesdeAaaammdd(en(fila, "fechaApertura")) || fechaDesdeAaaammdd(en(fila, "fechaCierre")),
      fechaDesdeAaaammdd(en(fila, "fechaCierre")),
      txt(fila, "orden"),
      nombreCliente,
      txt(fila, "modelo"),
      "", // patente: el export no la trae. Se completa a mano desde la pantalla.
      txt(fila, "vin"),
      asesor,
      celular,
      respaldo,
      txt(fila, "email"),
      comentario,
      // "INT" es lo que el importador lee como INTERNO. Se reutiliza el circuito
      // que ya existe en vez de agregar una regla nueva en otro lado.
      propio ? "INT" : "",
    ]);
  }

  const hoja = XLSX.utils.aoa_to_sheet([[...SALIDA], ...cuerpo]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja.slice(0, 31) || "Posventa VW");

  return {
    libro,
    resumen: {
      filasLeidas,
      casos: cuerpo.length,
      repetidasUnidas,
      internos,
      concesionarios: [...concesionarios].sort(),
    },
  };
}

/**
 * Si el libro es el export de VW lo traduce; si no, lo devuelve tal cual.
 *
 * Es el único punto que necesitan tocar el preview y la importación: los dos
 * llaman a esto apenas abren el archivo y siguen su camino sin enterarse de que
 * existe un formato nuevo.
 */
export function normalizarLibroSiEsVW(workbook: XLSX.WorkBook): XLSX.WorkBook {
  if (!esContactoPosventaVW(workbook)) return workbook;
  const r = convertirContactoPosventaVW(workbook);
  return "error" in r ? workbook : r.libro;
}
