// Campos del modelo Caso a los que se puede mapear una columna del Excel.
// Tiene que coincidir con CAMPOS_CASO del backend (excel.service.ts).

export const CAMPOS_CASO: Array<{ value: string; label: string }> = [
  { value: "descartar", label: "— Descartar columna —" },
  { value: "numeroOrden", label: "N° de orden (ORDEN)" },
  { value: "fechaProgramacion", label: "Fecha de programación" },
  { value: "hora", label: "Hora" },
  { value: "origenAgendamiento", label: "Origen del agendamiento" },
  { value: "asesor", label: "Asesor" },
  { value: "modelo", label: "Modelo" },
  { value: "patente", label: "Placa / Patente" },
  { value: "chasisVIN", label: "Chasis / VIN" },
  { value: "nombrePropietario", label: "Nombre del propietario" },
  { value: "emailPropietario", label: "E-mail del propietario" },
  { value: "celular", label: "Celular" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "comentarioAsesor", label: "Comentario del asesor" },
  { value: "fechaSalida", label: "Fecha de salida" },
  { value: "diasEnServicio", label: "Días en servicio" },
  { value: "estado", label: "Estado (S / NC / INT / RQR)" },
  { value: "satisfaccionConcesionario", label: "Satisfacción con el concesionario (1-5)" },
  { value: "satisfaccionServicio", label: "¿Servicio realizado satisfactoriamente? (1-5)" },
  { value: "satisfaccionFord", label: "Satisfacción con Ford (1-5)" },
  { value: "comentarioCliente", label: "Comentario del cliente (¡Dejanos tu comentario!)" },
];
