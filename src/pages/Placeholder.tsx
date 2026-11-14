import { CalendarHeart, Gift, Wallet, LockKeyhole, ArrowRight, Database } from "lucide-react";
import { Card, Badge, Button, SectionHint } from "@/components/ui";
import { useApp } from "@/lib/appContext";

const CONTENT = {
  reminder: {
    title: "纪念日全局提醒", icon: CalendarHeart,
    intro: "生日、上舰周年与观看纪念日的汇总提醒，是参照产品最被看重的能力之一。",
    features: [
      "每日首次启动弹出「今日纪念日」汇总卡片，覆盖未来 3 天内即将到来的节点（提前天数可配置）",
      "Windows 原生 Toast 通知，主窗口最小化到托盘后仍可触达",
      "每条提醒提供快捷操作：复制预设祝福话术、标记已处理、跳转粉丝档案",
      "关闭卡片后托盘角标保留未处理数量，直到标记已处理或次日重置",
    ],
    ready: "reminder_ack 表与提醒类型枚举已建好，档案中的生日 / 上舰周年 / 观看纪念日字段已可录入",
  },
  gifts: {
    title: "舰礼寄送台账", icon: Gift,
    intro: "把「谁该寄、寄到哪、寄了没」从 Excel 里搬进本地加密库。",
    features: [
      "地址审核状态流转：未审核 / 有效 / 无效 / 已寄送，支持 CSV 批量补录",
      "创建寄送批次（如「2026 年 11 月舰礼」），生成清单并逐条记录发货状态与快递单号",
      "地址列表默认折叠，单条展开需二次确认；导出先给脱敏预览，确认后才允许完整地址",
      "支出记录关联寄送批次，形成批次成本核算",
    ],
    ready: "gift_batch / gift_shipment 表已建好，档案中的加密地址字段与审核状态已可用",
  },
  ledger: {
    title: "主播记账本", icon: Wallet,
    intro: "大航海收入与舰礼支出的净额趋势，一眼看清每月实际结余。",
    features: [
      "收入侧自动归集大航海购买 / 续费事件，并支持手动录入其它收入",
      "支出侧记录舰礼采购成本、快递费用与平台手续费（手动或按比例估算）",
      "按月 / 按季度支出趋势图，以及大航海收入与舰礼支出的净额趋势",
      "支出记录关联寄送批次，形成批次成本核算",
    ],
    ready: "ledger_entry 表与 guard_event 价格字段已建好，可在导入事件中记录金额",
  },
} as const;

export default function Placeholder({ kind }: { kind: "reminder" | "gifts" | "ledger" }) {
  const { goTo } = useApp();
  const c = CONTENT[kind];
  return (
    <div className="flex flex-col gap-5">
      <Card className="relative overflow-hidden">
        <div className="absolute -top-20 right-10 h-56 w-56 rounded-full bg-[var(--glow)] blur-3xl pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="glass-soft rounded-2xl p-3"><c.icon size={26} className="text-accent" /></div>
          <div>
            <div className="flex items-center gap-2 mb-2"><Badge tone="warning"><LockKeyhole size={12} /> 即将开放</Badge></div>
            <h2 className="text-xl font-semibold">{c.title}</h2>
            <p className="text-sm text-muted mt-2 max-w-3xl leading-relaxed">{c.intro}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="规划中的能力" className="xl:col-span-2">
          <div className="flex flex-col gap-3">
            {c.features.map((f, i) => (
              <div key={f} className="glass-soft rounded-xl p-3.5 flex items-start gap-3 row-hover">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-white text-xs">{i + 1}</span>
                <p className="text-sm leading-relaxed">{f}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="当前可用部分">
          <div className="flex flex-col gap-4">
            <div className="glass-soft rounded-xl p-4">
              <Database size={18} className="text-accent mb-2" />
              <p className="text-sm font-medium mb-1">数据结构已就绪</p>
              <p className="text-xs text-muted leading-relaxed">{c.ready}。</p>
            </div>
            <SectionHint tone="warning">
              本期为核心 MVP，只实现 F1 档案、F2 导入、F6 备份与 F7 设置。该页面为占位，不产生任何业务数据。
            </SectionHint>
            <div className="flex flex-col gap-2">
              <Button onClick={() => goTo("fans")}>前往粉丝档案 <ArrowRight size={14} /></Button>
              <Button onClick={() => goTo("guards")}>导入在舰名单 <ArrowRight size={14} /></Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
