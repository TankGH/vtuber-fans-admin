import { createContext, useContext, type ReactNode } from "react";
import type { BootstrapDto, ThemeKey } from "@/types/dto";

export interface Banner {
  tone: "success" | "warning" | "info" | "error";
  title: string;
  detail?: string;
}

export interface AppContextValue {
  bootstrap: BootstrapDto | null;
  refresh: () => Promise<void>;
  theme: ThemeKey;
  setTheme: (t: ThemeKey) => void;
  banner: Banner | null;
  notify: (banner: Banner) => void;
  goTo: (page: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext 未初始化");
  return ctx;
}

export function AppProvider({ value, children }: { value: AppContextValue; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
