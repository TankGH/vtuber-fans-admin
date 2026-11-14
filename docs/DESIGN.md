# 详细设计 · vtuber-fans-admin

> **权威需求来源**：[`../requirement-doc.md`](../requirement-doc.md)。本文为实现层详细设计；架构分层与安全模型见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)，后续能力见 [`ROADMAP.md`](./ROADMAP.md)。
> **当前范围（v0.2.0）**：F1–F7 均可用；F3 / F4 / F5 为完整业务页面；同步引擎为**用户可选启用**的网页端低频快照（默认关闭，启用后按需扫码登录），不含 WebSocket 实时事件订阅。

## 1. 需求追溯矩阵

| 功能域 | 需求点 | 当前状态 | 交付物 |
| --- | --- | --- | --- |
| F1 粉丝终身档案 | UID 主键、昵称变更历史 | ✅ 实现 | `fan_profile` / `fan_nickname_history` + `profile_*` |
| F1 | 首次互动 / 生日 / 上舰周年 / 观看纪念日 / 地址 / 备注 | ✅ 实现 | DTO + 表单 + 详情侧滑 |
| F1 | 多来源录入、手动锁定字段 | ✅ 实现（自动同步来源暂缺） | `manual_locked_fields` + 合并状态机 |
| F1 | 同 UID 合并保留最早首次互动时间 | ✅ 实现 | `profile.rs` / `import.rs` 单事务 |
| F1 | 地址生日加密 + UI 默认脱敏 | ✅ 实现 | 字段级 AES-256-GCM + 脱敏 DTO |
| F2 大航海 | L1 HTTP 快照 / L2 WebSocket | ✅ L1 实现（可选启用）/ L2 未实现 | `sync::bilibili::BiliSource` + `sync::apply_snapshot`；WBI 签名、扫码登录、加密凭证 |
| F2 | L3 手动补录（CSV / Excel） | ✅ 实现 | `import.rs` + 导入向导 |
| F2 | 快照 diff / 有效期核算 / 疑似到期 | ✅ 数据层 | `guard.rs` 查询与核算；写入来自导入 |
| F2 | 失败降级、状态栏文案 | ✅ 基础框架 | `error.rs` 错误码 + 前端状态栏 |
| F3 纪念日提醒 | 汇总卡片 / Toast / 快捷操作 / 顶栏角标 | ✅ 实现 | `reminder_ack` 表 + `reminder.rs` + `Reminders.tsx` + 原生 Toast |
| F4 舰礼寄送 | 地址审核 / 寄送批次 / 发货状态 / 隐私导出 | ✅ 实现 | `gift_batch` / `gift_shipment` 表 + `gifts.rs` + `Gifts.tsx` |
| F5 记账本 | 收入归集 / 支出 / 趋势图 / 批次成本 | ✅ 实现 | `ledger_entry` 表 + `ledger.rs` + `Ledger.tsx`（recharts 按需加载） |
| F6 备份恢复 | 启动自动备份、7 份滚动 | ✅ 实现 | `backup.rs` + `manifest.json` |
| F6 | 一键恢复向导、重启完成 | ✅ 实现 | `restore.json` 标记 + 恢复流程 |
| F6 | 加密库导出 / 脱敏 CSV 导出 | ✅ 实现 | `backup_*` + 二次确认 |
| F6 | 上次备份时间常驻、超 3 天温和提示 | ✅ 实现 | 状态栏 + 概览健康横幅 |
| F7 设置与主题 | 三套主题即时切换 | ✅ 实现 | `data-theme` CSS 变量 |
| F7 | 备份目录、托盘行为 | ✅ 实现 | `app_settings` + 设置页 |
| F7 | 自动抓取开关 / 房间号 / 快照时刻 / 扫码登录 | ✅ 实现 | `sync_set_enabled` 需二次确认；`SyncPanel.tsx` 提供开关、扫码弹窗与登录状态 |
| Windows 易用性 | 双击即用 / 托盘 / Toast / 人类可读错误 | ✅ 实现（Toast 用于备份结果） | Tauri 插件 + `error.rs` |

## 2. 数据库设计（全量 DDL）

> 一次建全量，避免后续重复迁移；F3/F4/F5 表已全部接入业务。敏感字段一律密文 BLOB，B 站凭证单独存为 `bili_session.enc`。

### 2.1 核心表（依据需求文档 3.3）

```sql
-- 粉丝主档案
CREATE TABLE IF NOT EXISTS fan_profile (
  uid TEXT PRIMARY KEY,
  current_nickname TEXT NOT NULL,
  birthday_encrypted BLOB,             -- JSON: {month, day, year?}，AES-GCM 密文
  first_interaction_at TEXT,
  guard_anniversary_date TEXT,
  watch_anniversary_date TEXT,
  address_encrypted BLOB,              -- JSON: {receiver, phone, province, city, district, detail}
  address_status TEXT NOT NULL DEFAULT 'none', -- none/pending/valid/invalid/shipped
  note TEXT,
  manual_locked_fields TEXT NOT NULL DEFAULT '[]', -- JSON array
  source TEXT NOT NULL DEFAULT 'manual',          -- manual / import / snapshot / websocket
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fan_profile_updated ON fan_profile(updated_at);

CREATE TABLE IF NOT EXISTS fan_nickname_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL REFERENCES fan_profile(uid) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nickname_history_uid ON fan_nickname_history(uid);

-- 大航海快照
CREATE TABLE IF NOT EXISTS guard_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import',
  raw_response_hash TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS guard_snapshot_member (
  snapshot_id INTEGER NOT NULL REFERENCES guard_snapshot(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  nickname TEXT,
  guard_level INTEGER NOT NULL,   -- 1 总督 / 2 提督 / 3 舰长
  rank INTEGER,
  PRIMARY KEY (snapshot_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_guard_member_uid ON guard_snapshot_member(uid);

-- 大航海事件（当前来源 manual / import；snapshot diff 推断尚未实现）
CREATE TABLE IF NOT EXISTS guard_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  event_type TEXT NOT NULL,       -- purchase / renew / expire_suspected
  guard_level INTEGER,
  unit_months INTEGER,
  price_yuan REAL,
  event_at TEXT NOT NULL,
  source TEXT NOT NULL,           -- websocket / snapshot / manual / import
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_guard_event_at ON guard_event(event_at);
CREATE INDEX IF NOT EXISTS idx_guard_event_uid ON guard_event(uid);
```

### 2.2 扩展表（台账 / 同步 / 辅助）

```sql
CREATE TABLE IF NOT EXISTS import_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,        -- csv / xlsx
  total_rows INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  merge_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_ack (
  uid TEXT NOT NULL,
  reminder_type TEXT NOT NULL,    -- birthday / guard_anniv / watch_anniv
  reminder_date TEXT NOT NULL,
  acked_at TEXT,
  PRIMARY KEY (uid, reminder_type, reminder_date)
);

CREATE TABLE IF NOT EXISTS gift_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
);
CREATE TABLE IF NOT EXISTS gift_shipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES gift_batch(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  shipment_status TEXT NOT NULL DEFAULT 'pending',
  tracking_no TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL,       -- income / expense
  category TEXT NOT NULL,
  amount_yuan REAL NOT NULL,
  occurred_at TEXT NOT NULL,
  batch_id INTEGER,
  guard_event_id INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,             -- import / backup / restore / theme / profile
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**设计要点**
- `uid TEXT PRIMARY KEY`，昵称永远不是主键；导入时数字形态昵称不自动当 UID（工作区约定：`晚 风`、`大幕丶渐起` 等昵称原样保留）。
- `birthday_encrypted` / `address_encrypted` 为 BLOB，明文不出 Rust 侧；DTO 只含 `birthday_masked` / `address_masked`。
- `manual_locked_fields` 为 JSON 数组，是合并状态机的**唯一裁决依据**。
- `guard_snapshot.snapshot_date UNIQUE` 防同日重复导入；手动导入「某日名单」时以日期去重。

## 3. IPC Command 清单

| Command | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `app_bootstrap` | — | `BootstrapDto` | 统计、设置、备份健康、活动记录一次性取回 |
| `profile_list` | `ProfileQuery` | `Paged<FanProfileDto>` | 分页 + 搜索 + 筛选，默认脱敏 |
| `profile_get` | `uid` | `FanProfileDto` | 含昵称历史 |
| `profile_create` | `FanProfileInput` | `FanProfileDto` | 手动新建，自动锁定全部填写字段 |
| `profile_update` | `uid`, `FanProfileInput` | `FanProfileDto` | 更新字段并合并锁定集合 |
| `profile_reveal_address` | `uid`, `confirm: bool` | `AddressDto` | **二次确认**才返回完整地址 |
| `profile_set_lock` | `uid`, `field`, `locked` | `FanProfileDto` | 手动锁定开关 |
| `guard_list` | `GuardQuery` | `Paged<GuardMemberDto>` | 最新快照成员 + 有效期 |
| `guard_snapshots` | — | `Vec<SnapshotDto>` | 快照日期与人数 |
| `guard_events` | `uid?` | `Vec<GuardEventDto>` | 事件时间线 |
| `import_parse` | `file_path`, `mapping`, `kind` | `ImportPreview` | **只读解析，不写库** |
| `import_commit` | `file_path`, `mapping`, `kind` | `ImportResult` | 单事务批量写入 |
| `backup_list` | — | `Vec<BackupDto>` | 7 份滚动备份 + 校验状态 |
| `backup_now` | — | `BackupDto` | 立即备份 |
| `backup_export_db` | `dest_path`, `confirm` | `ExportResult` | 加密库导出 |
| `backup_export_csv` | `dest_path` | `ExportResult` | 脱敏 CSV 导出 |
| `restore_prepare` | `backup_id`, `confirm` | `RestorePlan` | 写 `restore.json`，先自动备份当前库 |
| `settings_get` | — | `SettingsDto` | 主题 / 目录 / 托盘 / 同步开关与提醒配置 |
| `settings_update` | `SettingsInput` | `SettingsDto` | 即时生效；不负责开启同步 |
| `open_data_dir` | — | `()` | 打开本地数据目录 |
| `reminder_list` / `reminder_ack` / `reminder_notify` | `ReminderQuery` / `ReminderAckInput` / — | `ReminderDto[]` / `ReminderDto` / `bool` | F3 汇总、处理标记、每日一次原生 Toast |
| `gift_batch_list` / `gift_batch_create` | — / `GiftBatchInput` | `GiftBatchDto[]` / `GiftBatchDto` | F4 批次 |
| `gift_shipment_list` / `gift_shipment_update` / `gift_address_set_status` | `batchId` / `GiftShipmentInput` / `uid,status` | `GiftShipmentDto[]` / `GiftShipmentDto` / `()` | F4 逐条寄送与地址审核 |
| `gift_shipment_reveal_address` / `gift_batch_export` | `id, confirm` / `batchId, confirm` | `AddressDto` / `ExportResult` | 完整地址二次确认 + 脱敏导出 |
| `ledger_list` / `ledger_create` / `ledger_delete` | `LedgerQuery` / `LedgerInput` / `id,confirm` | `LedgerEntryDto[]` / `LedgerEntryDto` / `()` | F5 账目 |
| `ledger_summary` / `ledger_sync_events` | — | `LedgerSummaryDto` | 月度汇总与事件幂等归集 |
| `sync_status` / `sync_set_enabled` | — / `enabled,confirm` | `SyncStatusDto` | 状态读取与用户显式开关（开启需二次确认） |
| `sync_qr_start` / `sync_qr_poll` | — | `SyncQrDto` / `SyncQrPollDto` | 本机生成二维码与按需登录轮询 |
| `sync_logout` / `sync_snapshot_now` | — | `SyncStatusDto` / `SyncSnapshotResultDto` | 清除凭证与手动触发快照 |

> 所有 `sync_*` 命令都在 `spawn_blocking` 中执行，避免同步 HTTP 阻塞主窗口；`sync_set_enabled` 之外没有任何命令会改变开关状态。

**DTO 对齐**：`src/types/dto.ts` 与 `src-tauri/src/models.rs` 一一对应；`src/lib/ipc.ts` 统一封装 `invoke` 并把错误码映射为中文文案。dev 环境（非 Tauri WebView）走演示数据适配器，保证 `npm run dev` 可独立验证全部 UI。

## 4. 导入与合并状态机（F1.3 / F1.4）

```
选文件 → 字段映射 → 预览(只读) → 确认 → 单事务写入 → 逐行结果报告
```

**字段映射**：CSV / xlsx 表头 → `uid`、`nickname`、`guard_level`、`rank`、`first_interaction_at`、`birthday`、`address`、`note`。昵称不做 trim / 去空格 / 标点归一化；`role` 映射 `提督=2 / 舰长=3 / 总督=1`。

**预览分类**（`ImportPreview`）：
| 分类 | 判定 | 处理 |
| --- | --- | --- |
| `new` | UID 不存在 | 新建档案 + 昵称历史首条 |
| `merge` | UID 已存在且无锁定冲突 | 按规则合并 |
| `conflict` | UID 已存在且目标字段被手动锁定 | 跳过该字段，列出 `FieldConflict{field, reason}` |
| `invalid` | 缺 UID / 等级非法 / 日期格式错误 | 跳过并给出错误行 |

**合并规则（不可变）**：
1. `first_interaction_at` 取**最早**值（含空值处理：非空才参与比较）。
2. `manual_locked_fields` 中的字段**永不**被导入/同步覆盖。
3. 昵称变化追加 `fan_nickname_history` 并更新 `current_nickname`（若昵称未被锁定）。
4. 加密字段以新密文写入，写前重新加密；预览不产生明文落盘。
5. 全部写入在同一事务；任一行失败整体回滚，返回逐行结果。

## 5. 备份与恢复流程（F6）

**启动自动备份**
1. `VACUUM INTO` 生成一致性快照 → AES-256-GCM 整体封装 → 写入用户指定备份目录 `backup-YYYYMMDD-HHmmss.enc`。
2. 更新 `manifest.json`：日期、记录数摘要（粉丝数 / 快照数 / 事件数）、文件大小、SHA-256 校验值。
3. 保留最近 7 份，滚动删除更旧的备份；结果写 `activity_log` 并更新「上次备份时间」。
4. 备份目录不可写 / 磁盘不足 → 中文错误 + 状态栏提示，不静默失败。

**恢复（幂等）**
```
选择备份 → 二次确认 → 自动备份当前库 → 写 restore.json 标记 → 重启应用
  → 启动时检测到标记 → 打开数据库前替换为选中备份 → 校验记录数 → 清除标记
  → 失败则保留标记与当前库备份，界面提示可回退
```
> 恢复必须先为当前库再备份一次，保证任何恢复都可回退（安全边界）。

**导出**：默认脱敏 CSV；导出完整地址或加密库文件时必须二次确认，前端先展示脱敏预览。

## 6. 错误码与人类可读文案（唯一错误源 `error.rs`）

| 错误码 | 界面文案 | 建议动作 |
| --- | --- | --- |
| `E_DB_OPEN` | 数据库打开失败，可能被其它程序占用 | 关闭占用程序后重试 |
| `E_DB_MIGRATE` | 本地数据结构升级失败，已保留原始文件 | 从备份恢复 |
| `E_CRYPTO_KEY` | 本机密钥不可用，无法读取敏感信息 | 从备份恢复或重新初始化 |
| `E_IMPORT_FORMAT` | 文件格式错误或表头无法识别 | 检查列名与编码（建议 UTF-8） |
| `E_IMPORT_UID` | 存在缺少 UID 的记录，已跳过 | 补齐 UID 后重新导入 |
| `E_BACKUP_DIR` | 备份目录不可写，请重新选择目录 | 前往设置更换目录 |
| `E_BACKUP_IO` | 备份写入失败，可能是磁盘空间不足 | 清理磁盘后重试 |
| `E_RESTORE_VERIFY` | 备份校验未通过，未改动当前数据 | 选择其它备份 |
| `E_SYNC_COOKIE` | B 站登录态失效或未登录，请重新扫码登录 | 前往设置重新扫码登录 |
| `E_SYNC_NETWORK` | 无法连接 B 站，请检查网络后重试 | 检查网络；也可关闭自动抓取并手动导入 |
| `E_SYNC_API` | B 站接口返回异常，可稍后重试或使用手动导入 | 稍后重试或改用 CSV / Excel 手动导入 |
| `E_INTERNAL` | 操作未完成，已保留原始数据 | 重试；仍失败则查看诊断信息 |

> 日志只记录错误码、操作类型与行数，**不记录** Cookie、收件人、电话、完整地址、生日与主密钥。

## 7. 三套主题与 UI 契约

| 主题 | `data-theme` | 背景 | 主色 | 文字 |
| --- | --- | --- | --- | --- |
| 守村人深蓝（默认） | `galaxy` | `#0B1220` / 玻璃面板 `#111C34` | `#2563EB → #38BDF8 → #6366F1` | `#F8FAFC` / `#94A3B8` |
| 晨雾浅色 | `mist` | `#F5F7FB` / 白色玻璃面板 | 同上，降低明度 | `#1E293B` / `#64748B` |
| 暖霞 | `aurora` | `#1B1424` / 暖紫玻璃面板 | `#F59E0B → #EF4444 → #6366F1` | `#FDF7F3` / `#C4B5BD` |

**CSS 变量**：`--bg` / `--surface` / `--surface-2` / `--border` / `--text` / `--text-muted` / `--primary` / `--accent` / `--success` / `--warning` / `--danger` / `--glow`。切换仅改根元素 `data-theme`，不重启、不重渲染整树。

**全局框架**：固定顶栏（产品标识 / 全局搜索 / 备份状态徽标 / 主题切换 / 最小化到托盘）+ 固定侧栏（概览、粉丝档案、大航海与导入、备份恢复、系统设置 + 「业务台账」分组）+ 固定底部状态栏（数据库位置 / 粉丝总数 / 上次备份时间 / 脱敏模式）。主内容区留出顶栏与底栏高度，表格可横向滚动。

**交互契约**：危险操作（恢复、导出完整地址、展开完整地址）一律红色二次确认弹窗；禁用态降低透明度并附说明文案；卡片入场轻微上浮、按钮点击微缩放、导航悬停渐亮；文字对比度满足长时间阅读；导入向导与表格翻页可键盘完成。

## 8. 测试设计

| 层 | 用例 |
| --- | --- |
| Rust `profile.rs` | 同 UID 合并保留最早首次互动时间；锁定字段不被覆盖；昵称变化写历史 |
| Rust `crypto.rs` | AES-GCM 往返、篡改密文失败、脱敏格式（省市区 / 月日） |
| Rust `import.rs` | CSV 流式解析、xlsx sheet 解析、缺 UID / 非法等级跳过、含空格与 `丶` 昵称原样保留 |
| Rust `backup.rs` | 7 份滚动删除顺序、manifest 记录数与校验值、恢复标记幂等 |
| Rust `error.rs` | 每个错误码都有中文文案 |
| 前端 Vitest | IPC 错误码映射、导入预览分类、主题切换只改 `data-theme` |
| 端到端 | Vite dev server 下用 playwright-cli 验证五个页面渲染、导入向导、主题切换、二次确认弹窗 |

> 验证范围必须区分「前端已验证」与「Tauri 原生端已验证」，结果写入根 `README.md`，不混淆、不伪造。
