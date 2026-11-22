use chrono::Datelike;
use rusqlite::params;

use super::*;
use crate::gifts;
use crate::ledger;
use crate::models::{
    BirthdayValue, FanProfileInput, GiftAddressStatusInput, GiftBatchInput, GiftShipmentInput,
    CustomReminderInput, LedgerInput, LedgerQuery, ProfileQuery, ReminderAckInput, ReminderQuery,
    SettingsDto, GLOBAL_REMINDER_UID,
};
use crate::reminder;

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
    let cfg = SettingsDto::default();
    let list = reminder::list(&db, &ReminderQuery { days_ahead: Some(0), include_acked: Some(false), source: None }, &cfg).unwrap();
    let item = list.iter().find(|r| r.uid == "u-birth" && r.reminder_type == "birthday").expect("今天应有生日提醒");
    assert_eq!(item.days_ahead, 0);
    assert_eq!(item.source, "auto");
    assert!(!item.greeting.contains("1998"), "提醒话术不得泄露生日年份");
    assert_eq!(reminder::pending_count(&db, 0, &cfg).unwrap(), 1);

    let input = ReminderAckInput {
        uid: item.uid.clone(), reminder_type: item.reminder_type.clone(),
        reminder_date: item.reminder_date.clone(), acked: Some(true),
    };
    assert!(reminder::ack(&db, &input, &cfg).unwrap().acked);
    assert_eq!(reminder::pending_count(&db, 0, &cfg).unwrap(), 0);
    assert!(reminder::ack(&db, &input, &cfg).is_ok(), "重复标记必须幂等");
    let mut undo = input.clone();
    undo.acked = Some(false);
    assert!(!reminder::ack(&db, &undo, &cfg).unwrap().acked);
    assert_eq!(reminder::pending_count(&db, 0, &cfg).unwrap(), 1);
}

#[test]
fn guard_milestones_generate_nth_day_and_nth_anniversary() {
    let (_tmp, state) = temp_state();
    let today = chrono::Local::now().date_naive();
    let db = state.lock_db().unwrap();
    let anchor = today - chrono::Duration::days(100);
    profile::create(&db, &FanProfileInput {
        uid: "u-guard".into(), current_nickname: "老舰长".into(),
        guard_anniversary_date: Some(anchor.format("%Y-%m-%d").to_string()),
        ..Default::default()
    }).unwrap();
    let cfg = SettingsDto::default();
    let list = reminder::list(&db, &ReminderQuery { days_ahead: Some(0), include_acked: Some(true), source: None }, &cfg).unwrap();
    let day100 = list.iter().find(|r| r.reminder_type == "guard_days_100").expect("今天应有上舰 100 天提醒");
    assert_eq!(day100.days_ahead, 0);
    assert_eq!(day100.reminder_label, "上舰 100 天");
    assert_eq!(day100.milestone.as_deref(), Some("第 1 个百日 · 100 天"));
    assert_eq!(day100.source, "auto");
    assert!(day100.greeting.contains("100 天"));

    // 100×n 自动延伸：同一年内还能看到 200 / 300 / 400 天节点与第 1 周年
    let wide_q = ReminderQuery { days_ahead: Some(366), include_acked: Some(true), source: None };
    let wide = reminder::list(&db, &wide_q, &cfg).unwrap();
    for days in [100, 200, 300, 400] {
        assert!(wide.iter().any(|r| r.reminder_type == format!("guard_days_{days}")), "应生成上舰 {days} 天节点");
    }
    assert!(!wide.iter().any(|r| r.reminder_type == "guard_days_365"), "不再生成非 100 倍数的天数节点");
    assert!(wide.iter().any(|r| r.reminder_type.starts_with("guard_years_")));

    // 两个开关互不影响：只关百日时周年仍在，只关周年时百日仍在
    let mut no_hundreds = cfg.clone();
    no_hundreds.milestone_hundreds_enabled = false;
    let a = reminder::list(&db, &wide_q, &no_hundreds).unwrap();
    assert!(!a.iter().any(|r| r.reminder_type.starts_with("guard_days_")));
    assert!(a.iter().any(|r| r.reminder_type.starts_with("guard_years_")));

    let mut no_years = cfg.clone();
    no_years.milestone_years_enabled = false;
    let b = reminder::list(&db, &wide_q, &no_years).unwrap();
    assert!(b.iter().any(|r| r.reminder_type.starts_with("guard_days_")));
    assert!(!b.iter().any(|r| r.reminder_type.starts_with("guard_years_")));

    let mut off = cfg.clone();
    off.milestone_hundreds_enabled = false;
    off.milestone_years_enabled = false;
    let muted = reminder::list(&db, &wide_q, &off).unwrap();
    assert!(!muted.iter().any(|r| r.reminder_type.starts_with("guard_days_")));
    assert!(!muted.iter().any(|r| r.reminder_type.starts_with("guard_years_")));

    assert_eq!(reminder::anniversary_for_test("2024-02-29", "2026-11-14"), Some(("2027-02-28".into(), 3)));
    assert_eq!(reminder::anniversary_for_test("2026-11-20", "2026-11-14"), Some(("2027-11-20".into(), 1)));
}

#[test]
fn custom_reminders_support_crud_ack_and_validation() {
    let (_tmp, state) = temp_state();
    let today = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
    let db = state.lock_db().unwrap();
    profile::create(&db, &FanProfileInput {
        uid: "u-custom".into(), current_nickname: "小粉丝".into(), ..Default::default()
    }).unwrap();

    let saved = reminder::save_custom(&db, &CustomReminderInput {
        title: "百日纪念".into(), uid: Some("u-custom".into()),
        anchor_date: today.clone(), rule: "annual".into(), ..Default::default()
    }).unwrap();
    assert_eq!(saved.title, "百日纪念");
    assert_eq!(saved.nickname.as_deref(), Some("小粉丝"));

    let global = reminder::save_custom(&db, &CustomReminderInput {
        title: "开播周年庆".into(), anchor_date: today.clone(), rule: "once".into(), ..Default::default()
    }).unwrap();
    assert!(global.uid.is_none());

    let cfg = SettingsDto::default();
    let q = ReminderQuery { days_ahead: Some(0), include_acked: Some(true), source: Some("custom".into()) };
    let list = reminder::list(&db, &q, &cfg).unwrap();
    assert_eq!(list.len(), 2, "两条自定义纪念日都应在今天出现");
    let personal = list.iter().find(|r| r.custom_id == Some(saved.id)).unwrap();
    assert_eq!(personal.reminder_type, format!("custom_{}", saved.id));
    assert_eq!(personal.source, "custom");
    assert!(personal.greeting.contains("小粉丝"));
    let global_item = list.iter().find(|r| r.uid == GLOBAL_REMINDER_UID).unwrap();
    assert!(global_item.greeting.contains("开播周年庆"));

    let ack = ReminderAckInput {
        uid: personal.uid.clone(), reminder_type: personal.reminder_type.clone(),
        reminder_date: personal.reminder_date.clone(), acked: Some(true),
    };
    assert!(reminder::ack(&db, &ack, &cfg).unwrap().acked, "动态类型也必须能标记已处理");

    let disabled = reminder::save_custom(&db, &CustomReminderInput {
        id: Some(saved.id), title: saved.title.clone(), uid: saved.uid.clone(),
        anchor_date: saved.anchor_date.clone(), rule: saved.rule.clone(),
        enabled: Some(false), ..Default::default()
    }).unwrap();
    assert!(!disabled.enabled);
    assert_eq!(reminder::list(&db, &q, &cfg).unwrap().len(), 1, "停用后不再生成提醒");

    assert!(reminder::save_custom(&db, &CustomReminderInput {
        title: "无效".into(), uid: Some("不存在的UID".into()),
        anchor_date: today.clone(), rule: "annual".into(), ..Default::default()
    }).is_err(), "绑定不存在的粉丝必须报错");
    assert!(reminder::save_custom(&db, &CustomReminderInput {
        title: "无效".into(), anchor_date: "不是日期".into(), rule: "annual".into(), ..Default::default()
    }).is_err(), "非法日期必须报错");
    assert!(reminder::save_custom(&db, &CustomReminderInput {
        title: "无效".into(), anchor_date: today.clone(), rule: "weekly".into(), ..Default::default()
    }).is_err(), "非法规则必须报错");

    assert!(reminder::delete_custom(&db, saved.id).unwrap());
    assert_eq!(reminder::list_custom(&db).unwrap().len(), 1);
    let orphan_ack: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM reminder_ack WHERE reminder_type=?1", params![format!("custom_{}", saved.id)],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(orphan_ack, 0, "删除时须清理历史处理标记");
}

#[test]
fn import_commit_creates_events_rejects_future_snapshot_and_warns_on_missing_columns() {
    let (_tmp, state) = temp_state();
    let csv = concat!(
        "uid,nickname,guard_level,rank,unit_months,price_yuan,event_type,event_at\n",
        "u-new,新舰长,3,1,1,198,purchase,2026-11-01\n",
        "u-renew,续费提督,2,2,12,886,renew,2026-11-02\n",
        "u-nolevel,等级未知的粉丝,未知,3,1,45,purchase,2026-11-03\n",
    );
    let args = crate::models::ImportArgs {
        file_content: Some(csv.to_string()),
        file_name: Some("events.csv".into()),
        mapping: Some(crate::import::default_mapping()),
        ..Default::default()
    };
    let result = crate::import::commit(&state, &args).unwrap();
    assert_eq!(result.event_count, 3, "金额/月数有值即生成事件，与等级能否识别无关");
    assert_eq!(result.new_count, 3);
    assert_eq!(result.snapshot_date, crate::crypto::today());
    assert!(result.warnings.is_empty());

    let db = state.lock_db().unwrap();
    let mut stmt = db.conn.prepare(
        "SELECT uid, event_type, price_yuan, event_at FROM guard_event WHERE source='import' ORDER BY uid",
    ).unwrap();
    let events: Vec<(String, String, f64, String)> = stmt.query_map([], |r| Ok((
        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
    ))).unwrap().map(|r| r.unwrap()).collect();
    drop(stmt);
    assert_eq!(events.len(), 3);
    assert!(events.iter().any(|(uid, kind, _, _)| uid == "u-renew" && kind == "renew"),
        "续费类型不得被硬编码成购买");
    let new_event = events.iter().find(|(uid, ..)| uid == "u-new").unwrap();
    assert!(new_event.3.starts_with("2026-11-01"), "event_at 应取购买日期而非导入时刻");
    assert_eq!(crate::ledger::unlinked_event_count(&db).unwrap(), 3, "归集页面应能看到未归集事件");
    assert_eq!(crate::ledger::collect_events(&db).unwrap(), 3, "三条事件都应可归集为收入");
    assert_eq!(crate::ledger::collect_events(&db).unwrap(), 0, "重复归集必须幂等");
    drop(db);

    // 未来日期快照：明确拒绝并给出中文原因，不再静默回落或写坏当前名单
    let future = (chrono::Local::now().date_naive() + chrono::Duration::days(1))
        .format("%Y-%m-%d").to_string();
    let bad = crate::models::ImportArgs {
        file_content: Some(csv.to_string()),
        mapping: Some(crate::import::default_mapping()),
        snapshot_date: Some(future),
        ..Default::default()
    };
    let err = crate::import::commit(&state, &bad).unwrap_err();
    assert!(err.message.contains("晚于今天"), "应给出可读提示：{err}");

    let invalid = crate::models::ImportArgs {
        file_content: Some(csv.to_string()),
        mapping: Some(crate::import::default_mapping()),
        snapshot_date: Some("不是日期".into()),
        ..Default::default()
    };
    assert!(crate::import::commit(&state, &invalid).is_err(), "非法日期格式必须拒绝");

    // 金额 / 月数列未映射时给可见提示，避免「导入成功但归集始终 0 条」
    let mut empty_map = crate::import::default_mapping();
    empty_map.unit_months.clear();
    empty_map.price_yuan.clear();
    let no_events = crate::models::ImportArgs {
        file_content: Some(csv.to_string()),
        mapping: Some(empty_map),
        ..Default::default()
    };
    let r2 = crate::import::commit(&state, &no_events).unwrap();
    assert_eq!(r2.event_count, 0);
    assert!(!r2.warnings.is_empty());
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
    let backup_root = crate::settings::backup_root(&state.data_dir);
    assert!(std::path::Path::new(&exported.path).starts_with(&backup_root), "F4 脱敏清单必须写入与 F6 相同的备份目录");
    assert!(std::path::Path::new(&exported.path).file_name().unwrap().to_string_lossy().contains("-masked-"),
        "文件名带时间戳，避免同批次重复导出互相覆盖");
    let text = std::fs::read_to_string(&exported.path).unwrap();
    assert!(!text.contains("世纪大道"), "脱敏导出不得含门牌号");
    assert!(!text.contains("13800006621"), "脱敏导出不得含电话");
}

#[test]
fn ledger_income_collect_is_idempotent_and_summary_is_rounded() {
    let (_tmp, state) = temp_state();
    let db = state.lock_db().unwrap();
    db.conn.execute(
        "INSERT INTO guard_event(uid, nickname, event_type, guard_level, unit_months, price_yuan, event_at, source)
         VALUES ('u1','甲','purchase',3,1,198.0,'2026-11-10T20:00:00+08:00','import')", [],
    ).unwrap();
    let event_id = db.conn.last_insert_rowid();
    assert_eq!(ledger::collect_events(&db).unwrap(), 1);
    assert_eq!(ledger::collect_events(&db).unwrap(), 0, "同一事件不得重复归集");
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
fn expired_guards_keep_last_level_and_are_flagged() {
    let (_tmp, state) = temp_state();
    let db = state.lock_db().unwrap();
    for (uid, name) in [("u-active", "在舰"), ("u-expired", "过期")] {
        profile::create(&db, &FanProfileInput {
            uid: uid.into(), current_nickname: name.into(), ..Default::default()
        }).unwrap();
    }
    db.conn.execute(
        "INSERT INTO guard_snapshot(snapshot_date, fetched_at, source) VALUES ('2026-11-13','2026-11-13T04:00:00+08:00','import')", [],
    ).unwrap();
    let first = db.conn.last_insert_rowid();
    for (uid, level) in [("u-active", 2), ("u-expired", 3)] {
        db.conn.execute(
            "INSERT INTO guard_snapshot_member(snapshot_id, uid, nickname, guard_level, rank) VALUES (?1,?2,?3,?4,1)",
            params![first, uid, uid, level],
        ).unwrap();
    }
    db.conn.execute(
        "INSERT INTO guard_snapshot(snapshot_date, fetched_at, source) VALUES ('2026-11-14','2026-11-14T04:00:00+08:00','import')", [],
    ).unwrap();
    let latest = db.conn.last_insert_rowid();
    db.conn.execute(
        "INSERT INTO guard_snapshot_member(snapshot_id, uid, nickname, guard_level, rank) VALUES (?1,'u-active','在舰',1,1)",
        params![latest],
    ).unwrap();

    let page = profile::list(&db, &ProfileQuery::default(), true).unwrap();
    let active = page.items.iter().find(|p| p.uid == "u-active").unwrap();
    let expired = page.items.iter().find(|p| p.uid == "u-expired").unwrap();
    assert_eq!(active.guard_level, Some(1));
    assert_eq!(active.last_guard_level, Some(1));
    assert!(!active.guard_expired);
    assert_eq!(expired.guard_level, None, "过期成员不应出现在当前等级中");
    assert_eq!(expired.last_guard_level, Some(3), "过期成员仍保留历史等级用于灰化徽章");
    assert!(expired.guard_expired);
    // 按等级筛选只应命中当前在舰成员
    let filtered = profile::list(&db, &ProfileQuery { guard_level: Some(3), ..Default::default() }, true).unwrap();
    assert_eq!(filtered.total, 0);
}

#[test]
fn ledger_create_returns_the_row_it_inserted_despite_activity_logging() {
    let (_tmp, state) = temp_state();
    let db = state.lock_db().unwrap();
    // 让 activity_log 的 rowid 远大于 ledger_entry，复现实测报告 P1 的触发条件：
    // 旧实现把 last_insert_rowid() 放在 log_activity 之后取值，会拿到 activity_log 的 id。
    for i in 0..12 {
        crate::db::log_activity(&db.conn, "test", &format!("预热活动 {i}")).unwrap();
    }
    let created = ledger::create(&db, &LedgerInput {
        entry_type: "expense".into(), category: "快递费".into(), amount_yuan: 45.0,
        occurred_at: "2026-11-14".into(), batch_id: None,
        guard_event_id: None, note: Some("保存误报回归".into()),
    }).unwrap();
    assert_eq!(created.category, "快递费");
    assert_eq!(created.amount_yuan, 45.0);
    assert_eq!(created.note, "保存误报回归");
    let rows = ledger::list(&db, &LedgerQuery::default()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, created.id);
    assert_eq!(ledger::summary(&db).unwrap().total_expense_yuan, 45.0);
}

