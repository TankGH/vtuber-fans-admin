import { Palette } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { THEMES } from "@/lib/ipc";
import type { ThemeKey } from "@/types/dto";

export function ThemeSwitch({ value, onChange, compact = false }: { value: ThemeKey; onChange: (t: ThemeKey) => void; compact?: boolean }) {
  if (compact) {
    return (
      <div className="glass-soft flex items-center gap-1 rounded-xl p-1">
        <Palette size={15} className="text-muted mx-1" />
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            title={t.name}
            aria-label={`切换主题：${t.name}`}
            className={twMerge(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-200 cursor-pointer",
              value === t.key ? "bg-[var(--primary)] text-white shadow" : "text-muted hover:text-ink",
            )}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.colors[1] }} />
            <span className="hidden xl:inline">{t.name}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {THEMES.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={twMerge(
            "glass-soft flex flex-col gap-3 rounded-2xl p-4 text-left transition-all duration-200 cursor-pointer hover:-translate-y-0.5",
            value === t.key && "ring-2 ring-[var(--accent)]",
          )}
        >
          <div className="flex items-center gap-2">
            {t.colors.map((c) => <span key={c} className="h-5 w-5 rounded-full border border-white/20" style={{ background: c }} />)}
          </div>
          <div>
            <p className="text-sm font-semibold">{t.name}</p>
            <p className="text-xs text-muted mt-1 leading-relaxed">{t.desc}</p>
          </div>
          <span className={twMerge("text-xs", value === t.key ? "text-accent" : "text-muted")}>
            {value === t.key ? "● 当前使用" : "点击应用"}
          </span>
        </button>
      ))}
    </div>
  );
}
