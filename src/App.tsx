import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, UsersRound, Ship, DatabaseBackup, Settings2, Gift, CalendarHeart,
  Wallet, Search, Bell, Minus, ShieldCheck, Sparkles, ChevronRight, FolderOpen,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import { AppProvider, type Banner } from "@/lib/appContext";
import { callSafe, applyTheme, readCachedTheme, formatDateTime, isNative } from "@/lib/ipc";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { StatusBanner } from "@/components/StatusBanner";
import { Button, Card, Field, Modal, Badge } from "@/components/ui";
import { readOnboarding, finishOnboarding } from "@/lib/onboarding";
import Dashboard from "@/pages/Dashboard";
import Fans from "@/pages/Fans";
import Guards from "@/pages/Guards";
import Backup from "@/pages/Backup";
import Settings from "@/pages/Settings";
import Placeholder from "@/pages/Placeholder";
import type { BootstrapDto, ThemeKey } from "@/types/dto";

const MAIN_NAV = [
  { key: "dashboard", label: "概览", icon: LayoutDashboard, desc: "数据总览与健康状态" },
  { key: "fans", label: "粉丝档案", icon: UsersRound, desc: "终身档案与敏感信息" },
  { key: "guards", label: "大航海与导入", icon: Ship, desc: "在舰名单与手动导入" },
  { key: "backup", label: "备份恢复", icon: DatabaseBackup, desc: "滚动备份与一键恢复" },
  { key: "settings", label: "系统设置", icon: Settings2, desc: "主题、目录与托盘行为" },
];

const SOON_NAV = [
  { key: "reminder", label: "纪念日提醒", icon: CalendarHeart },
  { key: "gifts", label: "舰礼寄送台账", icon: Gift },
  { key: "ledger", label: "主播记账本", icon: Wallet },
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null);
  const [theme, setThemeState] = useState<ThemeKey>(readCachedTheme());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [search, setSearch] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboarding().done);
  const [backupDirInput, setBackupDirInput] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await callSafe<BootstrapDto>("app_bootstrap");
    if (data) setBootstrap(data);
    if (error) setBanner({ tone: "error", title: error.message, detail: error.action });
  }, []);

  useEffect(() => {
    refresh().catch((err: unknown) => console.error("初始化失败：", err));
  }, [refresh]);

  const setTheme = useCallback((t: ThemeKey) => {
    applyTheme(t);
    setThemeState(t);
    callSafe("settings_update", { input: { theme: t } }).then(({ error }) => {
      if (error) console.error("主题保存失败：", error.message);
    }).catch((err: unknown) => console.error("主题保存失败：", err));
    refresh().catch((err: unknown) => console.error("刷新失败：", err));
  }, [refresh]);

  const notify = useCallback((b: Banner) => {
    setBanner(b);
    window.setTimeout(() => setBanner((cur) => (cur === b ? null : cur)), 6000);
  }, []);

  const goTo = useCallback((p: string) => setPage(p), []);

  const ctx = useMemo(() => ({ bootstrap, refresh, theme, setTheme, banner, notify, goTo }), [bootstrap, refresh, theme, setTheme, banner, notify, goTo]);

  const submitOnboarding = async () => {
    setOnboardingBusy(true);
    const dir = backupDirInput.trim() || bootstrap?.settings.backupDir || "";
    await finishOnboarding(dir).catch((err: unknown) => console.error("引导保存失败：", err));
    setOnboardingBusy(false);
    setOnboardingOpen(false);
    notify({ tone: "success", title: "初始化完成", detail: `备份目录：${dir}。已自动创建首个备份。` });
    await refresh();
  };

  const activeLabel = [...MAIN_NAV, ...SOON_NAV].find((n) => n.key === page)?.label ?? "概览";

  const renderPage = () => {
    switch (page) {
      case "fans": return <Fans />;
      case "guards": return <Guards />;
      case "backup": return <Backup />;
      case "settings": return <Settings />;
      case "reminder": return <Placeholder kind="reminder" />;
      case "gifts": return <Placeholder kind="gifts" />;
      case "ledger": return <Placeholder kind="ledger" />;
      default: return <Dashboard globalSearch={search} />;
    }
  };

  return (
    <AppProvider value={ctx}>
      <div className="h-full w-full">
        {/* 固定顶栏 */}
        <header className="fixed top-0 left-0 right-0 z-30 h-16 glass flex items-center gap-4 px-5">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
              <Sparkles size={19} className="text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-wide">守村人·粉丝档案</p>
              <p className="text-[11px] text-muted">粉丝管理系统 · 本地版</p>
            </div>
          </div>
          <div className="relative flex-1 max-w-md ml-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="field pl-9"
              placeholder="搜索 UID 或昵称（在档案页生效）"
              value={search}
              onChange={(e) => { setSearch(e.target.value); if (page !== "dashboard") setPage("fans"); }}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone="primary"><ShieldCheck size={12} /> 数据仅存本机</Badge>
            <Badge tone={bootstrap?.backupHealth.healthy ? "success" : "warning"}>
              <Bell size={12} /> {bootstrap?.backupHealth.healthy ? "备份正常" : "建议备份"}
            </Badge>
            <ThemeSwitch value={theme} onChange={setTheme} compact />
            <Button className="px-2.5 py-2" title="最小化到托盘" aria-label="最小化到托盘" onClick={() => notify({ tone: "info", title: isNative() ? "已最小化到托盘" : "浏览器预览模式", detail: isNative() ? "后台继续守护本地数据" : "桌面端安装后可最小化到系统托盘" })}>
              <Minus size={15} />
            </Button>
          </div>
        </header>

        {/* 固定侧栏：1024–1280px 由 theme.css 折叠为图标条 */}
        <aside className="fixed top-16 bottom-9 left-0 z-20 w-[228px] glass flex flex-col p-3 gap-1 overflow-y-auto app-sidebar">
          <p className="label-sm px-3 pt-2 pb-1 nav-group-title">工作台</p>
          {MAIN_NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              title={item.desc}
              aria-label={item.label}
              className={twMerge(
                "nav-item flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 cursor-pointer group",
                page === item.key ? "bg-[var(--primary)] text-white shadow-glow" : "text-muted hover:text-ink hover:bg-[var(--surface-2)]",
              )}
            >
              <item.icon size={17} className="shrink-0" />
              <span className="flex-1 text-sm font-medium nav-label">{item.label}</span>
              <ChevronRight size={13} className={twMerge("nav-chevron opacity-0 group-hover:opacity-70 transition-opacity", page === item.key && "opacity-70")} />
            </button>
          ))}
          <div className="my-3 h-px bg-[var(--border)] nav-divider" />
          <p className="label-sm px-3 pb-1 nav-group-title">即将开放</p>
          {SOON_NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              aria-label={item.label}
              className={twMerge(
                "nav-item flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 cursor-pointer",
                page === item.key ? "bg-[var(--surface-2)] text-ink" : "text-muted hover:text-ink hover:bg-[var(--surface-2)]",
              )}
            >
              <item.icon size={16} className="shrink-0" />
              <span className="flex-1 text-sm nav-label">{item.label}</span>
              <span className="text-[10px] chip px-2 py-0.5 nav-chip">后续</span>
            </button>
          ))}
          <div className="mt-auto glass-soft rounded-xl p-3 text-xs leading-relaxed text-muted nav-boundary">
            <p className="text-ink font-medium mb-1">本期能力边界</p>
            同步功能仅提供手动导入，不含自动抓取。手动录入始终是不变底座。
          </div>
        </aside>

        {/* 主内容区：避开固定顶栏与底栏 */}
        <main className="h-full ml-[228px] pt-16 pb-9 scroll-y app-main">
          <div className="p-6 flex flex-col gap-5 max-w-[1600px] mx-auto">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="label-sm">守村人·粉丝档案 / {activeLabel}</p>
                <h1 className="text-[28px] font-semibold leading-tight mt-1">{activeLabel}</h1>
              </div>
              <p className="text-xs text-muted">{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</p>
            </div>
            {banner && <StatusBanner tone={banner.tone} title={banner.title} detail={banner.detail} onClose={() => setBanner(null)} />}
            {renderPage()}
          </div>
        </main>

        {/* 固定底部状态栏 */}
        <footer className="fixed bottom-0 left-0 right-0 z-30 h-9 glass flex items-center gap-4 px-5 text-xs text-muted">
          <span className="flex items-center gap-1.5"><FolderOpen size={13} /> {bootstrap?.dataDir ?? "%APPDATA%\\com.vtuber.fans.admin"}</span>
          <span>粉丝 {bootstrap?.fanCount ?? 0} 人</span>
          <span>在舰 {bootstrap?.guardCount ?? 0} 人</span>
          <span>上次备份：{formatDateTime(bootstrap?.backupHealth.lastBackupAt ?? null)}</span>
          <span className="ml-auto flex items-center gap-2"><ShieldCheck size={13} /> 脱敏模式已开启 · {isNative() ? "Tauri 原生端" : "浏览器演示模式"}</span>
        </footer>
      </div>

      <Modal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        title="欢迎使用守村人·粉丝档案"
        width="max-w-xl"
        footer={<Button variant="primary" disabled={onboardingBusy} onClick={submitOnboarding}>{onboardingBusy ? "初始化中…" : "完成引导"}</Button>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">只需一步即可开始。所有数据保存在这台电脑上，不会上传云端。本期不自动抓取 B 站数据，名单通过 CSV / Excel 手动导入。</p>
          <div className="glass-soft rounded-xl p-4 flex flex-col gap-3">
            <p className="text-sm font-medium">第 1 步 · 选择备份目录</p>
            <Field
              label="备份目录（绝对路径）"
              placeholder="例如 C:\\Users\\c\\Documents\\vtuber-fans-admin-backups"
              value={backupDirInput}
              onChange={(e) => setBackupDirInput(e.target.value)}
              hint="留空则使用默认目录；每次启动自动备份，保留最近 7 份"
            />
          </div>
          <div className="glass-soft rounded-xl p-4 flex flex-col gap-3 opacity-70">
            <p className="text-sm font-medium">第 2 步 · 完成</p>
            <p className="text-xs text-muted">扫码登录与 B 站同步将在后续版本开放，本期该入口保持禁用状态，避免造成已可用的错觉。</p>
          </div>
        </div>
      </Modal>
    </AppProvider>
  );
}
