use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW: &str = "main";

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("missing app icon").clone())
        .tooltip("InfUsage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let window_to_hide = window.clone();
        window.on_window_event(move |window_event| {
            if let WindowEvent::CloseRequested { api, .. } = window_event {
                // Rust note: this keeps the process alive; like calling event.preventDefault() in JS.
                api.prevent_close();
                let _ = window_to_hide.hide();
            }
        });
    }

    Ok(())
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
