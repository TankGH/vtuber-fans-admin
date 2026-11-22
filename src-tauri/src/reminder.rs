use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::{params, OptionalExtension};

use crate::crypto::now_iso;
use crate::db::{log_activity, Db};
use crate::error::{AppError, AppResult};
use crate::models::{
    valid_reminder_type, BirthdayValue, CustomReminderDto, CustomReminderInput, ReminderAckInput,
    ReminderDto, ReminderQuery, SettingsDto, CUSTOM_REMINDER_RULES, GLOBAL_REMINDER_UID,
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
        "watch_anniversary" => format!("{nickname}，观看纪念日快乐！谢谢你陪我们走到今天。"),
        _ => format!("{nickname}，纪念日快乐！感谢一路相伴。"),
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

/// 起算日必须含年份；兼容 ISO 日期时间，只取前 10 位
fn parse_full_date(raw: &str) -> Option<NaiveDate> {
    let normalized = raw.trim().replace('/', "-").replace('.', "-");
    let head: String = normalized.chars().take(10).collect();
    NaiveDate::parse_from_str(&head, "%Y-%m-%d").ok()
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

fn add_years(base: NaiveDate, years: i32) -> Option<NaiveDate> {
    date_in_year(base.year() + years, base.month(), base.day())
}

/// 下一次「第 N 周年」；起算日尚未满一年时返回一周年的日期
pub fn next_anniversary(base: NaiveDate, today: NaiveDate) -> Option<(NaiveDate, i32, i32)> {
    let mut years = (today.year() - base.year()).max(1);
    let mut target = add_years(base, years)?;
    if target < today {
        years += 1;
        target = add_years(base, years)?;
    }
    Some((target, (target - today).num_days() as i32, years))
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

struct Draft {
    uid: String,
    nickname: String,
    reminder_type: String,
    reminder_label: String,
    reminder_date: NaiveDate,
    greeting: String,
    source: &'static str,
    custom_id: Option<i64>,
    milestone: Option<String>,
}

impl Draft {
    fn auto(uid: &str, nickname: &str, kind: &str) -> Self {
        Self {
            uid: uid.to_string(), nickname: nickname.to_string(),
            reminder_type: kind.to_string(), reminder_label: label(kind).to_string(),
            reminder_date: Local::now().date_naive(), greeting: greeting(nickname, kind),
            source: "auto", custom_id: None, milestone: None,
        }
    }
}

/// 一次性日期（上舰 N 天 / 仅当天）过期后自动不再出现；年度循环项不会早于今天
fn emit(db: &Db, out: &mut Vec<ReminderDto>, d: Draft, today: NaiveDate, window: i32) -> AppResult<()> {
    let days_ahead = (d.reminder_date - today).num_days() as i32;
    if days_ahead < 0 || days_ahead > window { return Ok(()); }
    let date_s = d.reminder_date.format("%Y-%m-%d").to_string();
    let (acked, acked_at) = is_acked(db, &d.uid, &d.reminder_type, &date_s)?;
    out.push(ReminderDto {
        uid: d.uid, nickname: d.nickname,
        reminder_type: d.reminder_type, reminder_label: d.reminder_label,
        reminder_date: date_s, days_ahead, acked, acked_at,
        greeting: d.greeting, source: d.source.to_string(),
        custom_id: d.custom_id, milestone: d.milestone,
    });
    Ok(())
}

fn push_month_day(
    db: &Db, out: &mut Vec<ReminderDto>, uid: &str, nickname: &str,
    kind: &str, month_day: (u32, u32), today: NaiveDate, window: i32,
) -> AppResult<()> {
    let Some((date, _)) = next_occurrence(month_day.0, month_day.1, today) else { return Ok(()); };
    let mut draft = Draft::auto(uid, nickname, kind);
    draft.reminder_date = date;
    emit(db, out, draft, today, window)
}

/// 用户自建纪念日列表（含绑定粉丝昵称）
pub fn list_custom(db: &Db) -> AppResult<Vec<CustomReminderDto>> {
    let mut stmt = db.conn.prepare(
        "SELECT c.id, c.title, c.uid, p.current_nickname, c.anchor_date, c.rule,
                c.offset_days, c.note, c.enabled, c.created_at
         FROM custom_reminder c LEFT JOIN fan_profile p ON p.uid = c.uid
         ORDER BY c.id DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok(CustomReminderDto {
        id: r.get(0)?, title: r.get(1)?, uid: r.get(2)?, nickname: r.get(3)?,
        anchor_date: r.get(4)?, rule: r.get(5)?, offset_days: r.get(6)?,
        note: r.get(7)?, enabled: r.get::<_, i64>(8)? != 0, created_at: r.get(9)?,
    }))?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

fn custom_target(item: &CustomReminderDto, today: NaiveDate) -> Option<NaiveDate> {
    let anchor = parse_full_date(&item.anchor_date)?;
    match item.rule.as_str() {
        "annual" => next_occurrence(anchor.month(), anchor.day(), today).map(|(d, _)| d),
        "once" => Some(anchor),
        "days" => anchor.checked_add_signed(Duration::days(item.offset_days as i64)),
        _ => None,
    }
}

fn push_custom(db: &Db, out: &mut Vec<ReminderDto>, item: &CustomReminderDto, today: NaiveDate, window: i32) -> AppResult<()> {
    let Some(date) = custom_target(item, today) else { return Ok(()); };
    let nickname = item.nickname.clone().unwrap_or_else(|| "全体".to_string());
    let text = if item.uid.is_some() {
        format!("{nickname}，{}快乐！感谢一路相伴。", item.title)
    } else {
        format!("「{}」到了，记得准备一下～", item.title)
    };
    emit(db, out, Draft {
        uid: item.uid.clone().unwrap_or_else(|| GLOBAL_REMINDER_UID.to_string()),
        nickname,
        reminder_type: format!("custom_{}", item.id),
        reminder_label: item.title.clone(),
        reminder_date: date,
        greeting: text,
        source: "custom",
        custom_id: Some(item.id),
        milestone: match item.rule.as_str() {
            "days" => Some(format!("{} 天", item.offset_days)),
            "annual" => Some("每年".to_string()),
            _ => None,
        },
    }, today, window)
}

/// 只输出脱敏信息：生日仅保留月日，绝不输出年份或地址
pub fn list(db: &Db, query: &ReminderQuery, cfg: &SettingsDto) -> AppResult<Vec<ReminderDto>> {
    let window = query.days_ahead.unwrap_or(cfg.reminder_days_ahead).clamp(0, 366);
    let include_acked = query.include_acked.unwrap_or(true);
    let today = Local::now().date_naive();
    let mut out = Vec::new();

    let profiles: Vec<(String, String, Option<Vec<u8>>, Option<String>, Option<String>, Option<String>, Option<String>)> = {
        let mut stmt = db.conn.prepare(
            "SELECT p.uid, p.current_nickname, p.birthday_encrypted, p.guard_anniversary_date,
                    p.watch_anniversary_date, p.first_interaction_at,
                    (SELECT MIN(substr(e.event_at, 1, 10)) FROM guard_event e
                      WHERE e.uid = p.uid AND e.event_type IN ('purchase', 'renew')) AS guard_start
             FROM fan_profile p ORDER BY p.current_nickname ASC",
        )?;
        let rows = stmt.query_map([], |r| Ok((
            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
        )))?;
        let mut raw = Vec::new();
        for row in rows { raw.push(row?); }
        raw
    };

    for (uid, nickname, birthday_blob, guard_date, watch_date, first_at, guard_start) in profiles {
        if let Some(blob) = birthday_blob {
            if let Ok(value) = db.crypto.decrypt_json::<BirthdayValue>(&blob) {
                push_month_day(db, &mut out, &uid, &nickname, "birthday",
                    (value.month as u32, value.day as u32), today, window)?;
            }
        }
        if let Some(text) = watch_date.as_deref().and_then(parse_month_day) {
            push_month_day(db, &mut out, &uid, &nickname, "watch_anniversary", text, today, window)?;
        }
        let guard_md = guard_date.as_deref().and_then(parse_month_day);
        // 完整起算日优先取上舰日期，其次首次互动，最后取最早的购买 / 续费事件
        let start = guard_date.as_deref().and_then(parse_full_date)
            .or_else(|| first_at.as_deref().and_then(parse_full_date))
            .or_else(|| guard_start.as_deref().and_then(parse_full_date));

        if cfg.milestone_years_enabled {
            if let Some(anchor) = start {
                if let Some((date, _, years)) = next_anniversary(anchor, today) {
                    emit(db, &mut out, Draft {
                        uid: uid.clone(), nickname: nickname.clone(),
                        reminder_type: format!("guard_years_{years}"),
                        reminder_label: format!("上舰 {years} 周年"),
                        reminder_date: date,
                        greeting: format!("{nickname}，上舰 {years} 周年快乐！谢谢一直以来的支持。"),
                        source: "auto", custom_id: None, milestone: Some(format!("{years} 周年")),
                    }, today, window)?;
                }
            } else if let Some(text) = guard_md {
                // 没有完整年份时退回按年度循环的普通上舰周年
                push_month_day(db, &mut out, &uid, &nickname, "guard_anniversary", text, today, window)?;
            }
        } else if let Some(text) = guard_md {
            push_month_day(db, &mut out, &uid, &nickname, "guard_anniversary", text, today, window)?;
        }

        if cfg.milestone_hundreds_enabled {
            if let Some(anchor) = start {
                // 100×n 天（n 为正整数），从最接近今天的那个百日节点开始算，
                // 只生成落在提醒窗口内的节点；窗口最多 366 天，向后看 8 个节点足够。
                let elapsed = (today - anchor).num_days();
                let first_n = if elapsed < 100 { 1 } else { (elapsed / 100).max(1) };
                for n in first_n..=(first_n + 8) {
                    let days = 100 * n;
                    let Some(date) = anchor.checked_add_signed(Duration::days(days as i64)) else { break; };
                    if (date - today).num_days() > window as i64 { break; }
                    emit(db, &mut out, Draft {
                        uid: uid.clone(), nickname: nickname.clone(),
                        reminder_type: format!("guard_days_{days}"),
                        reminder_label: format!("上舰 {days} 天"),
                        reminder_date: date,
                        greeting: format!("{nickname}，上舰 {days} 天啦！这是第 {n} 个百日，感谢一路相伴。"),
                        source: "auto", custom_id: None, milestone: Some(format!("第 {n} 个百日 · {days} 天")),
                    }, today, window)?;
                }
            }
        }
    }

    for item in list_custom(db)? {
        if item.enabled { push_custom(db, &mut out, &item, today, window)?; }
    }

    if !include_acked { out.retain(|r| !r.acked); }
    if let Some(source) = query.source.as_deref() {
        out.retain(|r| r.source == source);
    }
    out.sort_by(|a, b| a.days_ahead.cmp(&b.days_ahead)
        .then(a.reminder_type.cmp(&b.reminder_type))
        .then(a.nickname.cmp(&b.nickname)));
    Ok(out)
}

pub fn pending_count(db: &Db, days: i32, cfg: &SettingsDto) -> AppResult<usize> {
    Ok(list(db, &ReminderQuery { days_ahead: Some(days), include_acked: Some(false), source: None }, cfg)?.len())
}

/// 新建 / 编辑用户自建纪念日。校验不通过时不写库。
pub fn save_custom(db: &Db, input: &CustomReminderInput) -> AppResult<CustomReminderDto> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 60 {
        return Err(AppError::invalid("纪念日名称需为 1–60 个字符"));
    }
    if parse_full_date(&input.anchor_date).is_none() {
        return Err(AppError::invalid("起算日期格式应为 YYYY-MM-DD"));
    }
    if !CUSTOM_REMINDER_RULES.contains(&input.rule.as_str()) {
        return Err(AppError::invalid("提醒规则无效"));
    }
    let offset = if input.rule == "days" { input.offset_days.unwrap_or(100) } else { 0 };
    if input.rule == "days" && !(1..=36500).contains(&offset) {
        return Err(AppError::invalid("累计天数需在 1–36500 之间"));
    }
    let uid = input.uid.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(u) = uid.as_ref() {
        let exists: Option<String> = db.conn.query_row(
            "SELECT uid FROM fan_profile WHERE uid=?1", params![u], |r| r.get(0),
        ).optional()?;
        if exists.is_none() { return Err(AppError::invalid("绑定的粉丝 UID 不存在，请先在档案中创建")); }
    }
    let enabled = input.enabled.unwrap_or(true);
    let now = now_iso();
    let id = match input.id {
        Some(id) => {
            let changed = db.conn.execute(
                "UPDATE custom_reminder SET title=?1, uid=?2, anchor_date=?3, rule=?4,
                    offset_days=?5, note=?6, enabled=?7 WHERE id=?8",
                params![title, uid, input.anchor_date.trim(), input.rule, offset, input.note.trim(), enabled as i64, id],
            )?;
            if changed == 0 { return Err(AppError::not_found("该纪念日已不存在")); }
            id
        }
        None => {
            db.conn.execute(
                "INSERT INTO custom_reminder(title, uid, anchor_date, rule, offset_days, note, enabled, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![title, uid, input.anchor_date.trim(), input.rule, offset, input.note.trim(), enabled as i64, now],
            )?;
            // INSERT 后立刻取 rowid，后续写活动日志会改动 last_insert_rowid
            let new_id = db.conn.last_insert_rowid();
            log_activity(&db.conn, "reminder", &format!("新增自定义纪念日「{title}」"))?;
            new_id
        }
    };
    list_custom(db)?.into_iter().find(|c| c.id == id)
        .ok_or_else(|| AppError::not_found("该纪念日已不存在"))
}

pub fn delete_custom(db: &Db, id: i64) -> AppResult<bool> {
    let kind = format!("custom_{id}");
    let removed = db.conn.execute("DELETE FROM custom_reminder WHERE id=?1", params![id])?;
    if removed == 0 { return Ok(false); }
    db.conn.execute("DELETE FROM reminder_ack WHERE reminder_type=?1", params![kind])?;
    log_activity(&db.conn, "reminder", &format!("删除自定义纪念日 #{id}"))?;
    Ok(true)
}

pub fn ack(db: &Db, input: &ReminderAckInput, cfg: &SettingsDto) -> AppResult<ReminderDto> {
    if input.uid.trim().is_empty() { return Err(AppError::invalid("缺少粉丝 UID")); }
    if !valid_reminder_type(&input.reminder_type) {
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
    list(db, &ReminderQuery { days_ahead: Some(366), include_acked: Some(true), source: None }, cfg)?
        .into_iter()
        .find(|r| r.uid == input.uid && r.reminder_type == input.reminder_type && r.reminder_date == input.reminder_date)
        .ok_or_else(|| AppError::not_found("该提醒已不在当前周期内"))
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

#[cfg(test)]
pub fn anniversary_for_test(base: &str, today: &str) -> Option<(String, i32)> {
    let b = NaiveDate::parse_from_str(base, "%Y-%m-%d").ok()?;
    let t = NaiveDate::parse_from_str(today, "%Y-%m-%d").ok()?;
    let (date, _, years) = next_anniversary(b, t)?;
    Some((date.format("%Y-%m-%d").to_string(), years))
}
