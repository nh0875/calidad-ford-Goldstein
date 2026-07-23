interface Props {
  descripcion: string;
}

export default function PagePlaceholder({ descripcion }: Props) {
  return (
    <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
      <p className="text-gray-500">{descripcion}</p>
      <p className="mt-2 text-sm text-gray-400">Pantalla pendiente de implementación</p>
    </div>
  );
}
