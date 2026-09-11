// El validador de sucursal que usan TODOS los endpoints que la guardan.
//
// La sucursal decide quién ve cada cosa. Mientras se escribía a mano, un typo
// —"San juan", "SAN JUAN ", "Sanjuan"— no daba error en ningún lado y dejaba el
// registro invisible para la gente que correspondía. Ya pasó con una carga de
// 104 clientes y costó días encontrarlo.
//
// Las pantallas ahora ofrecen un desplegable, pero eso solo ordena lo que se ve:
// el pedido HTTP se puede armar a mano. Esto es lo que cierra la puerta de
// verdad, y además devuelve el nombre escrito como corresponde, así lo que se
// guarda es siempre idéntico a sí mismo.

import { z } from "zod";
import { mensajeSucursalInvalida, sucursalCanonica } from "../config/marca";

/** Sucursal obligatoria. Devuelve la forma canónica ("san juan" → "San Juan"). */
export const zSucursal = z
  .string({ required_error: "Falta indicar la sucursal." })
  .trim()
  .superRefine((v, ctx) => {
    if (!sucursalCanonica(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensajeSucursalInvalida() });
    }
  })
  .transform((v) => sucursalCanonica(v) as string);

/**
 * Sucursal de un USUARIO, donde vacío significa "ve todas las provincias".
 * Devuelve null en ese caso, que es lo que espera la base.
 */
export const zSucursalUsuario = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    if (v && !sucursalCanonica(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensajeSucursalInvalida() });
    }
  })
  .transform((v) => (v ? (sucursalCanonica(v) as string) : null));
