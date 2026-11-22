import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";

export function Button({ className, variant = "ghost", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  return <button className={twMerge(cls, className)} {...rest}>{children}</button>;
}

export function Card({ className, children, title, extra }: { className?: string; children: ReactNode; title?: string; extra?: ReactNode }) {
  return (
    <section className={twMerge("glass rounded-2xl p-5 fade-in", className)}>
      {(title || extra) && (
        <header className="flex items-center justify-between gap-3 mb-4">
          {title && <h2 className="card-title">{title}</h2>}
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "primary" | "success" | "warning" | "danger"; className?: string }) {
  const toneCls: Record<string, string> = {
    neutral: "text-muted",
    primary: "text-accent border-[var(--accent)]",
    success: "text-success border-[var(--success)]",
    warning: "text-warning border-[var(--warning)]",
    danger: "text-danger border-[var(--danger)]",
  };
  return <span className={twMerge("chip", toneCls[tone], className)}>{children}</span>;
}

export function Field({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={twMerge("flex flex-col gap-1.5", className)}>
      <span className="label-sm">{label}</span>
      <input className="field" {...rest} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SelectField({ label, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className={twMerge("flex flex-col gap-1.5", className)}>
      <span className="label-sm">{label}</span>
      <select className="field cursor-pointer" {...rest}>{children}</select>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <label className={twMerge("flex items-center justify-between gap-4 py-2", disabled && "opacity-50")}>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={twMerge(
          "relative h-6 w-11 shrink-0 rounded-full transition-all duration-200 cursor-pointer",
          checked ? "bg-[var(--primary)]" : "bg-[var(--surface-2)] border border-[var(--border)]",
          disabled && "cursor-not-allowed",
        )}
      >
        <span className={twMerge("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <div className={twMerge("glass w-full rounded-2xl p-6 fade-in", width)} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="关闭" className="text-muted hover:text-ink cursor-pointer transition-colors"><X size={18} /></button>
        </header>
        <div className="scroll-y max-h-[62vh]">{children}</div>
        {footer && <footer className="flex justify-end gap-2 mt-5 pt-4 border-t border-[var(--border)]">{footer}</footer>}
      </div>
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="text-3xl opacity-40">✦</div>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted max-w-md">{desc}</p>
      {action}
    </div>
  );
}

export function SectionHint({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "danger" }) {
  const cls = tone === "warning" ? "border-[var(--warning)] text-warning" : tone === "danger" ? "border-[var(--danger)] text-danger" : "border-[var(--border)] text-muted";
  return <div className={twMerge("rounded-xl px-3.5 py-2.5 text-xs leading-relaxed border", cls)}>{children}</div>;
}
