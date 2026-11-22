import { useCallback, useEffect, useState } from "react";
import { DatabaseBackup, ShieldCheck, HardDrive, RefreshCw, FileDown, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, Badge, Button, SectionHint } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBanner } from "@/components/StatusBanner";
import { callSafe, formatBytes, formatDateTime } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import type { BackupDto, ExportResult, RestorePlan } from "@/types/dto";

export default function Backup() {
  const { bootstrap, refresh, notify } = useApp();
  const [backups, setBackups] = useState<BackupDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupDto | null>(null);
  const [confirmExport, setConfirmExport] = useState<"db" | "csv" | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await callSafe<BackupDto[]>("backup_list");
    if (data) setBackups(data);
    if (error) notify({ tone: "error", title: error.message, detail: error.action });
  }, [notify]);

  useEffect(() => { load().catch((err: unknown) => console.error("备份列表加载失败：", err)); }, [load]);

  const backupNow = async () => {
    setBusy(true);
    const { data, error } = await callSafe<BackupDto>("backup_now");
    setBusy(false);
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    notify({ tone: "success", title: "备份完成", detail: `${data?.fileName ?? "已生成"} · 保留最近 7 份滚动备份` });
    await load();
    await refresh();
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    const { data, error } = await callSafe<RestorePlan>("restore_prepare", { backupId: restoreTarget.id, confirm: true });
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    notify({ tone: "success", title: "恢复已准备就绪", detail: `${data?.message ?? ""}。安全备份编号 ${data?.safetyBackupId ?? "已生成"}，可随时回退。` });
    await refresh();
  };

  const doExport = async (kind: "db" | "csv") => {
    const command = kind === "db" ? "backup_export_db" : "backup_export_csv";
    const { data, error } = await callSafe<ExportResult>(command, { destPath: "", confirm: true, masked: kind === "csv" });
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    notify({
      tone: "success",
      title: kind === "db" ? "加密库文件已导出" : "脱敏 CSV 已导出",
      detail: `${data?.path ?? "已生成"} · ${formatBytes(data?.sizeBytes ?? 0)}`,
    });
  };

  const columns: Column<BackupDto>[] = [
    { key: "date", title: "备份时间", width: "190px", render: (b) => <span className="masked-value">{formatDateTime(b.createdAt)}</span> },
    { key: "name", title: "文件名", render: (b) => <span className="text-xs masked-value">{b.fileName}</span> },
    { key: "size", title: "大小", width: "110px", render: (b) => <span className="text-muted">{formatBytes(b.sizeBytes)}</span> },
    { key: "summary", title: "记录数摘要", render: (b) => <span className="text-xs text-muted">粉丝 {b.fanCount} · 快照 {b.snapshotCount} · 事件 {b.eventCount}</span> },
    { key: "verify", title: "校验", width: "120px", render: (b) => b.verified ? <Badge tone="success"><CheckCircle2 size={11} /> 通过</Badge> : <Badge tone="danger"><AlertTriangle size={11} /> 异常</Badge> },
    { key: "action", title: "操作", width: "110px", render: (b) => (
      <Button className="px-2.5 py-1.5 text-xs" disabled={!b.verified} onClick={() => setRestoreTarget(b)}><RotateCcw size={12} /> 恢复</Button>
    ) },
  ];

  const health = bootstrap?.backupHealth;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><div className="flex items-center gap-3"><DatabaseBackup size={22} className="text-accent" /><div><p className="label-sm">上次备份</p><p className="text-sm font-medium mt-2 masked-value">{formatDateTime(health?.lastBackupAt ?? null)}</p></div></div></Card>
        <Card><div className="flex items-center gap-3"><HardDrive size={22} className={health?.healthy === false ? "text-warning" : "text-success"} /><div><p className="label-sm">滚动备份</p><p className="text-sm font-medium mt-2">{backups.length} / 7 份 · {health?.healthy ? "状态良好" : "建议立即备份"}</p></div></div></Card>
        <Card><div className="flex items-center gap-3"><ShieldCheck size={22} className="text-success" /><div><p className="label-sm">备份目录</p><p className="text-xs font-medium mt-2 break-all leading-relaxed">{bootstrap?.settings.backupDir ?? "未设置"}</p></div></div></Card>
      </div>

      {health && !health.healthy && (
        <StatusBanner tone="warning" title={`已有 ${health.daysSinceBackup} 天未备份`} detail="超过 3 天未备份时给出温和提示；备份在启动后台任务执行，不影响首屏。" actionText="立即备份" onAction={backupNow} />
      )}

      <SectionHint tone="neutral">
        每次启动自动用 VACUUM INTO 生成一致性快照，整体加密后写入备份目录并生成 manifest 校验摘要；保留最近 7 份，旧的自动删除。恢复前会先为当前库再备份一次，任何恢复都可回退。
      </SectionHint>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={backupNow}><RefreshCw size={14} /> {busy ? "备份中…" : "立即备份"}</Button>
        <Button onClick={() => setConfirmExport("csv")}><FileDown size={14} /> 导出脱敏 CSV</Button>
        <Button onClick={() => setConfirmExport("db")}><FileDown size={14} /> 导出加密库文件</Button>
      </div>

      <Card title="可用备份" extra={<Badge tone="primary">最近 {backups.length} 份</Badge>}>
        <DataTable columns={columns} rows={backups} rowKey={(b) => b.id} emptyTitle="暂无备份" emptyDesc="点击「立即备份」创建第一份" />
      </Card>

      <Card title="恢复与导出说明">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="glass-soft rounded-xl p-4">
            <p className="text-sm font-medium mb-2">一键恢复流程</p>
            <p className="text-xs text-muted leading-relaxed">选择备份 → 二次确认 → 自动创建安全备份 → 写入恢复标记 → 重启应用 → 打开数据库前替换 → 校验记录数 → 清除标记。失败时保留当前库与标记，不会破坏数据。</p>
          </div>
          <div className="glass-soft rounded-xl p-4">
            <p className="text-sm font-medium mb-2">导出隐私规则</p>
            <p className="text-xs text-muted leading-relaxed">脱敏 CSV 是默认导出项，仅含省市区与月日。导出完整加密库文件需要二次确认；任何完整地址导出都先展示脱敏预览，确认后才允许。</p>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="从备份恢复"
        description={`即将从 ${restoreTarget ? formatDateTime(restoreTarget.createdAt) : ""} 的备份恢复数据。系统会自动先为当前库创建安全备份，然后写入恢复标记，重启应用后完成替换。`}
        detail={`该备份记录：粉丝 ${restoreTarget?.fanCount ?? 0} 人、快照 ${restoreTarget?.snapshotCount ?? 0} 份、事件 ${restoreTarget?.eventCount ?? 0} 条。恢复过程中不会删除当前数据库。`}
        confirmText="确认准备恢复"
        requireCheck="我理解恢复后当前数据将被备份内容替换，且已保留可回退的安全备份"
        onClose={() => setRestoreTarget(null)}
        onConfirm={doRestore}
      />

      <ConfirmDialog
        open={Boolean(confirmExport)}
        title={confirmExport === "db" ? "导出完整加密库文件" : "导出脱敏 CSV"}
        description={confirmExport === "db"
          ? "加密库文件包含全部档案密文，可在另一台电脑恢复使用。请妥善保管，不要上传到网盘或发送给他人。"
          : "导出内容为脱敏预览：地址仅省市区、生日仅月日，不含电话与门牌号。"}
        detail="导出结果只写入你选择的本地目录，不会经过任何第三方服务器。"
        danger={confirmExport === "db"}
        confirmText="确认导出"
        requireCheck={confirmExport === "db" ? "我已确认导出文件的保管责任" : undefined}
        onClose={() => setConfirmExport(null)}
        onConfirm={() => { if (confirmExport) void doExport(confirmExport); }}
      />
    </div>
  );
}
