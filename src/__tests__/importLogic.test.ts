import { describe, expect, it } from "vitest";
import {
  buildPreview, buildRows, DEFAULT_MAPPING, earliestInteraction,
  parseDelimited, parseGuardLevel, suggestMapping,
} from "@/lib/importLogic";
import type { FanProfileDto } from "@/types/dto";

const CSV = [
  "uid,nickname,guard_level,rank,first_interaction_at,note",
  "1000009,晚 风,3,9,2025-06-22,含空格",
  "1000013,大幕丶渐起,3,13,2025-10-11,顿号变体",
  '1000001,limmax,2,1,2024-01-08,"含,逗号的备注"',
  ",缺 UID,3,16,2026-01-01,应跳过",
].join("\n");

function profile(uid: string, locked: FanProfileDto["manualLockedFields"] = []): FanProfileDto {
  return {
    uid, currentNickname: "原名", nicknameHistory: ["原名"],
    firstInteractionAt: "2024-01-08", birthdayMasked: null, addressMasked: null,
    addressStatus: "none", guardAnniversaryDate: null, watchAnniversaryDate: null,
    note: "", manualLockedFields: locked, guardLevel: 3, rank: 1,
    source: "manual", createdAt: "2024-01-08", updatedAt: "2026-01-01",
  };
}

describe("CSV 解析", () => {
  it("保留昵称中的空格、生僻字与顿号变体", () => {
    const { headers, records } = parseDelimited(CSV);
    expect(headers[0]).toBe("uid");
    expect(records[0][1]).toBe("晚 风");
    expect(records[1][1]).toBe("大幕丶渐起");
    expect(records[2][5]).toBe("含,逗号的备注");
  });

  it("支持 UTF-8 BOM 与制表符分隔", () => {
    const { headers, records } = parseDelimited("\uFEFFuid\tnickname\n1001\t晚 风\n");
    expect(headers).toEqual(["uid", "nickname"]);
    expect(records[0][1]).toBe("晚 风");
  });
});

describe("字段映射与等级", () => {
  it("按中文表头推荐映射", () => {
    const m = suggestMapping(["UID", "昵称", "等级", "排名", "生日"]);
    expect(m.uid).toBe("UID");
    expect(m.nickname).toBe("昵称");
    expect(m.guardLevel).toBe("等级");
    expect(m.rank).toBe("排名");
  });

  it("等级 1/2/3 与中文角色映射正确", () => {
    expect(parseGuardLevel("总督")).toBe(1);
    expect(parseGuardLevel("提督")).toBe(2);
    expect(parseGuardLevel("舰长")).toBe(3);
    expect(parseGuardLevel("3")).toBe(3);
    expect(parseGuardLevel("未知")).toBeNull();
  });
});

describe("导入预览与合并状态机", () => {
  it("分类新增 / 合并 / 冲突 / 跳过", () => {
    const existing = [profile("1000009", ["nickname"]), profile("1000001")];
    const p = buildPreview(CSV, DEFAULT_MAPPING, existing);
    expect(p.totalRows).toBe(4);
    expect(p.newCount).toBe(1);
    expect(p.mergeCount).toBe(1);
    expect(p.conflictCount).toBe(1);
    expect(p.invalidCount).toBe(1);
    expect(p.conflicts.some((c) => c.field === "nickname" && c.uid === "1000009")).toBe(true);
  });

  it("预览限量展示但 totalRows 仍为全量", () => {
    const many = ["uid,nickname,guard_level", ...Array.from({ length: 130 }, (_, i) => `u${i},粉丝${i},3`)].join("\n");
    const p = buildPreview(many, DEFAULT_MAPPING, [], 100);
    expect(p.totalRows).toBe(130);
    expect(p.rows.length).toBe(100);
    expect(p.truncated).toBe(true);
  });

  it("同 UID 保留最早首次互动时间", () => {
    expect(earliestInteraction("2024-01-08", "2025-06-01")).toBe("2024-01-08");
    expect(earliestInteraction("2025-06-01", "2024-01-08")).toBe("2024-01-08");
    expect(earliestInteraction(null, "")).toBeNull();
    expect(earliestInteraction(null, "2026-01-01")).toBe("2026-01-01");
  });

  it("构建行时不把纯数字昵称当作 UID", () => {
    const { rows } = buildRows(CSV, DEFAULT_MAPPING);
    expect(rows[2].uid).toBe("1000001");
    const { rows: nameOnly } = buildRows("nickname\n54736424\n", { ...DEFAULT_MAPPING, uid: "", nickname: "nickname" });
    expect(nameOnly[0].uid).toBe("");
    expect(nameOnly[0].nickname).toBe("54736424");
  });
});
