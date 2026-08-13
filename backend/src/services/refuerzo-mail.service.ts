// Notificación por correo del Refuerzo de encuesta (Volkswagen).
//
// En Ford los asesores entran al sistema y trabajan sus tareas ahí. En VW NO:
// los vendedores nunca abren el sistema. La administradora asigna los clientes y
// el sistema le manda a CADA vendedor un correo con los suyos; a partir de ahí
// la gestión es responsabilidad del vendedor, fuera del sistema.
//
// Por eso el correo tiene que bastarse solo: lleva todos los datos de contacto,
// porque el vendedor no tiene dónde ir a buscarlos.
import { EstadoTareaRefuerzo } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca } from "../config/marca";
import { enviarMail, MailError } from "./mail.service";

interface ClienteDelVendedor {
  nombre: string;
  telefono: string;
  email: string;
  modelo: string;
  patente: string;
  numeroOrden: string;
  sucursal: string;
  fecha: string;
}

function fechaCorta(f: Date | null | undefined): string {
  if (!f) return "-";
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}/${f.getFullYear()}`;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cuerpo del correo: una tabla con los clientes asignados a ese vendedor. */
function armarCuerpo(vendedor: string, clientes: ClienteDelVendedor[]): { html: string; texto: string } {
  const filas = clientes
    .map(
      (c) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.nombre)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.telefono)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.email)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.modelo)} ${escapar(c.patente)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.numeroOrden)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.fecha)}</td>
      </tr>`
    )
    .join("");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px">
    <p>Hola ${escapar(vendedor)},</p>
    <p>Te asignamos <strong>${clientes.length} cliente(s)</strong> para reforzar la encuesta de ${escapar(
      marca.nombre
    )}. Estos clientes ya recibieron la encuesta de fábrica en su correo y todavía no la respondieron.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead>
        <tr style="background:#f4f4f4;text-align:left">
          <th style="padding:6px 10px">Cliente</th>
          <th style="padding:6px 10px">Teléfono</th>
          <th style="padding:6px 10px">E-mail</th>
          <th style="padding:6px 10px">Vehículo</th>
          <th style="padding:6px 10px">N° orden</th>
          <th style="padding:6px 10px">Fecha</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    <p style="margin-top:16px;color:#666;font-size:12px">
      Este correo lo genera automáticamente el sistema de Calidad de ${escapar(marca.nombre)}.
      No hace falta responderlo.
    </p>
  </div>`;

  const texto =
    `Hola ${vendedor},\n\n` +
    `Te asignamos ${clientes.length} cliente(s) para reforzar la encuesta de ${marca.nombre}.\n\n` +
    clientes
      .map(
        (c) =>
          `- ${c.nombre} | Tel: ${c.telefono} | Mail: ${c.email} | ${c.modelo} ${c.patente} | Orden ${c.numeroOrden} | ${c.fecha}`
      )
      .join("\n") +
    `\n\nEste correo lo genera automáticamente el sistema de Calidad de ${marca.nombre}.`;

  return { html, texto };
}

export interface ResultadoNotificacion {
  vendedor: string;
  email: string;
  clientes: number;
  enviado: boolean;
  error: string | null;
}

/**
 * Manda a cada vendedor con tareas PENDIENTES el detalle de sus clientes.
 *
 * Un fallo con un vendedor NO corta el envío del resto: se registra y se sigue.
 * Si la mitad de las casillas están mal escritas, la otra mitad tiene que
 * recibir su lista igual.
 */
export async function notificarVendedores(): Promise<ResultadoNotificacion[]> {
  const tareas = await prisma.tareaRefuerzo.findMany({
    where: {
      estado: EstadoTareaRefuerzo.PENDIENTE,
      asignadoAId: { not: null },
      caso: { eliminadoEn: null },
    },
    select: {
      asignadoA: { select: { id: true, nombre: true, email: true } },
      caso: {
        select: {
          nombrePropietario: true,
          whatsapp: true,
          celular: true,
          emailPropietario: true,
          modelo: true,
          patente: true,
          numeroOrden: true,
          sucursal: true,
          fechaSalida: true,
          fechaProgramacion: true,
        },
      },
    },
  });

  // Agrupado por vendedor: un correo por persona, no uno por cliente.
  const porVendedor = new Map<string, { nombre: string; email: string; clientes: ClienteDelVendedor[] }>();
  for (const t of tareas) {
    if (!t.asignadoA) continue;
    const grupo =
      porVendedor.get(t.asignadoA.id) ??
      { nombre: t.asignadoA.nombre, email: t.asignadoA.email, clientes: [] };
    grupo.clientes.push({
      nombre: t.caso.nombrePropietario,
      telefono: t.caso.whatsapp || t.caso.celular || "-",
      email: t.caso.emailPropietario || "-",
      modelo: t.caso.modelo,
      patente: t.caso.patente || "-",
      numeroOrden: t.caso.numeroOrden,
      sucursal: t.caso.sucursal,
      fecha: fechaCorta(t.caso.fechaSalida ?? t.caso.fechaProgramacion),
    });
    porVendedor.set(t.asignadoA.id, grupo);
  }

  const resultados: ResultadoNotificacion[] = [];
  for (const grupo of porVendedor.values()) {
    const { html, texto } = armarCuerpo(grupo.nombre, grupo.clientes);
    try {
      await enviarMail({
        para: grupo.email,
        asunto: `Refuerzo de encuesta ${marca.nombre}: ${grupo.clientes.length} cliente(s) para contactar`,
        texto,
        html,
      });
      resultados.push({
        vendedor: grupo.nombre,
        email: grupo.email,
        clientes: grupo.clientes.length,
        enviado: true,
        error: null,
      });
    } catch (err) {
      resultados.push({
        vendedor: grupo.nombre,
        email: grupo.email,
        clientes: grupo.clientes.length,
        enviado: false,
        error: err instanceof MailError ? err.message : "No se pudo enviar el correo.",
      });
    }
  }
  return resultados;
}
