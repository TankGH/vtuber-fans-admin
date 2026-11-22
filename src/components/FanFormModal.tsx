import { useEffect, useState } from "react";
import { EyeOff, LockKeyhole, Save } from "lucide-react";
import { Button, Field, Modal, SectionHint, SelectField } from "@/components/ui";
import { ADDRESS_STATUS_TEXT } from "@/lib/ipc";
import type { AddressStatus, FanProfileDto, FanProfileInput } from "@/types/dto";

const EMPTY = {
  uid: "", currentNickname: "", firstInteractionAt: "", note: "",
  guardAnniversaryDate: "", watchAnniversaryDate: "", addressStatus: "none" as AddressStatus,
  birthMonth: "", birthDay: "", receiver: "", phone: "", province: "", city: "", district: "", detail: "",
};

type FormState = typeof EMPTY;

function fromProfile(p: FanProfileDto): FormState {
  const [m, d] = (p.birthdayMasked ?? "-").split("-");
  const parts = (p.addressMasked ?? "").split(" · ");
  return {
    uid: p.uid, currentNickname: p.currentNickname,
    firstInteractionAt: p.firstInteractionAt ?? "", note: p.note,
    guardAnniversaryDate: p.guardAnniversaryDate ?? "", watchAnniversaryDate: p.watchAnniversaryDate ?? "",
    addressStatus: p.addressStatus, birthMonth: m === "-" ? "" : String(Number(m)), birthDay: d ? String(Number(d)) : "",
    receiver: "", phone: "", province: parts[0] ?? "", city: parts[1] ?? "", district: parts[2] ?? "", detail: "",
  };
}

export function FanFormModal({ open, profile, onClose, onSubmit }: {
  open: boolean;
  profile: FanProfileDto | null;
  onClose: () => void;
  onSubmit: (input: FanProfileInput) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sensitiveOpen, setSensitiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(profile ? fromProfile(profile) : EMPTY);
    setSensitiveOpen(false);
    setError(null);
  }, [profile, open]);

  const set = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.uid.trim() || !form.currentNickname.trim()) {
      setError("UID 与当前昵称为必填项");
      return;
    }
    const hasBirth = form.birthMonth && form.birthDay;
    const hasAddress = form.receiver || form.phone || form.detail;
    const input: FanProfileInput = {
      uid: form.uid, currentNickname: form.currentNickname,
      firstInteractionAt: form.firstInteractionAt || null,
      guardAnniversaryDate: form.guardAnniversaryDate || null,
      watchAnniversaryDate: form.watchAnniversaryDate || null,
      note: form.note,
      addressStatus: form.addressStatus as AddressStatus,
      birthday: hasBirth ? { month: Number(form.birthMonth), day: Number(form.birthDay), year: null } : undefined,
      address: hasAddress ? {
        receiver: form.receiver, phone: form.phone, province: form.province,
        city: form.city, district: form.district, detail: form.detail,
      } : undefined,
      manualLockedFields: profile?.manualLockedFields ?? [],
    };
    setBusy(true);
    await onSubmit(input).catch((err: unknown) => { setError(String(err)); });
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={profile ? `编辑档案 · ${profile.currentNickname}` : "新建粉丝档案"}
      width="max-w-2xl"
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={busy} onClick={submit}><Save size={14} /> {busy ? "保存中…" : "保存档案"}</Button></>}
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="label-sm mb-3">基础信息</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="B 站 UID（唯一标识）" placeholder="例如 1000014" disabled={Boolean(profile)} value={form.uid} onChange={(e) => set("uid", e.target.value)} />
            <Field label="当前昵称" placeholder="原样填写，空格与生僻字会保留" value={form.currentNickname} onChange={(e) => set("currentNickname", e.target.value)} />
            <Field label="首次互动时间" type="date" value={form.firstInteractionAt.slice(0, 10)} onChange={(e) => set("firstInteractionAt", e.target.value)} />
            <Field label="上舰周年日" type="date" value={form.guardAnniversaryDate} onChange={(e) => set("guardAnniversaryDate", e.target.value)} />
            <Field label="观看纪念日" type="date" value={form.watchAnniversaryDate} onChange={(e) => set("watchAnniversaryDate", e.target.value)} />
            <SelectField label="地址审核状态" value={form.addressStatus} onChange={(e) => set("addressStatus", e.target.value)}>
              {(Object.keys(ADDRESS_STATUS_TEXT) as AddressStatus[]).map((k) => <option key={k} value={k}>{ADDRESS_STATUS_TEXT[k]}</option>)}
            </SelectField>
          </div>
        </div>

        <div>
          <button
            onClick={() => setSensitiveOpen(!sensitiveOpen)}
            className="flex items-center gap-2 text-sm font-medium cursor-pointer hover:text-accent transition-colors"
          >
            <EyeOff size={15} /> 敏感信息（加密存储）{sensitiveOpen ? "· 已展开" : "· 点击展开"}
          </button>
          {sensitiveOpen && (
            <div className="mt-3 flex flex-col gap-3 fade-in">
              <SectionHint tone="warning">
                <LockKeyhole size={12} className="inline mr-1" />
                生日与地址以 AES-256-GCM 密文落盘，界面默认只显示「月日」与「省 · 市 · 区」。编辑时留空表示不修改已有值。
              </SectionHint>
              <div className="grid grid-cols-2 gap-3">
                <Field label="生日 · 月" type="number" min="1" max="12" placeholder="1–12" value={form.birthMonth} onChange={(e) => set("birthMonth", e.target.value)} />
                <Field label="生日 · 日" type="number" min="1" max="31" placeholder="1–31" value={form.birthDay} onChange={(e) => set("birthDay", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Field label="收件人" value={form.receiver} onChange={(e) => set("receiver", e.target.value)} />
                <Field label="联系电话" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                <Field label="省" value={form.province} onChange={(e) => set("province", e.target.value)} />
                <Field label="市" value={form.city} onChange={(e) => set("city", e.target.value)} />
                <Field label="区 / 县" value={form.district} onChange={(e) => set("district", e.target.value)} />
              </div>
              <Field label="详细地址" placeholder="门牌号等完整信息（加密存储）" value={form.detail} onChange={(e) => set("detail", e.target.value)} />
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="label-sm">备注</span>
          <textarea
            className="field min-h-[72px] resize-y"
            placeholder="记录粉丝偏好、舰礼沟通情况或导入注意事项"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </label>

        {profile && profile.manualLockedFields.length > 0 && (
          <SectionHint tone="warning">
            已手动锁定字段：{profile.manualLockedFields.join("、")}。导入与后续同步都不会覆盖这些字段。
          </SectionHint>
        )}
        {error && <SectionHint tone="danger">{error}</SectionHint>}
      </div>
    </Modal>
  );
}
