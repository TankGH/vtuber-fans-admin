use rusqlite::Connection;
use std::sync::Mutex;

use crate::backup;
use crate::crypto::Crypto;
use crate::db::{self, AppState};
use crate::error::ERROR_CODES;
use crate::import::{build_rows, default_mapping, parse_delimited, parse_level, suggest_mapping};
use crate::models::{AddressValue, BirthdayValue, FanProfileInput, ParsedRow};
use crate::profile;

mod features;

fn crypto() -> Crypto {
    Crypto::from_key_for_test([7u8; 32])
}

fn temp_state() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().expect("临时目录");
    let data = tmp.path().join("data");
    let backups = tmp.path().join("backups");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(&backups).unwrap();
    let cfg = format!("{{\"backupDir\": {}}}", serde_json::to_string(&backups.to_string_lossy().to_string()).unwrap());
    std::fs::write(data.join("settings.json"), cfg).unwrap();
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(include_str!("../db/schema.sql")).unwrap();
    let state = AppState {
        db: Mutex::new(db::Db { conn, crypto: crypto() }),
        data_dir: data,
    };
    (tmp, state)
}

fn sample_csv() -> &'static str {
    "uid,nickname,guard_level,rank,first_interaction_at,birthday,address,note\n\
     1000009,晚 风,3,9,2026-01-08,05-20,浙江省·杭州市·余杭区,昵称含空格\n\
     1000013,大幕丶渐起,3,13,2026-02-02,12-02,四川省·成都市·武侯区,顿号变体\n\
     ,无名粉丝,3,16,2026-03-03,,,缺少 UID\n"
}

#[test]
fn aes_gcm_roundtrip_and_tamper_detection() {
    let c = crypto();
    let blob = c.encrypt(b"receiver-phone-address").unwrap();
    assert_eq!(c.decrypt(&blob).unwrap(), b"receiver-phone-address");
    let mut tampered = blob.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x01;
    assert!(c.decrypt(&tampered).is_err(), "篡改密文必须失败");
    assert!(c.decrypt(&[0u8; 4]).is_err(), "过短密文必须失败");
}

#[test]
fn encrypted_json_and_masking() {
    let c = crypto();
    let addr = AddressValue {
        receiver: "林先生".into(), phone: "13800000000".into(),
        province: "上海市".into(), city: "上海市".into(),
        district: "浦东新区".into(), detail: "世纪大道 100 号".into(),
    };
    let blob = c.encrypt_json(&addr).unwrap();
    let cipher_text = String::from_utf8_lossy(&blob).to_string();
    assert!(!cipher_text.contains("世纪大道 100 号"), "密文不得包含完整地址明文");
    assert_eq!(String::from_utf8(c.decrypt(&blob).unwrap()).unwrap().contains("世纪大道 100 号"), true);
    assert_eq!(c.mask_address(&Some(blob)).as_deref(), Some("上海市 · 上海市 · 浦东新区"));
    let birth = BirthdayValue { month: 11, day: 15, year: Some(1998) };
    let b = c.encrypt_json(&birth).unwrap();
    assert_eq!(c.mask_birthday(&Some(b.clone()), true).as_deref(), Some("11-15"));
    assert_eq!(c.mask_birthday(&Some(b), false).as_deref(), Some("1998-11-15"));
}

#[test]
fn csv_parsing_keeps_whitespace_and_unicode_variants() {
    let text = "uid,nickname,note\n1000009,\"晚 风\",\"含,逗号\"\n1000013,大幕丶渐起,勿误判为标点\n";
    let (headers, rows) = parse_delimited(text).unwrap();
    assert_eq!(headers, vec!["uid", "nickname", "note"]);
    assert_eq!(rows[0][1], "晚 风");
    assert_eq!(rows[0][2], "含,逗号");
    assert_eq!(rows[1][1], "大幕丶渐起");
}

#[test]
fn mapping_suggestion_and_level_parsing() {
    let (headers, _) = parse_delimited(sample_csv()).unwrap();
    let m = suggest_mapping(&headers);
    assert_eq!(m.uid, "uid");
    assert_eq!(m.nickname, "nickname");
    assert_eq!(m.guard_level, "guard_level");
    assert_eq!(parse_level("总督"), Some(1));
    assert_eq!(parse_level("提督"), Some(2));
    assert_eq!(parse_level("舰长"), Some(3));
    assert_eq!(parse_level("3"), Some(3));
    assert_eq!(parse_level("未知"), None);
}

#[test]
fn preview_classifies_new_merge_conflict_invalid() {
    let (_tmp, state) = temp_state();
    let (headers, records) = parse_delimited(sample_csv()).unwrap();
    let rows = build_rows(&headers, &records, &default_mapping());
    assert_eq!(rows.len(), 3);

    {
        let mut db = state.lock_db().unwrap();
        let crypto = db.crypto.clone();
        let tx = db.conn.transaction().unwrap();
        assert!(profile::upsert_from_import(&tx, &crypto, &rows[0]).unwrap());
        tx.commit().unwrap();
        profile::set_lock(&db, "1000009", "nickname", true).unwrap();
    }

    let args = crate::models::ImportArgs {
        file_content: Some(sample_csv().to_string()), file_name: Some("sample.csv".into()),
        mapping: Some(default_mapping()), ..Default::default()
    };
    let preview = crate::import::preview(&state, &args).unwrap();
    assert_eq!(preview.total_rows, 3);
    assert_eq!(preview.new_count, 1);
    assert_eq!(preview.conflict_count, 1);
    assert_eq!(preview.invalid_count, 1);
    assert!(preview.conflicts.iter().any(|c| c.field == "nickname"));
}

#[test]
fn merge_keeps_earliest_interaction_and_locked_nickname() {
    let (_tmp, state) = temp_state();
    let mut db = state.lock_db().unwrap();
    let crypto = db.crypto.clone();
    let base = ParsedRow {
        row: 2, uid: "u1".into(), nickname: "原名".into(), guard_level: Some(3), rank: Some(1),
        first_interaction_at: "2024-01-01".into(), birthday: "03-08".into(),
        address: "浙江省·杭州市·西湖区".into(), note: "手动备注".into(),
        unit_months: None, price_yuan: None, event_type: None, event_at: None,
    };
    let incoming = ParsedRow {
        row: 3, uid: "u1".into(), nickname: "新昵称".into(), guard_level: Some(2), rank: Some(2),
        first_interaction_at: "2025-06-01".into(), birthday: "05-20".into(),
        address: "广东省·深圳市·南山区".into(), note: "导入备注".into(),
        unit_months: Some(1), price_yuan: Some(198.0),
        event_type: Some("purchase".into()), event_at: Some("2026-01-01".into()),
    };
    {
        let tx = db.conn.transaction().unwrap();
        assert!(profile::upsert_from_import(&tx, &crypto, &base).unwrap());
        tx.commit().unwrap();
    }
    profile::set_lock(&db, "u1", "nickname", true).unwrap();
    {
        let tx = db.conn.transaction().unwrap();
        assert!(!profile::upsert_from_import(&tx, &crypto, &incoming).unwrap());
        tx.commit().unwrap();
    }
    let dto = profile::get(&db, "u1", true).unwrap();
    assert_eq!(dto.current_nickname, "原名", "锁定昵称不被覆盖");
    assert_eq!(dto.first_interaction_at.as_deref(), Some("2024-01-01"), "保留最早首次互动时间");
    assert_eq!(dto.birthday_masked.as_deref(), Some("05-20"), "未锁定字段可合并");
    assert_eq!(dto.address_masked.as_deref(), Some("广东省 · 深圳市 · 南山区"));
    assert_eq!(dto.nickname_history.len(), 1);
}

#[test]
fn delete_profiles_requires_confirmation_and_cleans_related_rows() {
    let (_tmp, state) = temp_state();
    let mut db = state.lock_db().unwrap();
    for (uid, nickname) in [("d1", "误导入一"), ("d2", "误导入二")] {
        profile::create(&db, &FanProfileInput {
            uid: uid.to_string(), current_nickname: nickname.to_string(), ..Default::default()
        }).unwrap();
    }
    assert!(profile::delete(&mut db, &["d1".to_string()], false).is_err(), "缺少二次确认必须拒绝删除");

    for sql in [
        "INSERT INTO fan_nickname_history(uid, nickname, changed_at) VALUES ('d1','旧昵称','2026-01-01T00:00:00Z')",
        "INSERT INTO guard_snapshot(snapshot_date, fetched_at) VALUES ('2026-01-01','2026-01-01T00:00:00Z')",
        "INSERT INTO guard_snapshot_member(snapshot_id, uid, guard_level) VALUES (1,'d1',3)",
        "INSERT INTO guard_event(uid, nickname, event_type, event_at, source, price_yuan) VALUES ('d1','误导入一','purchase','2026-01-01','import',198)",
        "INSERT INTO reminder_ack(uid, reminder_type, reminder_date, acked_at) VALUES ('d1','birthday','01-01','2026-01-01T00:00:00Z')",
        "INSERT INTO custom_reminder(title, uid, anchor_date, rule, offset_days, created_at) VALUES ('测试','d1','2026-01-01','once',0,'2026-01-01T00:00:00Z')",
        "INSERT INTO gift_batch(name, created_at) VALUES ('批次','2026-01-01T00:00:00Z')",
        "INSERT INTO gift_shipment(batch_id, uid, shipment_status, updated_at) VALUES (1,'d1','pending','2026-01-01T00:00:00Z')",
        "INSERT INTO ledger_entry(entry_type, category, amount_yuan, occurred_at, note) VALUES ('income','大航海',198,'2026-01-01','已归集收入')",
    ] {
        db.conn.execute(sql, []).unwrap();
    }

    let deleted = profile::delete(&mut db, &[
        "d1".to_string(), "d2".to_string(), "d1".to_string(),
    ], true).unwrap();
    assert_eq!(deleted, 2, "重复 UID 只能删除一次");

    for (table, expected) in [
        ("fan_profile", 0), ("fan_nickname_history", 0), ("guard_snapshot_member", 0),
        ("guard_event", 0), ("reminder_ack", 0), ("custom_reminder", 0), ("gift_shipment", 0),
    ] {
        let count: i64 = db.conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
        assert_eq!(count, expected, "{table} 未正确清理");
    }
    let ledger_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM ledger_entry", [], |r| r.get(0)).unwrap();
    assert_eq!(ledger_count, 1, "账目流水必须保留");
}

#[test]
fn clear_all_requires_confirmation_and_wipes_local_data() {
    let (_tmp, state) = temp_state();
    {
        let db = state.lock_db().unwrap();
        profile::create(&db, &FanProfileInput {
            uid: "clear1".to_string(), current_nickname: "待清除".to_string(), ..Default::default()
        }).unwrap();
        db.conn.execute(
            "INSERT INTO ledger_entry(entry_type, category, amount_yuan, occurred_at, note) VALUES ('income','大航海',198,'2026-01-01','待清除')",
            [],
        ).unwrap();
    }
    let backup_dir = state.data_dir.parent().unwrap().join("backups");
    std::fs::create_dir_all(&backup_dir).unwrap();
    let backup_file = backup_dir.join("backup-test.enc");
    let manifest = backup_dir.join("manifest.json");
    let session = state.data_dir.join("bili_session.enc");
    let marker = state.data_dir.join("restore.json");
    for p in [&backup_file, &manifest, &session, &marker] {
        std::fs::write(p, b"dummy").unwrap();
    }

    assert!(db::clear_all(&state, false).is_err(), "清除全部数据必须二次确认");
    let count: i64 = state.lock_db().unwrap().conn
        .query_row("SELECT COUNT(*) FROM fan_profile", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1, "未确认时不得改动任何数据");

    db::clear_all(&state, true).unwrap();
    let db = state.lock_db().unwrap();
    for table in ["fan_profile", "ledger_entry", "activity_log", "custom_reminder"] {
        let n: i64 = db.conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "{table} 未清空");
    }
    drop(db);
    for p in [&backup_file, &manifest, &session, &marker, &state.data_dir.join("settings.json")] {
        assert!(!p.exists(), "{} 未被清除", p.display());
    }
}

#[test]
fn backup_rotates_to_seven_with_manifest() {
    let (_tmp, state) = temp_state();
    for _ in 0..9 {
        backup::backup_now(&state).unwrap();
    }
    let list = backup::list_backups(&state).unwrap();
    assert!(list.len() <= 7, "必须只保留最近 7 份，实际 {}", list.len());
    assert!(list.iter().all(|b| b.verified), "所有备份必须通过校验");
    assert!(list.iter().all(|b| b.fan_count == 0), "空库备份记录数摘要应为 0");
}

#[test]
fn xlsx_sample_is_readable_by_calamine() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..").join("tests").join("samples").join("fans_sample.xlsx");
    if !path.exists() {
        eprintln!("跳过 xlsx 样例校验：本地未提供 {}", path.display());
        return;
    }
    let (headers, rows) = crate::import::parse_workbook_for_test(&path).unwrap();
    assert_eq!(headers.first().map(String::as_str), Some("uid"));
    assert!(rows.iter().any(|r| r.get(1).map(String::as_str) == Some("雪之下 雪乃")));
    assert!(rows.iter().any(|r| r.get(1).map(String::as_str) == Some("时崎丶狂三")));
    assert!(rows.iter().any(|r| r.first().map(String::is_empty) == Some(true)));
}

#[test]
fn all_error_codes_have_frontend_text() {
    let front = include_str!("../../../src/lib/errorText.ts");
    for code in ERROR_CODES {
        assert!(front.contains(code), "前端缺少错误码 {code} 的中文文案");
    }
}

#[test]
fn masked_csv_export_has_no_full_address() {
    let (_tmp, state) = temp_state();
    let result = backup::export_csv(&state, None).unwrap();
    let content = std::fs::read_to_string(&result.path).unwrap();
    assert!(result.masked);
    assert!(content.contains("address_masked"));
    assert!(!content.contains("世纪大道"));
}
