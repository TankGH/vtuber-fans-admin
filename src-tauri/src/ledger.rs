use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};

use crate::crypto::today;
use crate::db::{log_activity, Db};
use crate::error::{AppError, AppResult};
use crate::models::{
    LedgerBucketDto, LedgerEntryDto, LedgerInput, LedgerQuery, LedgerSummaryDto, LEDGER_TYPES,
};

const SELECT: &str = "SELECT id, entry_type, category, amount_yuan, occurred_at, batch_id, guard_event_id,
  COALESCE(note, '') FROM ledger_entry";

fn map_entry(r: &rusqlite::Row<'_>) -> rusqlite::Result<LedgerEntryDto> {
    Ok(LedgerEntryDto {
        id: r.get(0)?, entry_type: r.get(1)?, category: r.get(2)?, amount_yuan: r.get(3)?,
        occurred_at: r.get(4)?, batch_id: r.get(5)?, guard_event_id: r.get(6)?, note: r.get(7)?,
    })
}

pub fn list(db: &Db, query: &LedgerQuery) -> AppResult<Vec<LedgerEntryDto>> {
    let mut sql = String::from(SELECT);
    sql.push_str(" WHERE 1=1");
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(t) = query.entry_type.as_ref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND entry_type = ?");
        values.push(rusqlite::types::Value::Text(t.clone()));
    }
    if let Some(m) = query.month.as_ref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND substr(occurred_at, 1, 7) = ?");
        values.push(rusqlite::types::Value::Text(m.clone()));
    }
    if let Some(b) = query.batch_id {
        sql.push_str(" AND batch_id = ?");
        values.push(rusqlite::types::Value::Integer(b));
    }
    sql.push_str(" ORDER BY occurred_at DESC, id DESC LIMIT 500");
    let mut stmt = db.conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values.iter()), map_entry)?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

fn by_id(db: &Db, id: i64) -> AppResult<LedgerEntryDto> {
    let sql = format!("{SELECT} WHERE id = ?1");
    let mut stmt = db.conn.prepare(&sql)?;
    stmt.query_row([id], map_entry).optional()?
        .ok_or_else(|| AppError::not_found("未找到该账目"))
}

pub fn create(db: &Db, input: &LedgerInput) -> AppResult<LedgerEntryDto> {
    if !LEDGER_TYPES.contains(&input.entry_type.as_str()) {
        return Err(AppError::invalid("账目类型只能是收入或支出"));
    }
    let category = input.category.trim();
    if category.is_empty() || category.chars().count() > 40 {
        return Err(AppError::invalid("请填写 1–40 字的分类"));
    }
    if !input.amount_yuan.is_finite() || input.amount_yuan <= 0.0 {
        return Err(AppError::invalid("金额需为大于 0 的数字"));
    }
    let date = input.occurred_at.trim();
    if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err(AppError::invalid("日期格式应为 YYYY-MM-DD"));
    }
    if let Some(b) = input.batch_id {
        let exists: Option<i64> = db.conn.query_row("SELECT id FROM gift_batch WHERE id=?1", [b], |r| r.get(0)).optional()?;
        if exists.is_none() { return Err(AppError::invalid("关联的寄送批次不存在")); }
    }
    if let Some(e) = input.guard_event_id {
        let exists: Option<i64> = db.conn.query_row("SELECT id FROM guard_event WHERE id=?1", [e], |r| r.get(0)).optional()?;
        if exists.is_none() { return Err(AppError::invalid("关联的航海事件不存在")); }
        let counted: Option<i64> = db.conn.query_row(
            "SELECT id FROM ledger_entry WHERE guard_event_id=?1", [e], |r| r.get(0),
        ).optional()?;
        if counted.is_some() { return Err(AppError::invalid("该航海事件已归集，避免重复计入")); }
    }
    let note = input.note.clone().unwrap_or_default();
    if note.chars().count() > 200 { return Err(AppError::invalid("备注最多 200 字")); }
    db.conn.execute(
        "INSERT INTO ledger_entry(entry_type, category, amount_yuan, occurred_at, batch_id, guard_event_id, note)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![input.entry_type, category, input.amount_yuan, date, input.batch_id, input.guard_event_id, note],
    )?;
    log_activity(&db.conn, "ledger", &format!("新增{}「{category}」{:.2} 元", if input.entry_type == "income" { "收入" } else { "支出" }, input.amount_yuan))?;
    by_id(db, db.conn.last_insert_rowid())
}

pub fn delete(db: &Db, id: i64, confirm: bool) -> AppResult<()> {
    if !confirm { return Err(AppError::invalid("删除账目需要二次确认")); }
    let entry = by_id(db, id)?;
    db.conn.execute("DELETE FROM ledger_entry WHERE id=?1", params![id])?;
    log_activity(&db.conn, "ledger", &format!("删除{}「{}」{:.2} 元", if entry.entry_type == "income" { "收入" } else { "支出" }, entry.category, entry.amount_yuan))?;
    Ok(())
}

pub fn unlinked_event_count(db: &Db) -> AppResult<usize> {
    let n: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM guard_event e
         WHERE e.event_type IN ('purchase','renew') AND COALESCE(e.price_yuan, 0) > 0
           AND NOT EXISTS (SELECT 1 FROM ledger_entry l WHERE l.guard_event_id = e.id)",
        [], |r| r.get(0),
    )?;
    Ok(n as usize)
}

/// 同一 guard_event 只允许归集一次；事件主键写进 ledger_entry.guard_event_id 作为去重依据
pub fn sync_events(db: &Db) -> AppResult<usize> {
    let mut stmt = db.conn.prepare(
        "SELECT e.id, COALESCE(p.current_nickname, e.nickname), e.event_type, e.price_yuan, e.event_at
         FROM guard_event e LEFT JOIN fan_profile p ON p.uid = e.uid
         WHERE e.event_type IN ('purchase','renew') AND COALESCE(e.price_yuan, 0) > 0
           AND NOT EXISTS (SELECT 1 FROM ledger_entry l WHERE l.guard_event_id = e.id)
         ORDER BY e.event_at ASC",
    )?;
    let rows = stmt.query_map([], |r| Ok((
        r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
        r.get::<_, f64>(3)?, r.get::<_, String>(4)?,
    )))?;
    let mut pending = Vec::new();
    for row in rows { pending.push(row?); }
    if pending.is_empty() { return Ok(0); }
    let tx = db.conn.unchecked_transaction()?;
    for (id, nickname, event_type, price, event_at) in &pending {
        let date: String = event_at.chars().take(10).collect();
        let date = if chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_ok() { date } else { today() };
        let kind = if event_type == "renew" { "续费" } else { "购买" };
        tx.execute(
            "INSERT INTO ledger_entry(entry_type, category, amount_yuan, occurred_at, batch_id, guard_event_id, note)
             VALUES ('income','大航海',?1,?2,NULL,?3,?4)",
            params![price, date, id, format!("{nickname} 的{kind}事件")],
        )?;
    }
    tx.commit()?;
    log_activity(&db.conn, "ledger", &format!("自动归集 {} 条大航海收入", pending.len()))?;
    Ok(pending.len())
}

pub fn summary(db: &Db) -> AppResult<LedgerSummaryDto> {
    let entries = list(db, &LedgerQuery::default())?;
    let mut income = 0.0;
    let mut expense = 0.0;
    let mut buckets: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for e in &entries {
        let key = e.occurred_at.chars().take(7).collect::<String>();
        let slot = buckets.entry(key).or_insert((0.0, 0.0));
        if e.entry_type == "income" { income += e.amount_yuan; slot.0 += e.amount_yuan; }
        else { expense += e.amount_yuan; slot.1 += e.amount_yuan; }
    }
    let round = |v: f64| (v * 100.0).round() / 100.0;
    Ok(LedgerSummaryDto {
        total_income_yuan: round(income),
        total_expense_yuan: round(expense),
        net_yuan: round(income - expense),
        entry_count: entries.len(),
        buckets: buckets.into_iter().map(|(month, (i, x))| LedgerBucketDto {
            month, income_yuan: round(i), expense_yuan: round(x),
        }).collect(),
        unlinked_event_count: unlinked_event_count(db)?,
    })
}
