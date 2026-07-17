// lattice menubar app - a thin native client of the local daemon (:4600).
//
// It runs tray-only (no dock icon): the tray menu is rebuilt every few seconds
// from the daemon's /api/summaries + /api/shares, so recent summaries and their
// share state are always live. Per-summary Open / Share / Unshare, plus a
// settings window (theme editor + hosted token) that talks to the daemon's
// /api/config over the loopback CORS opened for tauri://localhost.
//
// The daemon stays the source of truth; this process never touches ~/.summaries
// directly - every mutation goes through the HTTP API, exactly like the CLI.

use std::time::Duration;

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

const POLL_SECS: u64 = 5;
const MAX_RECENT: usize = 8;

// --- daemon API access -------------------------------------------------------

fn api_base() -> String {
    let addr = std::env::var("LATTICE_ADDR").unwrap_or_else(|_| "127.0.0.1:4600".into());
    format!("http://{addr}")
}

fn summaries_dir() -> std::path::PathBuf {
    if let Ok(d) = std::env::var("LATTICE_DIR") {
        return std::path::PathBuf::from(d);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home).join(".summaries")
}

fn log_path() -> std::path::PathBuf {
    summaries_dir().join(".lattice").join("lattice.log")
}

#[derive(Deserialize, Clone)]
struct Summary {
    slug: String,
    #[serde(default)]
    title: String,
}

#[derive(Deserialize, Clone)]
struct ShareInfo {
    slug: String,
    #[serde(default)]
    url: String,
}

struct State {
    online: bool,
    summaries: Vec<Summary>,
    shares: Vec<ShareInfo>,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(1500))
        .build()
}

// fetch_state polls the daemon. A failure to reach it just means "offline" -
// the menu still renders, so the app is useful before the daemon comes up.
fn fetch_state() -> State {
    let base = api_base();
    let a = agent();
    let online = a.get(&format!("{base}/api/health")).call().is_ok();
    let summaries: Vec<Summary> = a
        .get(&format!("{base}/api/summaries"))
        .call()
        .ok()
        .and_then(|r| r.into_json().ok())
        .unwrap_or_default();
    let shares: Vec<ShareInfo> = a
        .get(&format!("{base}/api/shares"))
        .call()
        .ok()
        .and_then(|r| r.into_json().ok())
        .unwrap_or_default();
    State {
        online,
        summaries,
        shares,
    }
}

// --- tray menu ---------------------------------------------------------------

fn build_menu(app: &AppHandle, st: &State) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;

    let status = if st.online {
        format!("lattice - running · {} summaries", st.summaries.len())
    } else {
        "lattice - daemon offline".to_string()
    };
    menu.append(&MenuItem::with_id(app, "status", status, false, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "add", "Add Summary…", st.online, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    // Which slugs are currently shared - drives the per-summary toggle label.
    let shared: std::collections::HashSet<&str> =
        st.shares.iter().map(|s| s.slug.as_str()).collect();

    if st.summaries.is_empty() {
        let label = if st.online { "no summaries yet" } else { "-" };
        menu.append(&MenuItem::with_id(app, "none", label, false, None::<&str>)?)?;
    } else {
        for s in st.summaries.iter().take(MAX_RECENT) {
            let title = if s.title.is_empty() { &s.slug } else { &s.title };
            let sub = Submenu::with_id(app, format!("sm:{}", s.slug), title.clone(), true)?;
            sub.append(&MenuItem::with_id(app, format!("open:{}", s.slug), "Open", true, None::<&str>)?)?;
            if shared.contains(s.slug.as_str()) {
                sub.append(&MenuItem::with_id(app, format!("unshare:{}", s.slug), "Unshare", true, None::<&str>)?)?;
            } else {
                sub.append(&MenuItem::with_id(app, format!("share:{}", s.slug), "Share…", true, None::<&str>)?)?;
            }
            menu.append(&sub)?;
        }
    }

    if !st.shares.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(
            app,
            "shares-hdr",
            format!("{} active share(s)", st.shares.len()),
            false,
            None::<&str>,
        )?)?;
        for sh in &st.shares {
            menu.append(&MenuItem::with_id(
                app,
                format!("openurl:{}", sh.url),
                format!("  {} → {}", sh.slug, sh.url),
                true,
                None::<&str>,
            )?)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "restart", "Restart Daemon", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "logs", "Open Logs", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&PredefinedMenuItem::quit(app, Some("Quit Lattice"))?)?;
    Ok(menu)
}

fn refresh_tray(app: &AppHandle) {
    let st = fetch_state();
    if let Ok(menu) = build_menu(app, &st) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

// --- menu routing ------------------------------------------------------------

fn on_menu(app: &AppHandle, id: &str) {
    let base = api_base();
    match id.split_once(':') {
        Some(("open", slug)) => open_url(app, &format!("{base}/s/{slug}")),
        Some(("openurl", url)) => open_url(app, url),
        Some(("share", slug)) => {
            let body = serde_json::json!({ "slug": slug });
            let _ = agent()
                .post(&format!("{base}/api/shares"))
                .send_json(body);
            refresh_tray(app);
        }
        Some(("unshare", slug)) => {
            let _ = agent()
                .delete(&format!("{base}/api/shares/{slug}"))
                .call();
            refresh_tray(app);
        }
        _ => match id {
            "dashboard" => show_app(app, "dashboard"),
            "settings" => show_app(app, "appearance"),
            "restart" => restart_daemon_and_refresh(app),
            "logs" => {
                let _ = tauri_plugin_opener::open_path(log_path().to_string_lossy().into_owned(), None::<&str>);
            }
            "add" => pick_and_add(app),
            _ => {}
        },
    }
}

fn open_url(_app: &AppHandle, url: &str) {
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
}

// show_app reveals the main window and asks the webview to switch tabs.
// "dashboard" = Workspace dashboard; "appearance" = first Settings tab.
fn show_app(app: &AppHandle, tab: &str) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        let script = format!(
            "(function(t){{if(typeof window.__latticeNavigate==='function')window.__latticeNavigate(t);else window.__latticePendingTab=t;}})({tab:?})"
        );
        let _ = win.eval(&script);
    }
}

// pick_and_add opens a native file picker and registers the chosen .html with
// the daemon (POST /api/summaries), then refreshes the tray.
fn pick_and_add(app: &AppHandle) {
    let app = app.clone();
    app.dialog()
        .file()
        .add_filter("HTML", &["html", "htm"])
        .pick_file(move |path| {
            let Some(path) = path else { return };
            let p = path.to_string();
            let body = serde_json::json!({ "path": p });
            let _ = agent()
                .post(&format!("{}/api/summaries", api_base()))
                .send_json(body);
            refresh_tray(&app);
        });
}

fn restart_daemon_and_refresh(app: &AppHandle) {
    restart_daemon();
    let app = app.clone();
    // Give launchd a moment to relaunch before repolling.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1200));
        let inner = app.clone();
        let _ = app.run_on_main_thread(move || refresh_tray(&inner));
    });
}

// restart_daemon kickstarts the LaunchAgent (installed by `make install`).
#[cfg(target_os = "macos")]
fn restart_daemon() {
    let uid = libc_getuid();
    let _ = std::process::Command::new("launchctl")
        .args([
            "kickstart",
            "-k",
            &format!("gui/{uid}/dev.yeksax.lattice"),
        ])
        .status();
}

#[cfg(not(target_os = "macos"))]
fn restart_daemon() {}

// getuid without pulling the whole libc crate - a single documented syscall.
#[cfg(target_os = "macos")]
fn libc_getuid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    unsafe { getuid() }
}

// --- Tauri commands (called from the settings webview) -----------------------

#[tauri::command]
fn daemon_status() -> String {
    if agent().get(&format!("{}/api/health", api_base())).call().is_ok() {
        "running".into()
    } else {
        "offline".into()
    }
}

// daemon_fetch proxies /api/* through Rust so the webview never hits mixed-content
// or CORS (Tauri 2 serves the UI from https://tauri.localhost).
#[tauri::command]
fn daemon_fetch(path: String, method: Option<String>, body: Option<String>) -> Result<String, String> {
    if !path.starts_with("/api/") {
        return Err("only /api paths allowed".into());
    }
    let url = format!("{}{}", api_base(), path);
    let method = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let a = agent();

    let result = match method.as_str() {
        "GET" => a.get(&url).call(),
        "DELETE" => a.delete(&url).call(),
        "PUT" => {
            let req = a.put(&url).set("Content-Type", "application/json");
            match &body {
                Some(b) => req.send_string(b),
                None => req.call(),
            }
        }
        "POST" => {
            let req = a.post(&url).set("Content-Type", "application/json");
            match &body {
                Some(b) => req.send_string(b),
                None => req.call(),
            }
        }
        other => return Err(format!("unsupported method {other}")),
    };

    match result {
        Ok(response) => response.into_string().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, response)) => {
            let text = response.into_string().unwrap_or_default();
            Err(format!("HTTP {code}: {text}"))
        }
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn daemon_restart(app: AppHandle) {
    restart_daemon_and_refresh(&app);
}

#[tauri::command]
fn open_logs() {
    let _ = tauri_plugin_opener::open_path(log_path().to_string_lossy().into_owned(), None::<&str>);
}

#[tauri::command]
fn add_summary(app: AppHandle) {
    pick_and_add(&app);
}

#[tauri::command]
fn refresh(app: AppHandle) {
    refresh_tray(&app);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            daemon_status,
            daemon_fetch,
            daemon_restart,
            open_logs,
            add_summary,
            refresh
        ])
        .setup(|app| {
            // Menubar-only: no dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let st = fetch_state();
            let menu = build_menu(&handle, &st)?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Lattice")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
                .build(app)?;

            // Live-refresh the menu from the daemon on a slow poll.
            let poll = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(POLL_SECS));
                let refresh = poll.clone();
                let _ = poll.run_on_main_thread(move || refresh_tray(&refresh));
            });

            Ok(())
        })
        .on_window_event(|win, event| {
            // Closing the settings window hides it instead of quitting the app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if win.label() == "settings" {
                    api.prevent_close();
                    let _ = win.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building lattice app")
        .run(|_app, event| {
            // Keep running with no windows open (tray-only).
            if let tauri::RunEvent::ExitRequested { .. } = event {}
        });
}
