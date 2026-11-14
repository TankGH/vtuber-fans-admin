use std::collections::BTreeMap;

use chrono::Datelike;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::json;

use super::*;
use crate::gifts;
use crate::guard;
use crate::ledger;
use crate::models::{
    BirthdayValue, FanProfileInput, GiftAddressStatusInput, GiftBatchInput, GiftShipmentInput,
    LedgerInput, LedgerQuery, ReminderAckInput, ReminderQuery, SettingsInput,
};
use crate::reminder;
use crate::settings;
use crate::sync::bilibili;

#[test]
fn reminder_occurrence_handles_today_rollover_and_leap_day() {
    assert_eq!(reminder::occurrence_for_test(11, 14, "2026-11-14"), Some(("2026-11-14".into(), 0)));
    assert_eq!(reminder::occurrence_for_test(11, 15, "2026-11-14"), Some(("2026-11-15".into(), 1)));
    let (date, days) = reminder::occurrence_for_test(1, 1, "2026-11-14").unwrap();
    assert_eq!(date, "2027-01-01");
    assert!(days > 0);
    assert_eq!(reminder::occurrence_for_test(2, 29, "2027-01-01").unwrap().0, "2027-02-28");
}

#[test]
fn reminder_list_masks_birthday_and_ack_is_idempotent() {
    let (_tmp, state) = temp_state();
    let today = chrono::Local::now().date_naive();
    let db = state.lock_db().unwrap();
    profile::create(&db, &FanProfileInput {
        uid: "u-birth".into(), current_nickname: "小寿星".into(),
        birthday: Some(BirthdayValue { month: today.month() as i32, day: today.day() as i32, year: Some(1998) }),
        ..Default::default()
    }).unwrap();
    let list = reminder::list(&db, &ReminderQuery { days_ahead: Some(0), include_acked: Some(false) }).unwrap();
    let item = list.iter().find(|r| r.uid == "u-birth" && r.reminder_type == "birthday").expect("今天应有生日提醒");
    assert_eq!(item.days_ahead, 0);
    assert!(!item.greeting.contains("1998"), "提醒话术不得泄露生日年份");
    assert_eq!(reminder::pending_count(&db, 0).unwrap(), 1);

    let input = ReminderAckInput {
        uid: item.uid.clone(), reminder_type: item.reminder_type.clone(),
        reminder_date: item.reminder_date.clone(), acked: Some(true),
    };
    assert!(reminder::ack(&db, &input).unwrap().acked);
    assert_eq!(reminder::pending_count(&db, 0).unwrap(), 0);
    assert!(reminder::ack(&db, &input).is_ok(), "重复标记必须幂等");
    let mut undo = input.clone();
    undo.acked = Some(false);
    assert!(!reminder::ack(&db, &undo).unwrap().acked);
    assert_eq!(reminder::pending_count(&db, 0).unwrap(), 1);
}

#[test]
fn gift_batch_reveal_requires_confirm_and_export_is_masked() {
    let (_tmp, state) = temp_state();
    let db = state.lock_db().unwrap();
    profile::create(&db, &FanProfileInput {
        uid: "u-gift".into(), current_nickname: "收货人".into(),
        address: Some(crate::models::AddressValue {
            receiver: "林先生".into(), phone: "13800006621".into(),
            province: "上海市".into(), city: "上海市".into(),
            district: "浦东新区".into(), detail: "世纪大道 100 号".into(),
        }),
        address_status: Some("valid".into()),
        ..Default::default()
    }).unwrap();
    let batch = gifts::batch_create(&db, &GiftBatchInput {
        name: "2026 年 11 月舰礼".into(), member_uids: vec!["u-gift".into(), "u-gift".into()],
    }).unwrap();
    assert_eq!(batch.member_count, 1, "重复 UID 必须去重");
    let shipments = gifts::shipment_list(&db, batch.id).unwrap();
    assert_eq!(shipments.len(), 1);
    assert_eq!(shipments[0].address_masked.as_deref(), Some("上海市 · 上海市 · 浦东新区"));
    assert_eq!(shipments[0].shipment_status, "pending");

    assert!(gifts::reveal_address(&db, shipments[0].id, false).is_err(), "无二次确认不得展示完整地址");
    let full = gifts::reveal_address(&db, shipments[0].id, true).unwrap();
    assert_eq!(full.detail, "世纪大道 100 号");
    assert!(full.phone.contains("****"), "电话必须打码");

    let updated = gifts::shipment_update(&db, &GiftShipmentInput {
        id: shipments[0].id, shipment_status: Some("shipped".into()), tracking_no: Some("SF123456".into()),
    }).unwrap();
    assert_eq!(updated.shipment_status, "shipped");
    assert_eq!(updated.tracking_no.as_deref(), Some("SF123456"));
    assert!(gifts::shipment_update(&db, &GiftShipmentInput {
        id: shipments[0].id, shipment_status: Some("未知状态".into()), ..Default::default()
    }).is_err());

    gifts::address_set_status(&db, &GiftAddressStatusInput { uid: "u-gift".into(), address_status: "shipped".into() }).unwrap();
    assert!(gifts::address_set_status(&db, &GiftAddressStatusInput { uid: "u-gift".into(), address_status: "乱填".into() }).is_err());

    assert!(gifts::export_masked(&db, &state.data_dir, batch.id, None, false).is_err());
    let exported = gifts::export_masked(&db, &state.data_dir, batch.id, None, true).unwrap();
    assert!(exported.masked);
    let text = std::fs::read_to_string(&exported.path).unwrap();
    assert!(!text.contains("世纪大道"), "脱敏导出不得含门牌号");
    assert!(!text.contains("13800006621"), "脱敏导出不得含电话");
}

#[test]
fn ledger_income_sync_is_idempotent_and_summary_is_rounded() {
    let (_tmp, state) = temp_state();
    let db = state.lock_db().unwrap();
    db.conn.execute(
        "INSERT INTO guard_event(uid, nickname, event_type, guard_level, unit_months, price_yuan, event_at, source)
         VALUES ('u1','甲','purchase',3,1,198.0,'2026-11-10T20:00:00+08:00','import')", [],
    ).unwrap();
    let event_id = db.conn.last_insert_rowid();
    assert_eq!(ledger::sync_events(&db).unwrap(), 1);
    assert_eq!(ledger::sync_events(&db).unwrap(), 0, "同一事件不得重复归集");
    let summary = ledger::summary(&db).unwrap();
    assert_eq!(summary.total_income_yuan, 198.0);
    assert_eq!(summary.unlinked_event_count, 0);
    assert_eq!(summary.buckets[0].month, "2026-11");

    assert!(ledger::create(&db, &LedgerInput {
        entry_type: "income".into(), category: "大航海".into(), amount_yuan: 1.0,
        occurred_at: "2026-11-11".into(), guard_event_id: Some(event_id), ..Default::default()
    }).is_err(), "重复关联事件必须被拒绝");

    ledger::create(&db, &LedgerInput {
        entry_type: "expense".into(), category: "快递费".into(), amount_yuan: 12.34,
        occurred_at: "2026-11-11".into(), batch_id: None, ..Default::default()
    }).unwrap();
    let summary = ledger::summary(&db).unwrap();
    assert_eq!(summary.total_expense_yuan, 12.34);
    assert_eq!(summary.net_yuan, 185.66);
    assert_eq!(ledger::list(&db, &LedgerQuery { month: Some("2026-10".into()), ..Default::default() }).unwrap().len(), 0);

    let id = db.conn.query_row("SELECT id FROM ledger_entry WHERE entry_type='expense'", [], |r| r.get::<_, i64>(0)).unwrap();
    assert!(ledger::delete(&db, id, false).is_err(), "删除需二次确认");
    ledger::delete(&db, id, true).unwrap();
    assert_eq!(ledger::summary(&db).unwrap().total_expense_yuan, 0.0);
}

#[test]
fn settings_persists_sync_config_but_sync_stays_off_by_default() {
    let (_tmp, state) = temp_state();
    let cfg = settings::load(&state.data_dir);
    assert!(!cfg.sync_enabled, "自动抓取必须默认关闭");
    assert_eq!(cfg.reminder_days_ahead, 3);
    settings::update(&state.data_dir, SettingsInput {
        room_id: Some("21452505".into()), snapshot_hour: Some(6), reminder_days_ahead: Some(5), ..Default::default()
    }).unwrap();
    let cfg = settings::load(&state.data_dir);
    assert_eq!(cfg.room_id, "21452505");
    assert_eq!(cfg.snapshot_hour, 6);
    assert_eq!(cfg.reminder_days_ahead, 5);
    assert!(!cfg.sync_enabled, "设置更新不得顺带打开同步");
    assert!(settings::update(&state.data_dir, SettingsInput { room_id: Some("abc".into()), ..Default::default() }).is_err());
    assert!(settings::update(&state.data_dir, SettingsInput { snapshot_hour: Some(99), ..Default::default() }).is_err());
    settings::set_sync_enabled(&state.data_dir, true).unwrap();
    assert!(settings::load(&state.data_dir).sync_enabled);
    settings::set_sync_enabled(&state.data_dir, false).unwrap();
    assert!(!settings::load(&state.data_dir).sync_enabled);
}

#[test]
fn wbi_signature_is_deterministic_and_wts_changes_it() {
    let mixin = bilibili::mixin_key("7cd084941338484aae1ad9425b84077c", "4932caff0ff746eab6f01bf08b82ac");
    assert_eq!(mixin.len(), 32);
    let mut params = BTreeMap::new();
    params.insert("room_id".to_string(), "21452505".to_string());
    params.insert("page".to_string(), "1".to_string());
    let a = bilibili::wbi_sign(&params, &mixin, 1_700_000_000);
    let b = bilibili::wbi_sign(&params, &mixin, 1_700_000_000);
    let c = bilibili::wbi_sign(&params, &mixin, 1_700_000_001);
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(a.contains("w_rid="));
    assert!(a.contains("wts=1700000000"));
    assert_eq!(a.split("w_rid=").nth(1).unwrap().len(), 32, "w_rid 必须是 32 位 MD5");
}

#[test]
fn guard_list_parser_accepts_multiple_response_shapes() {
    let data = json!({
        "list": [
            {"uid": 1001, "username": "早风", "guard_level": 3, "rank": 1},
            {"mid": "1002", "uname": "小白", "guardLevel": 2}
        ],
        "top3": [{"uid": 1003, "nickname": "总督", "guard_level": 1}],
        "info": {"num": 3, "list": [{"uid": 1001, "username": "早风", "guard_level": 3}]}
    });
    let mut members = Vec::new();
    bilibili::collect_members(&data, &mut members);
    assert!(members.iter().any(|m| m.uid == "1001" && m.guard_level == 3));
    assert!(members.iter().any(|m| m.uid == "1002" && m.guard_level == 2));
    assert!(members.iter().any(|m| m.uid == "1003" && m.guard_level == 1));
    assert!(members.iter().all(|m| (1..=3).contains(&m.guard_level)));
}

#[test]
fn qr_cookie_extraction_combines_headers_and_redirect_url() {
    let mut headers = HeaderMap::new();
    headers.append("set-cookie", HeaderValue::from_static("SESSDATA=abc%2Cdef; Path=/; HttpOnly"));
    headers.append("set-cookie", HeaderValue::from_static("bili_jct=xyz; Path=/"));
    let cookie = bilibili::cookies_from(&headers, Some("https://www.bilibili.com/?DedeUserID=123456&sid=qq"));
    assert!(cookie.contains("SESSDATA=abc%2Cdef"));
    assert!(cookie.contains("bili_jct=xyz"));
    assert!(cookie.contains("DedeUserID=123456"));
    assert!(!cookie.contains("Path"));
}

#[test]
fn snapshot_apply_is_idempotent_per_day_and_respects_locked_nicknames() {
    let (_tmp, state) = temp_state();
    let db = state.lock_db().unwrap();
    let mut members = vec![
        crate::sync::GuardMember { uid: "u1".into(), nickname: "旧名".into(), guard_level: 3, rank: Some(1) },
        crate::sync::GuardMember { uid: "u2".into(), nickname: "二号".into(), guard_level: 2, rank: Some(2) },
    ];
    let first = crate::sync::apply_snapshot(&db, "21452505", &members, "snapshot").unwrap();
    assert_eq!(first.member_count, 2);
    assert_eq!(first.new_count, 2);
    profile::set_lock(&db, "u1", "nickname", true).unwrap();
    members[0].nickname = "新名".into();
    let second = crate::sync::apply_snapshot(&db, "21452505", &members, "snapshot").unwrap();
    assert_eq!(second.new_count, 0, "重复同步不得新增档案");
    assert_eq!(second.merge_count, 2);
    let snapshot_count: i64 = db.conn.query_row("SELECT COUNT(*) FROM guard_snapshot", [], |r| r.get(0)).unwrap();
    assert_eq!(snapshot_count, 1, "同日重复同步不得产生重复快照");
    assert_eq!(profile::get(&db, "u1", true).unwrap().current_nickname, "旧名", "手动锁定昵称不被同步覆盖");
    assert_eq!(guard::list_members(&db).unwrap().len(), 2);
}
