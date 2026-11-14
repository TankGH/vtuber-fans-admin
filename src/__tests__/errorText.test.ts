import { describe, expect, it } from "vitest";
import { ERROR_ACTION, ERROR_TEXT, humanizeError, isKnownErrorCode } from "@/lib/errorText";

const REQUIRED_CODES = [
  "E_DB_OPEN", "E_DB_MIGRATE", "E_CRYPTO_KEY", "E_IMPORT_FORMAT", "E_IMPORT_UID",
  "E_IMPORT_LEVEL", "E_BACKUP_DIR", "E_BACKUP_IO", "E_RESTORE_VERIFY", "E_RESTORE_MARKER",
  "E_SYNC_COOKIE", "E_SYNC_NETWORK", "E_SYNC_API", "E_NOT_FOUND", "E_INVALID_INPUT", "E_INTERNAL",
];

describe("错误码与人类可读文案", () => {
  it("每个约定错误码都有中文文案", () => {
    REQUIRED_CODES.forEach((code) => {
      expect(isKnownErrorCode(code)).toBe(true);
      expect(ERROR_TEXT[code]).toBeTruthy();
    });
  });

  it("Rust 侧错误对象映射为中文文案与建议动作", () => {
    const e = humanizeError({ code: "E_BACKUP_DIR", message: "备份目录不可写，请重新选择目录" });
    expect(e.message).toContain("备份目录不可写");
    expect(e.action).toContain("设置");
    expect(ERROR_ACTION.E_BACKUP_DIR).toBe("前往设置更换目录");
  });

  it("未知错误码降级为通用提示而不丢失原始信息", () => {
    const e = humanizeError({ code: "E_FUTURE", message: "自定义原因" });
    expect(e.code).toBe("E_FUTURE");
    expect(e.message).toBe("自定义原因");
    expect(e.action).toBeTruthy();
  });

  it("字符串错误也能安全展示", () => {
    const e = humanizeError("磁盘写入失败");
    expect(e.code).toBe("E_INTERNAL");
    expect(e.message).toBe("磁盘写入失败");
  });

  it("同步相关文案明确标注待启用，避免误导用户", () => {
    expect(ERROR_TEXT.E_SYNC_COOKIE).toContain("待同步引擎启用");
    expect(ERROR_TEXT.E_SYNC_NETWORK).toContain("待同步引擎启用");
  });
});
