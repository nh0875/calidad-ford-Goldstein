import { Request, Response } from "express";
import { AreaTrabajo, AreaUsuario, EstadoTareaRefuerzo, RolUsuario } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { hashPassword, motivoPasswordInvalida } from "../services/auth.service";
import { ACCIONES, auditar } from "../services/audit.service";
import { mismaProvincia } from "../services/refuerzo.service";
import { zSucursalUsuario } from "../services/sucursal.service";

const SELECT_USUARIO = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  area: true,
  sucursal: true,
  activo: true,
  participaEnRefuerzos: true,
  createdAt: true,
} as const;

// La provincia del usuario tiene que coincidir EXACTO con la de las cargas: si
// no, el usuario deja de ver todo y la pantalla no dice por qué. Por eso se
// valida contra la lista cerrada de la marca (ver services/sucursal.service.ts)
// en vez de normalizar a mano lo que alguien haya escrito.

// ---------- GET /api/usuarios ----------

export async function listUsuarios(_req: Request, res: Response) {
  const usuarios = await prisma.usuario.findMany({
    where: { eliminadoEn: null },
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
  // Provincia que atiende. Vacío = todas (sin restricción de provincia).
  sucursal: zSucursalUsuario.optional(),
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
  // El ADMIN no está limitado por área ni provincia: siempre AMBAS / todas.
  const esAdminNuevo = parsed.data.rol === RolUsuario.ADMIN;
  const area = esAdminNuevo ? AreaUsuario.AMBAS : parsed.data.area;
  const sucursal = esAdminNuevo ? null : parsed.data.sucursal ?? null;
  const usuario = await prisma.usuario.create({
    data: {
      nombre: parsed.data.nombre,
      email,
      passwordHash,
      rol: parsed.data.rol,
      area,
      sucursal,
      // participaEnRefuerzos viene en true por defecto en el schema. Para el rol
      // de Fidelizacion eso estaria mal: no trabaja Contacto Posterior, y el
      // sistema contaria su cuenta como cobertura del area y dejaria de avisar
      // que esas tareas no las mira nadie.
      participaEnRefuerzos: parsed.data.rol !== RolUsuario.FIDELIZACION,
    },
    select: SELECT_USUARIO,
  });

  // Auditoría: nunca se registra la contraseña, solo email/rol/área/provincia.
  await auditar(req, {
    accion: ACCIONES.USUARIO_CREADO,
    entidad: "Usuario",
    entidadId: usuario.id,
    detalles: { email: usuario.email, rol: usuario.rol, area: usuario.area, sucursal: usuario.sucursal },
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
    // Provincia: string ("" = todas) para poder cambiarla o limpiarla.
    sucursal: zSucursalUsuario.optional(),
  })
  .refine(
    (v) =>
      v.activo !== undefined ||
      v.participaEnRefuerzos !== undefined ||
      v.area !== undefined ||
      v.sucursal !== undefined,
    { message: "Indicá al menos un cambio (activo, área, provincia o participaEnRefuerzos)." }
  );

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

  // El ADMIN no se limita por área/provincia: se ignoran esos cambios sobre un admin.
  const esAdmin = usuario.rol === "ADMIN";
  const nuevaSucursal =
    !esAdmin && parsed.data.sucursal !== undefined ? parsed.data.sucursal : undefined;
  const nuevaArea = !esAdmin ? parsed.data.area : undefined;

  const actualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      ...(parsed.data.activo !== undefined ? { activo: parsed.data.activo } : {}),
      ...(nuevaArea !== undefined ? { area: nuevaArea } : {}),
      ...(nuevaSucursal !== undefined ? { sucursal: nuevaSucursal } : {}),
      ...(parsed.data.participaEnRefuerzos !== undefined
        ? { participaEnRefuerzos: parsed.data.participaEnRefuerzos }
        : {}),
    },
    select: SELECT_USUARIO,
  });

  // POOL COMPARTIDO: las tareas de refuerzo NO tienen dueño (se ven por
  // área+provincia). Al desactivar/cambiar el alcance de un usuario no hay tareas
  // "huérfanas" que redistribuir: simplemente dejan de aparecerle en su pool.

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
      sucursalAntes: usuario.sucursal,
      sucursalDespues: actualizado.sucursal,
      participaEnRefuerzosAntes: usuario.participaEnRefuerzos,
      participaEnRefuerzosDespues: actualizado.participaEnRefuerzos,
    },
  });

  // Mensaje que refleja lo que REALMENTE cambió (no siempre "activo/desactivado").
  const cambios: string[] = [];
  if (parsed.data.activo !== undefined && parsed.data.activo !== usuario.activo) {
    cambios.push(actualizado.activo ? "reactivado" : "desactivado");
  }
  if (nuevaArea !== undefined && nuevaArea !== usuario.area) cambios.push(`área → ${actualizado.area}`);
  if (nuevaSucursal !== undefined && (nuevaSucursal ?? "") !== (usuario.sucursal ?? "")) {
    cambios.push(`provincia → ${actualizado.sucursal ?? "todas"}`);
  }
  if (parsed.data.participaEnRefuerzos !== undefined && parsed.data.participaEnRefuerzos !== usuario.participaEnRefuerzos) {
    cambios.push(actualizado.participaEnRefuerzos ? "participa en refuerzos" : "no participa en refuerzos");
  }
  res.json({
    message: `${actualizado.nombre}: ${cambios.join(", ") || "sin cambios"}.`,
    data: actualizado,
  });
}

// ---------- DELETE /api/usuarios/:id ----------
//
// Borrado LÓGICO. Un Usuario cuelga de once relaciones —auditoría, los RQR que
// creó, los casos que borró, los WhatsApp que mandó—, así que un DELETE de
// verdad o falla por clave foránea o se lleva puesta la trazabilidad, que en un
// sistema de Calidad es justamente lo que no se puede perder.
//
// Lo que sí pasa, y es lo que la persona espera al apretar "Eliminar": la cuenta
// desaparece de la lista, no puede volver a entrar, y el email queda LIBRE para
// usarlo en una cuenta nueva.
export async function eliminarUsuario(req: Request, res: Response) {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!usuario || usuario.eliminadoEn) {
    return res.status(404).json({ message: "No se encontró ese usuario." });
  }

  if (usuario.id === req.usuario!.id) {
    return res.status(409).json({ message: "No podés eliminar tu propia cuenta." });
  }

  // Que no quede el sistema sin nadie que pueda administrarlo.
  if (usuario.rol === RolUsuario.ADMIN) {
    const otrosAdmins = await prisma.usuario.count({
      where: { rol: RolUsuario.ADMIN, activo: true, eliminadoEn: null, id: { not: usuario.id } },
    });
    if (otrosAdmins === 0) {
      return res.status(409).json({
        message: "Es el único administrador activo: si lo eliminás, nadie puede administrar el sistema.",
      });
    }
  }

  // El email se libera con un prefijo, porque la columna es única y el registro
  // no se borra. Así se puede volver a dar de alta a la misma persona.
  const marcaTiempo = Date.now();
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      eliminadoEn: new Date(),
      activo: false,
      participaEnRefuerzos: false,
      email: `eliminado-${marcaTiempo}-${usuario.email}`,
    },
  });

  auditar(req, {
    accion: ACCIONES.USUARIO_ELIMINADO,
    entidad: "Usuario",
    entidadId: usuario.id,
    detalles: { nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
  });
  res.json({ message: `Se eliminó la cuenta de ${usuario.nombre}. El email queda libre para reutilizar.` });
}
