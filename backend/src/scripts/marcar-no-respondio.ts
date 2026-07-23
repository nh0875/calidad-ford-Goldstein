// Dispara a mano la misma lógica que corre el cron diario de mantenimiento.
// Útil para pruebas o para una corrida puntual:
//   docker compose exec backend npx tsx src/scripts/marcar-no-respondio.ts
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { marcarNoRespondidos } from "../services/mantenimiento.service";

marcarNoRespondidos()
  .then((marcados) => {
    console.log(
      `${marcados} caso(s) ENVIADO sin respuesta hace más de ${env.diasSinRespuestaParaNC} día(s) pasaron a NO_RESPONDIO`
    );
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
