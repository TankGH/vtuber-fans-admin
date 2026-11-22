import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui";
import type { HumanError } from "@/lib/errorText";

export type BannerTone = "success" | "warning" | "info" | "error";

export function StatusBanner({
  tone, title, detail, actionText, onAction, onClose,
}: {
  tone: BannerTone;
  title: string;
  detail?: string;
  actionText?: string;
  onAction?: () => void;
  onClose?: () => void;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "warning" ? AlertCircle : tone === "error" ? AlertCircle : Info;
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "error" ? "text-danger" : "text-accent";
  return (
    <div className={twMerge("glass-soft flex items-start gap-3 rounded-xl px-4 py-3 fade-in border", tone === "error" && "border-[var(--danger)]")}>
      <Icon size={18} className={twMerge("mt-0.5 shrink-0", color)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="text-xs text-muted mt-0.5 leading-relaxed">{detail}</p>}
      </div>
      {actionText && onAction && <Button className="px-3 py-1.5 text-xs" onClick={onAction}>{actionText}</Button>}
      {onClose && <button onClick={onClose} aria-label="关闭提示" className="text-muted hover:text-ink cursor-pointer"><X size={15} /></button>}
    </div>
  );
}

export function errorBanner(err: HumanError): { tone: BannerTone; title: string; detail: string } {
  return { tone: "error", title: `${err.message}（${err.code}）`, detail: `建议：${err.action}` };
}
