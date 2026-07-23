import { ReactNode } from "react";

export function Card({
  children,
  className = "",
  padding = "p-4",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return <div className={`rounded-xl bg-white ${padding} shadow-sm ring-1 ring-black/5 ${className}`}>{children}</div>;
}
