import { describe, expect, it } from "vitest";
import { demoInvoke, resetDemoState } from "@/lib/demoAdapter";
import { SAMPLE_CSV } from "@/lib/demoData";
import { DEFAULT_MAPPING } from "@/lib/importLogic";
import type { FanProfileInput, ImportPreview, BootstrapDto } from "@/types/dto";
import { beforeEach } from "vitest";

// demoAdapter 依赖 localStorage，Vitest node 环境下走内存态
function invoke<T>(command: string, args: Record<string, unknown> = {}): T {
  return demoInvoke<T>(command, args);
}

beforeEach(() => resetDemoState());

describe("演示数据适配器", () => {
  it("bootstrap 返回真实名册规模与备份健康状态", () => {
    const data = invoke<BootstrapDto>("app_bootstrap");
    expect(data.fanCount).toBe(13);
    expect(data.guardCount).toBe(12);
    expect(data.nativeMode).toBe(false);
    expect(data.activities.length).toBeGreaterThan(0);
    expect(data.backupHealth.backupCount).toBeGreaterThan(0);
  });

  it("档案列表支持分页与仅看锁定字段", () => {
    const all = invoke<{ total: number; items: unknown[] }>("profile_list", { page: 1, pageSize: 10 });
    expect(all.total).toBe(13);
    expect(all.items.length).toBe(10);
    const locked = invoke<{ total: number }>("profile_list", { onlyLocked: true });
    expect(locked.total).toBeGreaterThan(0);
  });

  it("导入预览识别新增、合并、冲突与错误行", () => {
    const p = invoke<ImportPreview>("import_parse", { fileContent: SAMPLE_CSV, mapping: DEFAULT_MAPPING, kind: "fans" });
    expect(p.totalRows).toBe(4);
    expect(p.newCount).toBe(2);
    expect(p.mergeCount + p.conflictCount).toBe(1);
    expect(p.invalidCount).toBe(1);
  });

  it("查看完整地址必须二次确认", () => {
    expect(() => invoke("profile_reveal_address", { uid: "1000001", confirm: false })).toThrow();
    const addr = invoke<{ uid: string } | null>("profile_reveal_address", { uid: "1000001", confirm: true });
    expect(addr?.uid).toBe("1000001");
  });

  it("恢复操作必须二次确认且返回安全备份编号", () => {
    expect(() => invoke("restore_prepare", { backupId: "20261113-080000", confirm: false })).toThrow();
    const plan = invoke<{ safetyBackupId: string; requiresRestart: boolean }>("restore_prepare", {
      backupId: "20261113-080000", confirm: true,
    });
    expect(plan.safetyBackupId).toBeTruthy();
    expect(plan.requiresRestart).toBe(true);
  });

  it("设置更新即时生效", () => {
    const s = invoke<{ theme: string }>("settings_update", { input: { theme: "aurora" } });
    expect(s.theme).toBe("aurora");
    expect(invoke<{ theme: string }>("settings_get").theme).toBe("aurora");
  });

  it("新建档案后总数增加", () => {
    const before = invoke<BootstrapDto>("app_bootstrap").fanCount;
    const input: FanProfileInput = { uid: "9999999", currentNickname: "新粉丝" };
    invoke("profile_create", { input });
    expect(invoke<BootstrapDto>("app_bootstrap").fanCount).toBe(before + 1);
  });
});
