import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, QrCode, LogOut, RefreshCw, ShieldCheck, Save, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge, Button, Card, Field, Modal, SectionHint, Switch } from "@/components/ui";
import { callSafe, LOGIN_STATE_TEXT, formatDateTime } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import type { SyncQrDto, SyncQrPollDto, SyncSnapshotResultDto, SyncStatusDto } from "@/types/dto";

const POLL_TEXT: Record<string, string> = {
  waiting: "等待扫码…", scanned: "已扫码，请在手机上确认", expired: "二维码已过期，请重新生成",
  success: "登录成功", error: "扫码状态异常",
};

export default function SyncPanel() {
  const { notify, refresh, bootstrap } = useApp();
  const [status, setStatus] = useState<SyncStatusDto | null>(bootstrap?.syncStatus ?? null);
  const [roomId, setRoomId] = useState(bootstrap?.settings.roomId ?? "");
  const [hour, setHour] = useState(String(bootstrap?.settings.snapshotHour ?? 4));
  const [enableConfirm, setEnableConfirm] = useState(false);
  const [qr, setQr] = useState<SyncQrDto | null>(null);
  const [qrState, setQrState] = useState<SyncQrPollDto | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const timerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);
  useEffect(() => {
    callSafe<SyncStatusDto>("sync_status").then(({ data }) => { if (data) setStatus(data); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (bootstrap?.syncStatus) setStatus(bootstrap.syncStatus);
  }, [bootstrap?.syncStatus]);

  const publish = async (next: SyncStatusDto | null | undefined, message?: string) => {
    if (next) setStatus(next);
    if (message) notify({ tone: "info", title: message });
    await refresh();
  };

  const applyEnabled = async (enabled: boolean) => {
    setWorking(true);
    const { data, error } = await callSafe<SyncStatusDto>("sync_set_enabled", { enabled, confirm: enabled });
    setWorking(false);
    setEnableConfirm(false);
    if (error) { notify({ tone: "error", title: "设置未生效", detail: error.message }); return; }
    if (!enabled) { stopPolling(); setQrOpen(false); setQr(null); }
    await publish(data, enabled ? "已启用自动抓取。请按需扫码登录后才会访问 B 站接口。" : "已关闭自动抓取，不会再发起外部请求。");
  };

  const saveConfig = async () => {
    const value = Number(hour);
    if (!Number.isInteger(value) || value < 0 || value > 23) { notify({ tone: "error", title: "快照时刻无效", detail: "请填写 0–23 之间的整点小时。" }); return; }
    const { error } = await callSafe("settings_update", { input: { roomId: roomId.trim(), snapshotHour: value } });
    if (error) { notify({ tone: "error", title: "同步设置保存失败", detail: error.message }); return; }
    const { data } = await callSafe<SyncStatusDto>("sync_status");
    notify({ tone: "success", title: "同步设置已保存", detail: "房间号与每日快照时刻只写入本机配置，不会触发外部请求。" });
    await publish(data);
  };

  const closeQr = () => { stopPolling(); setQrOpen(false); setQr(null); setQrState(null); };

  const pollOnce = useCallback(async () => {
    const { data, error } = await callSafe<SyncQrPollDto>("sync_qr_poll");
    if (error) {
      setQrState({ status: "error", message: error.message, uname: null });
      stopPolling();
      const s = await callSafe<SyncStatusDto>("sync_status");
      if (s.data) setStatus(s.data);
      return;
    }
    if (!data) return;
    setQrState(data);
    if (data.status === "success" || data.status === "expired" || data.status === "error") {
      stopPolling();
      const s = await callSafe<SyncStatusDto>("sync_status");
      if (s.data) setStatus(s.data);
      await refresh();
      if (data.status === "success") {
        notify({ tone: "success", title: "扫码登录成功", detail: "凭证已加密保存在本机，可立即同步或等待每日定时快照。" });
        closeQr();
      }
    }
  }, [notify, refresh, stopPolling]);

  const startQr = async () => {
    setWorking(true);
    const { data, error } = await callSafe<SyncQrDto>("sync_qr_start");
    setWorking(false);
    if (error) { notify({ tone: "error", title: "二维码生成失败", detail: `${error.message}。${error.action}` }); return; }
    stopPolling();
    setQr(data ?? null);
    setQrState(null);
    setQrOpen(true);
    timerRef.current = window.setInterval(() => { pollOnce().catch(() => undefined); }, 2000);
  };

  const logout = async () => {
    const { data, error } = await callSafe<SyncStatusDto>("sync_logout");
    if (error) { notify({ tone: "error", title: "退出登录失败", detail: error.action }); return; }
    await publish(data, "已退出 B 站登录并清除本机凭证。");
  };

  const snapshotNow = async () => {
    setWorking(true);
    const { data, error } = await callSafe<SyncSnapshotResultDto>("sync_snapshot_now");
    setWorking(false);
    if (error) {
      const s = await callSafe<SyncStatusDto>("sync_status");
      if (s.data) setStatus(s.data);
      notify({ tone: "error", title: "同步未完成", detail: `${error.message}。${error.action}` });
      return;
    }
    notify({ tone: "success", title: "同步完成", detail: `${data?.snapshotDate} 快照：${data?.memberCount} 人，新增 ${data?.newCount}、合并 ${data?.mergeCount}。` });
    const s = await callSafe<SyncStatusDto>("sync_status");
    if (s.data) setStatus(s.data);
    await refresh();
  };

  const enabled = status?.enabled ?? false;
  const loggedIn = status?.loginState === "logged_in";
  const stateTone = status?.loginState === "logged_in" ? "success" : status?.loginState === "expired" ? "danger" : "neutral";

  return (
    <>
      <Card title="自动抓取（由你决定是否启用）" extra={<span className="flex items-center gap-1.5"><Badge tone="danger">尚未验证 · 暂不建议使用</Badge><Badge tone={enabled ? "primary" : "neutral"}><Radio size={12} /> {enabled ? "已启用" : "默认关闭"}</Badge></span>}>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-xl border border-[var(--danger)] glass-soft px-3 py-2.5 text-xs leading-relaxed text-danger">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold">当前不建议使用扫码自动获取：此功能尚未验证。</strong>
              <p className="mt-1">真实 B 站账号的扫码登录与名单拉取还没做人工端到端验证，接口可能变更、返回空名单，或把当日大航海快照写空。请优先使用 CSV / Excel 手动导入；如仍需试用，请先做一次备份，并自行核对同步后的名单。</p>
            </div>
          </div>

          <Switch
            checked={enabled}
            disabled={working}
            onChange={(v) => v ? setEnableConfirm(true) : applyEnabled(false)}
            label="启用 B 站自动抓取"
            hint="关闭时应用不会发起任何外部请求；开启后仍需你主动扫码登录才会访问 B 站接口"
          />

          <SectionHint tone={enabled ? "neutral" : "warning"}>
            {status?.message ?? "自动抓取默认关闭，名单可通过 CSV / Excel 手动导入。"}
            {" "}这是基于主播自身账号可见数据的低频同步，不保证实时；粉丝数据始终只保存在这台电脑。<strong className="font-medium"> 该功能尚未验证，当前不建议使用，正式名单请走手动导入。</strong>
          </SectionHint>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="直播间房间号" placeholder="例如 21452505" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!enabled} hint="纯数字，留空则不做定时快照" />
            <Field label="每日快照时刻（0–23 点）" type="number" min="0" max="23" value={hour} onChange={(e) => setHour(e.target.value)} disabled={!enabled} hint="仅在启用且当天尚未同步时执行一次" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveConfig} disabled={!enabled || working}><Save size={14} /> 保存同步设置</Button>
            <Button variant="primary" onClick={startQr} disabled={!enabled || working}><QrCode size={14} /> 扫码登录 B 站</Button>
            <Button onClick={snapshotNow} disabled={!enabled || !loggedIn || working}><RefreshCw size={14} /> 立即同步一次</Button>
            <Button onClick={logout} disabled={!status?.cookieConfigured || working}><LogOut size={14} /> 退出登录</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted border-t border-[var(--border)] pt-3">
            <Badge tone={stateTone}><ShieldCheck size={11} /> {LOGIN_STATE_TEXT[status?.loginState ?? "disabled"]}</Badge>
            {status?.uname && <span>账号：{status.uname}（MID {status.mid}）</span>}
            <span>凭证：{status?.cookieConfigured ? "已加密保存于本机" : "未保存"}</span>
            <span>上次同步：{formatDateTime(status?.lastSyncAt ?? null)}</span>
          </div>

          {status?.lastError && (
            <div className="flex items-start gap-2 text-xs text-warning glass-soft rounded-xl p-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>最近一次同步失败：{status.lastError}。可重新扫码、检查网络，或继续使用手动导入。</span>
            </div>
          )}
        </div>
      </Card>

      <Modal open={enableConfirm} onClose={() => setEnableConfirm(false)} title="确认启用自动抓取"
        footer={<><Button onClick={() => setEnableConfirm(false)}>取消</Button><Button variant="primary" disabled={working} onClick={() => applyEnabled(true)}>确认启用</Button></>}>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted">
          <p>启用后，应用才具备访问 B 站网页接口的能力。仅在以下情况会发起外部请求：</p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>你主动点击「扫码登录 B 站」并按需完成扫码；</li>
            <li>你点击「立即同步一次」，或到达设定的每日快照时刻且当天尚未同步；</li>
            <li>同步前校验登录态是否仍然有效。</li>
          </ul>
          <p>登录凭证经本机密钥加密后保存在数据目录，不写入日志、不进备份清单、不上传任何粉丝数据。随时可以关闭开关并退出登录，手动导入始终可用。</p>
          <p className="text-danger font-medium">注意：扫码登录与大航海名单拉取尚未完成真实账号验证，当前不建议用于正式档案；请继续使用手动导入，并先做一次备份再试用。</p>
          <p className="text-muted">建议使用主播本人（或对该直播间有管理权限）的 B 站账号扫码，登录后请核对显示的账号名与房间号是否一致。</p>
        </div>
      </Modal>

      <Modal open={qrOpen} onClose={closeQr} title="扫码登录 B 站"
        footer={<><Button onClick={closeQr}>取消</Button><Button onClick={startQr} disabled={working}><RefreshCw size={14} /> 重新生成二维码</Button></>}>
        <div className="flex flex-col items-center gap-3">
          {qr && (
            <div className="rounded-xl bg-white p-3 shadow">
              <img
                alt="B 站登录二维码"
                className="h-[232px] w-[232px]"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.qrSvg)}`}
              />
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            {qrState?.status === "success"
              ? <CheckCircle2 size={16} className="text-success" />
              : <Loader2 size={16} className="animate-spin text-accent" />}
            <span>{qrState ? `${POLL_TEXT[qrState.status] ?? qrState.status} · ${qrState.message}` : qr?.message}</span>
          </div>
          <p className="text-xs text-muted text-center">二维码在本机生成，不包含第三方服务；有效期约 3 分钟，过期后点击「重新生成二维码」。</p>
          <p className="text-xs text-danger text-center leading-relaxed">提醒：扫码登录与名单拉取尚未完成真实账号验证，当前不建议使用；请使用主播本人账号扫码，并在同步后核对名单。</p>
        </div>
      </Modal>
    </>
  );
}
