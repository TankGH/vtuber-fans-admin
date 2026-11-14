use std::collections::HashSet;
use std::path::Path;

use rusqlite::{params, OptionalExtension};

use crate::crypto::now_iso;
use crate::db::{log_activity, Db};
use crate::error::{AppError, AppResult};
use crate::models::{
    AddressDto, AddressValue, ExportResult, GiftAddressStatusInput, GiftBatchDto, GiftBatchInput,
    GiftShipmentDto, GiftShipmentInput, ADDRESS_STATUSES, SHIPMENT_STATUSES,
};

const SHIPMENT_SELECT: &str = "SELECT s.id, s.batch_id, s.uid, COALESCE(p.current_nickname, s.uid),
  (SELECT m.guard_level FROM guard_snapshot_member m
   WHERE m.uid = s.uid AND m.snapshot_id = (SELECT MAX(id) FROM guard_snapshot)),
  COALESCE(p.address_status, 'none'), p.address_encrypted,
  s.shipment_status, s.tracking_no, s.updated_at
  FROM gift_shipment s LEFT JOIN fan_profile p ON p.uid = s.uid";

fn map_shipment(db: &Db, row: (
    i64, i64, String, String, Option<i32>, String, Option<Vec<u8>>, String, Option<String>, String,
)) -> GiftShipmentDto {
    let (id, batch_id, uid, nickname, guard_level, address_status, blob, shipment_status, tracking_no, updated_at) = row;
    GiftShipmentDto {
        id, batch_id, uid, nickname, guard_level, address_status,
        address_masked: db.crypto.mask_address(&blob),
        shipment_status, tracking_no, updated_at,
    }
}

pub fn batch_list(db: &Db) -> AppResult<Vec<GiftBatchDto>> {
    let mut stmt = db.conn.prepare(
        "SELECT b.id, b.name, b.created_at, b.status,
           (SELECT COUNT(*) FROM gift_shipment s WHERE s.batch_id = b.id),
           (SELECT COUNT(*) FROM gift_shipment s WHERE s.batch_id = b.id AND s.shipment_status = 'shipped'),
           (SELECT COUNT(*) FROM gift_shipment s JOIN fan_profile p ON p.uid = s.uid
            WHERE s.batch_id = b.id AND p.address_status IN ('valid','shipped'))
         FROM gift_batch b ORDER BY b.id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        let member_count: i64 = r.get(4)?;
        let shipped_count: i64 = r.get(5)?;
        let address_ready: i64 = r.get(6)?;
        Ok(GiftBatchDto {
            id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?, status: r.get(3)?,
            member_count: member_count as usize,
            shipped_count: shipped_count as usize,
            pending_count: (member_count - shipped_count).max(0) as usize,
            address_ready_count: address_ready as usize,
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

pub fn batch_create(db: &Db, input: &GiftBatchInput) -> AppResult<GiftBatchDto> {
    let name = input.name.trim();
    if name.is_empty() { return Err(AppError::invalid("请填写批次名称")); }
    let mut seen = HashSet::new();
    let uids: Vec<String> = input.member_uids.iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && seen.insert(s.clone()))
        .collect();
    if uids.is_empty() { return Err(AppError::invalid("请至少选择一位在舰成员")); }
    for uid in &uids {
        let exists: Option<String> = db.conn.query_row(
            "SELECT uid FROM fan_profile WHERE uid=?1", [uid], |r| r.get(0),
        ).optional()?;
        if exists.is_none() {
            return Err(AppError::invalid(format!("UID {uid} 尚未建立档案，请先在粉丝档案中补录")));
        }
    }
    let now = now_iso();
    let tx = db.conn.unchecked_transaction()?;
    tx.execute("INSERT INTO gift_batch(name, created_at, status) VALUES (?1,?2,'open')", params![name, now])?;
    let batch_id = tx.last_insert_rowid();
    for uid in &uids {
        let status: String = tx.query_row(
            "SELECT address_status FROM fan_profile WHERE uid=?1", [uid], |r| r.get(0),
        )?;
        let shipment_status = if status == "valid" || status == "shipped" { "pending" } else { "address_missing" };
        tx.execute(
            "INSERT INTO gift_shipment(batch_id, uid, shipment_status, updated_at) VALUES (?1,?2,?3,?4)",
            params![batch_id, uid, shipment_status, now],
        )?;
    }
    tx.commit()?;
    log_activity(&db.conn, "gift", &format!("创建舰礼批次「{name}」，共 {} 人", uids.len()))?;
    batch_list(db)?
        .into_iter()
        .find(|b| b.id == batch_id)
        .ok_or_else(|| AppError::internal("批次回读", "写入后未找到批次"))
}

pub fn shipment_list(db: &Db, batch_id: i64) -> AppResult<Vec<GiftShipmentDto>> {
    let sql = format!("{SHIPMENT_SELECT} WHERE s.batch_id = ?1 ORDER BY s.id ASC");
    let mut stmt = db.conn.prepare(&sql)?;
    let rows = stmt.query_map([batch_id], |r| Ok((
        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
        r.get::<_, Option<Vec<u8>>>(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
    )))?;
    let mut out = Vec::new();
    for row in rows { out.push(map_shipment(db, row?)); }
    Ok(out)
}

fn shipment_by_id(db: &Db, id: i64) -> AppResult<GiftShipmentDto> {
    let sql = format!("{SHIPMENT_SELECT} WHERE s.id = ?1");
    let mut stmt = db.conn.prepare(&sql)?;
    let row = stmt.query_row([id], |r| Ok((
        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
        r.get::<_, Option<Vec<u8>>>(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
    ))).optional()?;
    row.map(|r| map_shipment(db, r))
        .ok_or_else(|| AppError::not_found("未找到该寄送记录"))
}

pub fn shipment_update(db: &Db, input: &GiftShipmentInput) -> AppResult<GiftShipmentDto> {
    if input.id <= 0 { return Err(AppError::invalid("缺少寄送记录编号")); }
    let current = shipment_by_id(db, input.id)?;
    let status = input.shipment_status.clone().unwrap_or_else(|| current.shipment_status.clone());
    if !SHIPMENT_STATUSES.contains(&status.as_str()) {
        return Err(AppError::invalid("寄送状态无效"));
    }
    let tracking = input.tracking_no.clone().unwrap_or(current.tracking_no.clone().unwrap_or_default());
    if tracking.len() > 64 { return Err(AppError::invalid("快递单号过长")); }
    db.conn.execute(
        "UPDATE gift_shipment SET shipment_status=?1, tracking_no=?2, updated_at=?3 WHERE id=?4",
        params![status, if tracking.is_empty() { None } else { Some(tracking) }, now_iso(), input.id],
    )?;
    log_activity(&db.conn, "gift", &format!("更新 {} 的寄送状态为 {}", current.nickname, shipment_text(&status)))?;
    shipment_by_id(db, input.id)
}

pub fn address_set_status(db: &Db, input: &GiftAddressStatusInput) -> AppResult<()> {
    if input.uid.trim().is_empty() { return Err(AppError::invalid("缺少粉丝 UID")); }
    if !ADDRESS_STATUSES.contains(&input.address_status.as_str()) {
        return Err(AppError::invalid("地址审核状态无效"));
    }
    let changed = db.conn.execute(
        "UPDATE fan_profile SET address_status=?1, updated_at=?2 WHERE uid=?3",
        params![input.address_status, now_iso(), input.uid],
    )?;
    if changed == 0 { return Err(AppError::not_found("未找到该粉丝档案")); }
    log_activity(&db.conn, "gift", &format!("地址审核 {} → {}", input.uid, input.address_status))?;
    Ok(())
}

pub fn mask_phone(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() < 7 { return "****".to_string(); }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}****{tail}")
}

/// 完整地址必须二次确认；电话始终打码，日志不记录收件信息
pub fn reveal_address(db: &Db, id: i64, confirm: bool) -> AppResult<AddressDto> {
    if !confirm { return Err(AppError::invalid("查看完整地址需要二次确认")); }
    let shipment = shipment_by_id(db, id)?;
    let blob: Option<Vec<u8>> = db.conn.query_row(
        "SELECT address_encrypted FROM fan_profile WHERE uid=?1", [&shipment.uid], |r| r.get(0),
    ).optional()?.ok_or_else(|| AppError::not_found("未找到该粉丝档案"))?;
    let value: AddressValue = db.crypto.decrypt_address(&blob)?;
    Ok(AddressDto {
        uid: shipment.uid.clone(),
        receiver: value.receiver,
        phone: mask_phone(&value.phone),
        province: value.province,
        city: value.city,
        district: value.district,
        detail: value.detail,
        address_status: shipment.address_status,
    })
}

/// 导出只含脱敏地址（省 · 市 · 区），不含电话、门牌号与收件人
pub fn export_masked(db: &Db, data_dir: &Path, batch_id: i64, dest_path: Option<&str>, confirm: bool) -> AppResult<ExportResult> {
    if !confirm { return Err(AppError::invalid("导出寄送清单需要二次确认")); }
    let items = shipment_list(db, batch_id)?;
    let path = dest_path
        .filter(|s| !s.trim().is_empty())
        .map(Path::new)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| data_dir.join(format!("gift-batch-{batch_id}-masked.csv")));
    let mut writer = csv::Writer::from_path(&path)
        .map_err(|e| AppError::new("E_BACKUP_IO", format!("寄送清单写入失败：{e}")))?;
    writer.write_record(["uid", "nickname", "guard_level", "address_masked", "shipment_status", "tracking_no"])
        .map_err(|e| AppError::new("E_BACKUP_IO", format!("寄送清单写入失败：{e}")))?;
    for item in &items {
        writer.write_record([
            item.uid.clone(), item.nickname.clone(),
            item.guard_level.map(|v| v.to_string()).unwrap_or_default(),
            item.address_masked.clone().unwrap_or_default(),
            item.shipment_status.clone(), item.tracking_no.clone().unwrap_or_default(),
        ]).map_err(|e| AppError::new("E_BACKUP_IO", format!("寄送清单写入失败：{e}")))?;
    }
    writer.flush().map_err(|e| AppError::new("E_BACKUP_IO", format!("寄送清单写入失败：{e}")))?;
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    log_activity(&db.conn, "gift", &format!("导出批次 {batch_id} 的脱敏寄送清单（{} 条）", items.len()))?;
    Ok(ExportResult { path: path.to_string_lossy().to_string(), size_bytes, masked: true })
}

pub fn shipment_text(status: &str) -> &'static str {
    match status {
        "pending" => "待寄送",
        "address_missing" => "地址待补",
        "shipped" => "已寄送",
        "invalid_address" => "地址无效",
        _ => "未知状态",
    }
}
