import { useState } from "react";
import { Palette, FolderOpen, Monitor, Radio, Info, Save, RotateCcw, LockKeyhole, ShieldCheck } from "lucide-react";
import { Card, Badge, Button, Field, SectionHint } from "@/components/ui";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { callSafe, isNative, formatDateTime } from "@/lib/ipc";
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
          <p className="text-xs text-muted mt-2">首次启动时执行自动备份；纪念日与同步失败提醒使用 Windows 原生 Toast。</p>
        </Card>
      </div>

      <Card title="同步配置（后续版本开放）" extra={<Badge tone="warning"><LockKeyhole size={12} /> 全部禁用</Badge>}>
        <SectionHint tone="warning">
          本期不实现任何自动抓取：没有 HTTP 快照、WebSocket 事件订阅、WBI 签名与扫码登录。以下控件保留配置位但统一禁用，避免造成已可用的错觉。手动导入始终是正式功能。
        </SectionHint>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 opacity-55">
          <Field label="B 站登录 Cookie" disabled placeholder="待同步引擎启用后扫码登录" />
          <Field label="每日快照时刻" disabled value="04:00" />
          <Field label="WebSocket 实时订阅" disabled value="关闭" />
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs text-muted">
          <Radio size={13} /> 同步状态：{bootstrap?.settings.cookieConfigured ? "已配置凭证" : "未配置凭证"} · 本期不会发起任何外部请求
        </div>
      </Card>

      <Card title="关于与诊断" extra={<Badge tone="success"><ShieldCheck size={12} /> 数据不出本机</Badge>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2 text-sm">
            <Diag label="版本" value="v0.1.0 · 核心 MVP" />
            <Diag label="运行模式" value={isNative() ? "Tauri v2 原生端" : "浏览器演示模式（前端独立验证）"} />
            <Diag label="上次备份" value={formatDateTime(bootstrap?.backupHealth.lastBackupAt ?? null)} />
            <Diag label="粉丝档案" value={`${bootstrap?.fanCount ?? 0} 位`} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium flex items-center gap-2"><Info size={15} /> 错误原因速查</p>
            <p className="text-xs text-muted leading-relaxed">「备份目录不可写」→ 在上方更换目录；「文件格式错误」→ 检查 CSV 编码为 UTF-8 且含表头；「数据库打开失败」→ 关闭其它占用程序后重试；「备份校验未通过」→ 选择其它备份，当前数据不会改动。</p>
            <p className="text-xs text-muted leading-relaxed">同步失败时界面会直接显示人类可读原因并提供重试按钮，不要求用户查看日志文件。</p>
          </div>
        </div>
      </Card>
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
