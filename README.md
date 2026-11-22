# 守村人·粉丝档案

面向 VTB 主播本人与助理的 **Windows 本地桌面工具**。粉丝档案、地址、生日与消费记录全部保存在用户本机，**没有云端后端、没有遥测、不访问任何外部服务**。

> **版本管理**：源码仓库为 `https://github.com/TankGH/vtuber-fans-admin.git`；粉丝数据、主密钥与备份文件始终只保存在用户本机，不入库、不上传。
>
> **文档**：实现层说明见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) / [`docs/DESIGN.md`](./docs/DESIGN.md) / [`docs/ROADMAP.md`](./docs/ROADMAP.md)；安装部署与日常操作见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)。

## 当前范围（v0.3.0）

| 功能域 | 状态 | 说明 |
| --- | --- | --- |
| F1 粉丝终身档案 | 可用 | UID 主键、昵称历史、手动锁定字段、同 UID 合并、敏感字段加密与脱敏；批量删除与二次确认；星座推算、总督/提督/舰长徽章，退出最新名单的成员标注「已过期」 |
| F2 大航海名单 | 可用 | **仅支持 CSV / Excel 手动导入**：字段映射、冲突预览、快照与购买 / 续费事件、有效期核算；快照日期可补录且拒绝未来日期；随包 CSV 模板可导出 |
| F3 纪念日提醒 | 可用 | 生日 / 观看纪念日按年度循环；上舰百日（`100×n` 天）与周年（`n` 年）双开关；用户自建纪念日（每年 / 起算后第 N 天 / 仅一次）；来源筛选、Windows Toast、祝福话术与处理标记 |
| F4 舰礼寄送台账 | 可用 | 寄送批次、地址审核流转、逐条发货状态与快递单号、完整地址二次确认、脱敏清单导出 |
| F5 主播记账本 | 可用 | 手动收支、大航海事件幂等归集、月度趋势图、支出关联寄送批次 |
| F6 备份与恢复 | 可用 | 启动自动备份、最近 7 份滚动、一键恢复向导、加密库与脱敏 CSV 导出 |
| F7 设置与主题 | 可用 | 三套主题即时切换、备份目录、托盘行为、一键清除全部保存的数据（强提醒 + 二次确认） |

## 安全边界

| 边界 | 规则 |
| --- | --- |
| 网络 | **零外联**。应用不发起任何外部网络请求；名单数据只能来自 CSV / Excel 手动导入或本机录入，只写入本地 SQLite，不上传任何服务端 |
| 敏感字段 | 地址、生日以 AES-256-GCM 密文落盘，主密钥由 Windows DPAPI（CurrentUser）保护 |
| 默认视图 | 地址仅显示「省+市+区」，生日仅显示「月日」；完整地址需二次确认 |
| 导出 | 默认脱敏 CSV；导出加密库文件 / 完整地址必须二次确认 |
| 日志 | 只记录错误码、操作类型与行数，绝不写入收件人、电话、完整地址、生日或主密钥 |
| 恢复 | 恢复前自动为当前库再备份一次，任何恢复都可回退 |

> **与需求文档的可审计偏差**：需求文档 3.3 指定 SQLCipher 全库加密。Windows/MSVC 下 `bundled-sqlcipher-vendored-openssl` 需要 Perl / NASM / OpenSSL 源码编译链，当前采用「SQLite + 字段级 AES-256-GCM + DPAPI 主密钥 + 备份整体加密」的降级方案。详见 `docs/ARCHITECTURE.md` §4 与 `docs/ROADMAP.md`。敏感字段仍是密文，数据仍不出本机。

## 目录

```
vtuber-fans-admin/
├── docs/                      架构 / 详细设计 / 演进路线 / 部署与使用指南
├── src/                       React + TS 前端（页面 / 组件 / IPC 契约 / 主题）
├── src-tauri/                 Rust Core（Commands / 领域服务 / schema / 加密 / 备份）
├── scripts/                   Windows 一键打包脚本（自动加载 MSVC 环境）
├── src/assets/fans_sample.csv 导入模板
├── index.html / vite.config.ts / tailwind.config.ts / tsconfig*.json
└── package.json
```

## 本地开发

> 面向使用者的安装、首启、导入、备份、升级与排障流程见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)；本节只保留开发者速查。

### 前置工具链（Windows）

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 20 | 前端构建 |
| Rust stable `x86_64-pc-windows-msvc` | `rustup-init.exe -y --default-toolchain stable --profile minimal --default-host x86_64-pc-windows-msvc` |
| Visual Studio Build Tools 2022 | 勾选「C++ 生成工具」+ Windows SDK，提供 `cl.exe` / `link.exe` |
| WebView2 Runtime | Windows 11 / 已装 Edge 通常自带 |

验证：`npm run typecheck`、`cargo --version`、`rustc --version`。

> **MSVC 环境提示**：`rustup` 安装后，新开的终端需把 `%USERPROFILE%\.cargo\bin` 加入 PATH；运行 `cargo check` / `cargo test` 前还需加载 VS Build Tools 的 `vcvars64.bat`，为 `link.exe` 与 Windows SDK 库提供环境变量。

### 命令

```powershell
npm install                 # 安装前端依赖
npm run dev                 # 仅前端（Vite dev server + 演示数据适配器）
npm run build               # tsc --noEmit && vite build
npm run test                # Vitest 前端单测
npm run tauri:dev           # 完整桌面应用（需 Rust 工具链）
npm run tauri:build         # 打包 NSIS 安装包（.exe）
```

Rust 侧（MSVC 环境内）：`cd src-tauri; cargo check; cargo test`。

### 数据目录

| 内容 | 默认位置 |
| --- | --- |
| 数据目录 | `%APPDATA%\com.vtuber.fans.admin`（由 Tauri `app_data_dir()` 解析，界面状态栏 / 设置页显示实际路径） |
| 数据库 | 数据目录下 `fans.db` |
| 主密钥 | 数据目录下 `app.key`（Windows DPAPI CurrentUser 保护） |
| 配置 | 数据目录下 `settings.json` |
| 备份 | 首启引导中由用户选择，默认 `%USERPROFILE%\Documents\vtuber-fans-admin-backups` |
| 恢复标记 | 数据目录下 `restore.json` |

> 所有上述文件都不进入 git（见 `.gitignore`）。请勿手动编辑或删除 `app.key`：它绑定当前 Windows 用户，丢失后密文敏感字段无法解密。

## 使用流程

1. 首次启动：两步引导（选择备份目录 → 完成），随后自动创建数据库与首个备份。
2. 「粉丝档案」：新建档案、编辑备注、开关字段锁定、查看昵称变更历史；列表与详情显示星座和大航海等级徽章，退出最新名单的成员显示灰化徽章与「已过期」；敏感段默认折叠。
3. 「大航海与导入」：选择 CSV / xlsx → 字段映射（含购买月数、金额、事件类型、购买日期）→ 预览新增/合并/冲突 → 可指定过去日期补录快照（未来日期会被明确拒绝）→ 确认写入 → 结果里显示生成的购买 / 续费事件数与实际快照日期。事件可在记账本归集为收入。
4. 「纪念日提醒」：按提前天数汇总未来节点，可按「自动生成 / 自定义」筛选，复制祝福话术、标记已处理；百日与周年两个开关互不干扰；自定义纪念日支持新增 / 编辑 / 停用 / 删除。顶栏角标显示待处理数量，首次启动推送一次 Windows Toast。
5. 「舰礼寄送台账」：新建批次并勾选在舰成员 → 逐条审核地址、登记寄送状态与快递单号 → 导出脱敏清单；完整地址需二次确认且电话打码。
6. 「主播记账本」：手动记收支、一键归集大航海事件收入（同一事件不重复计入）、查看月度趋势与净额。
7. 「备份恢复」：查看 7 份滚动备份、立即备份、一键恢复、导出脱敏 CSV 或加密库。
8. 「系统设置」：切换主题、更换备份目录、配置关窗行为、必要时清除本机数据。

导入页「导出模板」可生成随应用打包的 `fans_sample.csv`：昵称含空格、`丶` 顿号变体、生僻字与纯数字形态均原样保留，**数字形态昵称不会自动被当作 UID**。

## 验证

开发完成后应依次执行并通过：`npm run build`、`npm run test`、`cd src-tauri && cargo check && cargo test`、`npm run tauri:build`。浏览器演示模式（`npm run dev`）与 Tauri 原生窗口属于两种运行形态，验证结论必须分别记录，不得混同。

## 失败降级路径

| 情况 | 处理 |
| --- | --- |
| `cl.exe` / `link.exe` 缺失 | 安装 VS Build Tools 2022（C++ 生成工具 + Windows SDK）；安装期间可用 `npm run dev` 独立验证前端 |
| 无管理员权限导致安装失败 | 请以管理员身份运行安装器；代码与文档不依赖该权限即可审阅 |
| OpenSSL / Perl / NASM 缺失 | 当前未启用 SQLCipher（见 §安全边界），不影响 `cargo check` |
| 备份目录不可写 | 界面提示「备份目录不可写，请重新选择目录」，已有数据不受影响 |
| 恢复校验失败 | 保留当前库与自动备份，界面提示选择其它备份，不改动现有数据 |
