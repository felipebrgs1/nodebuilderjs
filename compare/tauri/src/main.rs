// Tauri baseline: same window size and scene as examples/bench/bench.tsx (SCENE=dashboard:
// examples/bench/dashboard.tsx), running the vanilla-DOM frontend shared with compare/electron
// in the system WebKitGTK. Options come from the same env vars as the other two.
use std::io::Write;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The page's fps lines, printed where scripts/compare.sh reads them.
#[tauri::command]
fn report(line: String) {
    println!("{line}");
    let _ = std::io::stdout().flush();
}

fn env(key: &str, default: &str) -> String {
    let value = std::env::var(key).unwrap_or_else(|_| default.into());
    value.chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

fn main() {
    let dashboard = env("SCENE", "") == "dashboard";
    let params = format!(
        "N={}&MODE={}&MAX_FPS={}&TAB={}&ROWS={}&LIVE={}&CYCLE={}",
        env("N", "1000"),
        env("MODE", "one"),
        env("NB_MAX_FPS", "120"),
        env("TAB", "overview"),
        env("ROWS", "500"),
        env("LIVE", "1"),
        env("CYCLE", "0"),
    );
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![report])
        .setup(move |app| {
            let (page, width, height) = if dashboard { ("dashboard.html", 1200.0, 800.0) } else { ("index.html", 1000.0, 720.0) };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App(page.into()))
                .title("Bench (Tauri)")
                .inner_size(width, height)
                .initialization_script(format!("window.__BENCH_PARAMS__ = \"{params}\";"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}
