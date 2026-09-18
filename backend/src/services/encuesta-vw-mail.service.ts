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
import { env } from "../config/env";
import { marca } from "../config/marca";
import { clavePersonaVendedor, NUMEROS_DE_MOSTRADOR } from "./encuesta-vw.service";
import { claveNormalizada } from "./normalizacion.service";
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
  /** Cuántas veces se le avisó ANTES al vendedor por este cliente (0 = es nuevo). */
  avisosPrevios: number;
  /** Cuándo fue el último de esos avisos. */
  ultimoAviso: string;
}

/**
 * La tabla de clientes, en HTML. Los que ya se le habían avisado llevan una
 * columna más con los avisos anteriores: es lo que le dice al vendedor "este ya
 * te lo mandamos y sigue sin contestar", que es el sentido del recordatorio.
 */
function tablaHtml(clientes: ClientePendiente[], conAvisosPrevios: boolean): string {
  const filas = clientes
    .map(
      (c) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.nombre)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.email)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.dominio)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.canal)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapar(c.fecha)}</td>${
          conAvisosPrevios
            ? `
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${
          c.avisosPrevios === 1 ? `1 vez (${escapar(c.ultimoAviso)})` : `${c.avisosPrevios} veces (último ${escapar(c.ultimoAviso)})`
        }</td>`
            : ""
        }
      </tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead>
        <tr style="background:#f4f4f4;text-align:left">
          <th style="padding:6px 10px">Cliente</th>
          <th style="padding:6px 10px">E-mail donde le llegó</th>
          <th style="padding:6px 10px">Dominio</th>
          <th style="padding:6px 10px">Canal</th>
          <th style="padding:6px 10px">Entrega</th>${conAvisosPrevios ? `
          <th style="padding:6px 10px">Ya te lo avisamos</th>` : ""}
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
}

function armarCuerpo(vendedor: string, clientes: ClientePendiente[]): { html: string; texto: string } {
  // Recordatorio (18-09-2026): Calidad puede volver a pasar a pendiente a los que
  // ya se avisaron y no contestaron. Esos van en una tabla aparte, para que el
  // vendedor distinga lo nuevo de lo que ya le mandamos y sigue sin respuesta.
  const nuevos = clientes.filter((c) => c.avisosPrevios === 0);
  const repetidos = clientes.filter((c) => c.avisosPrevios > 0);

  const bloqueNuevos = nuevos.length
    ? `<p>Estos <strong>${nuevos.length} cliente(s)</strong> tuyos todavía no respondieron la encuesta de
    ${escapar(marca.nombre)}. Ya la recibieron en su correo de parte de fábrica: lo que falta es que la
    contesten. Te pedimos que los llames para recordárselo.</p>
    ${tablaHtml(nuevos, false)}`
    : "";
  const bloqueRepetidos = repetidos.length
    ? `<p style="margin-top:${nuevos.length ? "20px" : "0"}"><strong>Recordatorio:</strong> estos
    <strong>${repetidos.length} cliente(s)</strong> ya te los habíamos avisado y <strong>siguen sin responder</strong>
    la encuesta de ${escapar(marca.nombre)}. Si ya los llamaste, volvé a intentar: la encuesta se puede contestar
    hasta que fábrica la cierre.</p>
    ${tablaHtml(repetidos, true)}`
    : "";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px">
    <p>Hola ${escapar(vendedor)},</p>
    ${bloqueNuevos}
    ${bloqueRepetidos}
    <p style="margin-top:16px;color:#666;font-size:12px">
      Este correo lo genera automáticamente el sistema de Calidad de ${escapar(marca.nombre)}.
      No hace falta responderlo.
    </p>
  </div>`;

  const linea = (c: ClientePendiente) => `- ${c.nombre} | ${c.email} | ${c.dominio} | ${c.canal} | Entrega ${c.fecha}`;
  const texto =
    `Hola ${vendedor},\n\n` +
    (nuevos.length
      ? `Estos ${nuevos.length} cliente(s) tuyos todavía no respondieron la encuesta de ${marca.nombre}.\n` +
        `Ya la recibieron por correo de parte de fábrica; falta que la contesten.\n\n` +
        nuevos.map(linea).join("\n") +
        "\n\n"
      : "") +
    (repetidos.length
      ? `RECORDATORIO: estos ${repetidos.length} cliente(s) ya te los habíamos avisado y siguen sin responder.\n\n` +
        repetidos
          .map(
            (c) =>
              `${linea(c)} | Ya avisado ${c.avisosPrevios === 1 ? "1 vez" : `${c.avisosPrevios} veces`}, último ${c.ultimoAviso}`
          )
          .join("\n") +
        "\n\n"
      : "") +
    `Este correo lo genera automáticamente el sistema de Calidad de ${marca.nombre}.`;

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
 * Vuelve a PENDIENTE a los clientes ya avisados que todavía no respondieron, para
 * que el próximo "Avisar a los vendedores" se los recuerde (pedido del 18-09-2026).
 *
 * Solo los de meses ABIERTOS: los de un mes cerrado ya no se trabajan (el aviso
 * tampoco los manda). Y solo los de la sucursal elegida en la pantalla, si hay una:
 * la sucursal del CLIENTE, la que dice el código con el que se vendió, que es la
 * misma que usa el filtro de la lista; si el cliente no la tiene, la del vendedor.
 *
 * Con `soloContar` no cambia nada: es para que la pantalla diga cuántos van a
 * volver antes de confirmar.
 */
export async function volverAPendienteVW(opciones: {
  sucursal: string | null;
  soloContar?: boolean;
}): Promise<{ cantidad: number; ids: string[] }> {
  const avisados = await prisma.encuestaFabricaVW.findMany({
    where: { estado: EstadoEncuestaFabrica.AVISADO, cerradoEn: null },
    select: { id: true, sucursal: true, vendedor: { select: { sucursal: true } } },
  });
  const clave = (s: string | null | undefined) => claveNormalizada(s ?? "");
  const elegidos = opciones.sucursal
    ? avisados.filter((a) => clave(a.sucursal ?? a.vendedor?.sucursal) === clave(opciones.sucursal))
    : avisados;
  const ids = elegidos.map((e) => e.id);
  if (opciones.soloContar || ids.length === 0) return { cantidad: ids.length, ids };

  // Por id y con las mismas condiciones repetidas: si entre la lectura y la
  // escritura alguien marcó a uno como respondido, o se cerró el mes, ese no se toca.
  const r = await prisma.encuestaFabricaVW.updateMany({
    where: { id: { in: ids }, estado: EstadoEncuestaFabrica.AVISADO, cerradoEn: null },
    data: { estado: EstadoEncuestaFabrica.PENDIENTE },
  });
  return { cantidad: r.count, ids };
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
  // Avisarle a UN código es avisarle a la persona: se suman sus otros códigos. Si
  // no, con el filtro de sucursal puesto el botón del renglón mandaba solo los
  // clientes de esa sucursal y los de la otra le llegaban en un segundo mail. El
  // mostrador (002) no se amplía: es uno por sucursal.
  let codigos = opciones?.codigos;
  if (codigos?.length) {
    const elegidos = await prisma.vendedorVW.findMany({ where: { codigo: { in: codigos } }, select: { numero: true } });
    const numeros = [...new Set(elegidos.map((v) => v.numero).filter((n) => !NUMEROS_DE_MOSTRADOR.has(n)))];
    if (numeros.length) {
      const gemelos = await prisma.vendedorVW.findMany({ where: { numero: { in: numeros } }, select: { codigo: true } });
      codigos = [...new Set([...codigos, ...gemelos.map((g) => g.codigo)])];
    }
  }

  const vendedores = await prisma.vendedorVW.findMany({
    where: {
      activo: true,
      ...(codigos?.length ? { codigo: { in: codigos } } : {}),
      // Los de un mes cerrado no se avisan (decisión del 17-09-2026).
      pendientes: { some: { estado: EstadoEncuestaFabrica.PENDIENTE, cerradoEn: null } },
    },
    select: {
      id: true,
      codigo: true,
      numero: true,
      nombre: true,
      email: true,
      pendientes: {
        // SOLO los PENDIENTE. Los que ya se avisaron quedaron en AVISADO y no
        // vuelven a entrar acá: es lo que impide que al vendedor le llegue el
        // mismo cliente dos veces. Antes, cada aviso le mandaba de nuevo la lista
        // completa y el vendedor no podía distinguir lo nuevo de lo ya visto.
        where: { estado: EstadoEncuestaFabrica.PENDIENTE, cerradoEn: null },
        select: {
          id: true,
          nombreCliente: true,
          email: true,
          dominio: true,
          canalVentas: true,
          fechaEntrega: true,
          vecesAvisado: true,
          avisadoEn: true,
        },
        orderBy: { fechaEntrega: "asc" },
      },
    },
    orderBy: { codigo: "asc" },
  });

  // UN correo por PERSONA, no por código (Calidad de VW, 16-09-2026): el 1035078 y
  // el 1036078 son el mismo vendedor en dos sucursales y recibe un solo mail con
  // los clientes de las dos. El mostrador (002) es uno por sucursal y va aparte.
  const porPersona = new Map<string, typeof vendedores>();
  for (const v of vendedores) {
    const clave = clavePersonaVendedor(v);
    porPersona.set(clave, [...(porPersona.get(clave) ?? []), v]);
  }

  // El nombre y el correo se buscan en TODOS los códigos de la persona, no solo en
  // los que hoy tienen pendientes: el correo pudo haber quedado cargado en el código
  // cuyos clientes ya se avisaron.
  const datosDePersona = await prisma.vendedorVW.findMany({
    where: { numero: { in: [...new Set(vendedores.map((v) => v.numero).filter((n) => !NUMEROS_DE_MOSTRADOR.has(n)))] } },
    select: { numero: true, nombre: true, email: true },
    orderBy: { codigo: "asc" },
  });

  const resultados: ResultadoAvisoVendedor[] = [];

  for (const grupo of porPersona.values()) {
    const codigosDelGrupo = grupo.map((v) => v.codigo);
    const hermanos = NUMEROS_DE_MOSTRADOR.has(grupo[0].numero)
      ? []
      : datosDePersona.filter((d) => d.numero === grupo[0].numero);
    const nombre = [...grupo, ...hermanos].find((v) => v.nombre)?.nombre || `Vendedor ${codigosDelGrupo[0]}`;
    const email = [...grupo, ...hermanos].find((v) => v.email?.trim())?.email?.trim() ?? null;
    const pendientes = grupo
      .flatMap((v) => v.pendientes)
      .sort((a, b) => (a.fechaEntrega?.getTime() ?? 0) - (b.fechaEntrega?.getTime() ?? 0));
    const base = { codigo: codigosDelGrupo.join(" · "), vendedor: nombre, email, pendientes: pendientes.length };

    if (!email) {
      resultados.push({
        ...base,
        enviado: false,
        error: "No tiene correo cargado. Cargalo en la pantalla de vendedores y volvé a avisar.",
      });
      continue;
    }

    const clientes: ClientePendiente[] = pendientes.map((p) => ({
      nombre: p.nombreCliente,
      email: p.email,
      dominio: p.dominio || "-",
      canal: p.canalVentas || "-",
      fecha: fechaCorta(p.fechaEntrega),
      avisosPrevios: p.vecesAvisado,
      ultimoAviso: fechaCorta(p.avisadoEn),
    }));
    const hayRecordatorio = clientes.some((c) => c.avisosPrevios > 0);

    const { html, texto } = armarCuerpo(nombre, clientes);
    try {
      await enviarMail({
        para: email,
        // "Recordatorio" en el asunto si va al menos un cliente que ya se le había
        // avisado (decisión del dueño, 18-09-2026): que se note antes de abrirlo.
        asunto: hayRecordatorio
          ? `Recordatorio: encuestas de ${marca.nombre} sin responder: ${clientes.length} cliente(s) tuyos`
          : `Encuestas de ${marca.nombre} sin responder: ${clientes.length} cliente(s) tuyos`,
        // Calidad va en copia de todos los avisos a vendedores.
        copia: env.mail.copiaAvisos,
        texto,
        html,
      });
      // Recién ACÁ, con el correo ya salido, se marcan como avisados. Si se
      // marcara antes y el envío fallara, esos clientes quedarían como avisados
      // sin que nadie los haya visto nunca: desaparecerían del próximo mail y del
      // radar, que es la peor falla posible en esta pantalla.
      const ahora = new Date();
      await prisma.vendedorVW.updateMany({ where: { id: { in: grupo.map((v) => v.id) } }, data: { ultimoAvisoEn: ahora } });
      await prisma.encuestaFabricaVW.updateMany({
        // Por id y no por "todos los pendientes de este vendedor": entre que se
        // armó la lista y salió el correo puede haber entrado un cliente nuevo, y
        // ese no estaba en el mail. Marcarlo sería perderlo.
        where: { id: { in: pendientes.map((p) => p.id) }, cerradoEn: null },
        // Se cuenta el aviso: es lo que hace que la próxima vez, si vuelve a
        // pendiente, salga como recordatorio.
        data: { estado: EstadoEncuestaFabrica.AVISADO, avisadoEn: ahora, vecesAvisado: { increment: 1 } },
      });
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
