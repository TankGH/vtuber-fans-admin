use chrono::Datelike;

use crate::db::Db;
use crate::error::AppResult;
use crate::models::{GuardEventDto, GuardMemberDto, SnapshotDto};

/// 有效期以购买/续费事件时间 + 购买月数核算；快照消失仅标记疑似到期
pub fn list_members(db: &Db) -> AppResult<Vec<GuardMemberDto>> {
    let mut stmt = db.conn.prepare(
        "SELECT m.uid, COALESCE(p.current_nickname, m.nickname), m.guard_level, m.rank, s.snapshot_date
         FROM guard_snapshot_member m
         JOIN guard_snapshot s ON s.id = m.snapshot_id
         LEFT JOIN fan_profile p ON p.uid = m.uid
         WHERE m.snapshot_id = (SELECT MAX(id) FROM guard_snapshot)
         ORDER BY m.rank ASC, m.uid ASC",
    )?;
    let rows = stmt.query_map([], |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i32>(2)?,
        r.get::<_, Option<i32>>(3)?, r.get::<_, String>(4)?,
    )))?;
    let mut members = Vec::new();
    for row in rows {
        let (uid, nickname, guard_level, rank, snapshot_date) = row?;
        let latest: Option<(String, Option<i32>)> = db.conn.query_row(
            "SELECT event_at, unit_months FROM guard_event
             WHERE uid = ?1 AND event_type IN ('purchase','renew') AND unit_months IS NOT NULL
             ORDER BY event_at DESC LIMIT 1",
            [&uid], |r| Ok((r.get(0)?, r.get(1)?)),
        ).ok();
        let valid_until = latest.and_then(|(at, months)| add_months(&at, months.unwrap_or(0)));
        let suspected: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM guard_event WHERE uid = ?1 AND event_type = 'expire_suspected'",
            [&uid], |r| r.get(0),
        ).unwrap_or(0);
        members.push(GuardMemberDto {
            uid, nickname, guard_level, rank, valid_until,
            status: if suspected > 0 { "expire_suspected".to_string() } else { "active".to_string() },
            snapshot_date: Some(snapshot_date),
        });
    }
    Ok(members)
}

pub fn list_snapshots(db: &Db) -> AppResult<Vec<SnapshotDto>> {
    let mut stmt = db.conn.prepare(
        "SELECT s.id, s.snapshot_date, s.fetched_at, s.source,
         (SELECT COUNT(*) FROM guard_snapshot_member m WHERE m.snapshot_id = s.id)
         FROM guard_snapshot s ORDER BY s.id DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok(SnapshotDto {
        id: r.get(0)?, snapshot_date: r.get(1)?,
        fetched_at: r.get(2)?, source: r.get(3)?, member_count: r.get::<_, i64>(4)? as usize,
    }))?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

pub fn list_events(db: &Db, uid: Option<&str>) -> AppResult<Vec<GuardEventDto>> {
    let sql = "SELECT e.id, e.uid, COALESCE(p.current_nickname, e.nickname), e.event_type,
       e.guard_level, e.unit_months, e.price_yuan, e.event_at, e.source
       FROM guard_event e LEFT JOIN fan_profile p ON p.uid = e.uid
       WHERE (?1 IS NULL OR e.uid = ?1) ORDER BY e.event_at DESC, e.id DESC LIMIT 200";
    let mut stmt = db.conn.prepare(sql)?;
    let rows = stmt.query_map([uid], |r| Ok(GuardEventDto {
        id: r.get(0)?, uid: r.get(1)?, nickname: r.get(2)?, event_type: r.get(3)?,
        guard_level: r.get(4)?, unit_months: r.get(5)?, price_yuan: r.get(6)?,
        event_at: r.get(7)?, source: r.get(8)?,
    }))?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

fn add_months(iso: &str, months: i32) -> Option<String> {
    let dt = chrono::DateTime::parse_from_rfc3339(iso).ok()?.with_timezone(&chrono::Utc);
    let mut year = dt.year();
    let mut month = dt.month() as i32 + months;
    while month > 12 { month -= 12; year += 1; }
    while month < 1 { month += 12; year -= 1; }
    let day = dt.day().min(28);
    chrono::NaiveDate::from_ymd_opt(year, month as u32, day)
        .map(|d| d.format("%Y-%m-%d").to_string())
}
