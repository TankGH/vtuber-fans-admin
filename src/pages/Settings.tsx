import { useState } from "react";
import { Palette, FolderOpen, Monitor, Info, Save, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Card, Badge, Button, Field, SectionHint } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { applyTheme, callSafe, isNative, formatDateTime } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import { writeOnboarding } from "@/lib/onboarding";

export default function Settings() {
  const { theme, setTheme, bootstrap, refresh, notify } = useApp();
  const settings = bootstrap?.settings;
  const [backupDir, setBackupDir] = useState(settings?.backupDir ?? "");
  const [minimize, setMinimize] = useState(settings?.minimizeToTray ?? true);
  const [hideYear, setHideYear] = useState(settings?.birthdayYearHidden ?? true);
  const [startup, setStartup] = useState(settings?.launchAtStartup ?? false);
  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const save = async () => {
    setBusy(true);
    const { error } = await callSafe("settings_update", {
      input: { backupDir, minimizeToTray: minimize, birthdayYearHidden: hideYear, launchAtStartup: startup },
    });
    setBusy(false);
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    notify({ tone: "success", title: "设置已保存", detail: "主题即时生效，其余配置写入本地配置文件；数据仍只保存在这台电脑上。" });
    await refresh();
  };

  const replayOnboarding = () => {
    writeOnboarding({ done: false, step: 0, backupDir });
    notify({ tone: "info", title: "引导已重置", detail: "重新打开应用即可再次进入首启引导。" });
  };

  const clearAllData = async () => {
    setClearing(true);
    const { error } = await callSafe("app_clear_all_data", { confirm: true });
    setClearing(false);
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    writeOnboarding({ done: false, step: 0, backupDir: "" });
    applyTheme("galaxy");
    notify({
      tone: "warning",
      title: "全部数据已清除",
      detail: "档案、账目、备份与配置均已删除；重启应用后将重新进入首启引导。此操作不可恢复。",
    });
    await refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <Card title="三套主题配色" extra={<Badge tone="primary"><Palette size={12} /> 即时切换，无需重启</Badge>}>
        <ThemeSwitch value={theme} onChange={setTheme} />
        <p className="text-xs text-muted mt-3">主题存储在本地配置中，切换只改变根元素 CSS 变量，不会重新渲染整个界面。</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="数据与备份目录" extra={<Badge tone="neutral"><FolderOpen size={12} /> 本地路径</Badge>}>
          <div className="flex flex-col gap-4">
            <Field
              label="备份目录（绝对路径）"
              placeholder="C:\\Users\\c\\Documents\\vtuber-fans-admin-backups"
              value={backupDir}
              onChange={(e) => setBackupDir(e.target.value)}
              hint="每次启动自动备份，保留最近 7 份滚动备份"
            />
            <div className="flex items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={save}><Save size={14} /> {busy ? "保存中…" : "保存设置"}</Button>
              <Button onClick={replayOnboarding}><RotateCcw size={14} /> 重放首启引导</Button>
            </div>
            <SectionHint tone="neutral">
              本地数据位置：{bootstrap?.dataDir ?? "%APPDATA%\\com.vtuber.fans.admin"}。数据库与主密钥文件都不进入 git，请勿手动编辑 app.key。
            </SectionHint>
          </div>
        </Card>

        <Card title="托盘与启动行为" extra={<Badge tone="neutral"><Monitor size={12} /> Windows</Badge>}>
          <div className="flex flex-col gap-1">
            <SettingsSwitch label="关闭主窗口时最小化到托盘" hint="后台继续守护本地数据，双击托盘图标恢复窗口" checked={minimize} onChange={setMinimize} />
            <SettingsSwitch label="开机自动启动" hint="登录后静默启动并驻留托盘" checked={startup} onChange={setStartup} />
            <SettingsSwitch label="隐藏生日年份" hint="仅显示月日，避免纪念日提醒泄露完整生日" checked={hideYear} onChange={setHideYear} />
          </div>
          <p className="text-xs text-muted mt-2">首次启动时执行自动备份；纪念日提醒使用 Windows 原生 Toast。</p>
        </Card>
      </div>

      <Card title="危险操作 · 清除全部数据" extra={<Badge tone="danger"><Trash2 size={12} /> 不可恢复</Badge>}>
        <div className="flex flex-col gap-4">
          <SectionHint tone="danger">
            清空前请务必确认：此操作会永久删除本机保存的粉丝档案与加密地址、昵称历史、大航海名单与快照、纪念日、舰礼台账、记账流水、自动备份及本地配置。
          </SectionHint>
          <ul className="text-xs text-muted leading-relaxed list-disc pl-5 space-y-1">
            <li>没有回收站，也不会保留恢复标记；清除后无法通过这些数据恢复。</li>
            <li>备份目录里由本应用生成的备份与导出文件会一并删除，其它文件不受影响。</li>
            <li>加密密钥会保留，以保证清空后仍能正常录入新数据。</li>
          </ul>
          <div>
            <Button variant="danger" onClick={() => setClearOpen(true)}>
              <Trash2 size={14} /> 一键清除全部保存的数据
            </Button>
          </div>
        </div>
      </Card>

      <Card title="关于与诊断" extra={<Badge tone="success"><ShieldCheck size={12} /> 数据不出本机</Badge>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2 text-sm">
            <Diag label="版本" value="v0.3.0 · 批量删除与全量清除" />
            <Diag label="运行模式" value={isNative() ? "Tauri v2 原生端" : "浏览器演示模式（前端独立验证）"} />
            <Diag label="上次备份" value={formatDateTime(bootstrap?.backupHealth.lastBackupAt ?? null)} />
            <Diag label="粉丝档案" value={`${bootstrap?.fanCount ?? 0} 位`} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium flex items-center gap-2"><Info size={15} /> 错误原因速查</p>
            <p className="text-xs text-muted leading-relaxed">「备份目录不可写」→ 在上方更换目录；「文件格式错误」→ 检查 CSV 编码为 UTF-8 且含表头；「数据库打开失败」→ 关闭其它占用程序后重试；「备份校验未通过」→ 选择其它备份，当前数据不会改动。</p>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={clearOpen}
        title="最终确认：清除全部保存的数据"
        description="你正在执行不可恢复的清空操作。所有粉丝档案、敏感信息、名单快照、账目、备份与配置都将被永久删除。"
        detail="确认后立即执行，不会移动到回收站，也不会保留恢复标记。若尚未另行保存需要的备份，请取消本操作。"
        confirmText={clearing ? "正在清除…" : "我确认，永久清除全部数据"}
        requireCheck="我已另行保存需要的备份，并确认要永久清除本机全部数据（不可撤销）"
        onClose={() => setClearOpen(false)}
        onConfirm={clearAllData}
      />
    </div>
  );
}

function SettingsSwitch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
      <span className="flex flex-col"><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted mt-0.5">{hint}</span></span>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-200 cursor-pointer ${checked ? "bg-[var(--primary)]" : "glass-soft border border-[var(--border)]"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

function Diag({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2"><span className="text-muted">{label}</span><span className="font-medium text-right">{value}</span></div>;
}
