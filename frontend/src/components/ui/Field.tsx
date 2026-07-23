import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const claseCampo =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-gray-400 transition-colors focus:border-accent focus:outline-none disabled:bg-gray-50 disabled:text-gray-400";

export function Etiqueta({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">{children}</span>;
}

export function Campo({ etiqueta, children, hint }: { etiqueta: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <Etiqueta>{etiqueta}</Etiqueta>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${claseCampo} ${className}`} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`${claseCampo} ${className}`} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`${claseCampo} ${className}`} {...rest} />;
}
