import { AreaTrabajo, EstadoRQR, Prisma, TipoAviso } from "@prisma/client";
import { prisma } from "../config/prisma";
import { areaPermitida, UsuarioArea } from "./area.service";

// ---------- Avisos en pantalla ----------
//
// Un RQR que se abre solo, de madrugada o mientras nadie mira la pantalla de
// RQR, antes se enteraba únicamente quien se acordara de entrar a buscarlo.
// El aviso es un cartel rojo que la app muestra ARRIBA DE TODO, en todas las
// pantallas, hasta que alguien lo agarra. No manda mails: vive dentro del
// sistema, que es donde se trabaja.
//
// Se apaga solo cuando el RQR asociado se cierra, o a mano con "Marcar visto".

interface DatosAviso {
  tipo: TipoAviso;
  area: AreaTrabajo;
  casoId?: string | null;
  rqrId?: string | null;
  titulo: string;
  detalle: string;
}

/**
 * Crea el aviso, salvo que ya haya uno igual sin ver (mismo tipo y mismo caso).
 * Así una conversación larga con varias idas y vueltas no llena la pantalla de
 * carteles repetidos del mismo caso.
 *
 * NUNCA lanza: un aviso es un efecto lateral; si falla, no puede voltear el
 * análisis ni la creación del RQR.
 */
export async function crearAviso(datos: DatosAviso): Promise<void> {
  try {
    if (datos.casoId) {
      const yaHay = await prisma.aviso.findFirst({
        where: { tipo: datos.tipo, casoId: datos.casoId, vistoEn: null },
        select: { id: true },
      });
      if (yaHay) {
        // Se refresca el detalle: interesa lo último que dijo el cliente.
        await prisma.aviso.update({
          where: { id: yaHay.id },
          data: { detalle: datos.detalle, creadoEn: new Date(), rqrId: datos.rqrId ?? undefined },
        });
        return;
      }
    }
    await prisma.aviso.create({
      data: {
        tipo: datos.tipo,
        area: datos.area,
        casoId: datos.casoId ?? null,
        rqrId: datos.rqrId ?? null,
        titulo: datos.titulo.slice(0, 200),
        detalle: datos.detalle.slice(0, 2000),
      },
    });
  } catch (err) {
    console.error(`[avisos] no se pudo crear el aviso ${datos.tipo}:`, err);
  }
}

/**
 * Apaga (marca como vistos) los avisos de un tipo para un caso. Se usa cuando
 * la razón del aviso se resolvió sola: p. ej. se clasificó a mano un caso que
 * estaba en revisión manual, o se respondió. No lanza: es un efecto lateral.
 */
export async function apagarAvisosCaso(casoId: string, tipo: TipoAviso): Promise<void> {
  try {
    await prisma.aviso.updateMany({
      where: { casoId, tipo, vistoEn: null },
      data: { vistoEn: new Date() },
    });
  } catch (err) {
    console.error(`[avisos] no se pudo apagar el aviso ${tipo} del caso ${casoId}:`, err);
  }
}

/**
 * Avisos vigentes para el usuario: los de su área (ADMIN y área AMBAS ven
 * todos), sin marcar como vistos, y descartando los que quedaron obsoletos
 * porque el RQR asociado ya se cerró o el caso se borró.
 */
export function whereAvisosVigentes(usuario: UsuarioArea): Prisma.AvisoWhereInput {
  const restringido = areaPermitida(usuario);
  return {
    vistoEn: null,
    ...(restringido ? { area: restringido } : {}),
    // Si el RQR ya está cerrado, el aviso no tiene sentido: se deja de mostrar
    // sin necesidad de que nadie lo marque.
    OR: [{ rqrId: null }, { rqr: { estado: { not: EstadoRQR.CERRADO }, eliminadoEn: null } }],
    // Un caso borrado se lleva sus avisos.
    AND: [{ OR: [{ casoId: null }, { caso: { eliminadoEn: null } }] }],
  };
}
