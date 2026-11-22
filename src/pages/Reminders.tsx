import { useCallback, useEffect, useState } from "react";
import {
  CalendarHeart, Copy, CheckCheck, RotateCcw, ArrowUpRight, BellRing, ShieldCheck,
  Plus, Pencil, Trash2, Sparkles, Users,
} from "lucide-react";
import {
  Badge, Button, Card, EmptyState, Field, Modal, SectionHint, SelectField, Switch,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { callSafe } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import { CUSTOM_REMINDER_RULES } from "@/types/dto";
import type {
  CustomReminderDto, CustomReminderInput, FanProfileDto, Paged, ReminderDto, ReminderRule,
} from "@/types/dto";

type SourceFilter = "all" | "auto" | "custom";

function localIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ruleLabel(rule: string): string {
  return CUSTOM_REMINDER_RULES.find((r) => r.value === rule)?.label ?? rule;
}

function emptyEditor(): CustomReminderInput {
  return { title: "", uid: null, anchorDate: localIso(), rule: "annual", offsetDays: 100, note: "", enabled: true };
}

function toEditor(item: CustomReminderDto): CustomReminderInput {
  return {
    id: item.id, title: item.title, uid: item.uid, anchorDate: item.anchorDate,
    rule: item.rule, offsetDays: item.offsetDays, note: item.note, enabled: item.enabled,
  };
}

export default function Reminders() {
  const { notify, refresh, goTo, bootstrap } = useApp();
  const [days, setDays] = useState(bootstrap?.settings.reminderDaysAhead ?? 3);
  const [includeAcked, setIncludeAcked] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [items, setItems] = useState<ReminderDto[]>([]);
  const [customs, setCustoms] = useState<CustomReminderDto[]>([]);
  const [profiles, setProfiles] = useState<FanProfileDto[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [hundredsEnabled, setHundredsEnabled] = useState(bootstrap?.settings.milestoneHundredsEnabled ?? true);
  const [yearsEnabled, setYearsEnabled] = useState(bootstrap?.settings.milestoneYearsEnabled ?? true);
  const [editor, setEditor] = useState<CustomReminderInput | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomReminderDto | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await callSafe<ReminderDto[]>("reminder_list", { daysAhead: days, includeAcked });
    if (data) setItems(data);
    if (error) notify({ tone: "error", title: "纪念日读取失败", detail: error.action });
    const { data: list } = await callSafe<CustomReminderDto[]>("custom_reminder_list");
    if (list) setCustoms(list);
    const { data: fans } = await callSafe<Paged<FanProfileDto>>("profile_list", { pageSize: 100 });
    if (fans) setProfiles(fans.items);
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

  const saveMilestones = async () => {
    const { error } = await callSafe("settings_update", {
      input: { milestoneHundredsEnabled: hundredsEnabled, milestoneYearsEnabled: yearsEnabled },
    });
    if (error) { notify({ tone: "error", title: "规则保存失败", detail: error.action }); return; }
    const on = [hundredsEnabled && "百日提醒", yearsEnabled && "周年提醒"].filter(Boolean).join(" / ");
    notify({ tone: "success", title: "里程碑规则已保存", detail: on ? `已启用：${on}` : "两类里程碑均已关闭" });
    await refresh();
    await load();
  };

  const saveCustom = async () => {
    if (!editor) return;
    if (!editor.title.trim()) { notify({ tone: "error", title: "无法保存", detail: "请填写纪念日名称" }); return; }
    setSaving(true);
    const { error } = await callSafe("custom_reminder_save", { input: editor });
    setSaving(false);
    if (error) { notify({ tone: "error", title: "保存失败", detail: error.action }); return; }
    notify({ tone: "success", title: editor.id ? "纪念日已更新" : "自定义纪念日已添加", detail: editor.title });
    setEditor(null);
    await load();
    await refresh();
  };

  const toggleEnabled = async (item: CustomReminderDto) => {
    const { error } = await callSafe("custom_reminder_save", { input: { ...toEditor(item), enabled: !item.enabled } });
    if (error) { notify({ tone: "error", title: "操作未完成", detail: error.action }); return; }
    notify({ tone: "success", title: item.enabled ? "已停用" : "已启用", detail: item.title });
    await load();
    await refresh();
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await callSafe("custom_reminder_delete", { id: deleteTarget.id });
    if (error) { notify({ tone: "error", title: "删除失败", detail: error.action }); return; }
    notify({ tone: "success", title: "纪念日已删除", detail: deleteTarget.title });
    setDeleteTarget(null);
    await load();
    await refresh();
  };

  const pending = items.filter((r) => !r.acked).length;
  const today = items.filter((r) => r.daysAhead === 0 && !r.acked).length;
  const shown = items.filter((r) => sourceFilter === "all" || r.source === sourceFilter);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="flex items-center gap-3">
          <BellRing size={22} className="text-accent" />
          <div><p className="label-sm">待处理提醒</p><p className="text-2xl font-semibold mt-1">{pending} 条</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <CalendarHeart size={22} className="text-warning" />
          <div><p className="label-sm">今天到期</p><p className="text-2xl font-semibold mt-1">{today} 条</p></div>
        </Card>
        <Card className="flex items-center gap-3">
          <Sparkles size={22} className="text-primary" />
          <div><p className="label-sm">自定义纪念日</p><p className="text-2xl font-semibold mt-1">{customs.length} 条</p></div>
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

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted mr-1">来源筛选</span>
          {([["all", "全部"], ["auto", "自动生成"], ["custom", "自定义"]] as const).map(([key, text]) => (
            <Button key={key} className="text-xs" variant={sourceFilter === key ? "primary" : "ghost"} onClick={() => setSourceFilter(key)}>{text}</Button>
          ))}
        </div>

        {shown.length === 0 && (
          <EmptyState
            title="近期没有纪念日"
            desc="在粉丝档案中补录生日、上舰日期或观看纪念日，或在下方新增自定义纪念日与里程碑规则。"
            action={<Button onClick={() => setEditor(emptyEditor())}><Plus size={14} /> 新增自定义纪念日</Button>}
          />
        )}

        <div className="flex flex-col gap-3">
          {shown.map((item) => {
            const key = `${item.uid}-${item.reminderType}-${item.reminderDate}`;
            return (
              <div key={key} className="glass-soft rounded-xl p-4 flex flex-col gap-3 row-hover">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.daysAhead === 0 ? "warning" : "neutral"}>{item.daysAhead === 0 ? "就是今天" : `还有 ${item.daysAhead} 天`}</Badge>
                  <Badge tone="primary">{item.reminderLabel}</Badge>
                  {item.milestone && <Badge tone="neutral">{item.milestone}</Badge>}
                  {item.source === "custom" && <Badge tone="primary"><Sparkles size={11} /> 自定义</Badge>}
                  {item.acked && <Badge tone="success"><CheckCheck size={11} /> 已处理</Badge>}
                  <span className="ml-auto text-xs text-muted masked-value">{item.reminderDate}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-base font-semibold">{item.nickname}</p>
                  {item.uid !== "__global__" && <span className="text-xs text-muted masked-value">UID {item.uid}</span>}
                </div>
                <p className="text-sm leading-relaxed text-muted">{item.greeting}</p>
                <div className="flex flex-wrap gap-2">
                  <Button className="text-xs" onClick={() => copyGreeting(item.greeting)}><Copy size={13} /> 复制祝福话术</Button>
                  <Button className="text-xs" disabled={busyKey === key} onClick={() => toggleAck(item)}>
                    {item.acked ? <RotateCcw size={13} /> : <CheckCheck size={13} />}
                    {item.acked ? "撤销处理" : "标记已处理"}
                  </Button>
                  {item.source === "custom" && item.customId !== null ? (
                    <Button className="text-xs" onClick={() => {
                      const target = customs.find((c) => c.id === item.customId);
                      if (target) setEditor(toEditor(target));
                    }}><Pencil size={13} /> 编辑纪念日</Button>
                  ) : (
                    <Button className="text-xs" onClick={() => goTo("fans")}>查看档案 <ArrowUpRight size={13} /></Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="上舰里程碑规则" extra={<Badge tone="neutral">两项独立开关</Badge>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Switch
            checked={hundredsEnabled}
            onChange={setHundredsEnabled}
            label="百日提醒（100×n 天）"
            hint="上舰满 100、200、300…天自动延伸，n 为任意正整数；每个节点只提醒一次"
          />
          <Switch
            checked={yearsEnabled}
            onChange={setYearsEnabled}
            label="周年提醒（n 年）"
            hint="上舰满 1、2、3…周年自动延伸，n 为任意正整数；每年循环一次"
          />
        </div>
        <div className="flex justify-end mt-3">
          <Button variant="primary" onClick={saveMilestones}>保存规则</Button>
        </div>
        <SectionHint tone="neutral">
          两类提醒互不影响，可分别开启或关闭。起算日优先取档案中的上舰日期，其次取首次互动时间，最后取最早的购买 / 续费事件；只有含年份的完整日期才能计算天数与第几周年。百日节点为一次性提醒、过期自动消失，周年节点每年循环；仅有「月日」时退回普通的「上舰周年」年度循环。
        </SectionHint>
      </Card>

      <Card
        title="自定义纪念日"
        extra={<Button variant="primary" onClick={() => setEditor(emptyEditor())}><Plus size={14} /> 新增纪念日</Button>}
      >
        {customs.length === 0 ? (
          <EmptyState title="还没有自定义纪念日" desc="可以记录开播周年庆、舰礼寄送日、相识 500 天等任意日期；留空关联粉丝即为全局纪念日。" />
        ) : (
          <div className="flex flex-col gap-2">
            {customs.map((c) => (
              <div key={c.id} className="glass-soft rounded-xl p-3 flex flex-wrap items-center gap-3 row-hover">
                <div className="min-w-[150px] flex-1">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {c.uid ? <><Users size={11} className="inline mr-1" />{c.nickname ?? c.uid}</> : "全局纪念日"}
                    {" · "}{ruleLabel(c.rule)}
                    {c.rule === "days" ? ` ${c.offsetDays} 天` : ""} · 起算 {c.anchorDate}
                  </p>
                  {c.note && <p className="text-xs text-muted mt-0.5">{c.note}</p>}
                </div>
                <Badge tone={c.enabled ? "success" : "neutral"}>{c.enabled ? "已启用" : "已停用"}</Badge>
                <div className="flex gap-2">
                  <Button className="text-xs" onClick={() => setEditor(toEditor(c))}><Pencil size={13} /> 编辑</Button>
                  <Button className="text-xs" onClick={() => toggleEnabled(c)}>{c.enabled ? "停用" : "启用"}</Button>
                  <Button className="text-xs" onClick={() => setDeleteTarget(c)}><Trash2 size={13} /> 删除</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionHint tone="neutral">
        提醒只读取本机档案，生日年份与地址始终不进入提醒文案；首次启动会推送一次 Windows 原生通知，最小化到托盘时同样可见。处理标记按「UID + 类型 + 具体日期」记录，年度循环项跨年自动重置，一次性节点过期后不再出现。
      </SectionHint>

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.id ? "编辑自定义纪念日" : "新增自定义纪念日"}
        footer={<>
          <Button onClick={() => setEditor(null)}>取消</Button>
          <Button variant="primary" disabled={saving} onClick={saveCustom}>保存纪念日</Button>
        </>}
      >
        {editor && (
          <div className="flex flex-col gap-4">
            <Field label="纪念日名称" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder="例如 开播周年庆 / 相识 500 天" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="起算日期" type="date" value={editor.anchorDate} onChange={(e) => setEditor({ ...editor, anchorDate: e.target.value })} />
              <SelectField label="关联粉丝" value={editor.uid ?? ""} onChange={(e) => setEditor({ ...editor, uid: e.target.value || null })}>
                <option value="">全局纪念日（不绑定粉丝）</option>
                {profiles.map((p) => <option key={p.uid} value={p.uid}>{p.currentNickname} · {p.uid}</option>)}
              </SelectField>
            </div>
            <SelectField label="提醒规则" value={editor.rule} onChange={(e) => setEditor({ ...editor, rule: e.target.value as ReminderRule })}>
              {CUSTOM_REMINDER_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </SelectField>
            <p className="text-xs text-muted -mt-2">{CUSTOM_REMINDER_RULES.find((r) => r.value === editor.rule)?.hint}</p>
            {editor.rule === "days" && (
              <Field label="累计天数" type="number" min={1} max={36500} value={editor.offsetDays ?? 100} onChange={(e) => setEditor({ ...editor, offsetDays: Number(e.target.value) })} hint="从起算日期开始计算的第 N 天，例如 100 表示上舰 100 天" />
            )}
            <Field label="备注（可选）" value={editor.note ?? ""} onChange={(e) => setEditor({ ...editor, note: e.target.value })} placeholder="仅保存在本机" />
            <Switch checked={editor.enabled ?? true} onChange={(v) => setEditor({ ...editor, enabled: v })} label="启用该纪念日" hint="停用后不再生成提醒，历史记录仍保留" />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除自定义纪念日"
        description={`确定删除「${deleteTarget?.title ?? ""}」吗？该纪念日的全部历史处理标记也会一并清除。`}
        detail="此操作只影响本机数据，不会删除粉丝档案；删除后无法撤销。"
        confirmText="确认删除"
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
      />
    </div>
  );
}
