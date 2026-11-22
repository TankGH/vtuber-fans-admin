import { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button, Modal, SectionHint } from "@/components/ui";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmText?: string;
  danger?: boolean;
  requireCheck?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/** 危险操作统一二次确认；requireCheck 存在时必须勾选才能确认 */
export function ConfirmDialog({
  open, title, description, detail, confirmText = "确认执行", danger = true,
  requireCheck, onClose, onConfirm,
}: ConfirmDialogProps) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = Boolean(requireCheck) && !checked;

  const close = () => {
    setChecked(false);
    setBusy(false);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    await Promise.resolve(onConfirm());
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button onClick={close}>取消</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={blocked || busy} onClick={confirm}>
            {busy ? "处理中…" : confirmText}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className={danger ? "text-danger" : "text-accent"}>
          {danger ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
        </div>
        <div className="flex flex-col gap-3 flex-1">
          <p className="text-sm leading-relaxed">{description}</p>
          {detail && <SectionHint tone={danger ? "danger" : "neutral"}>{detail}</SectionHint>}
          {requireCheck && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-1 h-4 w-4 cursor-pointer accent-[var(--primary)]"
              />
              <span>{requireCheck}</span>
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}
