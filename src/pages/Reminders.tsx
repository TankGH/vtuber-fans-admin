import { useCallback, useEffect, useState } from "react";
import { CalendarHeart, Copy, CheckCheck, RotateCcw, ArrowUpRight, BellRing, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, EmptyState, SectionHint, SelectField, Switch } from "@/components/ui";
import { callSafe } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import type { ReminderDto } from "@/types/dto";

export default function Reminders() {
  const { notify, refresh, goTo, bootstrap } = useApp();
  const [days, setDays] = useState(bootstrap?.settings.reminderDaysAhead ?? 3);
  const [includeAcked, setIncludeAcked] = useState(true);
  const [items, setItems] = useState<ReminderDto[]>([]);
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await callSafe<ReminderDto[]>("reminder_list", { daysAhead: days, includeAcked });
    if (data) setItems(data);
    if (error) notify({ tone: "error", title: "纪念日读取失败", detail: error.action });
  }, [days, includeAcked, notify]);

  useEffect(() => { load().catch((err: unknown) => console.error("纪念日加载失败：", err)); }, [load]);
  useEffect(() => {
    // 原生 Toast 每天最多一次，由 Rust 侧的日期标记控制；演示模式不弹通知
    callSafe<boolean>("reminder_notify").catch(() => undefined);
  }, []);

  const changeDays = async (value: number) => {
    setDays(value);
    const { error } = await callSafe("settings_update", { input: { reminderDaysAhead: value } });
    if (error) notify({ tone: "error", title: "提前天数保存失败", detail: error.action });
    await refresh();
  };

  const toggleAck = async (item: ReminderDto) => {
    const key = `${item.uid}-${item.reminderType}-${item.reminderDate}`;
    setBusyKey(key);
    const { error } = await callSafe("reminder_ack", {
      uid: item.uid, reminderType: item.reminderType, reminderDate: item.reminderDate, acked: !item.acked,
    });
    setBusyKey("");
    if (error) { notify({ tone: "error", title: "操作未完成", detail: error.action }); return; }
    notify({ tone: "success", title: item.acked ? "已撤销处理标记" : "已标记为处理完毕", detail: `${item.nickname} · ${item.reminderLabel}` });
    await load();
    await refresh();
  };

  const copyGreeting = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify({ tone: "success", title: "祝福话术已复制", detail: "可直接粘贴到私信或直播间弹幕。" });
    } catch {
      notify({ tone: "info", title: "复制失败", detail: "请手动选中下方话术文本复制。" });
    }
  };

  const pending = items.filter((r) => !r.acked).length;
  const today = items.filter((r) => r.daysAhead === 0 && !r.acked).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="flex items-center gap-3">
          <BellRing size={22} className="text-accent" />
          <div><p className="label-sm">待处理提醒</p><p className="text-2xl font-semibold mt-1">{pending} 条</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <CalendarHeart size={22} className="text-warning" />
          <div><p className="label-sm">今天到期</p><p className="text-2xl font-semibold mt-1">{today} 条</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <ShieldCheck size={22} className="text-success" />
          <div><p className="label-sm">隐私口径</p><p className="text-sm font-medium mt-2">生日仅月日 · 不含地址</p></div>
        </Card>
      </div>

      <Card title="纪念日汇总" extra={<Badge tone="primary">未来 {days} 天</Badge>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <SelectField label="提醒提前天数" value={String(days)} onChange={(e) => changeDays(Number(e.target.value))}>
            <option value="0">仅今天</option>
            <option value="3">未来 3 天（默认）</option>
            <option value="7">未来 7 天</option>
            <option value="14">未来 14 天</option>
          </SelectField>
          <div className="flex items-end pb-1">
            <Switch checked={includeAcked} onChange={setIncludeAcked} label="同时显示已处理" hint="关闭后只列出待处理项" />
          </div>
        </div>

        {items.length === 0 && (
          <EmptyState
            title="近期没有纪念日"
            desc="在粉丝档案中补录生日、上舰周年或观看纪念日，系统会自动按年度循环计算下一次日期。"
            action={<Button onClick={() => goTo("fans")}>前往粉丝档案 <ArrowUpRight size={14} /></Button>}
          />
        )}

        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const key = `${item.uid}-${item.reminderType}-${item.reminderDate}`;
            return (
              <div key={key} className="glass-soft rounded-xl p-4 flex flex-col gap-3 row-hover">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.daysAhead === 0 ? "warning" : "neutral"}>{item.daysAhead === 0 ? "就是今天" : `还有 ${item.daysAhead} 天`}</Badge>
                  <Badge tone="primary">{item.reminderLabel}</Badge>
                  {item.acked && <Badge tone="success"><CheckCheck size={11} /> 已处理</Badge>}
                  <span className="ml-auto text-xs text-muted masked-value">{item.reminderDate}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-base font-semibold">{item.nickname}</p>
                  <span className="text-xs text-muted masked-value">UID {item.uid}</span>
                </div>
                <p className="text-sm leading-relaxed text-muted">{item.greeting}</p>
                <div className="flex flex-wrap gap-2">
                  <Button className="text-xs" onClick={() => copyGreeting(item.greeting)}><Copy size={13} /> 复制祝福话术</Button>
                  <Button className="text-xs" disabled={busyKey === key} onClick={() => toggleAck(item)}>
                    {item.acked ? <RotateCcw size={13} /> : <CheckCheck size={13} />}
                    {item.acked ? "撤销处理" : "标记已处理"}
                  </Button>
                  <Button className="text-xs" onClick={() => goTo("fans")}>查看档案 <ArrowUpRight size={13} /></Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <SectionHint tone="neutral">
        提醒只读取本机档案，生日年份与地址始终不进入提醒文案；首次启动会推送一次 Windows 原生通知，最小化到托盘时同样可见。标记按「UID + 类型 + 具体日期」记录，跨年自动重置。
      </SectionHint>
    </div>
  );
}
