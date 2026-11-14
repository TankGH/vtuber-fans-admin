use calamine::Reader;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::crypto::{now_iso, today};
use crate::db::{log_activity, AppState};
use crate::error::{AppError, AppResult};
use crate::models::{
    FieldConflict, ImportArgs, ImportMapping, ImportPreview, ImportResult, ImportRowDto, ParsedRow,
};
use crate::profile;

const PREVIEW_LIMIT: usize = 100;

const HEADER_ALIASES: &[(&str, &[&str])] = &[
    ("uid", &["uid", "b站uid", "用户id", "粉丝uid", "用户编号"]),
    ("nickname", &["nickname", "昵称", "粉丝名", "当前昵称", "uname", "name"]),
    ("guardLevel", &["guard_level", "guardlevel", "等级", "舰长等级", "角色", "role"]),
    ("rank", &["rank", "排名", "rank_no"]),
    ("firstInteractionAt", &["first_interaction_at", "首次互动时间", "首次互动"]),
    ("birthday", &["birthday", "生日"]),
    ("address", &["address", "地址", "收货地址"]),
    ("note", &["note", "备注", "说明"]),
    ("unitMonths", &["unit_months", "月数", "购买月数", "guard_unit"]),
    ("priceYuan", &["price_yuan", "金额", "价格", "price"]),
];

pub fn suggest_mapping(headers: &[String]) -> ImportMapping {
    let mut mapping = ImportMapping::default();
    let mut assign = |key: &str, value: &str| match key {
        "uid" => mapping.uid = value.to_string(),
        "nickname" => mapping.nickname = value.to_string(),
        "guardLevel" => mapping.guard_level = value.to_string(),
        "rank" => mapping.rank = value.to_string(),
        "firstInteractionAt" => mapping.first_interaction_at = value.to_string(),
        "birthday" => mapping.birthday = value.to_string(),
        "address" => mapping.address = value.to_string(),
        "note" => mapping.note = value.to_string(),
        "unitMonths" => mapping.unit_months = value.to_string(),
        "priceYuan" => mapping.price_yuan = value.to_string(),
        _ => {}
    };
    for (key, aliases) in HEADER_ALIASES {
        if let Some(hit) = headers.iter().find(|h| aliases.iter().any(|a| h.trim().to_lowercase() == *a)) {
            assign(key, hit);
        }
    }
    mapping
}

pub fn default_mapping() -> ImportMapping {
    ImportMapping {
        uid: "uid".into(), nickname: "nickname".into(), guard_level: "guard_level".into(),
        rank: "rank".into(), first_interaction_at: "first_interaction_at".into(),
        birthday: "birthday".into(), address: "address".into(), note: "note".into(),
        unit_months: "unit_months".into(), price_yuan: "price_yuan".into(),
    }
}

/// 返回（表头、数据行）。CSV 流式读取；xlsx 按第一个 sheet 迭代
pub fn read_source(args: &ImportArgs) -> AppResult<(Vec<String>, Vec<Vec<String>>)> {
    if let Some(content) = args.file_content.as_ref().filter(|c| !c.trim().is_empty()) {
        return parse_delimited(content);
    }
    let path = args.file_path.as_deref().ok_or_else(|| AppError::new("E_IMPORT_FORMAT", "未提供文件路径或内容"))?;
    let p = Path::new(path);
    if !p.exists() {
        return Err(AppError::new("E_IMPORT_FORMAT", "文件不存在或已被移动"));
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext == "xlsx" || ext == "xls" || ext == "xlsb" || ext == "ods" {
        return parse_workbook(p);
    }
    let raw = std::fs::read_to_string(p)
        .map_err(|e| AppError::new("E_IMPORT_FORMAT", format!("文件读取失败（请使用 UTF-8 编码）：{e}")))?;
    parse_delimited(&raw)
}

pub fn parse_delimited(raw: &str) -> AppResult<(Vec<String>, Vec<Vec<String>>)> {
    let clean = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let delimiter = if clean.lines().next().unwrap_or("").contains('\t') { b'\t' } else { b',' };
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .has_headers(true)
        .from_reader(clean.as_bytes());
    let headers = reader.headers()
        .map_err(|e| AppError::new("E_IMPORT_FORMAT", format!("表头解析失败：{e}")))?
        .iter().map(|s| s.trim_start_matches('\u{feff}').to_string()).collect::<Vec<_>>();
    if headers.is_empty() || headers[0].is_empty() {
        return Err(AppError::new("E_IMPORT_FORMAT", "表头为空或首列无列名"));
    }
    let mut rows = Vec::new();
    for rec in reader.records() {
        let rec = rec.map_err(|e| AppError::new("E_IMPORT_FORMAT", format!("数据行解析失败：{e}")))?;
        rows.push(rec.iter().map(|s| s.to_string()).collect());
    }
    Ok((headers, rows))
}

fn cell_to_string(cell: &calamine::Data) -> String {
    use calamine::Data;
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Int(v) => v.to_string(),
        Data::Float(v) => {
            if (v - v.round()).abs() < f64::EPSILON { format!("{:.0}", v) } else { v.to_string() }
        }
        _ => cell.to_string(),
    }
}

pub fn parse_workbook_for_test(path: &Path) -> AppResult<(Vec<String>, Vec<Vec<String>>)> {
    parse_workbook(path)
}

fn parse_workbook(path: &Path) -> AppResult<(Vec<String>, Vec<Vec<String>>)> {
    let mut workbook = calamine::open_workbook_auto(path)
        .map_err(|e| AppError::new("E_IMPORT_FORMAT", format!("Excel 文件打开失败：{e}")))?;
    let first = workbook.sheet_names().into_iter().next()
        .ok_or_else(|| AppError::new("E_IMPORT_FORMAT", "工作簿中没有工作表"))?;
    let range = workbook.worksheet_range(&first)
        .map_err(|e| AppError::new("E_IMPORT_FORMAT", format!("工作表读取失败：{e}")))?;
    let mut iter = range.rows();
    let header_row = iter.next()
        .ok_or_else(|| AppError::new("E_IMPORT_FORMAT", "工作表首行无表头"))?;
    let headers: Vec<String> = header_row.iter().map(cell_to_string).collect();
    let mut rows = Vec::new();
    for row in iter {
        rows.push(row.iter().map(cell_to_string).collect());
    }
    Ok((headers, rows))
}

fn get_cell(headers: &[String], record: &[String], column: &str) -> String {
    if column.is_empty() { return String::new(); }
    let idx = headers.iter().position(|h| h == column);
    idx.and_then(|i| record.get(i)).cloned().unwrap_or_default()
}

pub fn parse_level(raw: &str) -> Option<i32> {
    match raw.trim() {
        "1" | "总督" | "governor" => Some(1),
        "2" | "提督" | "admiral" => Some(2),
        "3" | "舰长" | "captain" => Some(3),
        _ => None,
    }
}

pub fn build_rows(
    headers: &[String], records: &[Vec<String>], mapping: &ImportMapping,
) -> Vec<ParsedRow> {
    records.iter().enumerate().map(|(i, rec)| ParsedRow {
        row: i + 2,
        uid: get_cell(headers, rec, &mapping.uid),
        nickname: get_cell(headers, rec, &mapping.nickname),
        guard_level: parse_level(&get_cell(headers, rec, &mapping.guard_level)),
        rank: get_cell(headers, rec, &mapping.rank).parse::<i32>().ok(),
        first_interaction_at: get_cell(headers, rec, &mapping.first_interaction_at),
        birthday: get_cell(headers, rec, &mapping.birthday),
        address: get_cell(headers, rec, &mapping.address),
        note: get_cell(headers, rec, &mapping.note),
        unit_months: get_cell(headers, rec, &mapping.unit_months).parse::<i32>().ok(),
        price_yuan: get_cell(headers, rec, &mapping.price_yuan).parse::<f64>().ok(),
    }).collect()
}

fn locked_map(conn: &rusqlite::Connection) -> AppResult<HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare("SELECT uid, manual_locked_fields FROM fan_profile")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = HashMap::new();
    for row in rows {
        let (uid, raw) = row?;
        map.insert(uid, profile::locked_fields(&raw));
    }
    Ok(map)
}

pub fn preview(state: &AppState, args: &ImportArgs) -> AppResult<ImportPreview> {
    let (headers, records) = read_source(args)?;
    let mapping = args.mapping.clone().unwrap_or_else(|| suggest_mapping(&headers));
    let rows = build_rows(&headers, &records, &mapping);
    let db = state.lock_db()?;
    let locked = locked_map(&db.conn)?;
    let mut preview_rows = Vec::new();
    let mut conflicts = Vec::new();
    for r in &rows {
        let (action, reason) = if r.uid.is_empty() || r.nickname.is_empty() {
            ("invalid".to_string(), "缺少 UID 或昵称，已跳过".to_string())
        } else {
            match locked.get(&r.uid) {
                None => ("new".to_string(), "新建档案并写入昵称历史".to_string()),
                Some(fields) => {
                    let mut has_conflict = false;
                    for (val, field) in [
                        (&r.nickname, "nickname"), (&r.birthday, "birthday"),
                        (&r.address, "address"), (&r.note, "note"),
                        (&r.first_interaction_at, "first_interaction_at"),
                    ] {
                        if !val.is_empty() && fields.iter().any(|f| f == field) {
                            conflicts.push(FieldConflict {
                                row: r.row, field: field.to_string(), uid: r.uid.clone(),
                                reason: format!("字段「{field}」已被手动锁定，导入值不会覆盖"),
                            });
                            has_conflict = true;
                        }
                    }
                    if !r.guard_level.is_some() && !mapping.guard_level.is_empty() {
                        conflicts.push(FieldConflict {
                            row: r.row, field: "guard_level".to_string(), uid: r.uid.clone(),
                            reason: "大航海等级无法识别，该行将跳过等级更新".to_string(),
                        });
                    }
                    if has_conflict {
                        ("conflict".to_string(), "存在锁定字段冲突，仅合并未锁定字段".to_string())
                    } else {
                        ("merge".to_string(), "合并档案，保留最早首次互动时间".to_string())
                    }
                }
            }
        };
        preview_rows.push(ImportRowDto {
            row: r.row, uid: r.uid.clone(), nickname: r.nickname.clone(),
            action, reason, guard_level: r.guard_level,
        });
    }
    let count = |a: &str| preview_rows.iter().filter(|r| r.action == a).count();
    let truncated = preview_rows.len() > PREVIEW_LIMIT;
    Ok(ImportPreview {
        total_rows: rows.len(),
        new_count: count("new"), merge_count: count("merge"),
        conflict_count: count("conflict"), invalid_count: count("invalid"),
        headers, suggested_mapping: mapping, conflicts,
        rows: preview_rows.into_iter().take(PREVIEW_LIMIT).collect(), truncated,
    })
}

pub fn commit(state: &AppState, args: &ImportArgs) -> AppResult<ImportResult> {
    let (headers, records) = read_source(args)?;
    let mapping = args.mapping.clone().unwrap_or_else(|| suggest_mapping(&headers));
    let rows = build_rows(&headers, &records, &mapping);
    let mut db = state.lock_db()?;
    let crypto = db.crypto.clone();
    let tx = db.conn.transaction()?;
    let snapshot_date = args.snapshot_date.clone()
        .filter(|s| !s.is_empty()).unwrap_or_else(today);
    let fetched_at = now_iso();
    tx.execute(
        "INSERT OR IGNORE INTO guard_snapshot(snapshot_date, room_id, fetched_at, source) VALUES (?1,'',?2,'import')",
        params![snapshot_date, fetched_at],
    )?;
    let snapshot_id: i64 = tx.query_row(
        "SELECT id FROM guard_snapshot WHERE snapshot_date = ?1", [&snapshot_date], |r| r.get(0),
    )?;
    let mut new_count = 0usize;
    let mut merge_count = 0usize;
    let mut skipped = 0usize;
    let mut errors = Vec::new();
    for (r, rec) in rows.iter().zip(records.iter()) {
        if r.uid.is_empty() || r.nickname.is_empty() {
            skipped += 1;
            errors.push(format!("第 {} 行：缺少 UID 或昵称，已跳过", r.row));
            continue;
        }
        let is_new = profile::upsert_from_import(&tx, &crypto, r)?;
        if is_new { new_count += 1; } else { merge_count += 1; }
        if let Some(level) = r.guard_level {
            tx.execute(
                "INSERT INTO guard_snapshot_member(snapshot_id, uid, nickname, guard_level, rank)
                 VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(snapshot_id, uid) DO UPDATE SET
                   nickname=excluded.nickname, guard_level=excluded.guard_level, rank=excluded.rank",
                params![snapshot_id, r.uid, r.nickname, level, r.rank],
            )?;
            if r.unit_months.is_some() || r.price_yuan.is_some() {
                tx.execute(
                    "INSERT INTO guard_event(uid, nickname, event_type, guard_level, unit_months,
                     price_yuan, event_at, source, raw_json) VALUES (?1,?2,'purchase',?3,?4,?5,?6,'import',?7)",
                    params![r.uid, r.nickname, level, r.unit_months, r.price_yuan, fetched_at,
                        serde_json::to_string(rec).unwrap_or_default()],
                )?;
            }
        }
    }
    let file_name = args.file_name.clone().unwrap_or_else(|| "名单.csv".to_string());
    let file_type = if file_name.to_lowercase().ends_with(".xlsx") { "xlsx" } else { "csv" };
    let created_at = now_iso();
    tx.execute(
        "INSERT INTO import_batch(file_name, file_type, total_rows, new_count, merge_count, skipped_count, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![file_name, file_type, rows.len() as i64, new_count as i64, merge_count as i64, skipped as i64, created_at],
    )?;
    let batch_id = tx.last_insert_rowid();
    log_activity(&tx, "import", &format!("导入 {file_name}：新增 {new_count}、合并 {merge_count}"))?;
    tx.commit()?;
    Ok(ImportResult {
        batch_id, total_rows: rows.len(), new_count, merge_count,
        skipped_count: skipped, errors, created_at,
    })
}

/// 快照 diff：成员消失只标记「疑似到期」，绝不删除或降级档案
pub fn diff_suspected(conn: &rusqlite::Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT uid FROM guard_snapshot_member WHERE snapshot_id = (
           SELECT MAX(id) FROM guard_snapshot WHERE id < (SELECT MAX(id) FROM guard_snapshot)
         ) AND uid NOT IN (
           SELECT uid FROM guard_snapshot_member WHERE snapshot_id = (SELECT MAX(id) FROM guard_snapshot)
         )",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out: Vec<String> = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

pub fn existing_uids(conn: &rusqlite::Connection) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT uid FROM fan_profile")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = HashSet::new();
    for row in rows { out.insert(row?); }
    Ok(out)
}
