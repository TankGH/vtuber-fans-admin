import governor from "@/assets/badges/governor.png";
import admiral from "@/assets/badges/admiral.png";
import captain from "@/assets/badges/captain.png";
import { GUARD_LEVEL_TEXT } from "@/lib/ipc";
import type { GuardLevel } from "@/types/dto";

// 1 = 总督，2 = 提督，3 = 舰长；图片随前端资源一起打包进 exe，不依赖外部服务。
const BADGE_SRC: Record<GuardLevel, string> = {
  1: governor,
  2: admiral,
  3: captain,
};

export function GuardBadge({ level, expired = false, size = 24 }: {
  level: GuardLevel | null | undefined;
  expired?: boolean;
  size?: number;
}) {
  const src = level ? BADGE_SRC[level as GuardLevel] : undefined;
  if (!src || !level) return null;
  const label = GUARD_LEVEL_TEXT[level] ?? "大航海";
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={expired ? `${label}（已过期）` : label}
      title={expired ? `${label} · 已过期` : label}
      className="inline-block shrink-0 object-contain align-middle"
      style={{ filter: expired ? "grayscale(1)" : undefined, opacity: expired ? 0.55 : 1 }}
    />
  );
}
