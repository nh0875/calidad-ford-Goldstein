import { NextFunction, Request, Response } from "express";
import multer from "multer";

// Recepción endurecida de archivos Excel (.xlsx modernos y .xls clásicos):
//  - tope de tamaño de 20 MB (además del límite de nginx)
//  - filtro por extensión/mimetype al recibir
//  - validación del CONTENIDO real (firma del archivo) antes de procesar, no
//    solo por el nombre: un .exe o un PDF renombrado se rechaza acá
//  - el archivo se lee a memoria y se parsea con la librería de Excel; NUNCA se
//    ejecuta ni se guarda como ejecutable.
//
// Se aceptan los DOS formatos porque el reporte real de Contacto Posventa se
// descarga del sistema de la agencia como .xls clásico (OLE2), y la usuaria lo
// sube tal cual, sin convertirlo.

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function crearMulter() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const nombre = file.originalname.toLowerCase();
      const esExcel =
        nombre.endsWith(".xlsx") ||
        nombre.endsWith(".xls") ||
        file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.mimetype === "application/vnd.ms-excel";
      if (!esExcel) {
        return cb(new Error("Solo se aceptan archivos Excel (.xlsx o .xls)."));
      }
      cb(null, true);
    },
  });
}

/**
 * Valida que el CONTENIDO sea realmente un Excel, por su firma de bytes:
 *  - .xlsx (contenedor ZIP): "PK" (0x50 0x4B) + 0x03 0x04 / 0x05 0x06 / 0x07 0x08
 *  - .xls clásico (OLE2 / Compound File): 0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
 * Así un .exe o PDF renombrado se rechaza aunque tenga extensión de Excel.
 */
export function esExcelReal(buffer?: Buffer): boolean {
  if (!buffer || buffer.length < 8) return false;
  const [b0, b1, b2, b3, b4, b5, b6, b7] = buffer;
  const esXlsx = b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05 || b2 === 0x07);
  const esXls =
    b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0 &&
    b4 === 0xa1 && b5 === 0xb1 && b6 === 0x1a && b7 === 0xe1;
  return esXlsx || esXls;
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
      if (req.file && !esExcelReal(req.file.buffer)) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel válido: su contenido no corresponde a un .xlsx ni a un .xls (¿es un PDF, CSV o archivo renombrado?).",
        });
      }
      next();
    });
  };
}
