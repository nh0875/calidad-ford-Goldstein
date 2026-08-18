// Aviso por correo a los vendedores de Volkswagen con sus encuestas pendientes.
//
// Los vendedores de VW NO entran al sistema. Fábrica les mandó la encuesta a los
// clientes por mail y todavía no la contestaron; el vendedor es el que los tiene
// que llamar. Así que el correo tiene que bastarse solo: lleva el nombre, el
// mail y la unidad de cada cliente, porque el vendedor no tiene dónde ir a
// buscarlos.
//
// Estos clientes NO traen teléfono (el Excel de fábrica no lo incluye), por eso
// la tabla no lo muestra: prometer una columna vacía es peor que no ponerla.
import { EstadoEncuestaFabrica } from "@prisma/client";
import { prisma } from "../config/prisma";
import { marca } from "../config/marca";
import { enviarMail, MailError } from "./mail.service";

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

interface ClientePendiente {
  nombre: string;
  email: string;
  dominio: string;
  canal: string;
  fecha: string;
}

function armarCuerpo(vendedor: string, clientes: ClientePendiente[]): { html: string; texto: string } {
  const filas = clientes
    .map(
      (c) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.nombre)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.email)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.dominio)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.canal)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.fecha)}</td>
      </tr>`
    )
    .join("");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px">
    <p>Hola ${escapar(vendedor)},</p>
    <p>Estos <strong>${clientes.length} cliente(s)</strong> tuyos todavía no respondieron la encuesta de
    ${escapar(marca.nombre)}. Ya la recibieron en su correo de parte de fábrica: lo que falta es que la
    contesten. Te pedimos que los llames para recordárselo.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead>
        <tr style="background:#f4f4f4;text-align:left">
          <th style="padding:6px 10px">Cliente</th>
          <th style="padding:6px 10px">E-mail donde le llegó</th>
          <th style="padding:6px 10px">Dominio</th>
          <th style="padding:6px 10px">Canal</th>
          <th style="padding:6px 10px">Entrega</th>
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
    `Estos ${clientes.length} cliente(s) tuyos todavía no respondieron la encuesta de ${marca.nombre}.\n` +
    `Ya la recibieron por correo de parte de fábrica; falta que la contesten.\n\n` +
    clientes
      .map((c) => `- ${c.nombre} | ${c.email} | ${c.dominio} | ${c.canal} | Entrega ${c.fecha}`)
      .join("\n") +
    `\n\nEste correo lo genera automáticamente el sistema de Calidad de ${marca.nombre}.`;

  return { html, texto };
}

export interface ResultadoAvisoVendedor {
  codigo: string;
  vendedor: string;
  email: string | null;
  pendientes: number;
  enviado: boolean;
  error: string | null;
}

/**
 * Le manda a cada vendedor la lista de sus clientes pendientes.
 *
 * Un fallo con un vendedor NO corta el resto: se anota y se sigue. Si tres
 * casillas están mal escritas, los demás tienen que recibir su lista igual.
 *
 * Los vendedores sin correo cargado se devuelven igual en el resultado, con
 * enviado=false y el motivo, para que la pantalla muestre a quién le falta el
 * dato en vez de dejarlos afuera en silencio.
 */
export async function avisarVendedoresVW(opciones?: { codigos?: string[] }): Promise<ResultadoAvisoVendedor[]> {
  const vendedores = await prisma.vendedorVW.findMany({
    where: {
      activo: true,
      ...(opciones?.codigos?.length ? { codigo: { in: opciones.codigos } } : {}),
      pendientes: { some: { estado: EstadoEncuestaFabrica.PENDIENTE } },
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      email: true,
      pendientes: {
        where: { estado: EstadoEncuestaFabrica.PENDIENTE },
        select: { nombreCliente: true, email: true, dominio: true, canalVentas: true, fechaEntrega: true },
        orderBy: { fechaEntrega: "asc" },
      },
    },
    orderBy: { codigo: "asc" },
  });

  const resultados: ResultadoAvisoVendedor[] = [];

  for (const v of vendedores) {
    const nombre = v.nombre || `Vendedor ${v.codigo}`;
    const base = { codigo: v.codigo, vendedor: nombre, email: v.email, pendientes: v.pendientes.length };

    if (!v.email?.trim()) {
      resultados.push({
        ...base,
        enviado: false,
        error: "No tiene correo cargado. Cargalo en la pantalla de vendedores y volvé a avisar.",
      });
      continue;
    }

    const clientes: ClientePendiente[] = v.pendientes.map((p) => ({
      nombre: p.nombreCliente,
      email: p.email,
      dominio: p.dominio || "-",
      canal: p.canalVentas || "-",
      fecha: fechaCorta(p.fechaEntrega),
    }));

    const { html, texto } = armarCuerpo(nombre, clientes);
    try {
      await enviarMail({
        para: v.email,
        asunto: `Encuestas de ${marca.nombre} sin responder: ${clientes.length} cliente(s) tuyos`,
        texto,
        html,
      });
      await prisma.vendedorVW.update({ where: { id: v.id }, data: { ultimoAvisoEn: new Date() } });
      resultados.push({ ...base, enviado: true, error: null });
    } catch (err) {
      resultados.push({
        ...base,
        enviado: false,
        error: err instanceof MailError ? err.message : "No se pudo enviar el correo.",
      });
    }
  }

  return resultados;
}
