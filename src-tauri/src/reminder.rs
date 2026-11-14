use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{params, OptionalExtension};

use crate::crypto::now_iso;
use crate::db::{log_activity, Db};
use crate::error::{AppError, AppResult};
use crate::models::{
    BirthdayValue, ReminderAckInput, ReminderDto, ReminderQuery, REMINDER_TYPES,
};

pub fn label(kind: &str) -> &'static str {
    match kind {
        "birthday" => "生日",
        "guard_anniversary" => "上舰周年",
        "watch_anniversary" => "观看纪念日",
        _ => "纪念日",
    }
}

fn greeting(nickname: &str, kind: &str) -> String {
    match kind {
        "birthday" => format!("{nickname}，生日快乐！感谢又一年并肩守村。"),
        "guard_anniversary" => format!("{nickname}，上舰周年快乐！谢谢一直以来的支持。"),
        _ => format!("{nickname}，观看纪念日快乐！谢谢你陪我们走到今天。"),
    }
}

/// 支持「YYYY-MM-DD」与「MM-DD」两种录入格式；后者按年度循环计算
fn parse_month_day(raw: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = raw.trim().split(['-', '/', '.', '月']).filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 { return None; }
    let month = parts[0].trim().parse::<u32>().ok()?;
    let day = parts[1].trim().trim_end_matches('日').parse::<u32>().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
    Some((month, day))
}

fn date_in_year(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if NaiveDate::from_ymd_opt(year, 2, 29).is_some() { 29 } else { 28 },
        _ => return None,
    };
    NaiveDate::from_ymd_opt(year, month, day.min(max_day))
}

/// 返回下一次到来的日期与距离今天的天数；2 月 29 日在平年按 2 月 28 日提醒
pub fn next_occurrence(month: u32, day: u32, today: NaiveDate) -> Option<(NaiveDate, i32)> {
    let this_year = date_in_year(today.year(), month, day)?;
    let target = if this_year >= today {
        this_year
    } else {
        date_in_year(today.year() + 1, month, day)?
    };
    Some((target, (target - today).num_days() as i32))
}

fn is_acked(db: &Db, uid: &str, kind: &str, date: &str) -> AppResult<(bool, Option<String>)> {
    let row: Option<Option<String>> = db.conn.query_row(
        "SELECT acked_at FROM reminder_ack WHERE uid=?1 AND reminder_type=?2 AND reminder_date=?3",
        params![uid, kind, date], |r| r.get(0),
    ).optional()?;
    Ok(match row {
        Some(v) => (v.is_some(), v),
        None => (false, None),
    })
}

fn push_reminder(
    db: &Db, out: &mut Vec<ReminderDto>, uid: &str, nickname: &str,
    kind: &str, month_day: (u32, u32), today: NaiveDate, window: i32,
) -> AppResult<()> {
    let Some((date, days_ahead)) = next_occurrence(month_day.0, month_day.1, today) else { return Ok(()); };
    if days_ahead > window { return Ok(()); }
    let date_s = date.format("%Y-%m-%d").to_string();
    let (acked, acked_at) = is_acked(db, uid, kind, &date_s)?;
    out.push(ReminderDto {
        uid: uid.to_string(),
        nickname: nickname.to_string(),
        reminder_type: kind.to_string(),
        reminder_label: label(kind).to_string(),
        reminder_date: date_s,
        days_ahead,
        acked,
        acked_at,
        greeting: greeting(nickname, kind),
    });
    Ok(())
}

/// 只输出脱敏信息：生日仅保留月日，绝不输出年份或地址
pub fn list(db: &Db, query: &ReminderQuery) -> AppResult<Vec<ReminderDto>> {
    let window = query.days_ahead.unwrap_or(3).clamp(0, 366);
    let include_acked = query.include_acked.unwrap_or(true);
    let today = Local::now().date_naive();
    let mut stmt = db.conn.prepare(
        "SELECT uid, current_nickname, birthday_encrypted, guard_anniversary_date, watch_anniversary_date
         FROM fan_profile ORDER BY current_nickname ASC",
    )?;
    let rows = stmt.query_map([], |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<Vec<u8>>>(2)?,
        r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?,
    )))?;
    let mut raw = Vec::new();
    for row in rows { raw.push(row?); }

    let mut out = Vec::new();
    for (uid, nickname, birthday_blob, guard_date, watch_date) in raw {
        if let Some(blob) = birthday_blob {
            if let Ok(value) = db.crypto.decrypt_json::<BirthdayValue>(&blob) {
                push_reminder(db, &mut out, &uid, &nickname, "birthday", (value.month as u32, value.day as u32), today, window)?;
            }
        }
        if let Some(text) = guard_date.as_deref().and_then(parse_month_day) {
            push_reminder(db, &mut out, &uid, &nickname, "guard_anniversary", text, today, window)?;
        }
        if let Some(text) = watch_date.as_deref().and_then(parse_month_day) {
            push_reminder(db, &mut out, &uid, &nickname, "watch_anniversary", text, today, window)?;
        }
    }
    if !include_acked { out.retain(|r| !r.acked); }
    out.sort_by(|a, b| a.days_ahead.cmp(&b.days_ahead)
        .then(a.reminder_type.cmp(&b.reminder_type))
        .then(a.nickname.cmp(&b.nickname)));
    Ok(out)
}

pub fn pending_count(db: &Db, days: i32) -> AppResult<usize> {
    Ok(list(db, &ReminderQuery { days_ahead: Some(days), include_acked: Some(false) })?.len())
}

pub fn ack(db: &Db, input: &ReminderAckInput) -> AppResult<ReminderDto> {
    if input.uid.trim().is_empty() { return Err(AppError::invalid("缺少粉丝 UID")); }
    if !REMINDER_TYPES.contains(&input.reminder_type.as_str()) {
        return Err(AppError::invalid("提醒类型无效"));
    }
    if NaiveDate::parse_from_str(&input.reminder_date, "%Y-%m-%d").is_err() {
        return Err(AppError::invalid("提醒日期格式应为 YYYY-MM-DD"));
    }
    let want = input.acked.unwrap_or(true);
    if want {
        db.conn.execute(
            "INSERT INTO reminder_ack(uid, reminder_type, reminder_date, acked_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(uid, reminder_type, reminder_date) DO UPDATE SET acked_at=excluded.acked_at",
            params![input.uid, input.reminder_type, input.reminder_date, now_iso()],
        )?;
        log_activity(&db.conn, "reminder", &format!("标记 {} 的{}为已处理", input.uid, label(&input.reminder_type)))?;
    } else {
        db.conn.execute(
            "DELETE FROM reminder_ack WHERE uid=?1 AND reminder_type=?2 AND reminder_date=?3",
            params![input.uid, input.reminder_type, input.reminder_date],
        )?;
    }
    list(db, &ReminderQuery { days_ahead: Some(366), include_acked: Some(true) })?
        .into_iter()
        .find(|r| r.uid == input.uid && r.reminder_type == input.reminder_type && r.reminder_date == input.reminder_date)
        .ok_or_else(|| AppError::not_found("该提醒已不在当前年度周期内"))
}

/// 每天最多提示一次，由 app_meta 记录日期；即使窗口被反复刷新也不会刷屏
pub fn should_toast(db: &Db) -> AppResult<bool> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let last: Option<String> = db.conn.query_row(
        "SELECT value FROM app_meta WHERE key='reminder_toast_date'", [], |r| r.get(0),
    ).optional()?;
    Ok(last.as_deref() != Some(today.as_str()))
}

pub fn mark_toasted(db: &Db) -> AppResult<()> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    db.conn.execute(
        "INSERT INTO app_meta(key, value) VALUES ('reminder_toast_date', ?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![today],
    )?;
    Ok(())
}

/// 供单测使用：以固定基准日计算下一次提醒
#[cfg(test)]
pub fn occurrence_for_test(month: u32, day: u32, base: &str) -> Option<(String, i32)> {
    let today = NaiveDate::parse_from_str(base, "%Y-%m-%d").ok()?;
    let (date, days) = next_occurrence(month, day, today)?;
    Some((date.format("%Y-%m-%d").to_string(), days))
}

