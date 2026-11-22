import { useState } from "react";
import { X, Eye, LockKeyhole, UnlockKeyhole, History, MapPin, Cake, Pencil, Sparkles } from "lucide-react";
import { Badge, Button, Card, SectionHint } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GuardBadge } from "@/components/GuardBadge";
import { callSafe, ADDRESS_STATUS_TEXT, GUARD_LEVEL_TEXT, formatDateTime } from "@/lib/ipc";
import { zodiacFromBirthday } from "@/lib/zodiac";
import type { AddressDto, FanProfileDto, FieldName } from "@/types/dto";

const LOCKABLE: Array<[FieldName, string]> = [
  ["nickname", "昵称"], ["birthday", "生日"], ["address", "地址"],
  ["first_interaction_at", "首次互动时间"], ["note", "备注"],
];

export function FanDetail({ profile, onClose, onEdit, onChanged }: {
  profile: FanProfileDto;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [confirmAddress, setConfirmAddress] = useState(false);
  const [address, setAddress] = useState<AddressDto | null>(null);
  const zodiac = zodiacFromBirthday(profile.birthdayMasked);
  const badgeLevel = profile.guardLevel ?? profile.lastGuardLevel;
  const levelLabel = profile.guardExpired
    ? "已过期"
    : profile.guardLevel ? GUARD_LEVEL_TEXT[profile.guardLevel] : "未在舰";

  const reveal = async () => {
    const { data, error } = await callSafe<AddressDto | null>("profile_reveal_address", { uid: profile.uid, confirm: true });
    if (error) console.error("读取完整地址失败：", error.message);
    setAddress(data);
  };

  const toggleLock = async (field: FieldName, locked: boolean) => {
    const { error } = await callSafe("profile_set_lock", { uid: profile.uid, field, locked });
    if (error) console.error("字段锁定更新失败：", error.message);
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="glass w-full max-w-[480px] h-full overflow-y-auto p-6 flex flex-col gap-5 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="label-sm">粉丝终身档案</p>
            <h2 className="text-xl font-semibold mt-1">{profile.currentNickname}</h2>
            <p className="text-xs text-muted mt-1 masked-value">UID {profile.uid}</p>
          </div>
          <button onClick={onClose} aria-label="关闭详情" className="text-muted hover:text-ink cursor-pointer"><X size={18} /></button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5">
            <GuardBadge level={badgeLevel} expired={profile.guardExpired} size={24} />
            <Badge tone={profile.guardExpired ? "danger" : "primary"}>{levelLabel}</Badge>
          </span>
          <Badge tone="neutral">星座 · {zodiac ?? "未登记"}</Badge>
          <Badge tone={profile.addressStatus === "valid" ? "success" : "neutral"}>地址 · {ADDRESS_STATUS_TEXT[profile.addressStatus]}</Badge>
          <Badge tone="neutral">来源 · {profile.source === "import" ? "导入" : "手动录入"}</Badge>
        </div>

        <Card title="基础信息" extra={<Button className="px-2.5 py-1.5 text-xs" onClick={onEdit}><Pencil size={13} /> 编辑</Button>}>
          <div className="grid grid-cols-2 gap-y-4 text-sm">
            <Info icon={Cake} label="生日（脱敏）" value={profile.birthdayMasked ?? "未登记"} />
            <Info icon={Sparkles} label="星座" value={zodiac ?? "未登记"} />
            <Info icon={MapPin} label="地址（脱敏）" value={profile.addressMasked ?? "未登记"} />
            <Info label="首次互动" value={profile.firstInteractionAt ?? "未登记"} />
            <Info label="上舰周年" value={profile.guardAnniversaryDate ?? "未登记"} />
            <Info label="观看纪念日" value={profile.watchAnniversaryDate ?? "未登记"} />
            <Info label="排名" value={profile.rank ? `#${profile.rank}` : "—"} />
          </div>
        </Card>

        <Card title="敏感信息">
          <div className="flex flex-col gap-3">
            <SectionHint tone="warning">
              完整地址属于高敏感信息，查看需要二次确认；系统不会向任何外部端点发送地址字段。
            </SectionHint>
            {address ? (
              <div className="glass-soft rounded-xl p-3 text-sm leading-relaxed">
                <p><span className="text-muted">收件人：</span>{address.receiver || "—"} <span className="text-muted ml-3">电话：</span>{address.phone || "—"}</p>
                <p className="mt-1"><span className="text-muted">地址：</span>{[address.province, address.city, address.district, address.detail].filter(Boolean).join(" ") || "—"}</p>
              </div>
            ) : (
              <Button onClick={() => setConfirmAddress(true)}><Eye size={14} /> 查看完整地址（需二次确认）</Button>
            )}
          </div>
        </Card>

        <Card title="曾用名历史" extra={<Badge tone="neutral"><History size={12} /> {profile.nicknameHistory.length} 条</Badge>}>
          <div className="flex flex-col gap-2">
            {profile.nicknameHistory.map((n, i) => (
              <div key={`${n}-${i}`} className="glass-soft rounded-lg px-3 py-2 text-sm flex items-center justify-between">
                <span>{n}</span>
                <span className="text-xs text-muted">{i === profile.nicknameHistory.length - 1 ? "当前昵称" : `历史 ${i + 1}`}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="手动锁定字段" extra={<Badge tone="warning"><LockKeyhole size={12} /> 导入不覆盖</Badge>}>
          <div className="flex flex-col gap-1">
            {LOCKABLE.map(([field, label]) => {
              const locked = profile.manualLockedFields.includes(field);
              return (
                <button
                  key={field}
                  onClick={() => toggleLock(field, !locked)}
                  className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                >
                  <span>{label}</span>
                  <span className={locked ? "text-warning flex items-center gap-1" : "text-muted flex items-center gap-1"}>
                    {locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}{locked ? "已锁定" : "未锁定"}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="备注">
          <p className="text-sm leading-relaxed text-muted">{profile.note || "暂无备注"}</p>
          <p className="text-xs text-muted mt-3">更新时间：{formatDateTime(profile.updatedAt)}</p>
        </Card>
      </aside>

      <ConfirmDialog
        open={confirmAddress}
        title="查看完整地址"
        description="即将展示收件人、电话与完整门牌地址。请确认当前环境安全。"
        detail="此操作不会写入日志，也不会发送到任何外部端点；脱敏视图仍是默认展示方式。"
        confirmText="确认查看"
        requireCheck="我已确认周围无人旁观，且仅用于舰礼寄送核对"
        onClose={() => setConfirmAddress(false)}
        onConfirm={reveal}
      />
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon?: typeof Cake; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-sm flex items-center gap-1">{Icon && <Icon size={12} />}{label}</span>
      <span className="font-medium masked-value">{value}</span>
    </div>
  );
}
