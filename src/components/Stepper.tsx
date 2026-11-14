import { Check } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={twMerge(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
                  done && "bg-[var(--success)] text-white",
                  active && "bg-[var(--primary)] text-white shadow-glow",
                  !done && !active && "glass-soft text-muted",
                )}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span className={twMerge("text-xs whitespace-nowrap truncate", active ? "text-ink font-medium" : "text-muted")}>{label}</span>
            </div>
            {i < steps.length - 1 && <div className={twMerge("h-px flex-1", done ? "bg-[var(--success)]" : "bg-[var(--border)]")} />}
          </div>
        );
      })}
    </div>
  );
}
