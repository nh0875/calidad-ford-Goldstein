-- Alinear la sucursal de cada cliente de fidelización con la de SU CARGA.
--
-- EL PROBLEMA. Un cliente de fidelización guarda su propia sucursal, y en la
-- importación esa sucursal salía de `provincia_de_la_fila ?? sucursal_de_la_carga`:
-- la provincia donde vive el cliente le ganaba a la sucursal que hizo la carga.
-- Resultado: las dos podían decir cosas distintas, y como distintas partes del
-- sistema leían una u otra, el mismo cliente se veía en una pantalla y
-- desaparecía en la de al lado.
--
-- EL CASO REAL que lo destapó: una carga de 104 clientes rotulada "San Juan",
-- con los 104 mensajes ya enviados, que el usuario de Fidelización de San Juan no
-- veía en Seguimiento. La carga decía San Juan; las filas de los clientes, otra
-- cosa.
--
-- LA REGLA, que es la que ya rige para los Casos de Contacto Posterior: manda la
-- sucursal de LA CARGA. Un Excel que sube San Juan es trabajo de San Juan aunque
-- adentro venga un cliente que vive en Mendoza — quien lo tiene que llamar es San
-- Juan, que fue quien lo atendió. Es exactamente lo que pidió el dueño: "que vea
-- todos los casos que hayan cargado en la sucursal de San Juan, no los clientes
-- que son de San Juan".
--
-- Se toca SOLO lo que está desalineado, así la migración no reescribe filas que
-- ya estaban bien y el conteo de afectadas dice algo útil si hay que revisarlo.
UPDATE "ClienteFidelizacion" c
SET "sucursal" = u."sucursal"
FROM "ExcelUpload" u
WHERE u."id" = c."uploadId"
  AND c."sucursal" IS DISTINCT FROM u."sucursal";
