import { Request, Response } from "express";
import { z } from "zod";
import { EstadoEncuestaFabrica } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca, mensajeSucursalInvalida, sucursalCanonica, SUCURSAL_GENERAL } from "../config/marca";
import { abrirWorkbook, borrarArchivoTemporal, guardarArchivoTemporal, leerArchivoTemporal } from "../services/excel.service";
import {
  clavePersonaVendedor,
  NUMEROS_DE_MOSTRADOR,
  nombrePeriodo,
  parsearArchivoEncuestaVW,
  resumirPeriodosVW,
  sucursalDeCodigoVendedor,
} from "../services/encuesta-vw.service";
import { claveNormalizada } from "../services/normalizacion.service";
import { importarEncuestaFabricaVW } from "../services/importacion-encuesta-vw.service";
import {
  convertirInternoAArchivo,
  esArchivoInternoVW,
  nombresDeVendedorDelLibro,
  resolverVendedores,
} from "../services/encuesta-interna-vw.service";
import { avisarVendedoresVW } from "../services/encuesta-vw-mail.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { zSucursal } from "../services/sucursal.service";
import { seguimientoEncuestasVW } from "../services/seguimiento-encuesta-vw.service";

// ---------- POST /api/encuesta-vw/preview ----------
// Se lee el archivo y se muestra lo que se va a hacer ANTES de tocar la base.
// La carga solo AGREGA clientes: no le cambia el estado a ninguno de los que ya
// están (ver importacion-encuesta-vw.service.ts).

export async function previewEncuestaVW(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({
      message: "No se recibió ningún archivo. Elegí el Excel de encuestas pendientes de Volkswagen (.xlsx).",
    });
  }

  let workbook;
  try {
    workbook = abrirWorkbook(req.file.buffer);
  } catch {
    return res.status(400).json({ message: "El archivo no se pudo leer como Excel. Verificá que sea un .xlsx válido." });
  }

  // ---- Formato INTERNO de la concesionaria ----
  //
  // Trae el vendedor por NOMBRE, no por código. Lo que la pantalla necesita saber
  // antes de confirmar es a quién no pudo resolver solo, para que la persona lo
  // asigne una vez (y quede guardado para las próximas cargas).
  if (esArchivoInternoVW(workbook)) {
    const nombres = nombresDeVendedorDelLibro(workbook);
    const { mapa, sinResolver } = await resolverVendedores(nombres);
    const convertido = convertirInternoAArchivo(workbook, mapa);
    if ("error" in convertido) return res.status(400).json({ message: convertido.error });

    // Para el desplegable de asignación: todos los vendedores cargados.
    const vendedores = await prisma.vendedorVW.findMany({
      orderBy: [{ sucursal: "asc" }, { codigo: "asc" }],
      select: { codigo: true, nombre: true, sucursal: true },
    });

    // Cuántos clientes le tocarían a cada vendedor una vez resuelto el mapeo.
    const porVendedor = new Map<string, number>();
    for (const f of convertido.filas) {
      porVendedor.set(f.codigoVendedor, (porVendedor.get(f.codigoVendedor) ?? 0) + 1);
    }

    const token = guardarArchivoTemporal(req.file.buffer, req.file.originalname);
    // OJO: la respuesta tiene que traer TODOS los campos que la pantalla lee,
    // aunque para este formato vayan vacíos. La primera versión omitió tres
    // (vendedores, vendedoresSinNombre y observadasPorFabrica) y la pantalla, que
    // hace .length sobre ellos sin preguntar, se cayó entera: pantallazo blanco y
    // un "Cannot read properties of undefined" en la consola.
    return res.json({
      fileToken: token,
      filename: req.file.originalname,
      formato: "INTERNO",
      totalClientes: convertido.filas.length,
      hojas: [],
      vendedores: [...porVendedor.entries()].map(([codigo, clientes]) => {
        const v = vendedores.find((x) => x.codigo === codigo);
        return { codigo, nombre: v?.nombre ?? null, sucursal: sucursalDeCodigoVendedor(codigo) ?? v?.sucursal ?? "", clientes };
      }),
      vendedoresSinNombre: [],
      observadasPorFabrica: [],
      // Lo que hay que resolver antes de poder importar.
      vendedoresSinAsignar: sinResolver,
      vendedoresDisponibles: vendedores,
      // El interno no trae Fecha Dominio: el mes de cada cliente se estima con la
      // entrega, y la pantalla lo avisa con sinFechaDominio.
      ...resumirPeriodosVW(convertido.filas),
      rechazadas: convertido.rechazadas.slice(0, 50),
      avisos: convertido.avisos,
    });
  }

  const archivo = parsearArchivoEncuestaVW(workbook);
  if ("error" in archivo) return res.status(400).json({ message: archivo.error });
  if (archivo.filas.length === 0) {
    return res.status(400).json({
      message: "El archivo no tiene ninguna fila que se pueda importar. " + archivo.avisos.join(" "),
    });
  }

  const porVendedor = new Map<string, { codigo: string; nombre: string | null; sucursal: string; clientes: number }>();
  for (const f of archivo.filas) {
    const previo = porVendedor.get(f.codigoVendedor);
    porVendedor.set(f.codigoVendedor, {
      codigo: f.codigoVendedor,
      nombre: f.nombreVendedor ?? previo?.nombre ?? null,
      // La misma regla estricta que la carga: la sucursal la dice el código.
      sucursal:
        sucursalDeCodigoVendedor(f.codigoVendedor) ??
        archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ??
        f.codigoSucursal,
      clientes: (previo?.clientes ?? 0) + 1,
    });
  }

  const fileToken = guardarArchivoTemporal(req.file.buffer, req.file.originalname);

  res.json({
    fileToken,
    filename: req.file.originalname,
    hojas: archivo.hojas.map((h) => ({
      nombre: h.nombre,
      sucursal: h.nombreSucursal,
      codigoSucursal: h.codigoSucursal,
      clientes: h.filas.length,
      filasVacias: h.filasVacias,
    })),
    totalClientes: archivo.filas.length,
    vendedores: [...porVendedor.values()].sort((a, b) => b.clientes - a.clientes),
    vendedoresSinNombre: archivo.vendedoresSinNombre,
    rechazadas: archivo.rechazadas,
    observadasPorFabrica: archivo.filas
      .filter((f) => f.observacionesFabrica.length > 0)
      .map((f) => ({ hoja: f.hoja, fila: f.numeroFilaExcel, cliente: f.nombreCliente, observaciones: f.observacionesFabrica })),
    // Qué meses trae el archivo según la columna "Fecha Dominio". Un Excel de
    // fábrica mezcla meses, así que el reparto se muestra ANTES de confirmar.
    ...resumirPeriodosVW(archivo.filas),
    avisos: archivo.avisos,
  });
}

// ---------- POST /api/encuesta-vw/confirm ----------

const confirmSchema = z.object({
  fileToken: z.string().uuid("El identificador del archivo no es válido. Volvé a subir el Excel."),
  /** Solo para el formato interno: nombre del vendedor -> su código de 7 dígitos. */
  mapeoVendedores: z.record(z.string()).optional(),
});

export async function confirmEncuestaVW(req: Request, res: Response) {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }

  const archivo = leerArchivoTemporal(parsed.data.fileToken);
  if (!archivo) {
    return res.status(410).json({
      message: "El archivo ya no está disponible en el servidor. Volvé a subirlo desde el paso 1.",
    });
  }

  const resumen = await importarEncuestaFabricaVW({
    buffer: archivo.buffer,
    filename: archivo.filename,
    uploadedBy: req.usuario?.nombre ?? "Calidad",
    mapeoVendedores: parsed.data.mapeoVendedores,
    usuarioId: req.usuario?.id ?? null,
    auditar: (d) => auditar(req, d),
  });
  borrarArchivoTemporal(parsed.data.fileToken);

  if ("error" in resumen) return res.status(400).json({ message: resumen.error });

  const partes = [
    `${resumen.pendientesNuevos} cliente(s) nuevo(s)`,
    // "conservan su estado" y no solo "que ya estaban": es justo lo que antes no
    // pasaba, y quien sube el archivo tiene que poder quedarse tranquilo.
    `${resumen.pendientesQueSiguen} que ya estaban (conservan su estado)`,
  ];
  if (resumen.vendedoresNuevos) partes.push(`${resumen.vendedoresNuevos} vendedor(es) nuevo(s)`);
  // Se avisa explícitamente: es una decisión del sistema (dos códigos = una
  // persona) y conviene que quede a la vista para poder desmentirla si se
  // equivocó, en vez de que pase en silencio.
  if (resumen.vendedoresDeOtraSucursal.length) {
    partes.push(
      `${resumen.vendedoresDeOtraSucursal.length} vendedor(es) reconocido(s) vendiendo en la otra sucursal ` +
        `(${resumen.vendedoresDeOtraSucursal
          .map((v) => `${v.nombre ?? v.codigo}: ${v.vieneDe} → ${v.codigo}`)
          .join(", ")}), se les usó el correo que ya tenían`
    );
  }
  if (resumen.vendedoresSinMail.length) partes.push(`${resumen.vendedoresSinMail.length} sin correo cargado`);
  // El mes, con el reparto si el archivo trae más de uno: es con lo que después se
  // sigue la carga mes a mes, y conviene verlo en el momento.
  if (resumen.meses.length > 1) {
    const reparto = resumen.meses.map((m) => `${nombrePeriodo(m.periodo)}: ${m.clientes}`).join(", ");
    partes.push(`clientes de ${resumen.meses.length} meses según la Fecha Dominio (${reparto})`);
  } else if (resumen.meses.length === 1) {
    partes.push(`todos de ${nombrePeriodo(resumen.meses[0].periodo)}`);
  }

  res.status(201).json({ message: `Carga terminada: ${partes.join(", ")}.`, resumen });
}

// ---------- GET /api/encuesta-vw ----------
// Los pendientes agrupados por vendedor: es la vista con la que se trabaja.

export async function listarEncuestaVW(req: Request, res: Response) {
  const incluirRespondidos = String(req.query.incluirRespondidos ?? "") === "true";

  const vendedores = await prisma.vendedorVW.findMany({
    orderBy: [{ sucursal: "asc" }, { codigo: "asc" }],
    select: {
      id: true,
      codigo: true,
      // Para juntar en pantalla los códigos de una misma persona (1035078 y
      // 1036078) cuando se miran las dos provincias.
      numero: true,
      codigoSucursal: true,
      nombre: true,
      email: true,
      sucursal: true,
      activo: true,
      ultimoAvisoEn: true,
      pendientes: {
        // "Sin responder" son los PENDIENTE y también los AVISADO: al vendedor ya
        // se le avisó, pero el cliente todavía no contestó y Calidad lo tiene que
        // seguir viendo. Si acá quedara solo PENDIENTE, avisar haría desaparecer
        // clientes de la pantalla.
        where: incluirRespondidos
          ? {}
          : { estado: { in: [EstadoEncuestaFabrica.PENDIENTE, EstadoEncuestaFabrica.AVISADO] } },
        orderBy: { fechaEntrega: "asc" },
        select: {
          id: true,
          chasis: true,
          dominio: true,
          nombreCliente: true,
          email: true,
          canalVentas: true,
          area: true,
          fechaEntrega: true,
          // El mes del cliente para el seguimiento. Sin fechaDominio, es estimado.
          fechaDominio: true,
          periodo: true,
          // La del CLIENTE (sale del código con el que se vendió): es la que usa
          // el filtro de sucursal de la pantalla.
          sucursal: true,
          estado: true,
          avisadoEn: true,
          respondioEn: true,
          detectadaEn: true,
          observacionesFabrica: true,
          // Para distinguir en pantalla los que cargó Calidad a mano de los que
          // vinieron en el Excel de fábrica.
          esManual: true,
        },
      },
    },
  });

  const totalPendientes = vendedores.reduce(
    (n, v) => n + v.pendientes.filter((p) => p.estado === EstadoEncuestaFabrica.PENDIENTE).length,
    0
  );

  // Totales de TODO lo cargado, no solo de lo pendiente: hasta ahora no había
  // forma de saber cuántos clientes tiene el sistema ni de ver los que ya
  // contestaron, así que el seguimiento se cortaba al responder.
  const todos = vendedores.flatMap((v) => v.pendientes);

  // Los conteos de vendedores son de PERSONAS: el 1035078 y el 1036078 cuentan uno
  // solo, y el correo cargado en cualquiera de sus códigos le sirve a los dos.
  const personasConPendientes = new Set(
    vendedores
      .filter((v) => v.pendientes.some((p) => p.estado === EstadoEncuestaFabrica.PENDIENTE))
      .map(clavePersonaVendedor)
  );
  const personasConCorreo = new Set(vendedores.filter((v) => v.email).map(clavePersonaVendedor));

  res.json({
    data: vendedores.map((v) => ({ ...v, persona: clavePersonaVendedor(v) })),
    resumen: {
      totalPendientes,
      vendedoresConPendientes: personasConPendientes.size,
      sinCorreo: [...personasConPendientes].filter((p) => !personasConCorreo.has(p)).length,
      // Estos tres solo tienen sentido cuando se piden los respondidos: si no, el
      // total es igual a los pendientes.
      totalClientes: todos.length,
      totalAvisados: todos.filter((p) => p.estado === EstadoEncuestaFabrica.AVISADO).length,
      totalRespondidos: todos.filter((p) => p.estado === EstadoEncuestaFabrica.RESPONDIO).length,
      totalManuales: todos.filter((p) => p.esManual).length,
      totalVendedores: vendedores.length,
    },
  });
}

// ---------- PATCH /api/encuesta-vw/vendedores/:id ----------
// Acá es donde Calidad carga el correo de cada vendedor. El código NO se edita:
// es el que viene del Excel de fábrica y es lo que une las dos puntas.

const vendedorSchema = z.object({
  nombre: z.string().trim().max(120).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "El correo no parece válido.")
    .nullable()
    .optional(),
  activo: z.boolean().optional(),
});

export async function editarVendedorVW(req: Request, res: Response) {
  const parsed = vendedorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const existente = await prisma.vendedorVW.findUnique({ where: { id: req.params.id } });
  if (!existente) return res.status(404).json({ message: "No se encontró ese vendedor." });

  const datos = {
    ...(parsed.data.nombre !== undefined ? { nombre: parsed.data.nombre || null } : {}),
    ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
    ...(parsed.data.activo !== undefined ? { activo: parsed.data.activo } : {}),
  };
  if (Object.keys(datos).length === 0) {
    return res.status(400).json({ message: "Indicá al menos un campo para actualizar." });
  }

  // Nombre, correo y activo son de la PERSONA, no del código: el 1035078 y el
  // 1036078 son el mismo vendedor en dos sucursales, y el correo se carga una sola
  // vez (Calidad de VW, 16-09-2026). Se guardan en todos sus códigos. El mostrador
  // (002) es uno por sucursal y queda solo.
  const codigosDeLaPersona = NUMEROS_DE_MOSTRADOR.has(existente.numero)
    ? [existente.codigo]
    : (
        await prisma.vendedorVW.findMany({ where: { numero: existente.numero }, select: { codigo: true } })
      ).map((v) => v.codigo);
  await prisma.vendedorVW.updateMany({ where: { codigo: { in: codigosDeLaPersona } }, data: datos });
  const actualizado = await prisma.vendedorVW.findUniqueOrThrow({ where: { id: existente.id } });
  auditar(req, {
    accion: ACCIONES.VENDEDOR_VW_EDITADO,
    entidad: "VendedorVW",
    entidadId: actualizado.id,
    detalles: {
      codigo: actualizado.codigo,
      codigos: codigosDeLaPersona,
      antes: { nombre: existente.nombre, email: existente.email, activo: existente.activo },
      despues: datos,
    },
  });
  res.json({ message: `Vendedor ${actualizado.nombre || actualizado.codigo} actualizado.`, data: actualizado });
}

// ---------- POST /api/encuesta-vw/vendedores ----------
// Alta a mano, por si hace falta uno que todavía no vino en ningún Excel.

const nuevoVendedorSchema = z.object({
  codigo: z.string().trim().regex(/^\d{7}$/, "El código del vendedor son 7 dígitos (4 de sucursal + 3 del vendedor)."),
  sucursal: zSucursal,
  nombre: z.string().trim().max(120).optional(),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "El correo no parece válido.")
    .optional(),
});

export async function crearVendedorVW(req: Request, res: Response) {
  const parsed = nuevoVendedorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const { codigo, sucursal, nombre, email } = parsed.data;
  const existente = await prisma.vendedorVW.findUnique({ where: { codigo } });
  if (existente) {
    return res.status(409).json({ message: `Ya existe un vendedor con el código ${codigo}.` });
  }
  // Regla estricta: la sucursal la dice el código. Si se eligió otra, se avisa en
  // vez de guardar un 1036 en Mendoza, que es justo lo que había que dejar de ver.
  const sucursalDelCodigo = sucursalDeCodigoVendedor(codigo);
  if (sucursalDelCodigo && claveNormalizada(sucursalDelCodigo) !== claveNormalizada(sucursal)) {
    return res.status(400).json({
      message: `El código ${codigo} es de ${sucursalCanonica(sucursalDelCodigo) ?? sucursalDelCodigo}: los ${codigo.slice(0, 4)} son siempre de esa sucursal.`,
    });
  }
  const numero = Number(codigo.slice(4));
  // Si la persona ya tiene su código en la otra sucursal, hereda nombre y correo
  // (se cargan una sola vez). El mostrador es uno por sucursal y no hereda nada.
  const gemelo = NUMEROS_DE_MOSTRADOR.has(numero)
    ? null
    : await prisma.vendedorVW.findFirst({ where: { numero }, orderBy: { codigo: "asc" } });
  const creado = await prisma.vendedorVW.create({
    data: {
      codigo,
      codigoSucursal: codigo.slice(0, 4),
      numero,
      sucursal: (sucursalDelCodigo ?? sucursal).toUpperCase(),
      nombre: nombre || gemelo?.nombre || null,
      email: email || gemelo?.email || null,
    },
  });
  // Un correo o nombre nuevo cargado acá también vale para su otro código.
  if (gemelo && (nombre || email)) {
    await prisma.vendedorVW.updateMany({
      where: { numero, codigo: { not: codigo } },
      data: { ...(nombre ? { nombre } : {}), ...(email ? { email } : {}) },
    });
  }
  auditar(req, { accion: ACCIONES.VENDEDOR_VW_CREADO, entidad: "VendedorVW", entidadId: creado.id, detalles: { codigo } });
  res.status(201).json({ message: `Vendedor ${creado.nombre || creado.codigo} creado.`, data: creado });
}

// ---------- POST /api/encuesta-vw/notificar ----------

const notificarSchema = z.object({
  codigos: z.array(z.string().trim().regex(/^\d{7}$/)).optional(),
});

export async function notificarEncuestaVW(req: Request, res: Response) {
  if (!marca.refuerzo.notificarPorMail) {
    return res.status(404).json({
      message: `El aviso por correo a los vendedores no está disponible en ${marca.nombre}.`,
    });
  }
  const parsed = notificarSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Los códigos de vendedor tienen que ser de 7 dígitos." });
  }

  const resultados = await avisarVendedoresVW({ codigos: parsed.data.codigos });
  const enviados = resultados.filter((r) => r.enviado).length;
  const fallidos = resultados.filter((r) => !r.enviado);

  auditar(req, {
    accion: ACCIONES.ENCUESTA_VW_NOTIFICADA,
    entidad: "VendedorVW",
    detalles: { enviados, fallidos: fallidos.length },
  });

  if (resultados.length === 0) {
    return res.json({
      message: "No hay ningún cliente sin avisar. A todos los pendientes ya se les avisó al vendedor.",
      resultados,
    });
  }
  // Se dice cuántos CLIENTES cambiaron de estado, no solo cuántos correos
  // salieron: es lo que la persona ve pasar en la pantalla, y si el número no
  // cuadra con lo que esperaba conviene que se note en el momento.
  const clientesAvisados = resultados.filter((r) => r.enviado).reduce((n, r) => n + r.pendientes, 0);
  const detalle = `${clientesAvisados} cliente(s) quedaron como avisados.`;
  const message = fallidos.length
    ? `Se avisó a ${enviados} vendedor(es); ${detalle} ${fallidos.length} no recibieron el correo.`
    : `Se avisó a ${enviados} vendedor(es); ${detalle}`;
  res.json({ message, resultados });
}

// ---------- DELETE /api/encuesta-vw/vendedores/:id ----------
//
// Borrado DE VERDAD, pero solo si se puede: cada encuesta pendiente apunta a su
// vendedor y esa referencia es obligatoria, así que un vendedor con clientes
// asociados no se puede borrar sin dejarlos huérfanos. En ese caso no se borra a
// medias ni se borra en cascada (serían clientes que nadie va a llamar): se
// explica y se ofrece desactivarlo, que es lo que el sistema ya sabe hacer.

export async function eliminarVendedorVW(req: Request, res: Response) {
  const vendedor = await prisma.vendedorVW.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { pendientes: true } } },
  });
  if (!vendedor) return res.status(404).json({ message: "No se encontró ese vendedor." });

  const asociados = vendedor._count.pendientes;
  if (asociados > 0) {
    return res.status(409).json({
      message:
        `No se puede borrar a ${vendedor.nombre || vendedor.codigo}: tiene ${asociados} encuesta(s) ` +
        `asociada(s) y quedarían sin vendedor. Si ya no trabaja acá, desactivalo: deja de recibir ` +
        `avisos y no aparece para asignar, pero sus clientes históricos siguen teniendo a quién ` +
        `estar asociados.`,
      puedeDesactivar: true,
    });
  }

  await prisma.vendedorVW.delete({ where: { id: vendedor.id } });
  auditar(req, {
    accion: ACCIONES.VENDEDOR_VW_ELIMINADO,
    entidad: "VendedorVW",
    entidadId: vendedor.id,
    detalles: { codigo: vendedor.codigo, nombre: vendedor.nombre, email: vendedor.email },
  });
  res.json({ message: `Vendedor ${vendedor.nombre || vendedor.codigo} eliminado.` });
}

// ---------- POST /api/encuesta-vw/manual ----------
//
// Alta a mano de una encuesta pendiente, para el cliente que no vino en el Excel
// de fábrica pero igual hay que llamar.
//
// Queda marcada con esManual para que la carga del próximo Excel no la dé por
// respondida: esa barrida cierra todo lo que no venga en el archivo, y un caso
// cargado a mano nunca va a venir.

const encuestaManualSchema = z.object({
  chasis: z.string().trim().min(5, "El chasis es obligatorio.").max(40),
  dominio: z.string().trim().max(20).optional(),
  nombreCliente: z.string().trim().min(1, "El nombre del cliente es obligatorio.").max(160),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "El correo no parece válido.")
    .optional(),
  codigoVendedor: z.string().trim().regex(/^\d{7}$/, "El código del vendedor son 7 dígitos."),
  fechaEntrega: z.string().trim().optional(),
  canalVentas: z.string().trim().max(40).optional(),
});

export async function crearEncuestaManualVW(req: Request, res: Response) {
  const parsed = encuestaManualSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  const d = parsed.data;

  const vendedor = await prisma.vendedorVW.findUnique({ where: { codigo: d.codigoVendedor } });
  if (!vendedor) {
    return res.status(404).json({
      message: `No existe el vendedor ${d.codigoVendedor}. Cargalo primero en la lista de vendedores.`,
    });
  }

  // El chasis identifica la unidad y es único: si ya está, no se duplica.
  const chasis = d.chasis.toUpperCase();
  const yaEsta = await prisma.encuestaFabricaVW.findUnique({ where: { chasis } });
  if (yaEsta) {
    return res.status(409).json({
      message:
        yaEsta.estado === EstadoEncuestaFabrica.PENDIENTE
          ? `Ese chasis ya está en la lista de pendientes (${yaEsta.nombreCliente}).`
          : `Ese chasis ya figura como respondido (${yaEsta.nombreCliente}).`,
    });
  }

  const fecha = d.fechaEntrega ? new Date(d.fechaEntrega) : null;
  const creada = await prisma.encuestaFabricaVW.create({
    data: {
      chasis,
      dominio: d.dominio || null,
      nombreCliente: d.nombreCliente,
      email: d.email || "",
      fechaEntrega: fecha && !Number.isNaN(fecha.getTime()) ? fecha : null,
      // El mes, estimado con la entrega: un caso a mano no trae Fecha Dominio. Se
      // saca del texto "AAAA-MM-DD" y no de la fecha, porque new Date("2026-08-01")
      // es medianoche UTC, que en Argentina todavía es 31 de julio.
      periodo: /^\d{4}-\d{2}/.test(d.fechaEntrega ?? "") ? d.fechaEntrega!.slice(0, 7) : null,
      canalVentas: d.canalVentas || null,
      vendedorId: vendedor.id,
      sucursal: vendedor.sucursal,
      esManual: true,
      estado: EstadoEncuestaFabrica.PENDIENTE,
    },
  });

  auditar(req, {
    accion: ACCIONES.ENCUESTA_VW_MANUAL_CREADA,
    entidad: "EncuestaFabricaVW",
    entidadId: creada.id,
    detalles: { chasis, cliente: d.nombreCliente, vendedor: vendedor.codigo },
  });
  res.status(201).json({
    message: `${d.nombreCliente} agregado a los pendientes de ${vendedor.nombre || vendedor.codigo}.`,
    data: creada,
  });
}

// ---------- PATCH /api/encuesta-vw/clientes/:id ----------
//
// El cambio de estado a mano, con la calificación y la observación.
//
// POR QUÉ HACE FALTA. El estado se movía solo por dos caminos: la carga del Excel
// (lo que deja de venir se da por respondido) y ahora el aviso al vendedor. Los
// dos van en una sola dirección y ninguno sabe lo que pasa por teléfono. Cuando
// el vendedor llama y el cliente le dice que ya contestó y puso 4, no había dónde
// anotarlo: el cliente seguía figurando como pendiente hasta la carga siguiente.
// Solo el ESTADO. La calificación y la observación se sacaron de esta pantalla
// a pedido de Calidad: acá los clientes no tienen teléfono y nunca entran al
// circuito de WhatsApp, así que no hay una llamada de la cual anotar nada. Eso
// vive ahora en la pantalla de Casos, sobre el 3° contacto, que es donde de
// verdad se habla con el cliente.
const estadoEncuestaSchema = z.object({
  estado: z.nativeEnum(EstadoEncuestaFabrica).optional(),
});

export async function editarEstadoEncuestaVW(req: Request, res: Response) {
  const parseo = estadoEncuestaSchema.safeParse(req.body);
  if (!parseo.success) {
    return res.status(400).json({ message: parseo.error.issues[0]?.message ?? "Datos inválidos." });
  }
  const cambios = parseo.data;

  const encuesta = await prisma.encuestaFabricaVW.findUnique({
    where: { id: req.params.id },
    include: { vendedor: { select: { codigo: true, nombre: true } } },
  });
  if (!encuesta) return res.status(404).json({ message: "No se encontró ese cliente." });

  const estadoNuevo = cambios.estado ?? encuesta.estado;

  const data: {
    estado: EstadoEncuestaFabrica;
    respondioEn?: Date | null;
    avisadoEn?: Date | null;
  } = { estado: estadoNuevo };

  // Las fechas las pone el sistema, no la persona: son el registro de CUÁNDO
  // pasó cada cosa y no un dato editable.
  if (estadoNuevo === EstadoEncuestaFabrica.RESPONDIO && !encuesta.respondioEn) {
    data.respondioEn = new Date();
  }
  if (estadoNuevo !== EstadoEncuestaFabrica.RESPONDIO) data.respondioEn = null;
  // Volver a PENDIENTE es, textualmente, "quiero que le vuelva a llegar al
  // vendedor": se limpia la marca de avisado para que entre de nuevo en el mail.
  if (estadoNuevo === EstadoEncuestaFabrica.PENDIENTE) data.avisadoEn = null;
  if (estadoNuevo === EstadoEncuestaFabrica.AVISADO && !encuesta.avisadoEn) {
    data.avisadoEn = new Date();
  }

  const actualizada = await prisma.encuestaFabricaVW.update({ where: { id: encuesta.id }, data });

  auditar(req, {
    accion: ACCIONES.ENCUESTA_VW_ESTADO_CAMBIADO,
    entidad: "EncuestaFabricaVW",
    entidadId: encuesta.id,
    detalles: {
      chasis: encuesta.chasis,
      cliente: encuesta.nombreCliente,
      vendedor: encuesta.vendedor?.codigo ?? null,
      estadoAnterior: encuesta.estado,
      estadoNuevo: actualizada.estado,
    },
  });

  res.json({ data: actualizada });
}

// ---------- DELETE /api/encuesta-vw/clientes/:id ----------
//
// Saca un cliente de la lista. Es borrado de verdad: la fila no la referencia
// nadie, así que no deja nada huérfano.
//
// UN DETALLE QUE HAY QUE AVISARLE A QUIEN LO USA: si el cliente vino del Excel de
// fábrica y todavía figura ahí, la próxima carga lo vuelve a traer. Eso es lo
// correcto —la lista de fábrica manda— pero sorprende si uno no lo sabe. Los
// cargados A MANO no vuelven: no salen de ningún archivo.
export async function eliminarEncuestaVW(req: Request, res: Response) {
  const encuesta = await prisma.encuestaFabricaVW.findUnique({
    where: { id: req.params.id },
    include: { vendedor: { select: { codigo: true, nombre: true } } },
  });
  if (!encuesta) return res.status(404).json({ message: "No se encontró ese cliente." });

  await prisma.encuestaFabricaVW.delete({ where: { id: encuesta.id } });

  auditar(req, {
    accion: ACCIONES.ENCUESTA_VW_ELIMINADA,
    entidad: "EncuestaFabricaVW",
    entidadId: encuesta.id,
    detalles: {
      chasis: encuesta.chasis,
      cliente: encuesta.nombreCliente,
      estado: encuesta.estado,
      esManual: encuesta.esManual,
      vendedor: encuesta.vendedor?.codigo ?? null,
    },
  });

  res.json({
    message: encuesta.esManual
      ? `${encuesta.nombreCliente} eliminado de la lista.`
      : `${encuesta.nombreCliente} eliminado. Ojo: vino del Excel de fábrica, así que si todavía figura ahí, la próxima carga lo vuelve a traer.`,
  });
}

// ---------- GET /api/encuesta-vw/seguimiento ----------
//
// Cómo van las animaciones MES A MES (ver seguimiento-encuesta-vw.service.ts).
// `periodo` acota el ranking de vendedores a un mes; sin él, el ranking es de
// todos los meses. La evolución de los meses viene siempre entera.
//
// LOS GRÁFICOS SON DE TODOS (pedido de Calidad, 16-09-2026): cualquier perfil —
// administrador, Calidad y también Fidelización— ve las DOS provincias. Antes se
// acotaban a la provincia del usuario, y por eso alguien de Calidad de Mendoza veía
// menos que un administrador sin saber por qué. `sucursal` es un filtro que elige
// la persona, no una restricción: sin él se ven todas. La lista de clientes y las
// acciones de esta pantalla no cambian.

const seguimientoSchema = z.object({
  periodo: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "El mes tiene que tener el formato AAAA-MM.")
    .optional(),
  sucursal: z.string().optional(),
});

export async function seguimientoEncuestaVW(req: Request, res: Response) {
  const parsed = seguimientoSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(" ") });
  }
  let sucursal: string | null = null;
  if (parsed.data.sucursal) {
    // Con la lista cerrada de la marca: "SAN JUAN" o "san juan" entran como "San
    // Juan", y un valor que no es una sucursal real se rechaza en vez de devolver
    // gráficos vacíos que parecerían datos.
    const canonica = sucursalCanonica(parsed.data.sucursal);
    if (!canonica || canonica === SUCURSAL_GENERAL) {
      return res.status(400).json({ message: mensajeSucursalInvalida() });
    }
    sucursal = canonica;
  }
  res.json(await seguimientoEncuestasVW({ sucursal, periodo: parsed.data.periodo ?? null }));
}
