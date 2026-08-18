import { Request, Response } from "express";
import { z } from "zod";
import { EstadoEncuestaFabrica } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca } from "../config/marca";
import { abrirWorkbook, borrarArchivoTemporal, guardarArchivoTemporal, leerArchivoTemporal } from "../services/excel.service";
import { parsearArchivoEncuestaVW } from "../services/encuesta-vw.service";
import { importarEncuestaFabricaVW } from "../services/importacion-encuesta-vw.service";
import { avisarVendedoresVW } from "../services/encuesta-vw-mail.service";
import { ACCIONES, auditar } from "../services/audit.service";

// ---------- POST /api/encuesta-vw/preview ----------
// Se lee el archivo y se muestra lo que se va a hacer ANTES de tocar la base.
// La carga cierra pendientes (los que ya no vienen se dan por respondidos), así
// que conviene que quien la sube vea el impacto antes de confirmar.

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

  const archivo = parsearArchivoEncuestaVW(workbook);
  if ("error" in archivo) return res.status(400).json({ message: archivo.error });
  if (archivo.filas.length === 0) {
    return res.status(400).json({
      message: "El archivo no tiene ninguna fila que se pueda importar. " + archivo.avisos.join(" "),
    });
  }

  // Cuántos se darían por respondidos si se confirma: los pendientes de estas
  // sucursales cuyo chasis no viene en el archivo nuevo.
  const sucursales = [...new Set(archivo.filas.map((f) => f.codigoSucursal))];
  const chasisDelArchivo = archivo.filas.map((f) => f.chasis);
  const seDarianPorRespondidos = await prisma.encuestaFabricaVW.count({
    where: {
      estado: EstadoEncuestaFabrica.PENDIENTE,
      vendedor: { codigoSucursal: { in: sucursales } },
      chasis: { notIn: chasisDelArchivo },
    },
  });

  const porVendedor = new Map<string, { codigo: string; nombre: string | null; sucursal: string; clientes: number }>();
  for (const f of archivo.filas) {
    const previo = porVendedor.get(f.codigoVendedor);
    porVendedor.set(f.codigoVendedor, {
      codigo: f.codigoVendedor,
      nombre: f.nombreVendedor ?? previo?.nombre ?? null,
      sucursal: archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ?? f.codigoSucursal,
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
    seDarianPorRespondidos,
    vendedores: [...porVendedor.values()].sort((a, b) => b.clientes - a.clientes),
    vendedoresSinNombre: archivo.vendedoresSinNombre,
    rechazadas: archivo.rechazadas,
    observadasPorFabrica: archivo.filas
      .filter((f) => f.observacionesFabrica.length > 0)
      .map((f) => ({ hoja: f.hoja, fila: f.numeroFilaExcel, cliente: f.nombreCliente, observaciones: f.observacionesFabrica })),
    avisos: archivo.avisos,
  });
}

// ---------- POST /api/encuesta-vw/confirm ----------

const confirmSchema = z.object({
  fileToken: z.string().uuid("El identificador del archivo no es válido. Volvé a subir el Excel."),
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
    auditar: (d) => auditar(req, d),
  });
  borrarArchivoTemporal(parsed.data.fileToken);

  if ("error" in resumen) return res.status(400).json({ message: resumen.error });

  const partes = [
    `${resumen.pendientesNuevos} cliente(s) nuevo(s)`,
    `${resumen.pendientesQueSiguen} que ya estaban`,
    `${resumen.marcadosRespondio} dado(s) por respondido(s)`,
  ];
  if (resumen.vendedoresNuevos) partes.push(`${resumen.vendedoresNuevos} vendedor(es) nuevo(s)`);
  if (resumen.vendedoresSinMail.length) partes.push(`${resumen.vendedoresSinMail.length} sin correo cargado`);

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
      nombre: true,
      email: true,
      sucursal: true,
      activo: true,
      ultimoAvisoEn: true,
      pendientes: {
        where: incluirRespondidos ? {} : { estado: EstadoEncuestaFabrica.PENDIENTE },
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
          estado: true,
          respondioEn: true,
          detectadaEn: true,
          observacionesFabrica: true,
        },
      },
    },
  });

  const totalPendientes = vendedores.reduce(
    (n, v) => n + v.pendientes.filter((p) => p.estado === EstadoEncuestaFabrica.PENDIENTE).length,
    0
  );

  res.json({
    data: vendedores,
    resumen: {
      totalPendientes,
      vendedoresConPendientes: vendedores.filter((v) =>
        v.pendientes.some((p) => p.estado === EstadoEncuestaFabrica.PENDIENTE)
      ).length,
      sinCorreo: vendedores.filter(
        (v) => !v.email && v.pendientes.some((p) => p.estado === EstadoEncuestaFabrica.PENDIENTE)
      ).length,
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

  const actualizado = await prisma.vendedorVW.update({ where: { id: existente.id }, data: datos });
  auditar(req, {
    accion: ACCIONES.VENDEDOR_VW_EDITADO,
    entidad: "VendedorVW",
    entidadId: actualizado.id,
    detalles: { codigo: actualizado.codigo, antes: { nombre: existente.nombre, email: existente.email, activo: existente.activo }, despues: datos },
  });
  res.json({ message: `Vendedor ${actualizado.nombre || actualizado.codigo} actualizado.`, data: actualizado });
}

// ---------- POST /api/encuesta-vw/vendedores ----------
// Alta a mano, por si hace falta uno que todavía no vino en ningún Excel.

const nuevoVendedorSchema = z.object({
  codigo: z.string().trim().regex(/^\d{7}$/, "El código del vendedor son 7 dígitos (4 de sucursal + 3 del vendedor)."),
  sucursal: z.string().trim().min(1, "Indicá la sucursal.").max(80),
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
  const creado = await prisma.vendedorVW.create({
    data: {
      codigo,
      codigoSucursal: codigo.slice(0, 4),
      numero: Number(codigo.slice(4)),
      sucursal: sucursal.toUpperCase(),
      nombre: nombre || null,
      email: email || null,
    },
  });
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
    return res.json({ message: "No hay ningún vendedor con clientes pendientes.", resultados });
  }
  const message = fallidos.length
    ? `Se avisó a ${enviados} vendedor(es). ${fallidos.length} no recibieron el correo.`
    : `Se avisó a ${enviados} vendedor(es).`;
  res.json({ message, resultados });
}
