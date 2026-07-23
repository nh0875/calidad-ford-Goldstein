import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { hashPassword } from "../services/auth.service";

// Idempotente: si ADMIN_EMAIL ya existe como usuario, no toca nada (así un
// reinicio del contenedor no pisa la contraseña que el admin ya cambió).
// Se ejecuta solo tanto al arrancar el backend como manualmente (npm run seed:admin).
export async function seedAdmin(): Promise<void> {
  const { email, passwordInicial } = env.admin;

  if (!email || !passwordInicial) {
    console.log(
      "[seed] ADMIN_EMAIL / ADMIN_PASSWORD_INICIAL no están configurados: se omite la creación del admin inicial."
    );
    return;
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) return;

  const passwordHash = await hashPassword(passwordInicial);
  await prisma.usuario.create({
    data: { nombre: "Administrador", email, passwordHash, rol: "ADMIN" },
  });
  console.log(`[seed] Usuario ADMIN inicial creado: ${email} (cambiar la contraseña al entrar)`);
}

// Permite correrlo a mano: npm run seed:admin
if (require.main === module) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed] Error creando el admin inicial:", err);
      process.exit(1);
    });
}
