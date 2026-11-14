import type {
  ActivityDto,
  BackupDto,
  FanProfileDto,
  GiftBatchDto,
  GiftShipmentDto,
  GuardEventDto,
  GuardMemberDto,
  LedgerEntryDto,
  ReminderDto,
  SettingsDto,
  SnapshotDto,
  SyncStatusDto,
} from "@/types/dto";

// 演示数据基于 ../notes/fans.md 的舰队名册，昵称原样保留（含空格与「丶」）
export const ROSTER: Array<[string, string, 1 | 2 | 3, number]> = [
  ["1000001", "limmax", 2, 1],
  ["1000002", "54736424", 3, 2],
  ["1000003", "小白豆浆配油条", 3, 3],
  ["1000004", "老头", 3, 4],
  ["1000005", "廾匸", 3, 5],
  ["1000006", "沐星韫", 3, 6],
  ["1000007", "姐夫", 3, 7],
  ["1000008", "饼饼饼饼", 3, 8],
  ["1000009", "晚 风", 3, 9],
  ["1000010", "Tank", 3, 10],
  ["1000011", "柚子大姐姐", 3, 11],
  ["1000012", "水电工程", 3, 12],
  ["1000013", "大幕丶渐起", 3, 13],
];

const BIRTHDAYS: Record<string, [number, number]> = {
  "1000001": [11, 15],
  "1000003": [11, 14],
  "1000009": [11, 16],
  "1000011": [3, 8],
  "1000013": [12, 2],
};

const ADDRESSES: Record<string, [string, string, string]> = {
  "1000001": ["上海市", "上海市", "浦东新区"],
  "1000003": ["广东省", "深圳市", "南山区"],
  "1000006": ["浙江省", "杭州市", "西湖区"],
  "1000009": ["北京市", "北京市", "海淀区"],
  "1000013": ["四川省", "成都市", "武侯区"],
};

export function seedProfiles(): FanProfileDto[] {
  return ROSTER.map(([uid, nickname, guardLevel, rank], i) => {
    const birth = BIRTHDAYS[uid];
    const addr = ADDRESSES[uid];
    // 「大幕丶渐起」在演示名册里是疑似到期成员，用于展示过期舰长的灰化徽章
    const expired = uid === "1000013";
    return {
      uid,
      currentNickname: nickname,
      nicknameHistory:
        uid === "1000009"
          ? ["晚风", "晚 风"]
          : uid === "1000013"
            ? ["大幕渐起", "大幕丶渐起"]
            : [nickname],
      firstInteractionAt: `2025-${String((i % 12) + 1).padStart(2, "0")}-08`,
      birthdayMasked: birth ? `${String(birth[0]).padStart(2, "0")}-${String(birth[1]).padStart(2, "0")}` : null,
      addressMasked: addr ? addr.join(" · ") : null,
      addressStatus: addr ? (i % 4 === 0 ? "pending" : "valid") : "none",
      guardAnniversaryDate: `2025-${String((i % 12) + 1).padStart(2, "0")}-12`,
      watchAnniversaryDate: i % 3 === 0 ? `2024-${String((i % 12) + 1).padStart(2, "0")}-20` : null,
      note: uid === "1000009" ? "昵称含空格，导入时须原样保留" : "",
      manualLockedFields: uid === "1000001" ? (["nickname", "birthday"] as FanProfileDto["manualLockedFields"]) : [],
      guardLevel: expired ? null : guardLevel,
      rank: expired ? null : rank,
      lastGuardLevel: guardLevel,
      guardExpired: expired,
      source: "import",
      createdAt: "2025-01-08T10:20:00+08:00",
      updatedAt: "2026-11-12T09:30:00+08:00",
    };
  });
}

export const DEFAULT_SETTINGS: SettingsDto = {
  theme: "galaxy",
  backupDir: "C:\\Users\\c\\Documents\\vtuber-fans-admin-backups",
  minimizeToTray: true,
  launchAtStartup: false,
  birthdayYearHidden: true,
  snapshotHour: 4,
  websocketEnabled: false,
  cookieConfigured: false,
  dataDir: "%APPDATA%\\com.vtuber.fans.admin",
  onboardingDone: true,
  syncEnabled: false,
  roomId: "21452505",
  reminderDaysAhead: 3,
};

export function seedGuardMembers(): GuardMemberDto[] {
  return ROSTER.map(([uid, nickname, guardLevel, rank], i) => ({
    uid,
    nickname,
    guardLevel,
    rank,
    validUntil: i === 12 ? null : `2026-${String((i % 12) + 1).padStart(2, "0")}-28`,
    status: i === 12 ? "expire_suspected" : "active",
    snapshotDate: "2026-11-12",
  }));
}

export function seedSnapshots(): SnapshotDto[] {
  return [
    { id: 3, snapshotDate: "2026-11-12", roomId: "21452505", fetchedAt: "2026-11-12T04:00:12+08:00", memberCount: 13, source: "import" },
    { id: 2, snapshotDate: "2026-11-11", roomId: "21452505", fetchedAt: "2026-11-11T04:00:08+08:00", memberCount: 12, source: "import" },
    { id: 1, snapshotDate: "2026-11-10", roomId: "21452505", fetchedAt: "2026-11-10T04:00:05+08:00", memberCount: 12, source: "import" },
  ];
}

export function seedEvents(): GuardEventDto[] {
  return [
    { id: 4, uid: "1000001", nickname: "limmax", eventType: "renew", guardLevel: 2, unitMonths: 3, priceYuan: 1998, eventAt: "2026-11-12T21:08:00+08:00", source: "import" },
    { id: 3, uid: "1000009", nickname: "晚 风", eventType: "purchase", guardLevel: 3, unitMonths: 1, priceYuan: 198, eventAt: "2026-11-11T20:14:00+08:00", source: "import" },
    { id: 2, uid: "1000013", nickname: "大幕丶渐起", eventType: "expire_suspected", guardLevel: 3, unitMonths: null, priceYuan: null, eventAt: "2026-11-12T04:00:12+08:00", source: "import" },
    { id: 1, uid: "1000003", nickname: "小白豆浆配油条", eventType: "purchase", guardLevel: 3, unitMonths: 1, priceYuan: 198, eventAt: "2026-11-10T19:42:00+08:00", source: "import" },
  ];
}

export function seedBackups(): BackupDto[] {
  return [
    { id: "20261113-080000", fileName: "backup-20261113-080000.enc", createdAt: "2026-11-13T08:00:00+08:00", sizeBytes: 184320, fanCount: 13, snapshotCount: 3, eventCount: 4, sha256: "7d1f8a9c44e2b013", verified: true },
    { id: "20261112-080000", fileName: "backup-20261112-080000.enc", createdAt: "2026-11-12T08:00:00+08:00", sizeBytes: 181248, fanCount: 13, snapshotCount: 2, eventCount: 3, sha256: "2ba0e13f7c9d5a80", verified: true },
    { id: "20261111-080000", fileName: "backup-20261111-080000.enc", createdAt: "2026-11-11T08:00:00+08:00", sizeBytes: 178176, fanCount: 12, snapshotCount: 1, eventCount: 2, sha256: "91c4d7e02b6f35a8", verified: true },
  ];
}

export function seedActivities(): ActivityDto[] {
  return [
    { id: 6, kind: "backup", summary: "启动自动备份完成，保留最近 7 份", createdAt: "2026-11-13T08:00:00+08:00" },
    { id: 5, kind: "import", summary: "导入 fans_20261112.csv：新增 1、合并 12", createdAt: "2026-11-12T18:22:00+08:00" },
    { id: 4, kind: "profile", summary: "手动锁定 limmax 的昵称与生日字段", createdAt: "2026-11-12T14:05:00+08:00" },
    { id: 3, kind: "theme", summary: "主题切换为守村人深蓝", createdAt: "2026-11-11T09:31:00+08:00" },
    { id: 2, kind: "restore", summary: "从 2026-11-10 备份恢复前自动创建安全备份", createdAt: "2026-11-11T09:12:00+08:00" },
    { id: 1, kind: "profile", summary: "建立首批 13 位舰队成员档案", createdAt: "2026-11-10T10:20:00+08:00" },
  ];
}

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function seedReminders(): ReminderDto[] {
  const items: Array<[string, string, ReminderDto["reminderType"], string, number, boolean]> = [
    ["1000001", "limmax", "birthday", "生日", 0, false],
    ["1000003", "小白豆浆配油条", "guard_anniversary", "上舰周年", 0, true],
    ["1000009", "晚 风", "watch_anniversary", "观看纪念日", 1, false],
    ["1000011", "柚子大姐姐", "birthday", "生日", 2, false],
    ["1000013", "大幕丶渐起", "guard_anniversary", "上舰周年", 3, false],
  ];
  return items.map(([uid, nickname, reminderType, reminderLabel, daysAhead, acked]) => ({
    uid, nickname, reminderType, reminderLabel,
    reminderDate: dateOffset(daysAhead), daysAhead, acked,
    ackedAt: acked ? new Date().toISOString() : null,
    greeting: `${nickname}，${reminderLabel}快乐！感谢一路相伴。`,
  }));
}

export function seedGiftBatches(): GiftBatchDto[] {
  return [
    { id: 2, name: "2026 年 11 月舰礼", createdAt: "2026-11-12T10:00:00+08:00", status: "open", memberCount: 5, shippedCount: 2, pendingCount: 3, addressReadyCount: 4 },
    { id: 1, name: "2026 年 10 月舰礼", createdAt: "2026-10-08T10:00:00+08:00", status: "open", memberCount: 4, shippedCount: 4, pendingCount: 0, addressReadyCount: 4 },
  ];
}

export function seedGiftShipments(): GiftShipmentDto[] {
  const rows: Array<[number, number, string, string, 1 | 2 | 3, GiftShipmentDto["addressStatus"], string | null, GiftShipmentDto["shipmentStatus"], string | null]> = [
    [1, 2, "1000001", "limmax", 2, "shipped", "上海市 · 上海市 · 浦东新区", "shipped", "SF1234567890"],
    [2, 2, "1000003", "小白豆浆配油条", 3, "shipped", "广东省 · 深圳市 · 南山区", "shipped", "YT9876543210"],
    [3, 2, "1000006", "沐星韫", 3, "valid", "浙江省 · 杭州市 · 西湖区", "pending", null],
    [4, 2, "1000009", "晚 风", 3, "pending", "北京市 · 北京市 · 海淀区", "address_missing", null],
    [5, 2, "1000002", "54736424", 3, "none", null, "address_missing", null],
    [6, 1, "1000010", "Tank", 3, "shipped", null, "shipped", "SF0000000001"],
  ];
  return rows.map(([id, batchId, uid, nickname, guardLevel, addressStatus, addressMasked, shipmentStatus, trackingNo]) => ({
    id, batchId, uid, nickname, guardLevel, addressStatus, addressMasked, shipmentStatus, trackingNo,
    updatedAt: "2026-11-13T09:30:00+08:00",
  }));
}

export function seedLedgerEntries(): LedgerEntryDto[] {
  return [
    { id: 4, entryType: "income", category: "大航海", amountYuan: 1998, occurredAt: "2026-11-12", batchId: null, guardEventId: 4, note: "limmax 的续费事件" },
    { id: 3, entryType: "expense", category: "快递费", amountYuan: 68, occurredAt: "2026-11-13", batchId: 2, guardEventId: null, note: "11 月舰礼寄送" },
    { id: 2, entryType: "expense", category: "舰礼采购", amountYuan: 860.5, occurredAt: "2026-11-10", batchId: 2, guardEventId: null, note: "定制徽章与明信片" },
    { id: 1, entryType: "income", category: "大航海", amountYuan: 198, occurredAt: "2026-11-11", batchId: null, guardEventId: 3, note: "晚 风 的购买事件" },
  ];
}

export function seedSyncStatus(): SyncStatusDto {
  return {
    enabled: false,
    loginState: "disabled",
    cookieConfigured: false,
    mid: "",
    uname: "",
    roomId: DEFAULT_SETTINGS.roomId,
    snapshotHour: DEFAULT_SETTINGS.snapshotHour,
    lastSyncAt: null,
    lastError: null,
    message: "自动抓取已关闭，不会发起任何外部请求；名单可通过 CSV / Excel 手动导入。",
  };
}

export const SAMPLE_CSV = [
  "uid,nickname,guard_level,rank,first_interaction_at,birthday,address,note",
  "1000014,晚 风,3,14,2026-11-01,05-20,浙江省·杭州市·余杭区,昵称含空格",
  "1000015,大幕丶渐起,3,15,2026-11-02,12-02,广东省·广州市·天河区,顿号变体勿误判",
  '1000001,limmax,2,1,2024-01-08,11-15,上海市·上海市·浦东新区,"手动锁定字段示例"',
  ",无名粉丝,3,16,2026-11-03,,,缺少 UID 应跳过",
].join("\n");
