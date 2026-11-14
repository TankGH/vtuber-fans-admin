import { describe, expect, it } from "vitest";
import { zodiacFromBirthday } from "@/lib/zodiac";

describe("星座推算", () => {
  it("覆盖 12 星座分界与跨年的摩羯座", () => {
    const cases: Array<[string, string]> = [
      ["01-19", "摩羯座"], ["01-20", "水瓶座"],
      ["02-18", "水瓶座"], ["02-19", "双鱼座"],
      ["03-20", "双鱼座"], ["03-21", "白羊座"],
      ["04-19", "白羊座"], ["04-20", "金牛座"],
      ["05-20", "金牛座"], ["05-21", "双子座"],
      ["06-21", "双子座"], ["06-22", "巨蟹座"],
      ["07-22", "巨蟹座"], ["07-23", "狮子座"],
      ["08-22", "狮子座"], ["08-23", "处女座"],
      ["09-22", "处女座"], ["09-23", "天秤座"],
      ["10-23", "天秤座"], ["10-24", "天蝎座"],
      ["11-22", "天蝎座"], ["11-23", "射手座"],
      ["12-21", "射手座"], ["12-22", "摩羯座"], ["12-31", "摩羯座"],
    ];
    for (const [date, expected] of cases) {
      expect(zodiacFromBirthday(date), date).toBe(expected);
    }
  });

  it("兼容带年份的生日，并对未登记 / 非法日期返回 null", () => {
    expect(zodiacFromBirthday("1998-11-15")).toBe("天蝎座");
    expect(zodiacFromBirthday("11-15")).toBe("天蝎座");
    expect(zodiacFromBirthday(null)).toBeNull();
    expect(zodiacFromBirthday(undefined)).toBeNull();
    expect(zodiacFromBirthday("—")).toBeNull();
    expect(zodiacFromBirthday("13-01")).toBeNull();
    expect(zodiacFromBirthday("02-40")).toBeNull();
  });
});
