import type { AppErrorPayload } from "@/types/dto";

// 与 src-tauri/src/error.rs 唯一错误源保持一致
export const ERROR_TEXT: Record<string, string> = {
  E_DB_OPEN: "数据库打开失败，可能被其它程序占用",
  E_DB_MIGRATE: "本地数据结构升级失败，已保留原始文件",
  E_CRYPTO_KEY: "本机密钥不可用，无法读取敏感信息",
  E_IMPORT_FORMAT: "文件格式错误或表头无法识别，建议使用 UTF-8 编码",
  E_IMPORT_UID: "存在缺少 UID 的记录，已跳过该行",
  E_IMPORT_LEVEL: "大航海等级无法识别（应为 总督/提督/舰长 或 1/2/3）",
  E_BACKUP_DIR: "备份目录不可写，请重新选择目录",
  E_BACKUP_IO: "备份写入失败，可能是磁盘空间不足",
  E_RESTORE_VERIFY: "备份校验未通过，未改动当前数据",
  E_RESTORE_MARKER: "恢复标记处理失败，当前数据保持不变",
  E_SYNC_COOKIE: "B 站登录态失效或未登录，请重新扫码登录",
  E_SYNC_NETWORK: "无法连接 B 站，请检查网络后重试",
  E_SYNC_API: "B 站接口返回异常，可稍后重试或使用手动导入",
  E_NOT_FOUND: "未找到对应记录，可能已被删除",
  E_INVALID_INPUT: "填写内容不完整或格式不正确",
  E_INTERNAL: "操作未完成，已保留原始数据",
};

export const ERROR_ACTION: Record<string, string> = {
  E_DB_OPEN: "关闭占用程序后重试",
  E_DB_MIGRATE: "从备份恢复",
  E_CRYPTO_KEY: "从备份恢复或重新初始化",
  E_IMPORT_FORMAT: "检查列名与编码后重试",
  E_IMPORT_UID: "补齐 UID 后重新导入",
  E_IMPORT_LEVEL: "修正等级列后重新导入",
  E_BACKUP_DIR: "前往设置更换目录",
  E_BACKUP_IO: "清理磁盘后重试",
  E_RESTORE_VERIFY: "选择其它备份",
  E_SYNC_COOKIE: "前往设置重新扫码登录",
  E_SYNC_NETWORK: "检查网络；也可关闭自动抓取并手动导入",
  E_SYNC_API: "稍后重试或改用 CSV / Excel 手动导入",
  E_INTERNAL: "重试；仍失败则查看诊断信息",
};

export interface HumanError {
  code: string;
  message: string;
  action: string;
}

export function humanizeError(payload: unknown): HumanError {
  const raw = payload as AppErrorPayload | string | null;
  const code = typeof raw === "string" ? "E_INTERNAL" : raw?.code || "E_INTERNAL";
  const custom = typeof raw === "string" ? raw : raw?.message;
  return {
    code,
    message: custom || ERROR_TEXT[code] || "操作未完成，已保留原始数据",
    action: ERROR_ACTION[code] || "重试；仍失败则查看诊断信息",
  };
}

export function isKnownErrorCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ERROR_TEXT, code);
}
