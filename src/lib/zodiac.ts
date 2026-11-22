// 由脱敏生日推算星座。生日在界面上只以 MM-DD（或开启年份时 YYYY-MM-DD）出现，
// 星座不会额外泄露任何敏感信息；未登记生日时返回 null。

const BOUNDARIES: Array<[number, string]> = [
  [120, "水瓶座"],
  [219, "双鱼座"],
  [321, "白羊座"],
  [420, "金牛座"],
  [521, "双子座"],
  [622, "巨蟹座"],
  [723, "狮子座"],
  [823, "处女座"],
  [923, "天秤座"],
  [1024, "天蝎座"],
  [1123, "射手座"],
  [1222, "摩羯座"],
];

export function zodiacFromBirthday(masked: string | null | undefined): string | null {
  if (!masked) return null;
  const nums = masked.match(/\d+/g)?.map(Number);
  if (!nums || nums.length < 2) return null;
  const [month, day] = nums.length >= 3 ? [nums[1], nums[2]] : [nums[0], nums[1]];
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const md = month * 100 + day;
  if (md >= 1222 || md <= 119) return "摩羯座";
  for (let i = BOUNDARIES.length - 1; i >= 0; i -= 1) {
    if (md >= BOUNDARIES[i][0]) return BOUNDARIES[i][1];
  }
  return null;
}
