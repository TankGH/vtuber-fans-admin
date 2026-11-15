import { beforeEach, describe, expect, it } from "vitest";
import { demoInvoke, resetDemoState } from "@/lib/demoAdapter";
import { SAMPLE_CSV } from "@/lib/demoData";
import { DEFAULT_MAPPING } from "@/lib/importLogic";
import type {
  BootstrapDto, CustomReminderDto, FanProfileDto, GiftBatchDto, GiftShipmentDto, GuardEventDto,
  ImportResult, LedgerEntryDto, LedgerSummaryDto, Paged, ReminderDto, SettingsDto, SyncQrDto,
  SyncQrPollDto, SyncSnapshotResultDto, SyncStatusDto,
} from "@/types/dto";

function invoke<T>(command: string, args: Record<string, unknown> = {}): T {
  return demoInvoke<T>(command, args);
}

beforeEach(() => resetDemoState());

describe("用户可选启用的自动抓取", () => {
  it("默认关闭，关闭状态下不允许扫码或同步", () => {
    const status = invoke<SyncStatusDto>("sync_status");
    expect(status.enabled).toBe(false);
    expect(status.loginState).toBe("disabled");
    expect(invoke<BootstrapDto>("app_bootstrap").syncStatus.enabled).toBe(false);
    expect(() => invoke("sync_qr_start")).toThrow();
    expect(() => invoke("sync_snapshot_now")).toThrow();
  });

  it("启用必须二次确认，登录后才能同步，退出与关闭都会清除可用态", () => {
    expect(() => invoke("sync_set_enabled", { enabled: true })).toThrow();
    const enabled = invoke<SyncStatusDto>("sync_set_enabled", { enabled: true, confirm: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.loginState).toBe("not_logged_in");
    expect(() => invoke("sync_snapshot_now")).toThrow();

    const qr = invoke<SyncQrDto>("sync_qr_start");
    expect(qr.qrSvg).toContain("<svg");
    expect(qr.qrcodeKey).toBeTruthy();
    expect(invoke<SyncQrPollDto>("sync_qr_poll").status).toBe("waiting");
    invoke("sync_qr_poll");
    invoke("sync_qr_poll");
    const done = invoke<SyncQrPollDto>("sync_qr_poll");
    expect(done.status).toBe("success");
    const status = invoke<SyncStatusDto>("sync_status");
    expect(status.cookieConfigured).toBe(true);
    expect(status.loginState).toBe("logged_in");
    expect(invoke<SyncSnapshotResultDto>("sync_snapshot_now").memberCount).toBeGreaterThan(0);

    const out = invoke<SyncStatusDto>("sync_logout");
    expect(out.cookieConfigured).toBe(false);
    const off = invoke<SyncStatusDto>("sync_set_enabled", { enabled: false });
    expect(off.enabled).toBe(false);
    expect(off.loginState).toBe("disabled");
  });
});

describe("纪念日提醒", () => {
  it("列表按提前天数过滤，标记处理后待办数量下降", () => {
    const all = invoke<ReminderDto[]>("reminder_list", { daysAhead: 3, includeAcked: true });
    expect(all.length).toBeGreaterThan(0);
    const pendingBefore = invoke<BootstrapDto>("app_bootstrap").reminderCount;
    const target = all.find((r) => !r.acked && r.daysAhead === 0)!;
    invoke("reminder_ack", { uid: target.uid, reminderType: target.reminderType, reminderDate: target.reminderDate, acked: true });
    expect(invoke<BootstrapDto>("app_bootstrap").reminderCount).toBe(pendingBefore - 1);
    const onlyPending = invoke<ReminderDto[]>("reminder_list", { includeAcked: false });
    expect(onlyPending.every((r) => !r.acked)).toBe(true);
    invoke("reminder_ack", { uid: target.uid, reminderType: target.reminderType, reminderDate: target.reminderDate, acked: false });
    expect(invoke<BootstrapDto>("app_bootstrap").reminderCount).toBe(pendingBefore);
  });

  it("提前天数写入设置并影响顶栏角标", () => {
    invoke("settings_update", { input: { reminderDaysAhead: 0 } });
    expect(invoke<{ reminderDaysAhead: number }>("settings_get").reminderDaysAhead).toBe(0);
    const badge = invoke<BootstrapDto>("app_bootstrap").reminderCount;
    const today = invoke<ReminderDto[]>("reminder_list", { daysAhead: 0, includeAcked: false });
    expect(badge).toBe(today.length);
  });
});

describe("舰礼寄送台账", () => {
  it("批次创建、发货状态与二次确认查看", () => {
    const batch = invoke<GiftBatchDto>("gift_batch_create", { name: "新批次", memberUids: ["1000001", "1000001", "1000003"] });
    expect(batch.memberCount).toBe(2);
    const list = invoke<GiftShipmentDto[]>("gift_shipment_list", { batchId: batch.id });
    expect(list.length).toBe(2);
    expect(() => invoke("gift_shipment_reveal_address", { id: list[0].id, confirm: false })).toThrow();
    const addr = invoke<{ uid: string; phone: string } | null>("gift_shipment_reveal_address", { id: list[0].id, confirm: true });
    expect(addr?.phone).toContain("****");
    const updated = invoke<GiftShipmentDto>("gift_shipment_update", { id: list[0].id, shipmentStatus: "shipped", trackingNo: "SF001" });
    expect(updated.trackingNo).toBe("SF001");
    expect(() => invoke("gift_batch_export", { batchId: batch.id, confirm: false })).toThrow();
    expect(invoke<{ masked: boolean }>("gift_batch_export", { batchId: batch.id, confirm: true }).masked).toBe(true);
  });
});

describe("档案的大航海状态", () => {
  it("过期成员保留历史等级但不再计入当前等级", () => {
    const page = invoke<Paged<FanProfileDto>>("profile_list", { pageSize: 50 });
    const expired = page.items.find((p) => p.uid === "1000013")!;
    expect(expired.guardExpired).toBe(true);
    expect(expired.guardLevel).toBeNull();
    expect(expired.lastGuardLevel).toBe(3);
    const active = page.items.find((p) => p.uid === "1000001")!;
    expect(active.guardExpired).toBe(false);
    expect(active.guardLevel).toBe(2);
    const level3 = invoke<Paged<FanProfileDto>>("profile_list", { guardLevel: 3, pageSize: 50 });
    expect(level3.items.some((p) => p.uid === "1000013")).toBe(false);
  });
});

describe("主播记账本", () => {
  it("手动记账、事件幂等归集与汇总", () => {
    const created = invoke<LedgerEntryDto>("ledger_create", {
      entryType: "expense", category: "快递费", amountYuan: 20, occurredAt: "2026-11-14", note: "测试",
    });
    expect(created.amountYuan).toBe(20);
    expect(invoke<LedgerEntryDto[]>("ledger_list").some((e) => e.id === created.id && e.amountYuan === 20)).toBe(true);
    expect(() => invoke("ledger_create", {
      entryType: "income", category: "大航海", amountYuan: 0, occurredAt: "2026-11-14",
    })).toThrow();
    const before = invoke<LedgerSummaryDto>("ledger_summary");
    const after = invoke<LedgerSummaryDto>("ledger_sync_events");
    expect(after.unlinkedEventCount).toBe(0);
    expect(after.totalIncomeYuan).toBeGreaterThanOrEqual(before.totalIncomeYuan);
    expect(invoke<LedgerSummaryDto>("ledger_sync_events").entryCount).toBe(after.entryCount);
    expect(() => invoke("ledger_delete", { id: created.id, confirm: false })).toThrow();
    invoke("ledger_delete", { id: created.id, confirm: true });
    expect(invoke<LedgerEntryDto[]>("ledger_list").some((e) => e.id === created.id)).toBe(false);
  });
});

describe("纪念日里程碑与自定义提醒", () => {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  it("自动生成上舰 100 天与第 N 周年，并带里程碑标记", () => {
    const all = invoke<ReminderDto[]>("reminder_list", { daysAhead: 14, includeAcked: true });
    const day = all.find((r) => r.reminderType === "guard_days_100");
    expect(day?.milestone).toBe("第 1 个百日 · 100 天");
    expect(day?.source).toBe("auto");
    expect(day?.reminderLabel).toBe("上舰 100 天");
    expect(all.some((r) => r.reminderType === "guard_days_200")).toBe(true);
    const years = all.find((r) => r.reminderType.startsWith("guard_years_"));
    expect(years?.milestone).toMatch(/周年/);
    expect(invoke<ReminderDto[]>("reminder_list", { daysAhead: 14, source: "custom" }).every((r) => r.source === "custom")).toBe(true);
    expect(invoke<CustomReminderDto[]>("custom_reminder_list").length).toBe(2);
  });

  it("可新增、编辑、标记、停用并删除自定义纪念日", () => {
    const created = invoke<CustomReminderDto>("custom_reminder_save", {
      input: { title: "相识 500 天", uid: "1000001", anchorDate: today, rule: "days", offsetDays: 500, note: "测试", enabled: true },
    });
    expect(created.id).toBeGreaterThan(2);
    expect(created.nickname).toBe("limmax");
    expect(invoke<CustomReminderDto[]>("custom_reminder_list").some((c) => c.id === created.id)).toBe(true);

    const edited = invoke<CustomReminderDto>("custom_reminder_save", {
      input: { ...created, rule: "annual", offsetDays: 0 },
    });
    expect(edited.rule).toBe("annual");
    const item = invoke<ReminderDto[]>("reminder_list", { daysAhead: 0, includeAcked: true })
      .find((r) => r.reminderType === `custom_${created.id}`);
    expect(item?.source).toBe("custom");
    expect(item?.reminderLabel).toBe("相识 500 天");
    expect(item?.greeting).toContain("limmax");

    invoke("reminder_ack", { uid: item!.uid, reminderType: item!.reminderType, reminderDate: item!.reminderDate, acked: true });
    expect(invoke<ReminderDto[]>("reminder_list", { daysAhead: 0, includeAcked: true })
      .find((r) => r.reminderType === `custom_${created.id}`)?.acked).toBe(true);

    invoke("custom_reminder_save", { input: { ...edited, enabled: false } });
    expect(invoke<ReminderDto[]>("reminder_list", { daysAhead: 0, includeAcked: true })
      .some((r) => r.reminderType === `custom_${created.id}`)).toBe(false);

    expect(invoke<boolean>("custom_reminder_delete", { id: created.id })).toBe(true);
    expect(invoke<CustomReminderDto[]>("custom_reminder_list").some((c) => c.id === created.id)).toBe(false);
    expect(() => invoke("custom_reminder_save", {
      input: { title: "无效", uid: "不存在的UID", anchorDate: today, rule: "annual" },
    })).toThrow();
  });

  it("两类里程碑可分别开启并写入本机设置", () => {
    const cfg = invoke<SettingsDto>("settings_update", {
      input: { milestoneHundredsEnabled: false, milestoneYearsEnabled: true },
    });
    expect(cfg.milestoneHundredsEnabled).toBe(false);
    expect(cfg.milestoneYearsEnabled).toBe(true);
    const saved = invoke<SettingsDto>("settings_get");
    expect(saved.milestoneHundredsEnabled).toBe(false);
    expect(saved.milestoneYearsEnabled).toBe(true);
    const both = invoke<SettingsDto>("settings_update", {
      input: { milestoneHundredsEnabled: true, milestoneYearsEnabled: false },
    });
    expect(both.milestoneHundredsEnabled).toBe(true);
    expect(both.milestoneYearsEnabled).toBe(false);
  });
});

describe("手动导入生成收入事件与快照日期校验（P2）", () => {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(new Date());
  const past = iso(new Date(Date.now() - 3 * 86_400_000));
  const base = { fileContent: SAMPLE_CSV, fileName: "fans_sample.csv", kind: "fans", mapping: DEFAULT_MAPPING };

  it("写入购买 / 续费事件，记账本能归集且幂等", () => {
    const before = invoke<GuardEventDto[]>("guard_events").length;
    const r = invoke<ImportResult>("import_commit", base);
    expect(r.eventCount).toBe(3);
    expect(r.snapshotDate).toBe(today);
    expect(r.warnings).toHaveLength(0);
    const created = invoke<GuardEventDto[]>("guard_events").slice(before);
    expect(created).toHaveLength(3);
    expect(created.every((e) => e.source === "import")).toBe(true);
    expect(created.some((e) => e.eventType === "renew" && e.priceYuan === 588)).toBe(true);
    expect(created.some((e) => e.eventType === "purchase" && e.priceYuan === 198)).toBe(true);
    expect(invoke<LedgerSummaryDto>("ledger_summary").unlinkedEventCount).toBeGreaterThanOrEqual(3);
    const entriesBefore = invoke<LedgerEntryDto[]>("ledger_list").length;
    invoke<LedgerSummaryDto>("ledger_sync_events");
    const entriesAfter = invoke<LedgerEntryDto[]>("ledger_list").length;
    expect(entriesAfter - entriesBefore).toBeGreaterThanOrEqual(3);
    invoke<LedgerSummaryDto>("ledger_sync_events");
    expect(invoke<LedgerEntryDto[]>("ledger_list")).toHaveLength(entriesAfter);
  });

  it("过去日期可补录并回显，未来 / 非法日期被明确拒绝", () => {
    const r = invoke<ImportResult>("import_commit", { ...base, snapshotDate: past });
    expect(r.snapshotDate).toBe(past);
    const messageOf = (fn: () => unknown): string => {
      try { fn(); return ""; } catch (e) { return String((e as { message?: string })?.message ?? e); }
    };
    expect(messageOf(() => invoke("import_parse", { ...base, snapshotDate: "2099-12-31" }))).toContain("晚于今天");
    expect(messageOf(() => invoke("import_commit", { ...base, snapshotDate: "2099-12-31" }))).toContain("晚于今天");
    expect(messageOf(() => invoke("import_commit", { ...base, snapshotDate: "不是日期" }))).toContain("YYYY-MM-DD");
  });

  it("金额与月数未映射时给出可见提示", () => {
    const noMap = { ...DEFAULT_MAPPING, unitMonths: "", priceYuan: "" };
    const r = invoke<ImportResult>("import_commit", { ...base, mapping: noMap });
    expect(r.eventCount).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toContain("不会生成收入事件");
  });
});
