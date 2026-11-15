pub mod backup;
pub mod commands;
pub mod crypto;
pub mod db;
pub mod error;
pub mod gifts;
pub mod guard;
pub mod import;
pub mod ledger;
pub mod models;
pub mod profile;
pub mod reminder;
pub mod settings;
pub mod sync;

#[cfg(test)]
mod tests;

use std::path::PathBuf;
use tauri::Manager;

use db::AppState;

pub fn run() {
    tauri::Builder::default()
        // 必须最先注册：第二个实例启动时会直接退出，并把已有主窗口唤起，
        // 从而根治「安装完自动运行 + 手动再启动」造成的双进程双窗口（P3）。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_dir: PathBuf = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("数据目录创建失败：{e}"))?;

            // 恢复标记必须在打开数据库之前处理，避免文件占用导致替换失败
            match backup::apply_restore_marker(&data_dir) {
                Ok(true) => tracing::info!("已从备份恢复本地数据库"),
                Ok(false) => {}
                Err(e) => tracing::warn!("恢复未完成，保留标记与当前数据：{}", e),
            }

            app.manage(AppState::new(data_dir.clone())?);
            app.manage(sync::SyncState::default());
            setup_tray(app)?;

            // 定时快照仅在用户启用同步后生效；关闭时该线程只做本地配置检查，不发起任何外部请求
            let sync_handle = app.handle().clone();
            std::thread::spawn(move || sync::schedule_loop(sync_handle));

            // 启动自动备份放到后台线程，不阻塞首屏
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<AppState>();
                match backup::backup_now(&state) {
                    Ok(entry) => tracing::info!("启动自动备份完成：{}", entry.file_name),
                    Err(e) => tracing::warn!("启动自动备份失败：{}", e),
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let handle = window.app_handle();
                if let Some(state) = handle.try_state::<AppState>() {
                    let cfg = settings::load(&state.data_dir);
                    if cfg.minimize_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_bootstrap,
            commands::profile_list,
            commands::profile_get,
            commands::profile_create,
            commands::profile_update,
            commands::profile_reveal_address,
            commands::profile_set_lock,
            commands::guard_list,
            commands::guard_snapshots,
            commands::guard_events,
            commands::import_parse,
            commands::import_commit,
            commands::backup_list,
            commands::backup_now,
            commands::backup_export_db,
            commands::backup_export_csv,
            commands::restore_prepare,
            commands::settings_get,
            commands::settings_update,
            commands::open_data_dir,
            commands::reminder_list,
            commands::reminder_ack,
            commands::reminder_notify,
            commands::custom_reminder_list,
            commands::custom_reminder_save,
            commands::custom_reminder_delete,
            commands::gift_batch_list,
            commands::gift_batch_create,
            commands::gift_shipment_list,
            commands::gift_shipment_update,
            commands::gift_address_set_status,
            commands::gift_shipment_reveal_address,
            commands::gift_batch_export,
            commands::ledger_list,
            commands::ledger_create,
            commands::ledger_delete,
            commands::ledger_summary,
            commands::ledger_sync_events,
            commands::sync_status,
            commands::sync_set_enabled,
            commands::sync_qr_start,
            commands::sync_qr_poll,
            commands::sync_logout,
            commands::sync_snapshot_now,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let backup = MenuItem::with_id(app, "backup", "立即备份", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &backup, &sep, &quit])?;
    let icon = app.default_window_icon()
        .ok_or("缺少应用图标")?
        .clone();

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("守村人·粉丝档案")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "backup" => {
                let state = app.state::<AppState>();
                if let Err(e) = backup::backup_now(&state) {
                    tracing::warn!("托盘立即备份失败：{}", e);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}
