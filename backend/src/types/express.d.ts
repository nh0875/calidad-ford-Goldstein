import { AreaUsuario, RolUsuario } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      // Lo completa requireAuth a partir del JWT (con datos frescos de la base)
      usuario?: {
        id: string;
        nombre: string;
        email: string;
        rol: RolUsuario;
        area: AreaUsuario;
        sucursal: string | null; // provincia; null = atiende todas (para el pool de refuerzos)
      };
      // Datos del token en curso, para poder revocarlo al hacer logout
      token?: {
        jti: string;
        exp: number; // epoch en segundos
      };
    }
  }
}

export {};
