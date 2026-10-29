//! Native application menu bar.
//!
//! Custom items emit a `menu://action` JSON event (`{ id }`) to the focused
//! window, which the frontend routes. The two File items that belong to the
//! library go to the library window instead of the focused one. Window-level
//! actions (fullscreen) are handled natively here.
//!
//! The View and Session menus carry everything the floating session toolbar
//! offers, because Preferences can hide that toolbar outright and the menu is
//! then the only way to reach any of it. That makes the menu stateful: it has
//! to show which scaling mode, quality preset and monitor are actually in use,
//! so the session view pushes its state through `sync_session_menu` whenever
//! it changes and whenever its window takes the focus. The handles needed to
//! apply that state are kept in [`SessionMenu`], managed alongside `AppState`.

use std::collections::HashMap;

use parking_lot::Mutex;
use serde::Deserialize;
use tauri::menu::{
    CheckMenuItem, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu,
    SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};

/// Kept in step with `ui/src/lib/tauri.ts` (`PROJECT_URL`/`CONTACT_URL`),
/// which shows the same two links in the in-app dialog used on every
/// platform. The webview never names a URL: `open_about_link` takes a target
/// and these constants decide where it points.
pub(crate) const CONTACT_URL: &str = "https://github.com/psmux";
pub(crate) const PROJECT_URL: &str = "https://github.com/Mohammedorax/OraxDesk";

/// The one check item that means something with no session in front: it is a
/// preference, not a property of a connection, and Preferences is reachable
/// from the library window where nothing is connected at all.
const HIDE_TOOLBAR: &str = "menu:hide-toolbar";

/// The fixed sizes the Resolution submenu offers.
///
/// These are the tokens the rows carry, matching the item ids above and
/// `RDP_FIXED_SIZES` in `ui/src/lib/rdp.ts`. Three lists rather than one
/// because the menu is built in Rust before any session exists, the ids have
/// to be literals, and the dialog is built in the webview. They are kept in
/// step by hand; a size in only one of them is a row that does nothing rather
/// than a crash.
const RESOLUTIONS: &[&str] = &[
    "1280x720",
    "1366x768",
    "1600x900",
    "1920x1080",
    "2560x1440",
    "3440x1440",
    "3840x2160",
];

/// The languages the SHELL's own menus are built in.
///
/// The webview's catalogue lives in `ui/src/lib/i18n.tsx`; the menu bar is
/// built in Rust before any window exists, so it cannot read that file. The
/// two are kept in step by hand, and the choice is stored in the same settings
/// table the rest of the shell reads (`app_language`), written by the
/// `set_ui_language` command when the person switches language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ar,
    En,
}

impl Lang {
    pub fn parse(value: &str) -> Lang {
        if value.trim().eq_ignore_ascii_case("en") {
            Lang::En
        } else {
            Lang::Ar
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Lang::Ar => "ar",
            Lang::En => "en",
        }
    }
}

/// The settings key the chosen language is stored under.
pub(crate) const LANGUAGE_KEY: &str = "app_language";

/// Every label the shell's menus put on screen.
///
/// A struct rather than a key/value lookup: a missing label is a compile
/// error, which is the only way a menu this size stays translated when an item
/// is added.
struct Text {
    app_about: &'static str,
    /// macOS only: the application menu's Settings item. Everywhere else the
    /// same action is a webview button, so this label is built but unused.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    settings: &'static str,
    file: &'static str,
    new_host: &'static str,
    quick_connect: &'static str,
    edit: &'static str,
    connection: &'static str,
    connect: &'static str,
    disconnect: &'static str,
    reconnect: &'static str,
    wake: &'static str,
    displays: &'static str,
    no_session: &'static str,
    all_displays: &'static str,
    detect_displays: &'static str,
    resolution: &'static str,
    res_connect: &'static str,
    res_follow: &'static str,
    pointers: &'static str,
    remote_cursor: &'static str,
    cursor_standard: &'static str,
    cursor_dot: &'static str,
    cursor_off: &'static str,
    toggle_toolbar: &'static str,
    hide_toolbar: &'static str,
    view: &'static str,
    fullscreen: &'static str,
    scale_fit: &'static str,
    scale_aspect: &'static str,
    scale_actual: &'static str,
    scale_remote: &'static str,
    zoom_in: &'static str,
    zoom_out: &'static str,
    zoom_reset: &'static str,
    lock_zoom: &'static str,
    edge_pan: &'static str,
    gray: &'static str,
    gray_256: &'static str,
    gray_16: &'static str,
    gray_8: &'static str,
    gray_4: &'static str,
    gray_2: &'static str,
    gray_1: &'static str,
    quality: &'static str,
    q_auto: &'static str,
    q_high: &'static str,
    q_medium: &'static str,
    q_low: &'static str,
    q_bw: &'static str,
    always_refresh: &'static str,
    keyboard: &'static str,
    passthrough: &'static str,
    send_cad: &'static str,
    send_cmd_tab: &'static str,
    send_win: &'static str,
    send_alt_f4: &'static str,
    send_escape: &'static str,
    release_keys: &'static str,
    files: &'static str,
    session: &'static str,
    connection_info: &'static str,
    view_only: &'static str,
    refresh: &'static str,
    clipboard_send: &'static str,
    screenshot: &'static str,
    window: &'static str,
    show_library: &'static str,
    next_tab: &'static str,
    prev_tab: &'static str,
    close_tab: &'static str,
    split_right: &'static str,
    split_down: &'static str,
    next_pane: &'static str,
    prev_pane: &'static str,
    zoom_pane: &'static str,
    even_panes: &'static str,
    arrange: &'static str,
    /// The noun a count is put in front of: "`action!("menu:pane:grid:3", format!("{{}} {{}}", 3, t.panes))`" / "3 أجزاء".
    panes: &'static str,
    close_pane: &'static str,
    help: &'static str,
    help_about: &'static str,
    project: &'static str,
    contact: &'static str,
    tray_open: &'static str,
    tray_quit: &'static str,
}

const TEXT_AR: Text = Text {
    app_about: "عن OraxDesk",
    settings: "الإعدادات…",
    file: "ملف",
    new_host: "جهاز جديد…",
    quick_connect: "اتصال بـ…",
    edit: "تحرير",
    connection: "الاتصال",
    connect: "اتصال",
    disconnect: "قطع الاتصال",
    reconnect: "إعادة الاتصال الآن",
    wake: "إيقاظ عبر Wake-on-LAN",
    displays: "الشاشات",
    no_session: "لا جلسة",
    all_displays: "كل الشاشات",
    detect_displays: "اكتشاف الشاشات مجددًا",
    resolution: "الدقة",
    res_connect: "طابِق هذه النافذة عند الاتصال",
    res_follow: "طابِق هذه النافذة واستمر بالمطابقة",
    pointers: "المؤشرات",
    remote_cursor: "إظهار مؤشر الجهاز البعيد",
    cursor_standard: "مؤشري: سهم عادي",
    cursor_dot: "مؤشري: نقطة",
    cursor_off: "مؤشري: مخفي",
    toggle_toolbar: "إظهار/إخفاء الشريط",
    hide_toolbar: "إخفاء الشريط العائم",
    view: "عرض",
    fullscreen: "تبديل ملء الشاشة",
    scale_fit: "ملاءمة النافذة",
    scale_aspect: "ملاءمة بنسبة الأبعاد",
    scale_actual: "الحجم الفعلي",
    scale_remote: "تحجيم بعيد (مطابقة النافذة)",
    zoom_in: "تكبير",
    zoom_out: "تصغير",
    zoom_reset: "إعادة التكبير إلى 100%",
    lock_zoom: "تثبيت التكبير (تجاهل القرص)",
    edge_pan: "التحريك عند حواف النافذة",
    gray: "مستويات التدرج الرمادي",
    gray_256: "256 مستوى",
    gray_16: "16 مستوى",
    gray_8: "8 مستويات",
    gray_4: "4 مستويات",
    gray_2: "مستويان",
    gray_1: "بت واحد (مُتشابك)",
    quality: "الجودة",
    q_auto: "تلقائي (حاد عند السكون، أسرع تحت الحمل)",
    q_high: "حاد (أفضل صورة، دون تكيّف)",
    q_medium: "متوازن",
    q_low: "سريع الاستجابة (صورة أنعم، أقل تأخير)",
    q_bw: "أبيض وأسود",
    always_refresh: "اطلب إطارات جديدة دائمًا",
    keyboard: "لوحة المفاتيح",
    passthrough: "تمرير اختصارات النظام إلى البعيد",
    send_cad: "أرسل Ctrl+Alt+Del",
    send_cmd_tab: "أرسل Cmd/Alt+Tab",
    send_win: "أرسل مفتاح Windows/Super",
    send_alt_f4: "أرسل Alt+F4",
    send_escape: "أرسل Escape",
    release_keys: "أفلت كل المفاتيح",
    files: "نقل الملفات…",
    session: "الجلسة",
    connection_info: "معلومات الاتصال…",
    view_only: "عرض فقط",
    refresh: "تحديث الشاشة",
    clipboard_send: "أرسل الحافظة إلى البعيد",
    screenshot: "احفظ لقطة شاشة",
    window: "نافذة",
    show_library: "إظهار المكتبة",
    next_tab: "التبويب التالي",
    prev_tab: "التبويب السابق",
    close_tab: "إغلاق التبويب",
    split_right: "تقسيم إلى اليمين",
    split_down: "تقسيم إلى الأسفل",
    next_pane: "الجزء التالي",
    prev_pane: "الجزء السابق",
    zoom_pane: "تكبير الجزء",
    even_panes: "تسوية الأجزاء",
    arrange: "ترتيب",
    panes: "أجزاء",
    close_pane: "إغلاق الجزء",
    help: "مساعدة",
    help_about: "مساعدة OraxDesk",
    project: "صفحة المشروع",
    contact: "تواصل مع المطوّر…",
    tray_open: "افتح OraxDesk",
    tray_quit: "إنهاء OraxDesk",
};

const TEXT_EN: Text = Text {
    app_about: "About OraxDesk",
    settings: "Settings…",
    file: "File",
    new_host: "New Host…",
    quick_connect: "Connect to…",
    edit: "Edit",
    connection: "Connection",
    connect: "Connect",
    disconnect: "Disconnect",
    reconnect: "Reconnect Now",
    wake: "Wake with Wake-on-LAN",
    displays: "Displays",
    no_session: "No session",
    all_displays: "All Displays",
    detect_displays: "Detect Displays Again",
    resolution: "Resolution",
    res_connect: "Match This Window When Connecting",
    res_follow: "Match This Window, and Keep Matching",
    pointers: "Pointers",
    remote_cursor: "Show the Remote Pointer",
    cursor_standard: "My Pointer: Standard Arrow",
    cursor_dot: "My Pointer: Dot",
    cursor_off: "My Pointer: Hidden",
    toggle_toolbar: "Show/Hide Toolbar",
    hide_toolbar: "Hide the Floating Toolbar",
    view: "View",
    fullscreen: "Toggle Fullscreen",
    scale_fit: "Fit to Window",
    scale_aspect: "Aspect Fit",
    scale_actual: "Actual Size",
    scale_remote: "Remote Resize (Match Window)",
    zoom_in: "Zoom In",
    zoom_out: "Zoom Out",
    zoom_reset: "Zoom to 100%",
    lock_zoom: "Lock Zoom (Ignore Pinch)",
    edge_pan: "Pan by Moving to Edges",
    gray: "Gray Levels",
    gray_256: "256 Levels",
    gray_16: "16 Levels",
    gray_8: "8 Levels",
    gray_4: "4 Levels",
    gray_2: "2 Levels",
    gray_1: "1-bit (Dithered)",
    quality: "Quality",
    q_auto: "Auto (sharp when idle, faster under load)",
    q_high: "Sharp (best picture, never adapts)",
    q_medium: "Balanced",
    q_low: "Responsive (softer picture, lowest lag)",
    q_bw: "Black & White",
    always_refresh: "Always Request Fresh Frames",
    keyboard: "Keyboard",
    passthrough: "Pass System Shortcuts to Remote",
    send_cad: "Send Ctrl+Alt+Del",
    send_cmd_tab: "Send Cmd/Alt+Tab",
    send_win: "Send Windows/Super Key",
    send_alt_f4: "Send Alt+F4",
    send_escape: "Send Escape",
    release_keys: "Release All Keys",
    files: "File Transfer…",
    session: "Session",
    connection_info: "Connection Info…",
    view_only: "View Only",
    refresh: "Refresh Screen",
    clipboard_send: "Send Clipboard to Remote",
    screenshot: "Save Screenshot",
    window: "Window",
    show_library: "Show Library",
    next_tab: "Next Tab",
    prev_tab: "Previous Tab",
    close_tab: "Close Tab",
    split_right: "Split Right",
    split_down: "Split Down",
    next_pane: "Next Pane",
    prev_pane: "Previous Pane",
    zoom_pane: "Maximise Pane",
    even_panes: "Even Out Panes",
    arrange: "Arrange",
    panes: "Panes",
    close_pane: "Close Pane",
    help: "Help",
    help_about: "OraxDesk Help",
    project: "Project Page",
    contact: "Contact Developer…",
    tray_open: "Open OraxDesk",
    tray_quit: "Quit OraxDesk",
};

fn text(lang: Lang) -> &'static Text {
    match lang {
        Lang::Ar => &TEXT_AR,
        Lang::En => &TEXT_EN,
    }
}

/// The two labels the tray menu owns ("Open OraxDesk", "Quit OraxDesk").
pub(crate) fn tray_labels(lang: Lang) -> (&'static str, &'static str) {
    let t = text(lang);
    (t.tray_open, t.tray_quit)
}

/// The language the shell's menus are built in, from the settings table.
pub(crate) fn stored_language(app: &AppHandle) -> Lang {
    app.try_state::<crate::state::AppState>()
        .and_then(|state| state.store.get_setting(LANGUAGE_KEY).ok().flatten())
        .map(|value| Lang::parse(&value))
        .unwrap_or(Lang::Ar)
}


/// Live handles into the parts of the menu that mirror a session.
///
/// Everything here is `Send + Sync` (tauri's menu wrappers hop to the main
/// thread internally), so it can sit behind a plain mutex in managed state.
pub struct SessionMenu {
    /// The language the labels were built in. The dynamic parts (the Displays
    /// submenu, which is refilled as the session reports monitors) read it so
    /// they are rebuilt in the same language as the rest of the menu.
    lang: Lang,
    /// Rebuilt from the webview's monitor list; see [`rebuild_displays`].
    displays: Submenu<Wry>,
    /// Disabled unless the session is one whose desktop size can be chosen.
    resolution: Submenu<Wry>,
    /// Every check item in the menu, by id.
    checks: HashMap<&'static str, CheckMenuItem<Wry>>,
    /// Plain items that do nothing without a session in front.
    gated_items: Vec<MenuItem<Wry>>,
    /// Submenus in the same position.
    gated_menus: Vec<Submenu<Wry>>,
    /// The File Transfer item, gated on the SSH probe as well as on a session.
    files: MenuItem<Wry>,
    /// The toolbar recall item, disabled while the toolbar is switched off.
    toggle_toolbar: MenuItem<Wry>,
    /// What the Displays submenu was last built from. Tearing the submenu down
    /// and refilling it on every state push would rebuild native menu items
    /// several times a second; the list only actually changes on connect, on a
    /// desktop resize, and when the seam detector finishes.
    displays_sig: String,
}

impl SessionMenu {
    /// Grey out (or restore) everything that needs a session behind it.
    fn set_live(&self, live: bool, files_available: bool) {
        for item in &self.gated_items {
            let _ = item.set_enabled(live);
        }
        for menu in &self.gated_menus {
            let _ = menu.set_enabled(live);
        }
        for (id, check) in &self.checks {
            if *id != HIDE_TOOLBAR {
                let _ = check.set_enabled(live);
            }
        }
        let _ = self.files.set_enabled(live && files_available);
    }

    fn check(&self, id: &str, checked: bool) {
        if let Some(item) = self.checks.get(id) {
            let _ = item.set_checked(checked);
        }
    }

    /// Tick exactly one item of a radio-style group.
    fn radio(&self, prefix: &str, options: &[&str], selected: &str) {
        for option in options {
            self.check(&format!("{prefix}{option}"), *option == selected);
        }
    }
}

/// One row of the Displays submenu, as the webview computed it.
///
/// The list is built in the webview rather than here because most of it does
/// not come off the wire: a server that never describes its monitors gets
/// synthetic cuts and a seam detected from the pixels, neither of which the
/// shell knows anything about.
#[derive(Debug, Deserialize)]
pub struct DisplayEntry {
    id: i64,
    label: String,
}

/// Everything the menu needs to know about the session in front.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMenuState {
    /// `fit`, `aspect-fit`, `actual`, `remote-resize` or `custom`.
    scaling_mode: String,
    /// `auto`, `high`, `medium`, `low` or `bw`.
    quality: String,
    gray_levels: u32,
    /// `standard`, `dot` or `off`.
    local_cursor: String,
    show_remote_cursor: bool,
    view_only: bool,
    passthrough: bool,
    always_refresh: bool,
    zoom_locked: bool,
    edge_pan: bool,
    /// False while the SSH probe is running or when it came back negative.
    files_available: bool,
    /// True when `displays` is the server's own layout rather than guesses,
    /// which is also when re-running the seam detector makes no sense.
    layout_known: bool,
    displays: Vec<DisplayEntry>,
    /// The selected monitor, or `None` for the whole desktop.
    display_id: Option<i64>,
    /// `connect`, `follow`, a `WIDTHxHEIGHT` pair, or empty for a session
    /// whose desktop size is not the user's to choose.
    #[serde(default)]
    resolution: String,
}

/// The payload of `sync_session_menu`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSync {
    /// Preferences ▸ Session, global rather than per session.
    hide_toolbar: bool,
    /// `None` when the window in front has no session in it.
    session: Option<SessionMenuState>,
}

/// Build and install the menu in the language stored in the settings table.
///
/// Called once at startup. [`apply`] does the same work again when the person
/// switches language, and is where the labels actually come from.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let lang = stored_language(app);
    apply(app, lang)?;
    // Registered once, outside `build`: `on_menu_event` would otherwise add a
    // second handler on every language change, and each menu item would then
    // be handled twice.
    app.on_menu_event(|app, event| {
        handle_menu_event(app, event.id().as_ref());
    });
    Ok(())
}

/// (Re)build the menu in `lang` and install it.
///
/// Safe to call again. The managed [`SessionMenu`] is REPLACED through its
/// existing cell rather than managed a second time: `app.manage` panics on a
/// key that is already managed, so a language switch that built a new menu
/// would take the whole application down on the first click.
pub fn apply(app: &AppHandle, lang: Lang) -> tauri::Result<()> {
    let (menu, session) = build(app, lang)?;
    app.set_menu(menu)?;
    match app.try_state::<Mutex<SessionMenu>>() {
        Some(cell) => *cell.lock() = session,
        None => {
            app.manage(Mutex::new(session));
        }
    }
    // A rebuilt menu starts with every session item disabled (nothing is
    // known to be live). The window in front re-pushes its snapshot on this
    // event, the same way it does when it takes the focus, so switching
    // language does not leave Disconnect greyed out until the next click.
    let _ = app.emit("menu://relabel", ());
    Ok(())
}

fn build(app: &AppHandle, lang: Lang) -> tauri::Result<(Menu<Wry>, SessionMenu)> {
    let t = text(lang);
    let builder = MenuBuilder::new(app);
    let mut checks: HashMap<&'static str, CheckMenuItem<Wry>> = HashMap::new();
    let mut gated_items: Vec<MenuItem<Wry>> = Vec::new();
    let mut gated_menus: Vec<Submenu<Wry>> = Vec::new();

    // Build a check item, remember it, and hand it back for the builder.
    // Unchecked and disabled to begin with: nothing is connected when the menu
    // is installed. `HIDE_TOOLBAR` is the exception, being a preference rather
    // than a property of a connection, so it is built enabled and `set_live`
    // leaves it that way.
    macro_rules! check {
        ($id:expr, $label:expr) => {{
            let enabled = $id == HIDE_TOOLBAR;
            let item = CheckMenuItem::with_id(app, $id, $label, enabled, false, None::<&str>)?;
            checks.insert($id, item.clone());
            item
        }};
    }
    macro_rules! action {
        ($id:expr, $label:expr) => {{
            let item = MenuItemBuilder::with_id($id, $label)
                .enabled(false)
                .build(app)?;
            gated_items.push(item.clone());
            item
        }};
    }

    #[cfg(target_os = "macos")]
    {
        // A custom About item routed to the in-app dialog, NOT the native
        // AboutMetadata panel: two About surfaces drift (the native one was
        // showing the version three different ways), and only the in-app
        // dialog carries the build fingerprint and the copy-a-report button
        // that bug reports need.
        let app_menu = SubmenuBuilder::new(app, "OraxDesk")
            .item(&MenuItemBuilder::with_id("menu:about", t.app_about).build(app)?)
            .separator()
            .item(
                &MenuItemBuilder::with_id("menu:settings", t.settings)
                    .accelerator("Cmd+,")
                    .build(app)?,
            )
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        builder = builder.item(&app_menu);
    }

    let file = SubmenuBuilder::new(app, t.file)
        .item(
            &MenuItemBuilder::with_id("menu:new-host", t.new_host)
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:quick-connect", t.quick_connect)
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .separator()
        .close_window()
        .build()?;

    // The six standard editing items, and on macOS they are not optional. A
    // WKWebView does not perform Cmd+X/C/V/A/Z by itself: a key equivalent
    // the page leaves unhandled is offered to the main menu, and the paste
    // happens only when a Paste item with that key equivalent is there to
    // send `paste:` back down the responder chain. Without this submenu,
    // Cmd+V in one of the app's own fields did nothing at all, and so did
    // every dictation tool that inserts by writing the clipboard and posting
    // Cmd+V, which is how Wispr Flow delivers a transcript (typed keys
    // arrived, the paste behind them never did). A session is not affected:
    // its keyboard hook calls preventDefault on the chord it forwards, and a
    // handled key equivalent never reaches the menu, so under pass-through the
    // remote still gets the paste and the local field does not.
    let edit = SubmenuBuilder::new(app, t.edit)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let connection = SubmenuBuilder::new(app, t.connection)
        .item(&MenuItemBuilder::with_id("menu:connect", t.connect).build(app)?)
        .item(&{
            // Gated like the rest of the session half: with the library in
            // front there is no session to disconnect from, and an item that
            // does nothing when clicked is worse than a greyed one.
            let item = MenuItemBuilder::with_id("menu:disconnect", t.disconnect)
                .accelerator("CmdOrCtrl+Shift+D")
                .enabled(false)
                .build(app)?;
            gated_items.push(item.clone());
            item
        })
        .item(&{
            let item = MenuItemBuilder::with_id("menu:reconnect", t.reconnect)
                .enabled(false)
                .build(app)?;
            gated_items.push(item.clone());
            item
        })
        .separator()
        .item(&MenuItemBuilder::with_id("menu:wake", t.wake).build(app)?)
        .build()?;

    // The monitor list is filled in by the first `sync_session_menu`; until
    // then the submenu says what an empty one means rather than sitting there
    // blank.
    let displays = SubmenuBuilder::new(app, t.displays)
        .item(
            &MenuItemBuilder::with_id("menu:displays-none", t.no_session)
                .enabled(false)
                .build(app)?,
        )
        .build()?;
    gated_menus.push(displays.clone());

    // The size of the remote desktop, as opposed to how it is scaled once it
    // arrives. Remote Desktop only: RFB has no equivalent that a user chooses,
    // so the submenu is disabled for a VNC session rather than offering
    // choices that would do nothing.
    let resolution = SubmenuBuilder::new(app, t.resolution)
        .item(&check!(
            "menu:res:connect",
            t.res_connect
        ))
        .item(&check!(
            "menu:res:follow",
            t.res_follow
        ))
        .separator()
        .item(&check!("menu:res:1280x720", "1280 x 720"))
        .item(&check!("menu:res:1366x768", "1366 x 768"))
        .item(&check!("menu:res:1600x900", "1600 x 900"))
        .item(&check!("menu:res:1920x1080", "1920 x 1080"))
        .item(&check!("menu:res:2560x1440", "2560 x 1440"))
        .item(&check!("menu:res:3440x1440", "3440 x 1440"))
        .item(&check!("menu:res:3840x2160", "3840 x 2160"))
        .build()?;
    gated_menus.push(resolution.clone());

    let pointers = SubmenuBuilder::new(app, t.pointers)
        .item(&check!("menu:remote-cursor", t.remote_cursor))
        .separator()
        .item(&check!(
            "menu:cursor:standard",
            t.cursor_standard
        ))
        .item(&check!("menu:cursor:dot", t.cursor_dot))
        .item(&check!("menu:cursor:off", t.cursor_off))
        .build()?;
    gated_menus.push(pointers.clone());

    let toggle_toolbar = MenuItemBuilder::with_id("menu:toggle-toolbar", t.toggle_toolbar)
        .accelerator("CmdOrCtrl+Shift+M")
        .enabled(false)
        .build(app)?;

    // The zoom items deliberately carry no accelerators. A menu accelerator is
    // claimed by the OS before the webview sees the key, so Cmd/Ctrl+= and
    // Cmd/Ctrl+- here would be stolen from every remote application for the
    // life of the app, which is the mistake the fullscreen chord below was
    // already fixed for once.
    let view = SubmenuBuilder::new(app, t.view)
        .item(
            // F11 on Windows/Linux, the convention there, and the chord this
            // used to carry ("CmdOrCtrl+Ctrl+F") collapsed to a plain Ctrl+F
            // on those platforms: a shortcut remote applications use for
            // Find, quietly stolen from the desktop being viewed. macOS keeps
            // Cmd+Ctrl+F, which is its own fullscreen convention and is not
            // in the way of anything.
            &MenuItemBuilder::with_id("menu:toggle-fullscreen", t.fullscreen)
                .accelerator(if cfg!(target_os = "macos") {
                    "CmdOrCtrl+Ctrl+F"
                } else {
                    "F11"
                })
                .build(app)?,
        )
        .separator()
        .item(&check!("menu:scale-fit", t.scale_fit))
        .item(&check!("menu:scale-aspect", t.scale_aspect))
        .item(&check!("menu:scale-actual", t.scale_actual))
        .item(&check!("menu:scale-remote", t.scale_remote))
        .separator()
        .item(&action!("menu:zoom-in", t.zoom_in))
        .item(&action!("menu:zoom-out", t.zoom_out))
        .item(&action!("menu:zoom-reset", t.zoom_reset))
        .item(&check!("menu:lock-zoom", t.lock_zoom))
        .item(&check!("menu:edge-pan", t.edge_pan))
        .separator()
        .item(&displays)
        .item(&resolution)
        .item(&pointers)
        .separator()
        .item(&toggle_toolbar)
        .item(&check!(HIDE_TOOLBAR, t.hide_toolbar))
        .build()?;

    let gray = SubmenuBuilder::new(app, t.gray)
        .item(&check!("menu:gray:256", t.gray_256))
        .item(&check!("menu:gray:16", t.gray_16))
        .item(&check!("menu:gray:8", t.gray_8))
        .item(&check!("menu:gray:4", t.gray_4))
        .item(&check!("menu:gray:2", t.gray_2))
        .item(&check!("menu:gray:1", t.gray_1))
        .build()?;

    // Named for the trade the person is making, picture sharpness against how
    // quickly the screen answers them, rather than for the link the preset was
    // once assumed to imply. The toolbar carries the same five in the same
    // words. Auto does both ends: it holds the picture while the client can
    // afford it and steps down while the client is saturated, which is what a
    // video playing on the remote needs (measured: a right-click menu went
    // from 2208 ms to 346 ms once Auto dropped the quality by itself).
    let quality = SubmenuBuilder::new(app, t.quality)
        .item(&check!(
            "menu:quality:auto",
            t.q_auto
        ))
        .item(&check!(
            "menu:quality:high",
            t.q_high
        ))
        .item(&check!("menu:quality:medium", t.q_medium))
        .item(&check!(
            "menu:quality:low",
            t.q_low
        ))
        .item(&check!("menu:quality:bw", t.q_bw))
        .separator()
        .item(&gray)
        .separator()
        .item(&check!(
            "menu:always-refresh",
            t.always_refresh
        ))
        .build()?;
    gated_menus.push(quality.clone());

    let keyboard = SubmenuBuilder::new(app, t.keyboard)
        .item(&check!(
            "menu:passthrough",
            t.passthrough
        ))
        .separator()
        .item(&action!("menu:send-cad", t.send_cad))
        .item(&action!("menu:send-cmd-tab", t.send_cmd_tab))
        .item(&action!("menu:send-win", t.send_win))
        .item(&action!("menu:send-alt-f4", t.send_alt_f4))
        .item(&action!("menu:send-escape", t.send_escape))
        .separator()
        .item(&action!("menu:release-keys", t.release_keys))
        .build()?;
    gated_menus.push(keyboard.clone());

    // Gated on the SSH probe as well as on a session, so it is held out of
    // `gated_items` and enabled by hand in `SessionMenu::set_live`.
    let files = MenuItemBuilder::with_id("menu:files", t.files)
        .enabled(false)
        .build(app)?;

    let session = SubmenuBuilder::new(app, t.session)
        .item(&action!("menu:connection-info", t.connection_info))
        .separator()
        .item(&quality)
        .item(&check!("menu:view-only", t.view_only))
        .item(&action!("menu:refresh", t.refresh))
        .separator()
        .item(&keyboard)
        .separator()
        .item(&action!("menu:clipboard-send", t.clipboard_send))
        .item(&files)
        .item(&action!("menu:screenshot", t.screenshot))
        .build()?;

    // Tab navigation lives on the native menu rather than in the webview
    // because the session's keyboard hook swallows almost everything: a menu
    // accelerator is intercepted by the OS before the page ever sees the key,
    // which is the only way these still work while shortcut pass-through is
    // on. The frontend routes them by `menu://action` id like any other custom
    // item, and ignores them when nothing is open in a tab.
    //
    // `CmdOrCtrl+Shift+W` for Close Tab, not the more usual `CmdOrCtrl+W`:
    // that one belongs to the predefined Close Window item below, and two
    // items cannot share an accelerator.
    let window_menu = SubmenuBuilder::new(app, t.window)
        .item(
            &MenuItemBuilder::with_id("menu:tab:library", t.show_library)
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:tab:next", t.next_tab)
                .accelerator("Ctrl+Tab")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:tab:prev", t.prev_tab)
                .accelerator("Ctrl+Shift+Tab")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:tab:close", t.close_tab)
                .accelerator("CmdOrCtrl+Shift+W")
                .build(app)?,
        )
        .separator()
        // Panes divide one tab between several sessions. These sit beside the
        // tab items and reach the library window the same way, for the same
        // reason: the layout belongs to the shell, and the session in front
        // has no idea what shape it is being shown in.
        //
        // Every one carries Alt on top of the platform modifier. The plain
        // pairs are spoken for (Shift+W closes a tab, Shift+D disconnects),
        // and a chord that closed a pane when the user meant the tab is the
        // kind of near miss that costs a connection.
        .item(
            &MenuItemBuilder::with_id("menu:pane:split-right", t.split_right)
                .accelerator("CmdOrCtrl+Alt+D")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:pane:split-down", t.split_down)
                .accelerator("CmdOrCtrl+Alt+Shift+D")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:pane:next", t.next_pane)
                .accelerator("CmdOrCtrl+Alt+]")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:pane:prev", t.prev_pane)
                .accelerator("CmdOrCtrl+Alt+[")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:pane:zoom", t.zoom_pane)
                .accelerator("CmdOrCtrl+Alt+Z")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:pane:even", t.even_panes)
                .accelerator("CmdOrCtrl+Alt+=")
                .build(app)?,
        )
        // Ready made grids, so a wall of machines does not have to be built one
        // split at a time. The counts are the ones people actually ask for; the
        // frontend can lay out any number, these are just the ones worth a
        // menu item. Whatever is already connected in the tab is kept and
        // re-placed, and the rest of the panes come up empty.
        .item(
            &SubmenuBuilder::new(app, t.arrange)
                .item(&action!("menu:pane:grid:2", format!("{} {}", 2, t.panes)))
                .item(&action!("menu:pane:grid:3", format!("{} {}", 3, t.panes)))
                .item(&action!("menu:pane:grid:4", format!("{} {}", 4, t.panes)))
                .item(&action!("menu:pane:grid:6", format!("{} {}", 6, t.panes)))
                .item(&action!("menu:pane:grid:8", format!("{} {}", 8, t.panes)))
                .item(&action!("menu:pane:grid:9", format!("{} {}", 9, t.panes)))
                .item(&action!("menu:pane:grid:12", format!("{} {}", 12, t.panes)))
                .build()?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:pane:close", t.close_pane)
                .accelerator("CmdOrCtrl+Alt+W")
                .build(app)?,
        )
        .separator()
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    // "Help" opens the in-app dialog (routed to the frontend) rather than a
    // URL, so it still works with no network. "Project page" is the one that
    // deliberately leaves the app.
    #[allow(unused_mut)] // only reassigned in the non-macOS branch below
    let mut help_builder = SubmenuBuilder::new(app, t.help)
        .item(&MenuItemBuilder::with_id("menu:about", t.help_about).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("menu:project", t.project).build(app)?)
        .item(&MenuItemBuilder::with_id("menu:contact", t.contact).build(app)?);
    // macOS already carries About in the application menu; everywhere else it
    // belongs under Help.
    #[cfg(not(target_os = "macos"))]
    {
        help_builder = help_builder
            .separator()
            .item(&MenuItemBuilder::with_id("menu:about", t.app_about).build(app)?);
    }
    let help = help_builder.build()?;

    let menu = builder
        .items(&[
            &file,
            &edit,
            &connection,
            &view,
            &session,
            &window_menu,
            &help,
        ])
        .build()?;

    Ok((
        menu,
        SessionMenu {
            lang,
            displays,
            resolution,
            checks,
            gated_items,
            gated_menus,
            files,
            toggle_toolbar,
            displays_sig: String::new(),
        },
    ))
}

/// Apply the state the webview just reported (the `sync_session_menu` command).
pub fn sync(app: &AppHandle, update: MenuSync) {
    let Some(state) = app.try_state::<Mutex<SessionMenu>>() else {
        return;
    };
    let mut menu = state.lock();
    tracing::debug!(
        hide_toolbar = update.hide_toolbar,
        live = update.session.is_some(),
        "menu sync"
    );

    menu.check(HIDE_TOOLBAR, update.hide_toolbar);

    let Some(s) = update.session else {
        menu.set_live(false, false);
        return;
    };
    menu.set_live(true, s.files_available);
    // Nothing to recall while the toolbar is switched off entirely.
    let _ = menu.toggle_toolbar.set_enabled(!update.hide_toolbar);

    // "custom" is the zoom slider, which no fixed row represents: passing it
    // through leaves all four unticked, which is exactly right.
    let scaling = match s.scaling_mode.as_str() {
        "fit" => "fit",
        "aspect-fit" => "aspect",
        "actual" => "actual",
        "remote-resize" => "remote",
        _ => "",
    };
    menu.radio(
        "menu:scale-",
        &["fit", "aspect", "actual", "remote"],
        scaling,
    );
    menu.radio(
        "menu:quality:",
        &["auto", "high", "medium", "low", "bw"],
        &s.quality,
    );
    menu.radio(
        "menu:gray:",
        &["256", "16", "8", "4", "2", "1"],
        &s.gray_levels.to_string(),
    );
    menu.radio("menu:cursor:", &["standard", "dot", "off"], &s.local_cursor);
    let mut rows: Vec<&str> = vec!["connect", "follow"];
    rows.extend_from_slice(RESOLUTIONS);
    menu.radio("menu:res:", &rows, &s.resolution);
    let _ = menu.resolution.set_enabled(!s.resolution.is_empty());

    menu.check("menu:remote-cursor", s.show_remote_cursor);
    menu.check("menu:view-only", s.view_only);
    menu.check("menu:passthrough", s.passthrough);
    menu.check("menu:always-refresh", s.always_refresh);
    menu.check("menu:lock-zoom", s.zoom_locked);
    menu.check("menu:edge-pan", s.edge_pan);

    // Cheap identity for the monitor list, so an unchanged one is left alone.
    let sig = format!(
        "{}|{}|{}",
        s.layout_known,
        s.display_id.map(|id| id.to_string()).unwrap_or_default(),
        s.displays
            .iter()
            .map(|d| format!("{}:{}", d.id, d.label))
            .collect::<Vec<_>>()
            .join(","),
    );
    if sig != menu.displays_sig {
        match rebuild_displays(app, &menu.displays, &s, menu.lang) {
            Ok(()) => menu.displays_sig = sig,
            Err(e) => tracing::warn!("could not rebuild the Displays menu: {e}"),
        }
    }
}

/// Refill the Displays submenu from the webview's list.
///
/// Rebuilt rather than kept in step item by item: the rows are not a fixed
/// set, they change with the desktop's geometry, and a server that describes
/// no layout at all offers a different list again once the seam detector has
/// looked at the pixels.
fn rebuild_displays(
    app: &AppHandle,
    displays: &Submenu<Wry>,
    state: &SessionMenuState,
    lang: Lang,
) -> tauri::Result<()> {
    let t = text(lang);
    while displays.remove_at(0)?.is_some() {}

    displays.append(&CheckMenuItem::with_id(
        app,
        "menu:display:all",
        t.all_displays,
        true,
        state.display_id.is_none(),
        None::<&str>,
    )?)?;

    if !state.displays.is_empty() {
        displays.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for entry in &state.displays {
        displays.append(&CheckMenuItem::with_id(
            app,
            format!("menu:display:{}", entry.id),
            &entry.label,
            true,
            state.display_id == Some(entry.id),
            None::<&str>,
        )?)?;
    }

    // Detection only exists for the servers that describe nothing; over a real
    // layout there is nothing left to guess at.
    if !state.layout_known {
        displays.append(&PredefinedMenuItem::separator(app)?)?;
        displays.append(
            &MenuItemBuilder::with_id("menu:detect-displays", t.detect_displays)
                .build(app)?,
        )?;
    }
    Ok(())
}

fn focused_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "menu:toggle-fullscreen" => {
            if let Some(window) = focused_window(app) {
                let is_fs = window.is_fullscreen().unwrap_or(false);
                if let Err(e) = crate::windows::set_fullscreen_on_monitor(&window, None, !is_fs) {
                    tracing::warn!("toggle fullscreen failed: {e}");
                }
            }
        }
        "menu:project" | "menu:contact" => {
            use tauri_plugin_opener::OpenerExt;
            let url = if id == "menu:contact" {
                CONTACT_URL.to_string()
            } else {
                PROJECT_URL.to_string()
            };
            // Opened from Rust rather than the webview: the window capability
            // scopes the opener plugin, and this keeps that scope narrow.
            if let Err(e) = app.opener().open_url(&url, None::<&str>) {
                tracing::warn!("failed to open {url}: {e}");
            }
        }
        "menu:tab:library"
        | "menu:tab:next"
        | "menu:tab:prev"
        | "menu:tab:close"
        | "menu:pane:split-right"
        | "menu:pane:split-down"
        | "menu:pane:next"
        | "menu:pane:prev"
        | "menu:pane:even"
        | "menu:pane:zoom"
        | "menu:pane:close" => {
            // The tab strip and the pane layout both live in the library
            // window, so these always go there rather than to whatever is
            // focused: a session window in front must not swallow "next tab"
            // into a webview that has no tabs, nor "split right" into one that
            // has no panes. Deliberately WITHOUT the show/focus dance below,
            // in the tabbed view the library window is already the focused
            // one, and in the separate-windows view there is nothing to switch
            // or divide, so raising the library over the session the user is
            // working in would be a jump scare rather than a feature.
            let payload = serde_json::json!({ "id": id });
            let _ = app.emit_to("main", "menu://action", payload);
        }
        // The grid sizes carry their count in the id, so they are matched by
        // prefix rather than listed twice.
        custom if custom.starts_with("menu:pane:grid:") => {
            // Same destination and the same reasoning as the arm above; these
            // carry their pane count in the id, so they match by prefix rather
            // than being listed one by one.
            let payload = serde_json::json!({ "id": id });
            let _ = app.emit_to("main", "menu://action", payload);
        }
        "menu:new-host" | "menu:quick-connect" | "menu:connect" | "menu:wake" => {
            // Library concerns, not session ones. Sent to the library window
            // wherever the focus happens to be, because the alternative is
            // that Cmd+T does nothing at all whenever a session is in front,
            // which is exactly when reaching for another machine is likeliest.
            //
            // `menu:connect` and `menu:wake` act on the host SELECTED in the
            // library, which is why they are routed here too: a session window
            // has no selection to act on. The library comes forward so the
            // person can see which machine the command will use; with nothing
            // selected, it says so instead of guessing.
            let payload = serde_json::json!({ "id": id });
            match app.get_webview_window("main") {
                Some(main) => {
                    // Same three calls the tray and the single-instance hook
                    // use: focusing alone leaves a minimized library in the
                    // Dock, so the address bar would take the keystroke with
                    // nothing on screen to show for it.
                    let _ = main.show();
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                    let _ = app.emit_to("main", "menu://action", payload);
                }
                None => {
                    let _ = app.emit("menu://action", payload);
                }
            }
        }
        custom if custom.starts_with("menu:") => {
            // Route everything else to the frontend of the focused window
            // (falls back to an app-wide emit when nothing is focused).
            //
            // Check items included: muda ticks them itself on click, which is
            // a guess at the new state rather than the truth, so the frontend
            // acts on the action and pushes the real state straight back
            // through `sync_session_menu`.
            let payload = serde_json::json!({ "id": custom });
            match focused_window(app) {
                Some(window) => {
                    let _ = app.emit_to(window.label(), "menu://action", payload);
                }
                None => {
                    let _ = app.emit("menu://action", payload);
                }
            }
        }
        _ => {} // predefined items handle themselves
    }
}
