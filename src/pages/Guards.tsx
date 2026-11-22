import { useCallback, useEffect, useState } from "react";
import { Ship, AlertTriangle, Clock3, Radio, FileDown } from "lucide-react";
import { Card, Badge, Button, SectionHint } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { ImportWizard } from "@/components/ImportWizard";
import { StatusBanner } from "@/components/StatusBanner";
import { callSafe, GUARD_LEVEL_TEXT, formatDateTime } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import type { GuardEventDto, GuardMemberDto, ImportResult, SnapshotDto } from "@/types/dto";

export default function Guards() {
  const { refresh, notify } = useApp();
  const [members, setMembers] = useState<GuardMemberDto[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotDto[]>([]);
  const [events, setEvents] = useState<GuardEventDto[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    const [m, s, e] = await Promise.all([
      callSafe<{ items: GuardMemberDto[] }>("guard_list"),
      callSafe<SnapshotDto[]>("guard_snapshots"),
      callSafe<GuardEventDto[]>("guard_events"),
    ]);
    if (m.data) setMembers(m.data.items ?? []);
    if (s.data) setSnapshots(s.data);
    if (e.data) setEvents(e.data);
  }, []);

  useEffect(() => { load().catch((err: unknown) => console.error("在舰名单加载失败：", err)); }, [load]);

  const onFinished = async (result: ImportResult) => {
    notify({ tone: "success", title: "名单已写入本地库", detail: `批次 #${result.batchId}：新增 ${result.newCount}、合并 ${result.mergeCount}` });
    await load();
    await refresh();
  };

  const memberCols: Column<GuardMemberDto>[] = [
    { key: "rank", title: "排名", width: "80px", render: (r) => <span className="text-muted">#{r.rank ?? "—"}</span> },
    { key: "uid", title: "UID", width: "130px", render: (r) => <span className="masked-value text-muted">{r.uid}</span> },
    { key: "nickname", title: "昵称", render: (r) => <span className="font-medium">{r.nickname}</span> },
    { key: "level", title: "大航海等级", width: "130px", render: (r) => <Badge tone={r.guardLevel === 1 ? "warning" : r.guardLevel === 2 ? "primary" : "neutral"}>{GUARD_LEVEL_TEXT[r.guardLevel]}</Badge> },
    { key: "valid", title: "会员有效期", width: "150px", render: (r) => <span className="masked-value">{r.validUntil ?? "待购买事件确认"}</span> },
    { key: "status", title: "状态", width: "130px", render: (r) => r.status === "expire_suspected"
      ? <Badge tone="warning"><AlertTriangle size={11} /> 疑似到期</Badge>
      : <Badge tone="success">在舰</Badge> },
  ];

  const eventCols: Column<GuardEventDto>[] = [
    { key: "time", title: "事件时间", width: "190px", render: (e) => <span className="text-xs muted">{formatDateTime(e.eventAt)}</span> },
    { key: "uid", title: "UID", width: "130px", render: (e) => <span className="masked-value text-muted">{e.uid}</span> },
    { key: "nickname", title: "昵称", render: (e) => <span className="font-medium">{e.nickname}</span> },
    { key: "type", title: "事件", width: "130px", render: (e) => <Badge tone={e.eventType === "expire_suspected" ? "warning" : e.eventType === "renew" ? "primary" : "success"}>{e.eventType === "purchase" ? "开通" : e.eventType === "renew" ? "续费" : "疑似到期"}</Badge> },
    { key: "months", title: "月数", width: "90px", render: (e) => <span className="text-muted">{e.unitMonths ? `${e.unitMonths} 个月` : "—"}</span> },
    { key: "price", title: "金额", width: "110px", render: (e) => <span className="masked-value">{e.priceYuan ? `¥ ${e.priceYuan.toFixed(0)}` : "—"}</span> },
    { key: "source", title: "来源", width: "110px", render: (e) => <span className="text-xs text-muted">{e.source === "import" ? "手动导入" : e.source}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StatusBanner
        tone="info"
        title="名单通过 CSV / Excel 手动导入"
        detail="快照以「每日名单」为粒度；每次导入都会复用同一套档案合并状态机。有效期以购买事件时间 + 购买月数核算，成员消失仅标记疑似到期，不自动删除档案。"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <Ship size={22} className="text-accent" />
          <div><p className="label-sm">当前在舰</p><p className="text-2xl font-semibold mt-1">{members.filter((m) => m.status === "active").length} 人</p></div>
        </div>
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <Clock3 size={22} className="text-warning" />
          <div><p className="label-sm">疑似到期</p><p className="text-2xl font-semibold mt-1">{members.filter((m) => m.status === "expire_suspected").length} 人</p></div>
        </div>
        <div className="glass rounded-2xl p-4 flex items-center gap-3">
          <Radio size={22} className="text-muted" />
          <div>
            <p className="label-sm">手动导入快照</p>
            <p className="text-sm font-medium mt-2 text-muted">共 {snapshots.length} 份</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setImportOpen((v) => !v)}>{importOpen ? "收起导入向导" : "导入在舰名单"}</Button>
        <Button onClick={() => notify({ tone: "info", title: "字段说明", detail: "guard_level：1 总督 / 2 提督 / 3 舰长；rank 为榜单排名；unit_months 与 price_yuan 用于有效期与收入归集。" })}><FileDown size={14} /> 查看字段规范</Button>
      </div>

      {importOpen && <ImportWizard onFinished={onFinished} />}

      <Card title="在舰名单" extra={<Badge tone="primary">{snapshots[0]?.snapshotDate ?? "暂无快照"} 快照</Badge>}>
        <DataTable columns={memberCols} rows={members} rowKey={(r) => r.uid} emptyTitle="暂无在舰名单" emptyDesc="通过导入向导写入 CSV / Excel 名单后即可查看" />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="每日快照" extra={<Badge tone="neutral">{snapshots.length} 份</Badge>}>
          <div className="flex flex-col gap-2">
            {snapshots.map((s) => (
              <div key={s.id} className="glass-soft rounded-xl px-3 py-2.5 flex items-center justify-between row-hover">
                <div><p className="text-sm font-medium masked-value">{s.snapshotDate}</p><p className="text-xs text-muted mt-0.5">{formatDateTime(s.fetchedAt)}</p></div>
                <Badge tone="neutral">{s.memberCount} 人</Badge>
              </div>
            ))}
            {snapshots.length === 0 && <p className="text-sm text-muted">暂无快照记录</p>}
          </div>
          <SectionHint tone="neutral">某日快照缺失不可追回，但可随时「手动导入该日名单」补录。</SectionHint>
        </Card>

        <Card title="大航海事件" className="xl:col-span-2" extra={<Badge tone="neutral">最近 {events.length} 条</Badge>}>
          <DataTable columns={eventCols} rows={events} rowKey={(e) => String(e.id)} emptyTitle="暂无事件" emptyDesc="导入购买/续费记录后显示" />
        </Card>
      </div>
    </div>
  );
}
