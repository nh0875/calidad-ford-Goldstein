import * as XLSX from "xlsx";
import { normalizarTexto } from "./excel.service";

/**
 * Lector del Excel de encuestas de fábrica de Volkswagen.
 *
 * Es OTRO archivo que el de Ford y se lee aparte. Diferencias que obligan a eso:
 *
 *  - Trae UNA HOJA POR SUCURSAL ("PENDIENTES MENDOZA", "PENDIENTES SAN JUAN")
 *    más una hoja aparte con los nombres de los vendedores.
 *  - NO trae teléfono, solo mail. Por eso estos clientes no se pueden contactar
 *    por WhatsApp: el recordatorio se lo mandamos al VENDEDOR, no al cliente.
 *  - Las fechas vienen como número AAAAMMDD (20260803), no como fecha de Excel.
 *  - Después de las 14 columnas de datos hay 24 columnas de CONTROL de fábrica
 *    ("Mail invalido", "Chasis no tiene 17 digitos", …). Vienen vacías cuando el
 *    archivo está sano; si alguna trae texto, esa fila la rechazó fábrica.
 *  - Hay filas totalmente en blanco separando grupos de vendedor.
 */

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

/** Las 14 columnas de datos, en el orden en que vienen. */
const COLUMNAS_DATOS = [
  { campo: "zona", patrones: ["zona"] },
  // OJO: esta columna NO es la sucursal que vendió. En el archivo real, la hoja
  // de Mendoza trae 27 filas con 1035 y 23 con 1036, pero los 50 vendedores son
  // 1035xxx. La sucursal sale del código de vendedor (ver abajo), no de acá.
  { campo: "codigoEnLaFila", patrones: ["codigo"] },
  { campo: "canalVentas", patrones: ["canal de ventas", "canal"] },
  { campo: "chasis", patrones: ["chasis", "vin"] },
  { campo: "fechaEntregaFinal", patrones: ["entrega a cliente final"] },
  { campo: "fechaEntregaReportada", patrones: ["entrega a cliente reportada"] },
  { campo: "codigoVendedor", patrones: ["vendedor"] },
  { campo: "nombre", patrones: ["nombre"] },
  { campo: "apellido", patrones: ["apellido"] },
  { campo: "email", patrones: ["e-mail", "email", "correo"] },
  { campo: "fechaDominio", patrones: ["fecha dominio", "fecha de dominio"] },
  { campo: "dominio", patrones: ["dominio"] },
  { campo: "status", patrones: ["status", "estado"] },
  { campo: "mailEnviado", patrones: ["mail enviado"] },
] as const;

export type CampoEncuestaVW = (typeof COLUMNAS_DATOS)[number]["campo"];

/** Columnas obligatorias para dar una hoja por buena. */
const OBLIGATORIAS: CampoEncuestaVW[] = ["chasis", "codigoVendedor", "email"];

// ---------------------------------------------------------------------------
// Código de vendedor: 4 dígitos de sucursal + 3 del vendedor
// ---------------------------------------------------------------------------

export const LARGO_CODIGO_VENDEDOR = 7;

export interface CodigoVendedorPartido {
  completo: string; // "1035017"
  sucursal: string; // "1035"
  numero: number; // 17  (sirve para cruzar con la hoja de nombres, que trae 17)
}

/** Parte "1035017" en sucursal 1035 + vendedor 17. Devuelve null si no cierra. */
export function partirCodigoVendedor(valor: unknown): CodigoVendedorPartido | null {
  const texto = String(valor ?? "").trim();
  if (!/^\d{7}$/.test(texto)) return null;
  return { completo: texto, sucursal: texto.slice(0, 4), numero: Number(texto.slice(4)) };
}

// ---------------------------------------------------------------------------
// Fechas AAAAMMDD
// ---------------------------------------------------------------------------

/**
 * Las fechas del archivo son el número 20260803. Se arma la fecha al mediodía
 * para que ningún cambio de huso la corra un día para atrás.
 */
export function parsearFechaVW(valor: unknown): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;
  const texto = String(valor).trim();
  const m = texto.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, a, mes, d] = m;
  const fecha = new Date(Number(a), Number(mes) - 1, Number(d), 12, 0, 0);
  if (isNaN(fecha.getTime())) return null;
  // Rechaza fechas imposibles tipo 20260231, que el constructor "corrige" solo
  if (fecha.getMonth() !== Number(mes) - 1 || fecha.getDate() !== Number(d)) return null;
  return fecha;
}

// ---------------------------------------------------------------------------
// Nombre del cliente
// ---------------------------------------------------------------------------

/**
 * Arma el nombre a mostrar. Las empresas vienen con Nombre="EMPRESA" y la razón
 * social en Apellido: en ese caso se usa solo la razón social, porque
 * "EMPRESA VIEJO NOGAL S.A." no es el nombre de nadie.
 */
export function nombreClienteVW(nombre: unknown, apellido: unknown): string {
  const n = String(nombre ?? "").trim();
  const a = String(apellido ?? "").trim();
  if (normalizarTexto(n) === "empresa") return a || n;
  return [n, a].filter(Boolean).join(" ").trim();
}

// ---------------------------------------------------------------------------
// Canal de ventas -> área de VW
// ---------------------------------------------------------------------------

/**
 * "TRADICIONAL" es una venta común y "AUTOAHORRO" es un plan de ahorro. Se
 * devuelve el área del catálogo de VW; null si aparece un canal nuevo (no se
 * adivina: la fila queda para revisar a mano).
 */
export function areaDeCanalVW(canal: unknown): "VENTAS" | "PLAN_DE_AHORRO" | null {
  const c = normalizarTexto(canal);
  if (!c) return null;
  if (c.includes("autoahorro") || c.includes("ahorro") || c.includes("plan")) return "PLAN_DE_AHORRO";
  if (c.includes("tradicional") || c.includes("venta")) return "VENTAS";
  return null;
}

// ---------------------------------------------------------------------------
// Hoja de nombres de vendedores
// ---------------------------------------------------------------------------

export interface VendedorDelArchivo {
  sucursalNombre: string; // "MENDOZA"
  numero: number; // 17
  nombre: string; // "RUGGERI"
}

const NOMBRE_HOJA_VENDEDORES = ["codigos vendedores", "codigo vendedores", "vendedores"];

export function esHojaDeVendedores(nombreHoja: string): boolean {
  const n = normalizarTexto(nombreHoja);
  return NOMBRE_HOJA_VENDEDORES.some((p) => n.includes(p));
}

/**
 * Lee la hoja de nombres. Viene por secciones: una fila con la sucursal sola
 * ("MENDOZA"), después "ASESOR | NUMERO" y después los vendedores. El número es
 * el de 3 dígitos SIN el prefijo de sucursal (17, no 1035017).
 */
export function parsearVendedoresVW(workbook: XLSX.WorkBook, nombreHoja: string): VendedorDelArchivo[] {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return [];
  const filas: unknown[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, blankrows: true });

  const vendedores: VendedorDelArchivo[] = [];
  let sucursal = "";
  for (const fila of filas) {
    const a = String(fila?.[0] ?? "").trim();
    const b = fila?.[1];
    if (!a) continue;
    // Encabezado de sección: la sucursal viene sola, sin número al lado
    if (b === null || b === undefined || String(b).trim() === "") {
      sucursal = a.toUpperCase();
      continue;
    }
    if (normalizarTexto(a) === "asesor") continue; // fila "ASESOR | NUMERO"
    const numero = Number(String(b).trim());
    if (!Number.isInteger(numero)) continue;
    vendedores.push({ sucursalNombre: sucursal, numero, nombre: a.toUpperCase() });
  }
  return vendedores;
}

// ---------------------------------------------------------------------------
// Hojas de datos
// ---------------------------------------------------------------------------

export interface FilaEncuestaVW {
  numeroFilaExcel: number;
  hoja: string;
  campos: Partial<Record<CampoEncuestaVW, string>>;
  /** Texto de las columnas de control de fábrica que vinieran completas. */
  observacionesFabrica: string[];
}

export interface HojaEncuestaVWParseada {
  nombre: string;
  /** Sucursal deducida del prefijo de los códigos de vendedor de la hoja. */
  codigoSucursal: string | null;
  /** Nombre de la sucursal según el título de la hoja ("PENDIENTES MENDOZA"). */
  nombreSucursal: string;
  filas: FilaEncuestaVW[];
  /** Filas en blanco salteadas: van al resumen para que nadie las extrañe. */
  filasVacias: number;
  avisos: string[];
}

function ubicarColumnas(encabezados: unknown[]): {
  indices: Partial<Record<CampoEncuestaVW, number>>;
  indicesControl: Array<{ indice: number; titulo: string }>;
} {
  const indices: Partial<Record<CampoEncuestaVW, number>> = {};
  const usadas = new Set<number>();

  // Se recorre columna por columna en el orden esperado y se toma la PRIMERA
  // que coincida y esté libre. Importa el orden: "Dominio" y "Fecha Dominio"
  // comparten palabra, y "Chasis" aparece también en un título de control.
  for (const { campo, patrones } of COLUMNAS_DATOS) {
    for (let i = 0; i < encabezados.length; i++) {
      if (usadas.has(i)) continue;
      const titulo = normalizarTexto(encabezados[i]);
      if (!titulo) continue;
      // Coincidencia exacta primero, para que "dominio" no se coma "fecha dominio"
      if (patrones.some((p) => titulo === p)) {
        indices[campo] = i;
        usadas.add(i);
        break;
      }
    }
    if (indices[campo] !== undefined) continue;
    for (let i = 0; i < encabezados.length; i++) {
      if (usadas.has(i)) continue;
      const titulo = normalizarTexto(encabezados[i]);
      if (titulo && patrones.some((p) => titulo.includes(p))) {
        indices[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }

  // Todo lo que quedó con título y no es de datos es una columna de control
  const indicesControl: Array<{ indice: number; titulo: string }> = [];
  for (let i = 0; i < encabezados.length; i++) {
    if (usadas.has(i)) continue;
    const titulo = String(encabezados[i] ?? "").trim();
    if (titulo) indicesControl.push({ indice: i, titulo });
  }

  return { indices, indicesControl };
}

export function parsearHojaEncuestaVW(
  workbook: XLSX.WorkBook,
  nombreHoja: string
): HojaEncuestaVWParseada | { error: string } {
  const hoja = workbook.Sheets[nombreHoja];
  if (!hoja) return { error: `La hoja "${nombreHoja}" no existe.` };

  const filasCrudas: unknown[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, blankrows: true });
  if (filasCrudas.length === 0) return { error: `La hoja "${nombreHoja}" está vacía.` };

  const encabezados = filasCrudas[0] ?? [];
  const { indices, indicesControl } = ubicarColumnas(encabezados);

  const faltantes = OBLIGATORIAS.filter((c) => indices[c] === undefined);
  if (faltantes.length > 0) {
    return {
      error:
        `La hoja "${nombreHoja}" no tiene las columnas ${faltantes.join(", ")}. ` +
        "Verificá que sea el Excel de encuestas pendientes que baja de la plataforma de Volkswagen.",
    };
  }

  const avisos: string[] = [];
  const filas: FilaEncuestaVW[] = [];
  let filasVacias = 0;

  for (let i = 1; i < filasCrudas.length; i++) {
    const cruda = filasCrudas[i] ?? [];
    const campos: Partial<Record<CampoEncuestaVW, string>> = {};
    let tieneDatos = false;
    for (const { campo } of COLUMNAS_DATOS) {
      const indice = indices[campo];
      if (indice === undefined) continue;
      const valor = cruda[indice];
      const texto = valor === null || valor === undefined ? "" : String(valor).trim();
      if (texto) {
        campos[campo] = texto;
        tieneDatos = true;
      }
    }
    // Las filas en blanco separan grupos de vendedor: se saltean sin ruido
    if (!tieneDatos) {
      filasVacias++;
      continue;
    }

    const observacionesFabrica: string[] = [];
    for (const { indice, titulo } of indicesControl) {
      const valor = cruda[indice];
      const texto = valor === null || valor === undefined ? "" : String(valor).trim();
      if (texto) observacionesFabrica.push(`${titulo}: ${texto}`);
    }

    filas.push({ numeroFilaExcel: i + 1, hoja: nombreHoja, campos, observacionesFabrica });
  }

  // La sucursal sale del prefijo de los códigos de vendedor, no de la columna
  // "Código" (que en el archivo real trae la de otra sucursal en muchas filas).
  const prefijos = new Map<string, number>();
  for (const f of filas) {
    const c = partirCodigoVendedor(f.campos.codigoVendedor);
    if (c) prefijos.set(c.sucursal, (prefijos.get(c.sucursal) ?? 0) + 1);
  }
  let codigoSucursal: string | null = null;
  if (prefijos.size === 1) {
    codigoSucursal = [...prefijos.keys()][0];
  } else if (prefijos.size > 1) {
    const ordenados = [...prefijos.entries()].sort((a, b) => b[1] - a[1]);
    codigoSucursal = ordenados[0][0];
    avisos.push(
      `La hoja "${nombreHoja}" mezcla vendedores de más de una sucursal ` +
        `(${ordenados.map(([p, n]) => `${p}: ${n} fila(s)`).join(", ")}). ` +
        `Se toma ${codigoSucursal} por ser la mayoría; revisá las demás a mano.`
    );
  }

  const nombreSucursal = nombreHoja.replace(/^\s*pendientes\s*/i, "").trim().toUpperCase() || nombreHoja.toUpperCase();

  return { nombre: nombreHoja, codigoSucursal, nombreSucursal, filas, filasVacias, avisos };
}

// ---------------------------------------------------------------------------
// Archivo completo
// ---------------------------------------------------------------------------

export interface FilaEncuestaVWListaParaImportar {
  numeroFilaExcel: number;
  hoja: string;
  codigoVendedor: string; // "1035017"
  codigoSucursal: string; // "1035"
  numeroVendedor: number; // 17
  nombreVendedor: string | null; // de la hoja de nombres; null si no figura
  nombreCliente: string;
  email: string;
  chasis: string;
  dominio: string | null;
  canalVentas: string | null;
  area: "VENTAS" | "PLAN_DE_AHORRO" | null;
  fechaEntrega: Date | null;
  observacionesFabrica: string[];
}

export interface ArchivoEncuestaVW {
  hojas: HojaEncuestaVWParseada[];
  vendedores: VendedorDelArchivo[];
  /** Filas listas para importar (las que tienen los datos mínimos). */
  filas: FilaEncuestaVWListaParaImportar[];
  /** Filas que NO se pueden importar, con el motivo. */
  rechazadas: Array<{ hoja: string; numeroFilaExcel: number; motivo: string }>;
  /** Códigos de vendedor que aparecen en los datos pero no en la hoja de nombres. */
  vendedoresSinNombre: Array<{ codigo: string; sucursal: string; filas: number }>;
  avisos: string[];
}

/**
 * Lee el archivo entero: las hojas de datos, la de nombres, y deja las filas
 * listas para importar junto con todo lo que quedó afuera y por qué.
 *
 * No decide nada del negocio: solo lee, valida el formato y avisa. Qué hacer con
 * las filas rechazadas o con los vendedores sin nombre lo resuelve quien llama.
 */
export function parsearArchivoEncuestaVW(workbook: XLSX.WorkBook): ArchivoEncuestaVW | { error: string } {
  const nombresHojas = workbook.SheetNames;
  const hojaVendedores = nombresHojas.find(esHojaDeVendedores) ?? null;
  const hojasDatos = nombresHojas.filter((n) => n !== hojaVendedores);

  if (hojasDatos.length === 0) {
    return { error: "El archivo no tiene ninguna hoja con clientes pendientes." };
  }

  const vendedores = hojaVendedores ? parsearVendedoresVW(workbook, hojaVendedores) : [];
  const avisos: string[] = [];
  if (!hojaVendedores) {
    avisos.push(
      'No se encontró la hoja "Codigos Vendedores": los clientes se van a importar con el código de ' +
        "vendedor pero sin el nombre. Se puede completar después desde la pantalla de vendedores."
    );
  }

  const hojas: HojaEncuestaVWParseada[] = [];
  const rechazadas: ArchivoEncuestaVW["rechazadas"] = [];
  const filas: FilaEncuestaVWListaParaImportar[] = [];

  for (const nombre of hojasDatos) {
    const parseada = parsearHojaEncuestaVW(workbook, nombre);
    if ("error" in parseada) {
      avisos.push(parseada.error);
      continue;
    }
    hojas.push(parseada);
    avisos.push(...parseada.avisos);
  }

  if (hojas.length === 0) {
    return { error: "Ninguna hoja del archivo tiene el formato esperado. " + avisos.join(" ") };
  }

  // Nombre del vendedor: la hoja de nombres los agrupa por sucursal con el
  // número de 3 dígitos, así que se cruza por (sucursal de la hoja, número).
  const nombrePorSucursalYNumero = new Map<string, string>();
  for (const h of hojas) {
    if (!h.codigoSucursal) continue;
    for (const v of vendedores) {
      if (normalizarTexto(v.sucursalNombre) === normalizarTexto(h.nombreSucursal)) {
        nombrePorSucursalYNumero.set(`${h.codigoSucursal}-${v.numero}`, v.nombre);
      }
    }
  }

  const sinNombre = new Map<string, { codigo: string; sucursal: string; filas: number }>();

  for (const hoja of hojas) {
    for (const fila of hoja.filas) {
      const c = fila.campos;
      const codigo = partirCodigoVendedor(c.codigoVendedor);
      if (!codigo) {
        rechazadas.push({
          hoja: hoja.nombre,
          numeroFilaExcel: fila.numeroFilaExcel,
          motivo: `El código de vendedor "${c.codigoVendedor ?? ""}" no tiene ${LARGO_CODIGO_VENDEDOR} dígitos.`,
        });
        continue;
      }
      const email = (c.email ?? "").trim();
      if (!email.includes("@")) {
        rechazadas.push({
          hoja: hoja.nombre,
          numeroFilaExcel: fila.numeroFilaExcel,
          motivo: email ? `El mail "${email}" no parece válido.` : "La fila no tiene mail del cliente.",
        });
        continue;
      }
      const nombreCliente = nombreClienteVW(c.nombre, c.apellido);
      if (!nombreCliente) {
        rechazadas.push({
          hoja: hoja.nombre,
          numeroFilaExcel: fila.numeroFilaExcel,
          motivo: "La fila no tiene nombre ni apellido del cliente.",
        });
        continue;
      }

      const nombreVendedor = nombrePorSucursalYNumero.get(`${codigo.sucursal}-${codigo.numero}`) ?? null;
      if (!nombreVendedor) {
        const previo = sinNombre.get(codigo.completo);
        sinNombre.set(codigo.completo, {
          codigo: codigo.completo,
          sucursal: hoja.nombreSucursal,
          filas: (previo?.filas ?? 0) + 1,
        });
      }

      filas.push({
        numeroFilaExcel: fila.numeroFilaExcel,
        hoja: hoja.nombre,
        codigoVendedor: codigo.completo,
        codigoSucursal: codigo.sucursal,
        numeroVendedor: codigo.numero,
        nombreVendedor,
        nombreCliente,
        email,
        chasis: (c.chasis ?? "").trim(),
        dominio: c.dominio?.trim() || null,
        canalVentas: c.canalVentas?.trim() || null,
        area: areaDeCanalVW(c.canalVentas),
        fechaEntrega: parsearFechaVW(c.fechaEntregaFinal) ?? parsearFechaVW(c.fechaEntregaReportada),
        observacionesFabrica: fila.observacionesFabrica,
      });
    }
  }

  return {
    hojas,
    vendedores,
    filas,
    rechazadas,
    vendedoresSinNombre: [...sinNombre.values()].sort((a, b) => b.filas - a.filas),
    avisos,
  };
}
