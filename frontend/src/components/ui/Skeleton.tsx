export function SkeletonKpiCard() {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="skeleton h-3 w-20" />
      <div className="skeleton mt-3 h-7 w-16" />
      <div className="skeleton mt-2 h-3 w-24" />
    </div>
  );
}

export function SkeletonTableRows({ filas = 5, columnas = 6 }: { filas?: number; columnas?: number }) {
  return (
    <>
      {Array.from({ length: filas }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100">
          {Array.from({ length: columnas }).map((_, j) => (
            <td key={j} className="px-3 py-3">
              <div className="skeleton h-4 w-full max-w-[10rem]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonBlock({ className = "h-40 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}
