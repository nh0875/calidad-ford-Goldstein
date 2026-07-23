import { Request, Response } from "express";
import { AreaUsuario, EstadoTareaRefuerzo, RolUsuario } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { hashPassword, motivoPasswordInvalida } from "../services/auth.service";
import { ACCIONES, auditar } from "../services/audit.service";

const SELECT_USUARIO = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  area: true,
  activo: true,
  participaEnRefuerzos: true,
  createdAt: true,
} as const;

// ---------- GET /api/usuarios ----------

export async function listUsuarios(_req: Request, res: Response) {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { createdAt: "asc" },
    select: SELECT_USUARIO,
  });
  res.json({ data: usuarios });
}

// ---------- POST /api/usuarios ----------

const createUsuarioSchema = z.object({
  nombre: z.string().trim().min(1, "Ingresá el nombre."),
  email: z.string().trim().min(1, "Ingresá el email.").email("El email no es válido."),
  password: z.string().min(1, "Ingresá una contraseña inicial."),
  rol: z.nativeEnum(RolUsuario).default(RolUsuario.CALIDAD),
  area: z.nativeEnum(AreaUsuario).default(AreaUsuario.AMBAS),
});

export async function createUsuario(req: Request, res: Response) {
  const parsed = createUsuarioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.errors[0]?.message ?? "Revisá los datos del formulario.",
    });
  }

  const errorFormato = motivoPasswordInvalida(parsed.data.password);
  if (errorFormato) {
    return res.status(400).json({ message: errorFormato });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const yaExiste = await prisma.usuario.findUnique({ where: { email } });
  if (yaExiste) {
    return res.status(409).json({ message: "Ya existe un usuario con ese email." });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const usuario = await prisma.usuario.create({
    data: { nombre: parsed.data.nombre, email, passwordHash, rol: parsed.data.rol, area: parsed.data.area },
    select: SELECT_USUARIO,
  });

  // Auditoría: nunca se registra la contraseña, solo email/rol/área.
  await auditar(req, {
    accion: ACCIONES.USUARIO_CREADO,
    entidad: "Usuario",
    entidadId: usuario.id,
    detalles: { email: usuario.email, rol: usuario.rol, area: usuario.area },
  });

  res.status(201).json({ message: `Usuario ${usuario.nombre} creado correctamente.`, data: usuario });
}

// ---------- PATCH /api/usuarios/:id/resetear-password ----------
// El sistema no tiene servicio de mail: el admin define directamente la
// contraseña nueva y se la comunica a la persona por otro medio.

const resetearPasswordSchema = z.object({
  passwordNueva: z.string().min(1, "Ingresá la contraseña nueva."),
});

export async function resetearPassword(req: Request, res: Response) {
  const parsed = resetearPasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.errors[0]?.message ?? "Ingresá la contraseña nueva.",
    });
  }

  const errorFormato = motivoPasswordInvalida(parsed.data.passwordNueva);
  if (errorFormato) {
    return res.status(400).json({ message: errorFormato });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!usuario) {
    return res.status(404).json({ message: "No se encontró ese usuario." });
  }

  const passwordHash = await hashPassword(parsed.data.passwordNueva);
  await prisma.usuario.update({ where: { id: usuario.id }, data: { passwordHash } });

  // Se audita el reseteo (quién a quién), nunca la contraseña nueva.
  await auditar(req, {
    accion: ACCIONES.USUARIO_PASSWORD_RESET,
    entidad: "Usuario",
    entidadId: usuario.id,
    detalles: { email: usuario.email },
  });

  res.json({ message: `Contraseña de ${usuario.nombre} restablecida correctamente.` });
}

// ---------- PATCH /api/usuarios/:id ----------
// Activar/desactivar una cuenta (ej: alguien deja el equipo).

const patchUsuarioSchema = z
  .object({
    activo: z.boolean().optional(),
    participaEnRefuerzos: z.boolean().optional(),
    area: z.nativeEnum(AreaUsuario).optional(),
  })
  .refine((v) => v.activo !== undefined || v.participaEnRefuerzos !== undefined || v.area !== undefined, {
    message: "Indicá al menos un cambio (activo, área o participaEnRefuerzos).",
  });

export async function patchUsuario(req: Request, res: Response) {
  const parsed = patchUsuarioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Datos inválidos." });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!usuario) {
    return res.status(404).json({ message: "No se encontró ese usuario." });
  }
  if (usuario.id === req.usuario!.id && parsed.data.activo === false) {
    return res.status(400).json({ message: "No podés desactivar tu propia cuenta." });
  }

  const actualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      ...(parsed.data.activo !== undefined ? { activo: parsed.data.activo } : {}),
      ...(parsed.data.area !== undefined ? { area: parsed.data.area } : {}),
      ...(parsed.data.participaEnRefuerzos !== undefined
        ? { participaEnRefuerzos: parsed.data.participaEnRefuerzos }
        : {}),
    },
    select: SELECT_USUARIO,
  });

  // Si se le cambió el área y queda restringido, sus tareas abiertas de la OTRA
  // área ya no le corresponden: se avisan para que el ADMIN las reasigne.
  let tareasParaReasignar: Array<{ id: string; numeroOrden: string; nombrePropietario: string }> = [];
  const cambioArea = parsed.data.area !== undefined && parsed.data.area !== usuario.area;
  if (cambioArea && actualizado.area !== AreaUsuario.AMBAS) {
    const areaOtra = actualizado.area === AreaUsuario.VENTAS ? "POSVENTA" : "VENTAS";
    const tareas = await prisma.tareaRefuerzo.findMany({
      where: {
        asignadoAId: actualizado.id,
        estado: { in: [EstadoTareaRefuerzo.PENDIENTE, EstadoTareaRefuerzo.EN_GESTION] },
        caso: { area: areaOtra, eliminadoEn: null },
      },
      select: { id: true, caso: { select: { numeroOrden: true, nombrePropietario: true } } },
    });
    tareasParaReasignar = tareas.map((t) => ({
      id: t.id,
      numeroOrden: t.caso.numeroOrden,
      nombrePropietario: t.caso.nombrePropietario,
    }));
  }

  await auditar(req, {
    accion: ACCIONES.USUARIO_MODIFICADO,
    entidad: "Usuario",
    entidadId: actualizado.id,
    detalles: {
      email: actualizado.email,
      activoAntes: usuario.activo,
      activoDespues: actualizado.activo,
      areaAntes: usuario.area,
      areaDespues: actualizado.area,
      tareasParaReasignar: tareasParaReasignar.length,
      participaEnRefuerzosAntes: usuario.participaEnRefuerzos,
      participaEnRefuerzosDespues: actualizado.participaEnRefuerzos,
    },
  });

  const avisoArea =
    tareasParaReasignar.length > 0
      ? ` Atención: tiene ${tareasParaReasignar.length} tarea(s) abierta(s) de la otra área que hay que reasignar.`
      : "";
  res.json({
    message: `${actualizado.nombre} quedó ${actualizado.activo ? "activo" : "desactivado"}.${avisoArea}`,
    data: actualizado,
    tareasParaReasignar,
  });
}
