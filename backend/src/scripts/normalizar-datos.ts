// Normaliza asesor/sucursal y rellena telefonosNorm de TODOS los casos ya
// cargados. Idempotente: usa asesorRaw/sucursalRaw (el valor original) como
// fuente, así se puede correr las veces que haga falta (por ejemplo tras
// declarar alias nuevos). Uso: npm run normalizar
import { TipoAlias } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  aplicarAlias,
  cargarAliasMap,
  claveNormalizada,
  parsearAsesor,
  parsearSucursal,
  telefonosNormalizados,
} from "../services/normalizacion.service";

async function main() {
  const aliasAsesor = await cargarAliasMap(TipoAlias.ASESOR);
  const aliasSucursal = await cargarAliasMap(TipoAlias.SUCURSAL);

  const casos = await prisma.caso.findMany({
    select: {
      id: true,
      asesor: true,
      asesorRaw: true,
      sucursal: true,
      sucursalRaw: true,
      whatsapp: true,
      celular: true,
    },
  });

  // PASADA 1: resolver nombre + código por caso, y construir un mapa
  // nombre→código. El código suele venir en SOLO algunos casos del mismo asesor
  // (ej. una fila trae "CARLA CAMPORA - 140445" y el resto "Carla Campora"); se
  // propaga ese código a TODOS los casos de esa persona para no fragmentarla.
  const resueltos = casos.map((c) => {
    const asesorNorm = aplicarAlias(parsearAsesor(c.asesorRaw ?? c.asesor), aliasAsesor);
    return { c, nombre: asesorNorm.nombre || (c.asesorRaw ?? c.asesor), codigo: asesorNorm.codigo };
  });
  const codigoPorNombre = new Map<string, string>();
  for (const r of resueltos) {
    if (r.codigo) codigoPorNombre.set(claveNormalizada(r.nombre), r.codigo);
  }

  const asesoresAntes = new Set<string>();
  const clavesDespues = new Set<string>();
  let actualizados = 0;

  for (const r of resueltos) {
    const c = r.c;
    asesoresAntes.add(c.asesor);
    const sucursalFuente = c.sucursalRaw ?? c.sucursal;
    const sucursalNorm = aplicarAlias(parsearSucursal(sucursalFuente), aliasSucursal);
    const telNorm = telefonosNormalizados(c.whatsapp, c.celular);
    // Código propio o el conocido para ese nombre.
    const codigo = r.codigo ?? codigoPorNombre.get(claveNormalizada(r.nombre)) ?? null;
    clavesDespues.add(codigo ? `cod:${codigo}` : `nom:${claveNormalizada(r.nombre)}`);

    await prisma.caso.update({
      where: { id: c.id },
      data: {
        asesor: r.nombre,
        asesorCodigo: codigo,
        asesorRaw: c.asesorRaw ?? c.asesor,
        sucursal: sucursalNorm.nombre || sucursalFuente,
        sucursalRaw: c.sucursalRaw ?? sucursalFuente,
        telefonosNorm: telNorm,
      },
    });
    actualizados++;
  }

  console.log(`Casos normalizados: ${actualizados}`);
  console.log(`Valores distintos de asesor ANTES:  ${asesoresAntes.size}`);
  console.log(`Grupos de asesor DESPUÉS (por código/nombre): ${clavesDespues.size}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
