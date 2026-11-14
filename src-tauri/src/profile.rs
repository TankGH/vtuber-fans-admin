use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

use crate::crypto::now_iso;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{
    AddressDto, AddressValue, FanProfileDto, FanProfileInput, Paged, ParsedRow, ProfileQuery,
};

const SELECT: &str = "SELECT uid, current_nickname, birthday_encrypted, first_interaction_at,
  guard_anniversary_date, watch_anniversary_date, address_encrypted, address_status, note,
  manual_locked_fields, source, created_at, updated_at FROM fan_profile";

pub fn locked_fields(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

pub fn locked_json(fields: &[String]) -> String {
    serde_json::to_string(fields).unwrap_or_else(|_| "[]".to_string())
}

fn guard_level_map(conn: &Connection) -> AppResult<HashMap<String, (i32, Option<i32>)>> {
    let mut map = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT m.uid, m.guard_level, m.rank FROM guard_snapshot_member m
         WHERE m.snapshot_id = (SELECT MAX(id) FROM guard_snapshot)",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?, r.get::<_, Option<i32>>(2)?)))?;
    for row in rows {
        let (uid, level, rank) = row?;
        map.insert(uid, (level, rank));
    }
    Ok(map)
}

pub fn list(db: &Db, query: &ProfileQuery, hide_year: bool) -> AppResult<Paged<FanProfileDto>> {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(10).clamp(1, 100);
    let mut where_sql = String::from(" WHERE 1=1");
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(kw) = query.keyword.as_ref().filter(|s| !s.is_empty()) {
        where_sql.push_str(" AND (uid LIKE ? OR current_nickname LIKE ?)");
        values.push(rusqlite::types::Value::Text(format!("%{kw}%")));
        values.push(rusqlite::types::Value::Text(format!("%{kw}%")));
    }
    if let Some(level) = query.guard_level {
        where_sql.push_str(" AND uid IN (SELECT uid FROM guard_snapshot_member WHERE snapshot_id = (SELECT MAX(id) FROM guard_snapshot) AND guard_level = ?)");
        values.push(rusqlite::types::Value::Integer(level as i64));
    }
    if let Some(status) = query.address_status.as_ref().filter(|s| !s.is_empty()) {
        where_sql.push_str(" AND address_status = ?");
        values.push(rusqlite::types::Value::Text(status.clone()));
    }
    if query.only_locked.unwrap_or(false) {
        where_sql.push_str(" AND manual_locked_fields <> '[]'");
    }
    let total_sql = format!("SELECT COUNT(*) FROM fan_profile{where_sql}");
    let total: usize = db.conn.query_row(&total_sql, rusqlite::params_from_iter(values.iter()), |r| r.get::<_, i64>(0))
        .map(|n| n as usize)?;
    let sql = format!("{SELECT}{where_sql} ORDER BY updated_at DESC LIMIT ? OFFSET ?");
    let mut all = values;
    all.push(rusqlite::types::Value::Integer(page_size as i64));
    all.push(rusqlite::types::Value::Integer(((page - 1) * page_size) as i64));
    let mut stmt = db.conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(all.iter()), |r| {
        Ok((
            r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<Vec<u8>>>(2)?,
            r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<Vec<u8>>>(6)?, r.get::<_, String>(7)?, r.get::<_, String>(8)?,
            r.get::<_, String>(9)?, r.get::<_, String>(10)?, r.get::<_, String>(11)?, r.get::<_, String>(12)?,
        ))
    })?;
    let levels = guard_level_map(&db.conn)?;
    let mut items = Vec::new();
    for row in rows {
        let t = row?;
        let uid = t.0.clone();
        let locked = locked_fields(&t.9);
        let mut history = Vec::new();
        let mut hs = db.conn.prepare("SELECT nickname FROM fan_nickname_history WHERE uid = ?1 ORDER BY id ASC")?;
        let names = hs.query_map([&uid], |r| r.get::<_, String>(0))?;
        for n in names { history.push(n?); }
        let (guard_level, rank) = levels.get(&uid).map(|(l, r)| (Some(*l), *r)).unwrap_or((None, None));
        items.push(FanProfileDto {
            uid,
            current_nickname: t.1,
            nickname_history: history,
            first_interaction_at: t.3,
            birthday_masked: db.crypto.mask_birthday(&t.2, hide_year),
            address_masked: db.crypto.mask_address(&t.6),
            address_status: t.7,
            guard_anniversary_date: t.4,
            watch_anniversary_date: t.5,
            note: t.8,
            manual_locked_fields: locked,
            guard_level,
            rank,
            source: t.10,
            created_at: t.11,
            updated_at: t.12,
        });
    }
    Ok(Paged { items, total, page, page_size })
}

pub fn get(db: &Db, uid: &str, hide_year: bool) -> AppResult<FanProfileDto> {
    let sql = format!("{SELECT} WHERE uid = ?1");
    let mut stmt = db.conn.prepare(&sql)?;
    let raw = stmt.query_row([uid], |r| {
        Ok((
            r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<Vec<u8>>>(2)?,
            r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<Vec<u8>>>(6)?, r.get::<_, String>(7)?, r.get::<_, String>(8)?,
            r.get::<_, String>(9)?, r.get::<_, String>(10)?, r.get::<_, String>(11)?, r.get::<_, String>(12)?,
        ))
    }).optional()?;
    let t = raw.ok_or_else(|| AppError::not_found("未找到该粉丝档案"))?;
    let mut history = Vec::new();
    let mut hs = db.conn.prepare("SELECT nickname FROM fan_nickname_history WHERE uid = ?1 ORDER BY id ASC")?;
    let names = hs.query_map([uid], |r| r.get::<_, String>(0))?;
    for n in names { history.push(n?); }
    let (guard_level, rank) = guard_level_map(&db.conn)?.get(uid)
        .map(|(l, r)| (Some(*l), *r)).unwrap_or((None, None));
    Ok(FanProfileDto {
        uid: t.0, current_nickname: t.1, nickname_history: history,
        first_interaction_at: t.3, birthday_masked: db.crypto.mask_birthday(&t.2, hide_year),
        address_masked: db.crypto.mask_address(&t.6), address_status: t.7,
        guard_anniversary_date: t.4, watch_anniversary_date: t.5, note: t.8,
        manual_locked_fields: locked_fields(&t.9), guard_level, rank,
        source: t.10, created_at: t.11, updated_at: t.12,
    })
}

pub fn reveal_address(db: &Db, uid: &str) -> AppResult<AddressDto> {
    let blob: Option<Vec<u8>> = db.conn
        .query_row("SELECT address_encrypted FROM fan_profile WHERE uid = ?1", [uid], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::not_found("未找到该粉丝档案"))?;
    let status: String = db.conn.query_row(
        "SELECT address_status FROM fan_profile WHERE uid = ?1", [uid], |r| r.get(0),
    )?;
    let value: AddressValue = db.crypto.decrypt_address(&blob)?;
    Ok(AddressDto {
        uid: uid.to_string(), receiver: value.receiver, phone: value.phone,
        province: value.province, city: value.city, district: value.district,
        detail: value.detail, address_status: status,
    })
}

pub fn set_lock(db: &Db, uid: &str, field: &str, locked: bool) -> AppResult<FanProfileDto> {
    if !crate::models::LOCKABLE_FIELDS.contains(&field) {
        return Err(AppError::invalid("该字段不支持手动锁定"));
    }
    let raw: String = db.conn.query_row(
        "SELECT manual_locked_fields FROM fan_profile WHERE uid = ?1", [uid], |r| r.get(0),
    ).optional()?.ok_or_else(|| AppError::not_found("未找到该粉丝档案"))?;
    let mut fields = locked_fields(&raw);
    if locked {
        if !fields.contains(&field.to_string()) { fields.push(field.to_string()); }
    } else {
        fields.retain(|f| f != field);
    }
    db.conn.execute(
        "UPDATE fan_profile SET manual_locked_fields = ?1, updated_at = ?2 WHERE uid = ?3",
        params![locked_json(&fields), now_iso(), uid],
    )?;
    get(db, uid, true)
}

pub fn create(db: &Db, input: &FanProfileInput) -> AppResult<FanProfileDto> {
    if input.uid.trim().is_empty() || input.current_nickname.is_empty() {
        return Err(AppError::invalid("UID 与当前昵称为必填项"));
    }
    let exists: Option<String> = db.conn.query_row(
        "SELECT uid FROM fan_profile WHERE uid = ?1", [&input.uid], |r| r.get(0),
    ).optional()?;
    if exists.is_some() {
        return Err(AppError::invalid("该 UID 已存在，请使用编辑或导入合并"));
    }
    let now = now_iso();
    let birthday = input.birthday.as_ref().map(|b| db.crypto.encrypt_json(b)).transpose()?;
    let address = input.address.as_ref().map(|a| db.crypto.encrypt_json(a)).transpose()?;
    // 手动新建的字段自动锁定，避免后续导入覆盖
    let mut locked: Vec<String> = vec!["nickname".to_string(), "note".to_string()];
    if birthday.is_some() { locked.push("birthday".to_string()); }
    if address.is_some() { locked.push("address".to_string()); }
    if input.first_interaction_at.is_some() { locked.push("first_interaction_at".to_string()); }
    if let Some(extra) = &input.manual_locked_fields {
        for f in extra { if !locked.contains(f) { locked.push(f.clone()); } }
    }
    db.conn.execute(
        "INSERT INTO fan_profile(uid, current_nickname, birthday_encrypted, first_interaction_at,
         guard_anniversary_date, watch_anniversary_date, address_encrypted, address_status, note,
         manual_locked_fields, source, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'manual',?11,?11)",
        params![
            input.uid, input.current_nickname, birthday, input.first_interaction_at,
            input.guard_anniversary_date, input.watch_anniversary_date, address,
            input.address_status.clone().unwrap_or_else(|| "none".to_string()),
            input.note.clone().unwrap_or_default(), locked_json(&locked), now,
        ],
    )?;
    db.conn.execute(
        "INSERT INTO fan_nickname_history(uid, nickname, changed_at) VALUES (?1,?2,?3)",
        params![input.uid, input.current_nickname, now],
    )?;
    crate::db::log_activity(&db.conn, "profile", &format!("新建档案 {}", input.current_nickname))?;
    get(db, &input.uid, true)
}

pub fn update(db: &Db, uid: &str, input: &FanProfileInput) -> AppResult<FanProfileDto> {
    let old = get(db, uid, true)?;
    let nickname = if input.current_nickname.is_empty() { old.current_nickname.clone() } else { input.current_nickname.clone() };
    let birthday = input.birthday.as_ref().map(|b| db.crypto.encrypt_json(b)).transpose()?;
    let address = input.address.as_ref().map(|a| db.crypto.encrypt_json(a)).transpose()?;
    let mut locked = old.manual_locked_fields.clone();
    for f in ["nickname", "note"] { if !locked.contains(&f.to_string()) { locked.push(f.to_string()); } }
    if birthday.is_some() && !locked.contains(&"birthday".to_string()) { locked.push("birthday".to_string()); }
    if address.is_some() && !locked.contains(&"address".to_string()) { locked.push("address".to_string()); }
    db.conn.execute(
        "UPDATE fan_profile SET current_nickname=?1,
         birthday_encrypted = COALESCE(?2, birthday_encrypted),
         first_interaction_at = COALESCE(?3, first_interaction_at),
         guard_anniversary_date = COALESCE(?4, guard_anniversary_date),
         watch_anniversary_date = COALESCE(?5, watch_anniversary_date),
         address_encrypted = COALESCE(?6, address_encrypted),
         address_status = COALESCE(?7, address_status), note = ?8,
         manual_locked_fields = ?9, updated_at = ?10 WHERE uid = ?11",
        params![
            nickname, birthday, input.first_interaction_at, input.guard_anniversary_date,
            input.watch_anniversary_date, address, input.address_status,
            input.note.clone().unwrap_or(old.note), locked_json(&locked), now_iso(), uid,
        ],
    )?;
    if nickname != old.current_nickname {
        db.conn.execute(
            "INSERT INTO fan_nickname_history(uid, nickname, changed_at) VALUES (?1,?2,?3)",
            params![uid, nickname, now_iso()],
        )?;
    }
    crate::db::log_activity(&db.conn, "profile", &format!("更新档案 {nickname}"))?;
    get(db, uid, true)
}

/// 合并状态机：手动锁定字段是唯一裁决依据；同 UID 保留最早首次互动时间
pub fn upsert_from_import(tx: &rusqlite::Transaction<'_>, crypto: &crate::crypto::Crypto, row: &ParsedRow) -> AppResult<bool> {
    let existing: Option<(String, Option<String>, String)> = tx.query_row(
        "SELECT current_nickname, first_interaction_at, manual_locked_fields FROM fan_profile WHERE uid = ?1",
        [&row.uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).optional()?;
    let now = now_iso();
    match existing {
        None => {
            let birthday = parse_birthday(row).map(|b| crypto.encrypt_json(&b)).transpose()?;
            let address = parse_address(row).map(|a| crypto.encrypt_json(&a)).transpose()?;
            tx.execute(
                "INSERT INTO fan_profile(uid, current_nickname, birthday_encrypted, first_interaction_at,
                 address_encrypted, address_status, note, manual_locked_fields, source, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,'none',?6,'[]','import',?7,?7)",
                params![row.uid, row.nickname, birthday, nonempty(&row.first_interaction_at), address, row.note, now],
            )?;
            tx.execute(
                "INSERT INTO fan_nickname_history(uid, nickname, changed_at) VALUES (?1,?2,?3)",
                params![row.uid, row.nickname, now],
            )?;
            Ok(true)
        }
        Some((old_nickname, old_first, locked_raw)) => {
            let locked = locked_fields(&locked_raw);
            let nickname = if locked.contains(&"nickname".to_string()) { old_nickname.clone() } else { row.nickname.clone() };
            let first = earliest(old_first.as_deref(), &row.first_interaction_at);
            let birthday = (!locked.contains(&"birthday".to_string()))
                .then(|| parse_birthday(row).map(|b| crypto.encrypt_json(&b)).transpose()).transpose()?.flatten();
            let address = (!locked.contains(&"address".to_string()))
                .then(|| parse_address(row).map(|a| crypto.encrypt_json(&a)).transpose()).transpose()?.flatten();
            let note = if locked.contains(&"note".to_string()) { None } else if row.note.is_empty() { None } else { Some(row.note.clone()) };
            tx.execute(
                "UPDATE fan_profile SET current_nickname=?1, first_interaction_at=?2,
                 birthday_encrypted = COALESCE(?3, birthday_encrypted),
                 address_encrypted = COALESCE(?4, address_encrypted),
                 note = COALESCE(?5, note), source='import', updated_at=?6 WHERE uid=?7",
                params![nickname, first, birthday, address, note, now, row.uid],
            )?;
            if nickname != old_nickname {
                tx.execute(
                    "INSERT INTO fan_nickname_history(uid, nickname, changed_at) VALUES (?1,?2,?3)",
                    params![row.uid, nickname, now],
                )?;
            }
            Ok(false)
        }
    }
}

pub fn earliest(prev: Option<&str>, incoming: &str) -> Option<String> {
    if incoming.is_empty() { return prev.map(|s| s.to_string()); }
    match prev {
        None => Some(incoming.to_string()),
        Some(p) => Some(if incoming < p { incoming.to_string() } else { p.to_string() }),
    }
}

fn nonempty(s: &str) -> Option<String> { if s.is_empty() { None } else { Some(s.to_string()) } }

fn parse_birthday(row: &ParsedRow) -> Option<crate::models::BirthdayValue> {
    let parts: Vec<&str> = row.birthday.split(['-', '/', '月', '.']).filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 { return None; }
    let month = parts[0].trim().parse::<i32>().ok()?;
    let day = parts[1].trim().parse::<i32>().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
    Some(crate::models::BirthdayValue { month, day, year: None })
}

fn parse_address(row: &ParsedRow) -> Option<AddressValue> {
    if row.address.is_empty() { return None; }
    let parts: Vec<&str> = row.address.split(['·', '|', ',', '，', ' ']).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() { return None; }
    Some(AddressValue {
        province: parts.first().unwrap_or(&"").to_string(),
        city: parts.get(1).unwrap_or(&"").to_string(),
        district: parts.get(2).unwrap_or(&"").to_string(),
        detail: String::new(), receiver: String::new(), phone: String::new(),
    })
}
