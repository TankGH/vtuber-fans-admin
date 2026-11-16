import type {
  AddressDto,
  BackupDto,
  BootstrapDto,
  CustomReminderDto,
  CustomReminderInput,
  ExportResult,
  FanProfileDto,
  FanProfileInput,
  GiftBatchDto,
  GiftBatchInput,
  GiftShipmentDto,
  GiftShipmentInput,
  GuardEventDto,
  GuardMemberDto,
  ImportCommitArgs,
  ImportParseArgs,
  ImportPreview,
  ImportResult,
  LedgerEntryDto,
  LedgerInput,
  LedgerQuery,
  LedgerSummaryDto,
  Paged,
  ProfileQuery,
  ReminderAckInput,
  ReminderDto,
  ReminderQuery,
  RestorePlan,
  SettingsDto,
  SettingsInput,
  SnapshotDto,
  SyncQrDto,
  SyncQrPollDto,
  SyncSnapshotResultDto,
  SyncStatusDto,
  ThemeKey,
} from "@/types/dto";
import {
  DEFAULT_SETTINGS,
  seedActivities,
  seedBackups,
  seedCustomReminders,
  seedEvents,
  seedGiftBatches,
  seedGiftShipments,
  seedGuardMembers,
  seedLedgerEntries,
  seedProfiles,
  seedReminders,
  seedSnapshots,
  seedSyncStatus,
} from "@/lib/demoData";
import { buildPreview, buildRows, earliestInteraction, getCell, parseDelimited } from "@/lib/importLogic";

const STORAGE_KEY = "vtuber-fans-admin.demo.v1";
const CLEARED_KEY = "vtuber-fans-admin.demo.cleared.v1";

// Node / Vitest 环境没有 localStorage，用进程内状态回退，保证写操作可验证
let memoryState: DemoState | null = null;
let demoCleared = false;

interface DemoState {
  profiles: FanProfileDto[];
  guardMembers: GuardMemberDto[];
  snapshots: SnapshotDto[];
  events: GuardEventDto[];
  backups: BackupDto[];
  settings: SettingsDto;
  activities: ReturnType<typeof seedActivities>;
  addresses: Record<string, AddressDto>;
  importContent: string;
  nextImportBatchId: number;
  reminders: ReminderDto[];
  customReminders: CustomReminderDto[];
  nextCustomReminderId: number;
  giftBatches: GiftBatchDto[];
  giftShipments: GiftShipmentDto[];
  ledgerEntries: LedgerEntryDto[];
  sync: SyncStatusDto;
  qr: { active: boolean; polls: number } | null;
  nextGiftBatchId: number;
  nextShipmentId: number;
  nextLedgerId: number;
}

function initialState(): DemoState {
  const addresses: Record<string, AddressDto> = {
    "1000001": { uid: "1000001", receiver: "林先生", phone: "138****6621", province: "上海市", city: "上海市", district: "浦东新区", detail: "世纪大道 100 号 32 层", addressStatus: "pending" },
    "1000003": { uid: "1000003", receiver: "白女士", phone: "139****2048", province: "广东省", city: "深圳市", district: "南山区", detail: "科技园北区 8 栋", addressStatus: "valid" },
  };
  return {
    profiles: seedProfiles(),
    guardMembers: seedGuardMembers(),
    snapshots: seedSnapshots(),
    events: seedEvents(),
    backups: seedBackups(),
    settings: { ...DEFAULT_SETTINGS },
    activities: seedActivities(),
    addresses,
    importContent: "",
    nextImportBatchId: 7,
    reminders: seedReminders(),
    customReminders: seedCustomReminders(),
    nextCustomReminderId: 3,
    giftBatches: seedGiftBatches(),
    giftShipments: seedGiftShipments(),
    ledgerEntries: seedLedgerEntries(),
    sync: seedSyncStatus(),
    qr: null,
    nextGiftBatchId: 3,
    nextShipmentId: 7,
    nextLedgerId: 5,
  };
}

function emptyState(): DemoState {
  return {
    profiles: [],
    guardMembers: [],
    snapshots: [],
    events: [],
    backups: [],
    settings: {
      ...DEFAULT_SETTINGS,
      onboardingDone: false,
      roomId: "",
      cookieConfigured: false,
    },
    activities: [],
    addresses: {},
    importContent: "",
    nextImportBatchId: 1,
    reminders: [],
    customReminders: [],
    nextCustomReminderId: 1,
    giftBatches: [],
    giftShipments: [],
    ledgerEntries: [],
    sync: {
      ...seedSyncStatus(),
      roomId: "",
      loginState: "not_logged_in",
      message: "自动抓取已关闭，名单可通过 CSV / Excel 手动导入。",
    },
    qr: null,
    nextGiftBatchId: 1,
    nextShipmentId: 1,
    nextLedgerId: 1,
  };
}

function syncSettings(state: DemoState): void {
  state.sync.roomId = state.settings.roomId;
  state.sync.snapshotHour = state.settings.snapshotHour;
  state.sync.enabled = state.settings.syncEnabled;
  if (!state.sync.enabled) state.sync.loginState = "disabled";
  else if (!state.sync.cookieConfigured) state.sync.loginState = "not_logged_in";
  else if (state.sync.loginState === "disabled" || state.sync.loginState === "not_logged_in") state.sync.loginState = "logged_in";
  state.sync.message = !state.sync.enabled
    ? "自动抓取已关闭，不会发起任何外部请求；名单可通过 CSV / Excel 手动导入。"
    : state.sync.loginState === "not_logged_in"
      ? "已启用自动抓取，尚未登录。点击「扫码登录 B 站」按需完成登录。"
      : "登录有效，可立即同步或等待每日定时快照。";
}

function load(): DemoState {
  if (typeof localStorage === "undefined") {
    if (!memoryState) memoryState = demoCleared ? emptyState() : initialState();
    return memoryState;
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  const cleared = localStorage.getItem(CLEARED_KEY) === "1";
  const base = cleared ? emptyState() : initialState();
  if (!raw) return base;
  const parsed = JSON.parse(raw) as Partial<DemoState>;
  return { ...base, ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
}

function save(state: DemoState): void {
  if (typeof localStorage === "undefined") {
    memoryState = state;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function now(): string {
  return new Date().toISOString();
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resolveSnapshotDate(raw?: string): string {
  const today = isoDate(new Date());
  const value = raw?.trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw { code: "E_INVALID_INPUT", message: "快照日期格式应为 YYYY-MM-DD" };
  }
  if (value > today) {
    throw { code: "E_INVALID_INPUT", message: `快照日期 ${value} 晚于今天（${today}），已取消导入；未来日期的名单不应作为当前在舰快照。` };
  }
  return value;
}

function customOccurrence(item: CustomReminderDto): { date: string; daysAhead: number } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const anchor = new Date(`${item.anchorDate}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) return null;
  let target: Date;
  if (item.rule === "annual") {
    target = new Date(today.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (target.getTime() < today.getTime()) {
      target = new Date(today.getFullYear() + 1, anchor.getMonth(), anchor.getDate());
    }
  } else {
    target = new Date(anchor);
    if (item.rule === "days") target.setDate(target.getDate() + item.offsetDays);
  }
  const daysAhead = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return daysAhead < 0 ? null : { date: isoDate(target), daysAhead };
}

function rebuildCustomReminder(state: DemoState, item: CustomReminderDto): void {
  const type = `custom_${item.id}`;
  state.reminders = state.reminders.filter((r) => r.reminderType !== type);
  if (!item.enabled) return;
  const occ = customOccurrence(item);
  if (!occ) return;
  const nickname = item.nickname ?? "全体";
  state.reminders.push({
    uid: item.uid ?? "__global__",
    nickname,
    reminderType: type,
    reminderLabel: item.title,
    reminderDate: occ.date,
    daysAhead: occ.daysAhead,
    acked: false,
    ackedAt: null,
    greeting: item.uid
      ? `${nickname}，${item.title}快乐！感谢一路相伴。`
      : `「${item.title}」到了，记得准备一下～`,
    source: "custom",
    customId: item.id,
    milestone: item.rule === "days" ? `${item.offsetDays} 天` : item.rule === "annual" ? "每年" : null,
  });
}

function logActivity(state: DemoState, kind: string, summary: string): void {
  state.activities.unshift({ id: Date.now(), kind, summary, createdAt: now() });
  state.activities = state.activities.slice(0, 30);
}

function maskAddress(raw: string): string {
  const parts = raw.split(/[·|,，\s]+/).filter(Boolean);
  return parts.slice(0, 3).join(" · ") || "已登记";
}

function maskBirthday(raw: string): string {
  const m = raw.match(/(\d{1,2})[-/月](\d{1,2})/);
  return m ? `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : raw;
}

function toDto(input: FanProfileInput, base?: FanProfileDto): FanProfileDto {
  const locked = [...new Set([...(base?.manualLockedFields ?? []), ...(input.manualLockedFields ?? [])])];
  return {
    uid: input.uid,
    currentNickname: input.currentNickname,
    nicknameHistory: base
      ? base.currentNickname !== input.currentNickname
        ? [...base.nicknameHistory, input.currentNickname]
        : base.nicknameHistory
      : [input.currentNickname],
    firstInteractionAt: input.firstInteractionAt ?? base?.firstInteractionAt ?? null,
    birthdayMasked: input.birthday ? maskBirthday(`${input.birthday.month}-${input.birthday.day}`) : (base?.birthdayMasked ?? null),
    addressMasked: input.address ? maskAddress(`${input.address.province}·${input.address.city}·${input.address.district}`) : (base?.addressMasked ?? null),
    addressStatus: input.addressStatus ?? base?.addressStatus ?? "none",
    guardAnniversaryDate: input.guardAnniversaryDate ?? base?.guardAnniversaryDate ?? null,
    watchAnniversaryDate: input.watchAnniversaryDate ?? base?.watchAnniversaryDate ?? null,
    note: input.note ?? base?.note ?? "",
    manualLockedFields: locked,
    guardLevel: base?.guardLevel ?? null,
    rank: base?.rank ?? null,
    lastGuardLevel: base?.lastGuardLevel ?? base?.guardLevel ?? null,
    guardExpired: base?.guardExpired ?? false,
    source: base?.source ?? "manual",
    createdAt: base?.createdAt ?? now(),
    updatedAt: now(),
  };
}

export function resetDemoState(): void {
  memoryState = null;
  demoCleared = false;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CLEARED_KEY);
  }
}

export function isNative(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

export function getTheme(): ThemeKey {
  const s = load();
  return s.settings.theme;
}

type Handler = (args: Record<string, unknown>) => unknown;

function bootstrap(): BootstrapDto {
  const state = load();
  const last = state.backups[0]?.createdAt ?? null;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  return {
    fanCount: state.profiles.length,
    guardCount: state.guardMembers.filter((g) => g.status === "active").length,
    snapshotCount: state.snapshots.length,
    conflictCount: 0,
    reminderCount: state.reminders.filter((r) => !r.acked && r.daysAhead <= state.settings.reminderDaysAhead).length,
    syncStatus: state.sync,
    settings: state.settings,
    backupHealth: {
      lastBackupAt: last,
      daysSinceBackup: days,
      backupCount: state.backups.length,
      healthy: days === null || days <= 3,
    },
    activities: state.activities,
    dataDir: state.settings.dataDir,
    nativeMode: false,
  };
}

function profileList(args: Record<string, unknown>): Paged<FanProfileDto> {
  const q = args as unknown as ProfileQuery;
  const state = load();
  const kw = (q.keyword ?? "").toLowerCase();
  const filtered = state.profiles.filter((p) => {
    if (kw && !p.uid.toLowerCase().includes(kw) && !p.currentNickname.toLowerCase().includes(kw)) return false;
    if (q.guardLevel && p.guardLevel !== q.guardLevel) return false;
    if (q.addressStatus && p.addressStatus !== q.addressStatus) return false;
    if (q.onlyLocked && p.manualLockedFields.length === 0) return false;
    return true;
  });
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}

function maskPhone(raw: string): string {
  if (raw.length < 7) return "****";
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

/** 演示模式不访问任何外部服务，用确定性网格模拟二维码外观 */
function demoQrSvg(seed: string): string {
  const cells: string[] = [];
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { hash = (hash ^ seed.charCodeAt(i)) * 16777619 >>> 0; }
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 21; x += 1) {
      hash = (hash * 1103515245 + 12345) >>> 0;
      if ((hash >>> 16) % 100 < 48) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 25 25" width="232" height="232" shape-rendering="crispEdges"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><g fill="#0B1220">${cells.join("")}</g></svg>`;
}

function refreshBatchCounts(state: DemoState, batchId: number): GiftBatchDto {
  const items = state.giftShipments.filter((s) => s.batchId === batchId);
  const batch = state.giftBatches.find((b) => b.id === batchId)!;
  batch.memberCount = items.length;
  batch.shippedCount = items.filter((s) => s.shipmentStatus === "shipped").length;
  batch.pendingCount = batch.memberCount - batch.shippedCount;
  batch.addressReadyCount = items.filter((s) => s.addressStatus === "valid" || s.addressStatus === "shipped").length;
  return batch;
}

function ledgerSummary(state: DemoState): LedgerSummaryDto {
  const buckets = new Map<string, { incomeYuan: number; expenseYuan: number }>();
  let income = 0;
  let expense = 0;
  state.ledgerEntries.forEach((e) => {
    const key = e.occurredAt.slice(0, 7);
    const slot = buckets.get(key) ?? { incomeYuan: 0, expenseYuan: 0 };
    if (e.entryType === "income") { income += e.amountYuan; slot.incomeYuan += e.amountYuan; }
    else { expense += e.amountYuan; slot.expenseYuan += e.amountYuan; }
    buckets.set(key, slot);
  });
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    totalIncomeYuan: round(income),
    totalExpenseYuan: round(expense),
    netYuan: round(income - expense),
    entryCount: state.ledgerEntries.length,
    buckets: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
      month, incomeYuan: round(v.incomeYuan), expenseYuan: round(v.expenseYuan),
    })),
    unlinkedEventCount: state.events.filter((e) => (e.eventType === "purchase" || e.eventType === "renew")
      && (e.priceYuan ?? 0) > 0 && !state.ledgerEntries.some((l) => l.guardEventId === e.id)).length,
  };
}

const handlers: Record<string, Handler> = {
  app_bootstrap: () => bootstrap(),
  app_clear_all_data: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "清除全部数据需要二次确认" };
    demoCleared = true;
    if (typeof localStorage !== "undefined") localStorage.setItem(CLEARED_KEY, "1");
    save(emptyState());
    return null;
  },
  profile_list: (a) => profileList(a),
  profile_get: (a) => {
    const p = load().profiles.find((x) => x.uid === a.uid);
    if (!p) throw { code: "E_NOT_FOUND", message: "未找到该粉丝档案" };
    return p;
  },
  profile_create: (a) => {
    const state = load();
    const input = a.input as FanProfileInput;
    if (state.profiles.some((p) => p.uid === input.uid)) throw { code: "E_INVALID_INPUT", message: "该 UID 已存在，请使用档案合并或导入" };
    const dto = toDto({ ...input, manualLockedFields: ["nickname", "birthday", "address", "note"] });
    state.profiles.unshift(dto);
    if (input.address) state.addresses[input.uid] = { ...input.address, uid: input.uid, addressStatus: input.addressStatus ?? "pending" };
    logActivity(state, "profile", `新建档案 ${dto.currentNickname}（${dto.uid}）`);
    save(state);
    return dto;
  },
  profile_update: (a) => {
    const state = load();
    const input = a.input as FanProfileInput;
    const idx = state.profiles.findIndex((p) => p.uid === a.uid);
    if (idx < 0) throw { code: "E_NOT_FOUND", message: "未找到该粉丝档案" };
    const dto = toDto(input, state.profiles[idx]);
    state.profiles[idx] = dto;
    if (input.address) state.addresses[dto.uid] = { ...input.address, uid: dto.uid, addressStatus: input.addressStatus ?? "pending" };
    logActivity(state, "profile", `更新档案 ${dto.currentNickname} 的资料`);
    save(state);
    return dto;
  },
  profile_delete: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "删除档案需要二次确认" };
    const inputUids = (a.uids as string[] | undefined) ?? [];
    const uids = [...new Set(inputUids.map((uid) => String(uid).trim()).filter(Boolean))];
    if (uids.length === 0) throw { code: "E_INVALID_INPUT", message: "请先选择要删除的档案" };
    const uidSet = new Set(uids);
    const state = load();
    const before = state.profiles.length;
    state.profiles = state.profiles.filter((p) => !uidSet.has(p.uid));
    uids.forEach((uid) => { delete state.addresses[uid]; });
    state.guardMembers = state.guardMembers.filter((g) => !uidSet.has(g.uid));
    state.events = state.events.filter((e) => !uidSet.has(e.uid));
    const affectedBatchIds = [...new Set(state.giftShipments.filter((s) => uidSet.has(s.uid)).map((s) => s.batchId))];
    state.giftShipments = state.giftShipments.filter((s) => !uidSet.has(s.uid));
    affectedBatchIds.forEach((id) => refreshBatchCounts(state, id));
    const removedCustomIds = state.customReminders.filter((c) => c.uid && uidSet.has(c.uid)).map((c) => c.id);
    state.customReminders = state.customReminders.filter((c) => !c.uid || !uidSet.has(c.uid));
    state.reminders = state.reminders.filter((r) => !uidSet.has(r.uid) && !removedCustomIds.includes(r.customId ?? -1));
    const deleted = before - state.profiles.length;
    logActivity(state, "profile", `删除 ${deleted} 位粉丝档案`);
    save(state);
    return deleted;
  },
  profile_reveal_address: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "查看完整地址需要二次确认" };
    const addr = load().addresses[a.uid as string];
    return addr ?? null;
  },
  profile_set_lock: (a) => {
    const state = load();
    const p = state.profiles.find((x) => x.uid === a.uid);
    if (!p) throw { code: "E_NOT_FOUND", message: "未找到该粉丝档案" };
    const field = a.field as FanProfileDto["manualLockedFields"][number];
    p.manualLockedFields = a.locked
      ? [...new Set([...p.manualLockedFields, field])]
      : p.manualLockedFields.filter((f) => f !== field);
    p.updatedAt = now();
    save(state);
    return p;
  },
  guard_list: () => ({ items: load().guardMembers, total: load().guardMembers.length, page: 1, pageSize: 50 }),
  guard_snapshots: () => load().snapshots,
  guard_events: (a) => {
    const list = load().events;
    return a.uid ? list.filter((e) => e.uid === a.uid) : list;
  },
  import_parse: (a) => {
    const args = a as unknown as ImportParseArgs;
    const content = args.fileContent || "";
    if (!content.trim()) throw { code: "E_IMPORT_FORMAT", message: "文件内容为空或格式无法识别" };
    resolveSnapshotDate(args.snapshotDate);
    const state = load();
    const preview = buildPreview(content, args.mapping, state.profiles);
    state.importContent = content;
    save(state);
    return preview;
  },
  import_commit: (a) => {
    const args = a as unknown as ImportCommitArgs;
    const state = load();
    const content = args.fileContent || state.importContent;
    const snapshotDate = resolveSnapshotDate(args.snapshotDate);
    const preview = buildPreview(content, args.mapping, state.profiles) as ImportPreview;
    const { rows } = buildRows(content, args.mapping);
    const { headers, records } = parseDelimited(content);
    const mapping = args.mapping;
    const warnings: string[] = [];
    if (!mapping.unitMonths && !mapping.priceYuan) {
      warnings.push("金额与购买月数列均未映射，本次不会生成收入事件；如需在记账本归集，请在「字段映射」里指定这两列。");
    }
    let newCount = 0;
    let mergeCount = 0;
    let eventCount = 0;
    rows.forEach((r, i) => {
      if (!r.uid || !r.nickname) return;
      const idx = state.profiles.findIndex((p) => p.uid === r.uid);
      if (idx < 0) {
        newCount += 1;
        state.profiles.push(toDto({ uid: r.uid, currentNickname: r.nickname, firstInteractionAt: r.firstInteractionAt || null, note: r.note }, undefined));
      } else {
        mergeCount += 1;
        const p = state.profiles[idx];
        state.profiles[idx] = {
          ...p,
          currentNickname: p.manualLockedFields.includes("nickname") ? p.currentNickname : r.nickname,
          nicknameHistory: p.currentNickname !== r.nickname ? [...p.nicknameHistory, r.nickname] : p.nicknameHistory,
          firstInteractionAt: earliestInteraction(p.firstInteractionAt, r.firstInteractionAt),
          note: p.manualLockedFields.includes("note") ? p.note : r.note || p.note,
          addressMasked: r.address && !p.manualLockedFields.includes("address") ? maskAddress(r.address) : p.addressMasked,
          birthdayMasked: r.birthday && !p.manualLockedFields.includes("birthday") ? maskBirthday(r.birthday) : p.birthdayMasked,
          guardLevel: r.guardLevel ?? p.guardLevel,
          rank: r.rank ?? p.rank,
          updatedAt: now(),
        };
      }
      if (r.guardLevel) {
        const gi = state.guardMembers.findIndex((g) => g.uid === r.uid);
        if (gi >= 0) state.guardMembers[gi] = { ...state.guardMembers[gi], nickname: r.nickname, guardLevel: r.guardLevel, rank: r.rank };
        else state.guardMembers.push({ uid: r.uid, nickname: r.nickname, guardLevel: r.guardLevel, rank: r.rank, validUntil: null, status: "active", snapshotDate });
      }
      // 与 Rust 侧一致：金额或月数任一有值就生成购买 / 续费事件，供记账本归集
      const rec = records[i] ?? [];
      const unitMonths = Number.parseInt(getCell(rec, headers, mapping.unitMonths), 10);
      const priceYuan = Number.parseFloat(getCell(rec, headers, mapping.priceYuan));
      if (Number.isFinite(unitMonths) || Number.isFinite(priceYuan)) {
        const typeRaw = getCell(rec, headers, mapping.eventType).trim().toLowerCase();
        const isRenew = ["renew", "续费", "续舰", "renewal"].includes(typeRaw);
        const atRaw = getCell(rec, headers, mapping.eventAt).trim();
        state.events.push({
          id: state.events.length + 1,
          uid: r.uid,
          nickname: r.nickname,
          eventType: isRenew ? "renew" : "purchase",
          guardLevel: r.guardLevel,
          unitMonths: Number.isFinite(unitMonths) ? unitMonths : null,
          priceYuan: Number.isFinite(priceYuan) ? priceYuan : null,
          eventAt: /^\d{4}-\d{2}-\d{2}/.test(atRaw) ? atRaw.slice(0, 10) : snapshotDate,
          source: "import",
        });
        eventCount += 1;
      }
    });
    if (eventCount === 0 && warnings.length === 0) {
      warnings.push("未识别到金额或购买月数，本次没有生成收入事件；请检查这两列的数据是否为纯数字。");
    }
    const result: ImportResult = {
      batchId: state.nextImportBatchId++,
      totalRows: preview.totalRows,
      newCount,
      mergeCount,
      skippedCount: preview.invalidCount,
      eventCount,
      snapshotDate,
      warnings,
      errors: preview.conflicts.map((c) => `第 ${c.row} 行：${c.reason}`),
      createdAt: now(),
    };
    logActivity(state, "import", `导入 ${args.fileName ?? "名单"}：新增 ${newCount}、合并 ${mergeCount}`);
    save(state);
    return result;
  },
  backup_list: () => load().backups,
  backup_now: () => {
    const state = load();
    const id = now().replace(/\D/g, "").slice(0, 14);
    const dto: BackupDto = {
      id, fileName: `backup-${id}.enc`, createdAt: now(), sizeBytes: 186000 + Math.floor(Math.random() * 4000),
      fanCount: state.profiles.length, snapshotCount: state.snapshots.length, eventCount: state.events.length,
      sha256: Math.random().toString(16).slice(2, 18), verified: true,
    };
    state.backups.unshift(dto);
    state.backups = state.backups.slice(0, 7);
    logActivity(state, "backup", "手动立即备份完成，保留最近 7 份");
    save(state);
    return dto;
  },
  backup_export_db: (a) => ({ path: (a.destPath as string) || "fans-db-export.enc", sizeBytes: 186368, masked: false } as ExportResult),
  backup_export_csv: (a) => ({ path: (a.destPath as string) || "fans-masked-export.csv", sizeBytes: 4096, masked: true } as ExportResult),
  restore_prepare: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "恢复操作需要二次确认" };
    const state = load();
    const target = state.backups.find((b) => b.id === a.backupId);
    if (!target) throw { code: "E_RESTORE_VERIFY", message: "找不到所选备份" };
    logActivity(state, "restore", `准备从 ${target.createdAt} 恢复，已自动创建安全备份`);
    save(state);
    return { backupId: target.id, safetyBackupId: "safety-" + target.id, fanCount: target.fanCount, requiresRestart: true, message: "已创建安全备份并写入恢复标记，重启应用后完成恢复" } as RestorePlan;
  },
  settings_get: () => load().settings,
  settings_update: (a) => {
    const state = load();
    const input = a.input as SettingsInput;
    state.settings = { ...state.settings, ...input };
    if (input.theme) logActivity(state, "theme", `主题切换为 ${({ galaxy: "守村人深蓝", mist: "晨雾浅色", aurora: "暖霞" } as Record<ThemeKey, string>)[input.theme]}`);
    syncSettings(state);
    save(state);
    return state.settings;
  },
  open_data_dir: () => null,

  // ---- F3 纪念日提醒 ----
  reminder_list: (a) => {
    const q = a as unknown as ReminderQuery;
    const days = q.daysAhead ?? 3;
    const include = q.includeAcked ?? true;
    return load().reminders.filter((r) => r.daysAhead <= days && (include || !r.acked) && (!q.source || r.source === q.source));
  },
  custom_reminder_list: () => load().customReminders,
  custom_reminder_save: (a) => {
    const state = load();
    const input = (a as { input?: CustomReminderInput }).input;
    if (!input) throw { code: "E_INVALID", message: "缺少纪念日内容" };
    const title = input.title.trim();
    if (!title || title.length > 60) throw { code: "E_INVALID", message: "纪念日名称需为 1–60 个字符" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.anchorDate)) throw { code: "E_INVALID", message: "起算日期格式应为 YYYY-MM-DD" };
    const uid = input.uid?.trim() || null;
    if (uid && !state.profiles.some((p) => p.uid === uid)) {
      throw { code: "E_INVALID", message: "绑定的粉丝 UID 不存在，请先在档案中创建" };
    }
    const id = input.id ?? state.nextCustomReminderId++;
    const existing = state.customReminders.find((c) => c.id === id);
    const offset = input.rule === "days" ? (input.offsetDays ?? 100) : 0;
    if (input.rule === "days" && (offset < 1 || offset > 36500)) {
      throw { code: "E_INVALID", message: "累计天数需在 1–36500 之间" };
    }
    const item: CustomReminderDto = {
      id, title, uid,
      nickname: uid ? state.profiles.find((p) => p.uid === uid)?.currentNickname ?? null : null,
      anchorDate: input.anchorDate,
      rule: input.rule,
      offsetDays: offset,
      note: input.note ?? "",
      enabled: input.enabled ?? true,
      createdAt: existing?.createdAt ?? now(),
    };
    state.customReminders = [item, ...state.customReminders.filter((c) => c.id !== id)];
    rebuildCustomReminder(state, item);
    logActivity(state, "reminder", `${existing ? "编辑" : "新增"}自定义纪念日「${title}」`);
    save(state);
    return item;
  },
  custom_reminder_delete: (a) => {
    const state = load();
    const id = (a as { id: number }).id;
    const existed = state.customReminders.some((c) => c.id === id);
    state.customReminders = state.customReminders.filter((c) => c.id !== id);
    state.reminders = state.reminders.filter((r) => r.reminderType !== `custom_${id}`);
    if (existed) logActivity(state, "reminder", `删除自定义纪念日 #${id}`);
    save(state);
    return existed;
  },
  reminder_ack: (a) => {
    const input = a as unknown as ReminderAckInput;
    const state = load();
    const item = state.reminders.find((r) => r.uid === input.uid && r.reminderType === input.reminderType && r.reminderDate === input.reminderDate);
    if (!item) throw { code: "E_NOT_FOUND", message: "未找到该纪念日提醒" };
    item.acked = input.acked ?? true;
    item.ackedAt = item.acked ? now() : null;
    logActivity(state, "reminder", `${item.acked ? "标记" : "撤销"} ${item.nickname} 的${item.reminderLabel}`);
    save(state);
    return item;
  },
  reminder_notify: () => false,

  // ---- F4 舰礼寄送台账 ----
  gift_batch_list: () => load().giftBatches,
  gift_batch_create: (a) => {
    const input = a as unknown as GiftBatchInput;
    const state = load();
    if (!input.name?.trim()) throw { code: "E_INVALID_INPUT", message: "请填写批次名称" };
    const uids = [...new Set((input.memberUids ?? []).map((u) => String(u).trim()).filter(Boolean))];
    if (!uids.length) throw { code: "E_INVALID_INPUT", message: "请至少选择一位在舰成员" };
    const id = state.nextGiftBatchId++;
    state.giftBatches.unshift({ id, name: input.name.trim(), createdAt: now(), status: "open", memberCount: 0, shippedCount: 0, pendingCount: 0, addressReadyCount: 0 });
    uids.forEach((uid) => {
      const p = state.profiles.find((x) => x.uid === uid);
      const addressStatus = p?.addressStatus ?? "none";
      const ready = addressStatus === "valid" || addressStatus === "shipped";
      state.giftShipments.push({
        id: state.nextShipmentId++, batchId: id, uid,
        nickname: p?.currentNickname ?? uid, guardLevel: p?.guardLevel ?? null,
        addressStatus, addressMasked: p?.addressMasked ?? null,
        shipmentStatus: ready ? "pending" : "address_missing", trackingNo: null, updatedAt: now(),
      });
    });
    logActivity(state, "gift", `创建舰礼批次「${input.name.trim()}」，共 ${uids.length} 人`);
    const batch = refreshBatchCounts(state, id);
    save(state);
    return batch;
  },
  gift_shipment_list: (a) => load().giftShipments.filter((s) => s.batchId === Number(a.batchId)),
  gift_shipment_update: (a) => {
    const input = a as unknown as GiftShipmentInput;
    const state = load();
    const item = state.giftShipments.find((s) => s.id === input.id);
    if (!item) throw { code: "E_NOT_FOUND", message: "未找到该寄送记录" };
    if (input.shipmentStatus && !["pending", "address_missing", "shipped", "invalid_address"].includes(input.shipmentStatus)) {
      throw { code: "E_INVALID_INPUT", message: "寄送状态无效" };
    }
    if (input.shipmentStatus) item.shipmentStatus = input.shipmentStatus;
    if (input.trackingNo !== undefined) item.trackingNo = input.trackingNo || null;
    item.updatedAt = now();
    refreshBatchCounts(state, item.batchId);
    logActivity(state, "gift", `更新 ${item.nickname} 的寄送状态`);
    save(state);
    return item;
  },
  gift_address_set_status: (a) => {
    const state = load();
    const uid = String(a.uid);
    const status = String(a.addressStatus);
    if (!["none", "pending", "valid", "invalid", "shipped"].includes(status)) throw { code: "E_INVALID_INPUT", message: "地址审核状态无效" };
    const p = state.profiles.find((x) => x.uid === uid);
    if (!p) throw { code: "E_NOT_FOUND", message: "未找到该粉丝档案" };
    p.addressStatus = status as FanProfileDto["addressStatus"];
    state.giftShipments.filter((s) => s.uid === uid).forEach((s) => { s.addressStatus = p.addressStatus; });
    state.giftShipments.forEach((s) => refreshBatchCounts(state, s.batchId));
    save(state);
    return null;
  },
  gift_shipment_reveal_address: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "查看完整地址需要二次确认" };
    const state = load();
    const item = state.giftShipments.find((s) => s.id === Number(a.id));
    if (!item) throw { code: "E_NOT_FOUND", message: "未找到该寄送记录" };
    const addr = state.addresses[item.uid];
    if (!addr) return null;
    return { ...addr, phone: maskPhone(addr.phone) };
  },
  gift_batch_export: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "导出寄送清单需要二次确认" };
    const state = load();
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const path = `${state.settings.backupDir}\\gift-batch-${a.batchId}-masked-${stamp}.csv`;
    return { path, sizeBytes: 2048, masked: true } as ExportResult;
  },

  // ---- F5 主播记账本 ----
  ledger_list: (a) => {
    const q = a as unknown as LedgerQuery;
    return load().ledgerEntries.filter((e) =>
      (!q.entryType || e.entryType === q.entryType)
      && (!q.month || e.occurredAt.startsWith(q.month))
      && (!q.batchId || e.batchId === q.batchId));
  },
  ledger_create: (a) => {
    const input = a as unknown as LedgerInput;
    if (!input.category?.trim()) throw { code: "E_INVALID_INPUT", message: "请填写分类" };
    if (!(Number(input.amountYuan) > 0)) throw { code: "E_INVALID_INPUT", message: "金额需为大于 0 的数字" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredAt ?? "")) throw { code: "E_INVALID_INPUT", message: "日期格式应为 YYYY-MM-DD" };
    const state = load();
    const existing = state.ledgerEntries.some((e) => input.guardEventId != null && e.guardEventId === input.guardEventId);
    if (existing) throw { code: "E_INVALID_INPUT", message: "该航海事件已归集，避免重复计入" };
    const entry: LedgerEntryDto = {
      id: state.nextLedgerId++, entryType: input.entryType, category: input.category.trim(),
      amountYuan: Number(input.amountYuan), occurredAt: input.occurredAt,
      batchId: input.batchId ?? null, guardEventId: input.guardEventId ?? null, note: input.note ?? "",
    };
    state.ledgerEntries.unshift(entry);
    logActivity(state, "ledger", `新增${entry.entryType === "income" ? "收入" : "支出"}「${entry.category}」`);
    save(state);
    return entry;
  },
  ledger_delete: (a) => {
    if (!a.confirm) throw { code: "E_INVALID_INPUT", message: "删除账目需要二次确认" };
    const state = load();
    const idx = state.ledgerEntries.findIndex((e) => e.id === Number(a.id));
    if (idx < 0) throw { code: "E_NOT_FOUND", message: "未找到该账目" };
    state.ledgerEntries.splice(idx, 1);
    logActivity(state, "ledger", "删除一条账目");
    save(state);
    return null;
  },
  ledger_summary: () => ledgerSummary(load()),
  ledger_sync_events: () => {
    const state = load();
    let count = 0;
    state.events.filter((e) => (e.eventType === "purchase" || e.eventType === "renew") && (e.priceYuan ?? 0) > 0
      && !state.ledgerEntries.some((l) => l.guardEventId === e.id)).forEach((e) => {
      state.ledgerEntries.unshift({
        id: state.nextLedgerId++, entryType: "income", category: "大航海",
        amountYuan: e.priceYuan ?? 0, occurredAt: e.eventAt.slice(0, 10),
        batchId: null, guardEventId: e.id, note: `${e.nickname} 的${e.eventType === "renew" ? "续费" : "购买"}事件`,
      });
      count += 1;
    });
    if (count) logActivity(state, "ledger", `自动归集 ${count} 条大航海收入`);
    save(state);
    return ledgerSummary(state);
  },

  // ---- 用户可选启用的 B 站同步（演示模式不发起任何真实请求） ----
  sync_status: () => load().sync,
  sync_set_enabled: (a) => {
    const state = load();
    const enabled = Boolean(a.enabled);
    if (enabled && !a.confirm) throw { code: "E_INVALID_INPUT", message: "启用自动抓取需要确认" };
    state.settings.syncEnabled = enabled;
    state.qr = null;
    if (!enabled) state.sync.lastError = null;
    syncSettings(state);
    logActivity(state, "sync", enabled ? "用户主动启用自动抓取" : "用户关闭自动抓取");
    save(state);
    return state.sync;
  },
  sync_qr_start: () => {
    const state = load();
    if (!state.settings.syncEnabled) throw { code: "E_INVALID_INPUT", message: "自动抓取未启用，请先在设置中主动开启" };
    state.qr = { active: true, polls: 0 };
    state.sync.lastError = null;
    save(state);
    return {
      qrSvg: demoQrSvg("demo-qr-" + Date.now()),
      qrUrl: "https://passport.bilibili.com/qr/demo",
      qrcodeKey: "demo-key", expiresIn: 180,
      message: "演示模式二维码，不会访问 B 站；桌面端将展示真实扫码二维码。",
    } as SyncQrDto;
  },
  sync_qr_poll: () => {
    const state = load();
    if (!state.qr?.active) throw { code: "E_INVALID_INPUT", message: "二维码会话已结束，请重新生成" };
    state.qr.polls += 1;
    const polls = state.qr.polls;
    let result: SyncQrPollDto;
    if (polls < 2) result = { status: "waiting", message: "等待扫码，请用 B 站 App 扫描二维码", uname: null };
    else if (polls < 4) result = { status: "scanned", message: "已扫码，请在手机上点击确认登录", uname: null };
    else {
      state.qr.active = false;
      state.sync.cookieConfigured = true;
      state.sync.uname = "演示账号";
      state.sync.mid = "100000";
      state.sync.loginState = "logged_in";
      state.settings.cookieConfigured = true;
      logActivity(state, "sync", "扫码登录成功，凭证已加密保存到本机");
      result = { status: "success", message: "扫码登录成功，凭证已加密保存在本机", uname: "演示账号" };
    }
    syncSettings(state);
    save(state);
    return result;
  },
  sync_logout: () => {
    const state = load();
    state.sync.cookieConfigured = false;
    state.settings.cookieConfigured = false;
    state.sync.uname = "";
    state.sync.mid = "";
    state.sync.loginState = "not_logged_in";
    state.qr = null;
    syncSettings(state);
    logActivity(state, "sync", "退出 B 站登录并清除本机凭证");
    save(state);
    return state.sync;
  },
  sync_snapshot_now: () => {
    const state = load();
    if (!state.settings.syncEnabled) throw { code: "E_INVALID_INPUT", message: "自动抓取未启用" };
    if (!state.settings.roomId) throw { code: "E_INVALID_INPUT", message: "请先填写直播间房间号" };
    if (!state.sync.cookieConfigured) throw { code: "E_SYNC_COOKIE", message: "尚未扫码登录，请先登录 B 站" };
    const today = new Date().toISOString().slice(0, 10);
    const existing = state.snapshots.find((s) => s.snapshotDate === today);
    if (!existing) state.snapshots.unshift({
      id: Math.max(0, ...state.snapshots.map((s) => s.id)) + 1, snapshotDate: today,
      roomId: state.settings.roomId, fetchedAt: now(), memberCount: state.guardMembers.length, source: "snapshot",
    });
    state.sync.lastSyncAt = now();
    state.sync.lastError = null;
    logActivity(state, "sync", `写入 ${today} 大航海快照：${state.guardMembers.length} 人`);
    save(state);
    return {
      snapshotId: state.snapshots[0].id, snapshotDate: today, memberCount: state.guardMembers.length,
      newCount: 0, mergeCount: state.guardMembers.length, source: "snapshot",
    } as SyncSnapshotResultDto;
  },
};

export function demoInvoke<T>(command: string, args: Record<string, unknown>): T {
  const handler = handlers[command];
  if (!handler) throw { code: "E_INTERNAL", message: `演示模式未实现命令 ${command}` };
  return handler(args) as T;
}
