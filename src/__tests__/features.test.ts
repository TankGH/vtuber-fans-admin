import { beforeEach, describe, expect, it } from "vitest";
import { demoInvoke, resetDemoState } from "@/lib/demoAdapter";
import type {
  BootstrapDto, GiftBatchDto, GiftShipmentDto, LedgerEntryDto, LedgerSummaryDto,
  ReminderDto, SyncQrDto, SyncQrPollDto, SyncSnapshotResultDto, SyncStatusDto,
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

describe("主播记账本", () => {
  it("手动记账、事件幂等归集与汇总", () => {
    const created = invoke<LedgerEntryDto>("ledger_create", {
      entryType: "expense", category: "快递费", amountYuan: 20, occurredAt: "2026-11-14", note: "测试",
    });
    expect(created.amountYuan).toBe(20);
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
