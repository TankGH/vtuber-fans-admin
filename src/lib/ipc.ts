import type { ThemeKey } from "@/types/dto";
import { demoInvoke, isNative } from "@/lib/demoAdapter";
import { humanizeError, type HumanError } from "@/lib/errorText";

export { isNative };

export class AppCallError extends Error {
  detail: HumanError;
  constructor(detail: HumanError) {
    super(detail.message);
    this.detail = detail;
  }
}

/** 唯一 IPC 出口：原生 Tauri 模式走 invoke，浏览器开发模式走演示数据适配器 */
export async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isNative()) {
    return demoInvoke<T>(command, args);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  // Rust 侧所有 command 统一接收单个 payload，避免跨语言参数命名歧义
  return invoke<T>(command, { payload: args }).catch((err: unknown) => {
    throw new AppCallError(humanizeError(err));
  });
}

export async function callSafe<T>(command: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: HumanError | null }> {
  return call<T>(command, args)
    .then((data) => ({ data, error: null }))
    .catch((err: unknown) => ({
      data: null,
      error: err instanceof AppCallError ? err.detail : humanizeError(err),
    }));
}

export const THEMES: Array<{ key: ThemeKey; name: string; desc: string; colors: string[] }> = [
  { key: "galaxy", name: "守村人深蓝", desc: "夜空底色 · 靛蓝光晕，适合长时间值守", colors: ["#0B1220", "#2563EB", "#38BDF8"] },
  { key: "mist", name: "晨雾浅色", desc: "明亮通透 · 白天办公与打印场景", colors: ["#F5F7FB", "#2563EB", "#0284C7"] },
  { key: "aurora", name: "暖霞", desc: "暖紫渐变 · 直播后复盘与礼品台账", colors: ["#1B1424", "#F59E0B", "#FB7185"] },
];

export function applyTheme(theme: ThemeKey): void {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", theme);
  if (typeof localStorage !== "undefined") localStorage.setItem("vtuber-fans-admin.theme", theme);
}

export function readCachedTheme(): ThemeKey {
  if (typeof localStorage === "undefined") return "galaxy";
  const v = localStorage.getItem("vtuber-fans-admin.theme");
  return v === "mist" || v === "aurora" || v === "galaxy" ? v : "galaxy";
}

export function formatDateTime(value: string | null): string {
  if (!value) return "暂无记录";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export const GUARD_LEVEL_TEXT: Record<number, string> = { 1: "总督", 2: "提督", 3: "舰长" };
export const ADDRESS_STATUS_TEXT: Record<string, string> = {
  none: "未登记", pending: "未审核", valid: "有效", invalid: "无效", shipped: "已寄送",
};
export const ACTIVITY_TEXT: Record<string, string> = {
  import: "名单导入", backup: "数据备份", restore: "恢复操作", theme: "主题切换", profile: "档案维护",
};
