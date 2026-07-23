import { NextFunction, Request, Response } from "express";
import multer from "multer";

// Recepción endurecida de archivos .xlsx:
//  - tope de tamaño de 20 MB (además del límite de nginx)
//  - filtro por extensión/mimetype al recibir
//  - validación del CONTENIDO real (firma ZIP) antes de procesar, no solo por
//    el nombre: un .exe o un PDF renombrado a .xlsx se rechaza acá
//  - el archivo se lee a memoria y se parsea con la librería de Excel; NUNCA se
//    ejecuta ni se guarda como ejecutable.

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function crearMulter() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const esXlsx =
        file.originalname.toLowerCase().endsWith(".xlsx") ||
        file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (!esXlsx) {
        return cb(new Error("Solo se aceptan archivos Excel (.xlsx)."));
      }
      cb(null, true);
    },
  });
}

/**
 * Un .xlsx es un contenedor ZIP: sus primeros bytes son la firma "PK" (0x50 0x4B)
 * seguida de 0x03 0x04 (archivo normal), 0x05 0x06 (vacío) o 0x07 0x08 (spanned).
 * Así distinguimos un .xlsx real de un archivo renombrado.
 */
export function esXlsxReal(buffer?: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  const [b0, b1, b2] = buffer;
  return b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05 || b2 === 0x07);
}

/**
 * Middleware que recibe UN archivo .xlsx en el campo indicado, devolviendo
 * errores en JSON amigable y validando el contenido real antes de seguir.
 */
export function recibirXlsx(campo: string) {
  const mw = crearMulter().single(campo);
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? "El archivo pesa más de 20 MB. Verificá que sea el Excel correcto."
            : err instanceof Error
              ? err.message
              : "No se pudo recibir el archivo.";
        return res.status(400).json({ message });
      }
      if (req.file && !esXlsxReal(req.file.buffer)) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel .xlsx válido: su contenido no corresponde a un .xlsx (¿es un PDF, CSV o archivo renombrado?).",
        });
      }
      next();
    });
  };
}
