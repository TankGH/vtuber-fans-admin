import { UsersRound, Ship, AlertTriangle, DatabaseBackup, ArrowUpRight, Activity, CalendarHeart, Gift, Wallet, Sparkles } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, Button, Badge, SectionHint } from "@/components/ui";
import { StatusBanner } from "@/components/StatusBanner";
import { useApp } from "@/lib/appContext";
import { ACTIVITY_TEXT, formatDateTime, callSafe } from "@/lib/ipc";

const TREND = [
  { day: "11-07", fans: 9, guards: 8 }, { day: "11-08", fans: 10, guards: 9 },
  { day: "11-09", fans: 11, guards: 10 }, { day: "11-10", fans: 12, guards: 11 },
  { day: "11-11", fans: 12, guards: 12 }, { day: "11-12", fans: 13, guards: 13 },
  { day: "11-13", fans: 13, guards: 12 },
];

export default function Dashboard({ globalSearch }: { globalSearch: string }) {
  const { bootstrap, goTo, notify } = useApp();
  const health = bootstrap?.backupHealth;
  const stats = [
    { label: "粉丝档案总数", value: bootstrap?.fanCount ?? 0, sub: "跨舰长周期终身保留", icon: UsersRound, tone: "text-accent" },
    { label: "当前在舰人数", value: bootstrap?.guardCount ?? 0, sub: "含总督 / 提督 / 舰长", icon: Ship, tone: "text-primary" },
    { label: "待处理导入冲突", value: bootstrap?.conflictCount ?? 0, sub: "手动锁定字段优先", icon: AlertTriangle, tone: "text-warning" },
    { label: "距上次备份", value: health?.daysSinceBackup === null ? "—" : `${health?.daysSinceBackup ?? 0} 天`, sub: health?.healthy ? "备份状态良好" : "建议立即备份", icon: DatabaseBackup, tone: health?.healthy === false ? "text-danger" : "text-success" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card className="relative overflow-hidden">
        <div className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-[var(--glow)] blur-3xl pointer-events-none" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2"><Sparkles size={16} className="text-accent" /><span className="label-sm">今日工作台</span></div>
            <h2 className="brand-text text-2xl font-semibold">晚上好，舰队数据一切就绪</h2>
            <p className="text-sm text-muted mt-2 max-w-2xl leading-relaxed">
              13 位舰队成员的档案、上舰周年与舰礼地址都在这台电脑上。「晚 风」「大幕丶渐起」等昵称已按原样保留，敏感信息默认脱敏显示。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => goTo("fans")}>新建档案</Button>
            <Button onClick={() => goTo("guards")}>导入名单</Button>
            <Button onClick={async () => {
              const { data, error } = await callSafe("backup_now");
              notify(error ? { tone: "error", title: error.message, detail: error.action } : { tone: "success", title: "已创建新的备份", detail: `文件：${String((data as { fileName?: string })?.fileName ?? "backup.enc")}` });
            }}>立即备份</Button>
          </div>
        </div>
      </Card>

      {health && !health.healthy && (
        <StatusBanner
          tone="warning"
          title={`已有 ${health.daysSinceBackup} 天未备份`}
          detail="养成定期备份的习惯可以避免电脑故障丢失资料。恢复向导会先为当前数据创建安全备份。"
          actionText="前往备份"
          onAction={() => goTo("backup")}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <Card key={s.label} className="animate-rise-in" >
            <div className="flex items-start justify-between">
              <div>
                <p className="label-sm">{s.label}</p>
                <p className="text-3xl font-semibold mt-2">{s.value}</p>
                <p className="text-xs text-muted mt-2">{s.sub}</p>
              </div>
              <div className="glass-soft rounded-xl p-2.5"><s.icon size={18} className={s.tone} /></div>
            </div>
            <div className="h-9 mt-3 -mb-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={TREND} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`spark-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip contentStyle={{ display: "none" }} />
                  <Area type="monotone" dataKey="fans" stroke="var(--accent)" strokeWidth={1.6} fill={`url(#spark-${i})`} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="近期动态" className="xl:col-span-2" extra={<Badge tone="neutral"><Activity size={12} /> 最近 6 条</Badge>}>
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {(bootstrap?.activities ?? []).slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{a.summary}</p>
                  <p className="text-xs text-muted mt-1">{ACTIVITY_TEXT[a.kind] ?? a.kind} · {formatDateTime(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="业务台账" extra={<Badge tone="primary">已可用</Badge>}>
          <div className="flex flex-col gap-3">
            {[
              { key: "reminder", icon: CalendarHeart, title: "纪念日提醒", desc: `待处理 ${bootstrap?.reminderCount ?? 0} 条 · 祝福话术与处理标记` },
              { key: "gifts", icon: Gift, title: "舰礼寄送台账", desc: "寄送批次、地址审核、发货状态与脱敏导出" },
              { key: "ledger", icon: Wallet, title: "主播记账本", desc: "大航海收入归集、支出统计与批次成本核算" },
            ].map((f) => (
              <button key={f.key} onClick={() => goTo(f.key)} className="glass-soft rounded-xl p-3 flex items-start gap-3 row-hover text-left cursor-pointer">
                <f.icon size={17} className="text-accent mt-0.5 shrink-0" />
                <div><p className="text-sm font-medium">{f.title}</p><p className="text-xs text-muted mt-1 leading-relaxed">{f.desc}</p></div>
              </button>
            ))}
            <SectionHint tone="neutral">
              自动抓取默认关闭；{bootstrap?.syncStatus.enabled ? "已在设置中启用，可按需扫码登录。" : "需要时可在设置中自行启用并扫码登录。"}手动导入始终可用。
            </SectionHint>
          </div>
        </Card>
      </div>

      {globalSearch && (
        <Card title="全局搜索">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">正在搜索「<span className="text-ink">{globalSearch}</span>」，档案页会按 UID 与昵称筛选。</p>
            <Button onClick={() => goTo("fans")}>前往档案 <ArrowUpRight size={14} /></Button>
          </div>
        </Card>
      )}
    </div>
  );
}
