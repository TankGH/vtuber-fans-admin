import type {
  FanProfileDto,
  FieldConflict,
  FieldName,
  GuardLevel,
  ImportMapping,
  ImportPreview,
  ImportRowDto,
} from "@/types/dto";

export const DEFAULT_MAPPING: ImportMapping = {
  uid: "uid",
  nickname: "nickname",
  guardLevel: "guard_level",
  rank: "rank",
  firstInteractionAt: "first_interaction_at",
  birthday: "birthday",
  address: "address",
  note: "note",
  unitMonths: "unit_months",
  priceYuan: "price_yuan",
  eventType: "event_type",
  eventAt: "event_at",
};

const HEADER_ALIASES: Record<keyof ImportMapping, string[]> = {
  uid: ["uid", "UID", "用户ID", "粉丝UID"],
  nickname: ["nickname", "昵称", "粉丝名", "当前昵称", "uname"],
  guardLevel: ["guard_level", "等级", "舰长等级", "角色", "role", "guardLevel"],
  rank: ["rank", "排名", "rank_no"],
  firstInteractionAt: ["first_interaction_at", "首次互动时间", "首次互动"],
  birthday: ["birthday", "生日"],
  address: ["address", "地址", "收货地址"],
  note: ["note", "备注", "说明"],
  unitMonths: ["unit_months", "月数", "购买月数", "guard_unit"],
  priceYuan: ["price_yuan", "金额", "价格", "price"],
  eventType: ["event_type", "事件类型", "购买类型", "类型", "order_type"],
  eventAt: ["event_at", "购买日期", "购买时间", "事件时间", "下单时间"],
};

export function suggestMapping(headers: string[]): ImportMapping {
  const result = { ...DEFAULT_MAPPING };
  (Object.keys(HEADER_ALIASES) as Array<keyof ImportMapping>).forEach((key) => {
    const hit = headers.find((h) => HEADER_ALIASES[key].some((a) => a.toLowerCase() === h.toLowerCase()));
    result[key] = hit ?? "";
  });
  return result;
}

// 支持带引号字段与逗号转义；昵称不做 trim / 去空格 / 标点归一化
export function parseDelimited(text: string): { headers: string[]; records: string[][] } {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.length > 0)) rows.push(row);
  const headers = rows.shift()?.map((h) => h.replace(/^\uFEFF/, "")) ?? [];
  return { headers, records: rows };
}

export function parseGuardLevel(raw: string): GuardLevel | null {
  const v = raw.trim();
  if (["1", "总督", "governor"].includes(v)) return 1;
  if (["2", "提督", "admiral"].includes(v)) return 2;
  if (["3", "舰长", "captain"].includes(v)) return 3;
  return null;
}

export function getCell(record: string[], headers: string[], column: string): string {
  if (!column) return "";
  const idx = headers.findIndex((h) => h.toLowerCase() === column.toLowerCase());
  return idx >= 0 ? (record[idx] ?? "") : "";
}

export interface ParsedImportRow {
  row: number;
  uid: string;
  nickname: string;
  guardLevel: GuardLevel | null;
  rank: number | null;
  firstInteractionAt: string;
  birthday: string;
  address: string;
  note: string;
}

export function buildRows(text: string, mapping: ImportMapping): { headers: string[]; rows: ParsedImportRow[] } {
  const { headers, records } = parseDelimited(text);
  return {
    headers,
    rows: records.map((rec, i) => ({
      row: i + 2,
      uid: getCell(rec, headers, mapping.uid),
      nickname: getCell(rec, headers, mapping.nickname),
      guardLevel: parseGuardLevel(getCell(rec, headers, mapping.guardLevel)),
      rank: Number.parseInt(getCell(rec, headers, mapping.rank), 10) || null,
      firstInteractionAt: getCell(rec, headers, mapping.firstInteractionAt),
      birthday: getCell(rec, headers, mapping.birthday),
      address: getCell(rec, headers, mapping.address),
      note: getCell(rec, headers, mapping.note),
    })),
  };
}

const LOCK_CHECK: Array<[keyof ParsedImportRow, FieldName]> = [
  ["nickname", "nickname"],
  ["birthday", "birthday"],
  ["address", "address"],
  ["firstInteractionAt", "first_interaction_at"],
  ["note", "note"],
];

/** 合并状态机：手动锁定字段是唯一裁决依据；同 UID 保留最早首次互动时间 */
export function buildPreview(
  text: string,
  mapping: ImportMapping,
  existing: FanProfileDto[],
  limit = 100,
): ImportPreview {
  const { headers, rows } = buildRows(text, mapping);
  const byUid = new Map(existing.map((p) => [p.uid, p]));
  const conflicts: FieldConflict[] = [];
  const previewRows: ImportRowDto[] = rows.map((r) => {
    if (!r.uid || !r.nickname) {
      return { row: r.row, uid: r.uid, nickname: r.nickname, action: "invalid", reason: "缺少 UID 或昵称，已跳过", guardLevel: r.guardLevel };
    }
    const profile = byUid.get(r.uid);
    if (!profile) {
      return { row: r.row, uid: r.uid, nickname: r.nickname, action: "new", reason: "新建档案并写入昵称历史", guardLevel: r.guardLevel };
    }
    let conflict = false;
    LOCK_CHECK.forEach(([key, field]) => {
      const incoming = String(r[key] ?? "");
      if (incoming && profile.manualLockedFields.includes(field)) {
        conflicts.push({ row: r.row, uid: r.uid, field, reason: `字段「${field}」已被手动锁定，导入值不会覆盖` });
        conflict = true;
      }
    });
    if (!r.guardLevel) {
      conflicts.push({ row: r.row, uid: r.uid, field: "guard_level", reason: "大航海等级无法识别，该行将跳过等级更新" });
    }
    return {
      row: r.row,
      uid: r.uid,
      nickname: r.nickname,
      action: conflict ? "conflict" : "merge",
      reason: conflict ? "存在锁定字段冲突，仅合并未锁定字段" : "合并档案，保留最早首次互动时间",
      guardLevel: r.guardLevel,
    };
  });
  return {
    totalRows: rows.length,
    newCount: previewRows.filter((r) => r.action === "new").length,
    mergeCount: previewRows.filter((r) => r.action === "merge").length,
    conflictCount: previewRows.filter((r) => r.action === "conflict").length,
    invalidCount: previewRows.filter((r) => r.action === "invalid").length,
    headers,
    suggestedMapping: mapping,
    conflicts,
    rows: previewRows.slice(0, limit),
    truncated: previewRows.length > limit,
  };
}

/** 同 UID 合并取最早的非空首次互动时间 */
export function earliestInteraction(prev: string | null, incoming: string): string | null {
  if (!prev) return incoming || null;
  if (!incoming) return prev;
  return incoming < prev ? incoming : prev;
}
