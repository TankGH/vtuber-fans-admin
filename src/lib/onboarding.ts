import { call } from "@/lib/ipc";
import type { SettingsDto } from "@/types/dto";

const KEY = "vtuber-fans-admin.onboarding.v1";

export interface OnboardingState {
  done: boolean;
  step: number;
  backupDir: string;
}

export function readOnboarding(): OnboardingState {
  const fallback: OnboardingState = { done: false, step: 0, backupDir: "" };
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(KEY);
  if (!raw) return fallback;
  return { ...fallback, ...(JSON.parse(raw) as Partial<OnboardingState>) };
}

export function writeOnboarding(state: OnboardingState): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
}

/** 本期引导精简为两步：选择备份目录 → 完成。名单通过 CSV / Excel 导入 */
export async function finishOnboarding(backupDir: string): Promise<SettingsDto> {
  const settings = await call<SettingsDto>("settings_update", {
    input: { backupDir, onboardingDone: true },
  });
  writeOnboarding({ done: true, step: 2, backupDir });
  return settings;
}
