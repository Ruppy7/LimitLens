use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, WindowEvent,
};

const MAIN_WINDOW: &str = "main";
const POPUP_MARGIN: i32 = 16;
const ALL_SIZE: (f64, f64) = (400.0, 540.0);
const MINIMAL_SIZE: (f64, f64) = (320.0, 225.0);
static POPPED_OUT: AtomicBool = AtomicBool::new(false);

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
        show_popup_window(&window);
    }

    Ok(())
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.emit("tray-popup-closing", ());
        return;
    }

    show_popup_window(&window);
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    show_popup_window(&window);
}

pub fn hide_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.hide()?;
    }

    Ok(())
}

pub fn request_close_animation(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.emit("tray-popup-closing", ())?;
    }

    Ok(())
}

pub fn set_popped_out(app: &tauri::AppHandle, popped_out: bool) -> tauri::Result<()> {
    POPPED_OUT.store(popped_out, Ordering::Relaxed);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.set_always_on_top(true)?;
        if !popped_out {
            position_near_bottom_right(&window);
        }
    }

    Ok(())
}

pub fn set_display_mode(app: &tauri::AppHandle, mode: &str) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return Ok(());
    };

    let (width, height) = if mode == "minimal" {
        MINIMAL_SIZE
    } else {
        ALL_SIZE
    };

    window.set_size(Size::Logical(LogicalSize { width, height }))?;
    show_popup_window(&window);
    Ok(())
}

fn show_popup_window(window: &tauri::WebviewWindow) {
    let popped_out = POPPED_OUT.load(Ordering::Relaxed);
    if !popped_out {
        position_near_bottom_right(window);
    }
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.emit("tray-popup-opened", ());
    let _ = window.show();
    let _ = window.set_focus();
}

fn position_near_bottom_right(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let work_area = monitor.work_area();
    let x = work_area.position.x + work_area.size.width as i32
        - window_size.width as i32
        - POPUP_MARGIN;
    let y = work_area.position.y + work_area.size.height as i32
        - window_size.height as i32
        - POPUP_MARGIN;

    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
}
