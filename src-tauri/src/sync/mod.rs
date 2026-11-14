use crate::error::AppResult;

/// 后续 HTTP 快照同步将返回的最小成员结构（本期不参与任何写入）
#[derive(Debug, Clone)]
pub struct GuardMember {
    pub uid: String,
    pub nickname: String,
    pub guard_level: i32,
    pub rank: Option<i32>,
}

/// 同步源契约（依赖倒置）：本期**没有任何网络实现**。
/// 后续按 docs/ROADMAP.md 阶段一/三新增实现即可，不需要改动 profile.rs / import.rs。
pub trait SyncSource: Send + Sync {
    fn fetch_guard_snapshot(&self, room_id: &str) -> AppResult<Vec<GuardMember>>;
    fn source_kind(&self) -> &'static str;
}

/// 明确标记本期能力边界，避免误以为同步已可用
pub const SYNC_STATUS: &str = "本期仅手动导入：未实现 HTTP 快照、WebSocket 事件、WBI 签名、扫码登录与 Cookie 管理";
