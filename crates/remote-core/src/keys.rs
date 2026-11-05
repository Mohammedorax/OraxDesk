//! The named key table, and the type an agent names a physical key with.
//!
//! This is vocabulary, not policy, and it sits here for the reason
//! [`crate::intent`] does: `IntentKind::Press` and `IntentKind::Click` hold
//! `&'static NamedKey`, so the type has to be reachable from the command side
//! or `ClientCommand::Agent` cannot be written at all (`PRDAgentPlug/00 R28`,
//! `00 R47a`). [`NamedKey::lookup`] is an inherent method and Rust only lets
//! it live in the crate that defines the type, so the table it reads came with
//! it.
//!
//! What did NOT come with it is the LOWERING: `keysym_for_char`,
//! `type_keysyms`, `lower_type` and `lower_press` are still `limb_core::keys`,
//! because turning an intent into a run of `ClientCommand`s is a decision
//! about how a limb behaves and nothing in this crate calls it. Read the module
//! comment there before touching any of it; it is the keysym versus scancode
//! trap and it is the subtlest correctness bug in the set.

/// A key an agent may press by name, with both identifiers.
///
/// Both, because `Press` is for physical chords: `sendKeyCombo` used to send
/// keycode 0 for every key, so Ctrl+Alt+Del from the toolbar degraded to a
/// keysym only KeyEvent and did nothing at all on a server that only
/// understands scancodes (`ui/src/render/keysyms.ts:246`). A chord genuinely
/// is a set of key positions, so it carries positions.
///
/// That is the whole difference between [`IntentKind::Press`] and
/// [`IntentKind::Type`], and it is why they are separate intents with separate
/// vocabularies rather than one intent with a flag.
///
/// [`IntentKind::Press`]: crate::intent::IntentKind::Press
/// [`IntentKind::Type`]: crate::intent::IntentKind::Type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NamedKey {
    /// The name an agent uses. These are the DOM `code` and `key` spellings,
    /// because those are the names the webview's own tables are keyed on and a
    /// second set of names for the same keys is how the two drift.
    pub name: &'static str,
    pub keysym: u32,
    /// XT (PC set 1) scancode for the QEMU Extended Key Event. `0` when the
    /// tree has none, which makes the session fall back to the plain keysym
    /// only KeyEvent, exactly as `KeyIds` documents
    /// (`ui/src/render/keysyms.ts:123`).
    ///
    /// The extended (grey) keys carry the `0xE0` prefix as BIT 7 of the single
    /// byte rather than as a second byte, which is why ArrowRight is `0xcd`
    /// and not `0xe04d`. Sending two bytes in a one byte field made a server
    /// that masks it see `0x4d`, which is Numpad4. The tree records that bug
    /// at `ui/src/render/keysyms.ts:101` and this table is copied from the
    /// fixed version.
    pub scancode: u32,
}

impl NamedKey {
    /// Look a key up by name, ignoring ASCII case.
    ///
    /// Case insensitive because an agent writing `escape` for `Escape` has
    /// made no meaningful error, and a refusal there teaches it nothing. No
    /// two names in the table differ only in case, which a test asserts, so
    /// the relaxation cannot make a lookup ambiguous.
    ///
    /// A name outside the table returns `None`, and the caller turns that into
    /// `UNKNOWN_KEY` before an intent is built. A numeric code outside the
    /// table is a DIFFERENT action needing `limb_core::Capability::Scancode`,
    /// which is in no bundle (`00 R30`).
    pub fn lookup(name: &str) -> Option<&'static NamedKey> {
        let name = name.trim();
        NAMED_KEYS
            .iter()
            .find(|k| k.name.eq_ignore_ascii_case(name))
    }
}

/// The fixed named key table.
///
/// Copied from `ui/src/render/keysyms.ts`, which holds the keysyms in
/// `KEY_TO_KEYSYM` and `CODE_TO_KEYSYM` and the scancodes in
/// `CODE_TO_XT_SCANCODE`. It is a copy rather than a generated artefact
/// because there is no build step between TypeScript and Rust here, and a
/// test asserts the two properties that matter: no duplicate names, and no key
/// whose keysym is zero.
///
/// It is deliberately a FIXED table with no aliases. `Control` is not a key,
/// `ControlLeft` and `ControlRight` are, and a plane that quietly resolved the
/// first to the second would be choosing a physical key on the agent's behalf
/// in the one intent whose entire purpose is to name a physical key.
pub static NAMED_KEYS: &[NamedKey] = &[
    // Editing and control, keyed by DOM `key` in the webview.
    NamedKey {
        name: "Backspace",
        keysym: 0xff08,
        scancode: 0x0e,
    },
    NamedKey {
        name: "Tab",
        keysym: 0xff09,
        scancode: 0x0f,
    },
    NamedKey {
        name: "Clear",
        keysym: 0xff0b,
        scancode: 0x00,
    },
    NamedKey {
        name: "Enter",
        keysym: 0xff0d,
        scancode: 0x1c,
    },
    NamedKey {
        name: "Pause",
        keysym: 0xff13,
        scancode: 0xc6,
    },
    NamedKey {
        name: "ScrollLock",
        keysym: 0xff14,
        scancode: 0x46,
    },
    NamedKey {
        name: "Escape",
        keysym: 0xff1b,
        scancode: 0x01,
    },
    NamedKey {
        name: "Space",
        keysym: 0x0020,
        scancode: 0x39,
    },
    NamedKey {
        name: "Delete",
        keysym: 0xffff,
        scancode: 0xd3,
    },
    NamedKey {
        name: "Home",
        keysym: 0xff50,
        scancode: 0xc7,
    },
    NamedKey {
        name: "ArrowLeft",
        keysym: 0xff51,
        scancode: 0xcb,
    },
    NamedKey {
        name: "ArrowUp",
        keysym: 0xff52,
        scancode: 0xc8,
    },
    NamedKey {
        name: "ArrowRight",
        keysym: 0xff53,
        scancode: 0xcd,
    },
    NamedKey {
        name: "ArrowDown",
        keysym: 0xff54,
        scancode: 0xd0,
    },
    NamedKey {
        name: "PageUp",
        keysym: 0xff55,
        scancode: 0xc9,
    },
    NamedKey {
        name: "PageDown",
        keysym: 0xff56,
        scancode: 0xd1,
    },
    NamedKey {
        name: "End",
        keysym: 0xff57,
        scancode: 0xcf,
    },
    NamedKey {
        name: "Insert",
        keysym: 0xff63,
        scancode: 0xd2,
    },
    NamedKey {
        name: "ContextMenu",
        keysym: 0xff67,
        scancode: 0xdd,
    },
    NamedKey {
        name: "PrintScreen",
        keysym: 0xff61,
        scancode: 0x54,
    },
    NamedKey {
        name: "NumLock",
        keysym: 0xff7f,
        scancode: 0x45,
    },
    NamedKey {
        name: "CapsLock",
        keysym: 0xffe5,
        scancode: 0x3a,
    },
    // Function keys. F13 upward have no XT scancode in the tree, so they go
    // out keysym only, which is what `KeyIds` says a zero means.
    NamedKey {
        name: "F1",
        keysym: 0xffbe,
        scancode: 0x3b,
    },
    NamedKey {
        name: "F2",
        keysym: 0xffbf,
        scancode: 0x3c,
    },
    NamedKey {
        name: "F3",
        keysym: 0xffc0,
        scancode: 0x3d,
    },
    NamedKey {
        name: "F4",
        keysym: 0xffc1,
        scancode: 0x3e,
    },
    NamedKey {
        name: "F5",
        keysym: 0xffc2,
        scancode: 0x3f,
    },
    NamedKey {
        name: "F6",
        keysym: 0xffc3,
        scancode: 0x40,
    },
    NamedKey {
        name: "F7",
        keysym: 0xffc4,
        scancode: 0x41,
    },
    NamedKey {
        name: "F8",
        keysym: 0xffc5,
        scancode: 0x42,
    },
    NamedKey {
        name: "F9",
        keysym: 0xffc6,
        scancode: 0x43,
    },
    NamedKey {
        name: "F10",
        keysym: 0xffc7,
        scancode: 0x44,
    },
    NamedKey {
        name: "F11",
        keysym: 0xffc8,
        scancode: 0x57,
    },
    NamedKey {
        name: "F12",
        keysym: 0xffc9,
        scancode: 0x58,
    },
    NamedKey {
        name: "F13",
        keysym: 0xffca,
        scancode: 0x00,
    },
    NamedKey {
        name: "F14",
        keysym: 0xffcb,
        scancode: 0x00,
    },
    NamedKey {
        name: "F15",
        keysym: 0xffcc,
        scancode: 0x00,
    },
    NamedKey {
        name: "F16",
        keysym: 0xffcd,
        scancode: 0x00,
    },
    NamedKey {
        name: "F17",
        keysym: 0xffce,
        scancode: 0x00,
    },
    NamedKey {
        name: "F18",
        keysym: 0xffcf,
        scancode: 0x00,
    },
    NamedKey {
        name: "F19",
        keysym: 0xffd0,
        scancode: 0x00,
    },
    NamedKey {
        name: "F20",
        keysym: 0xffd1,
        scancode: 0x00,
    },
    // Modifiers. Left and right are different keysyms, which is why the
    // webview keys these off `event.code` rather than `event.key`.
    NamedKey {
        name: "ShiftLeft",
        keysym: 0xffe1,
        scancode: 0x2a,
    },
    NamedKey {
        name: "ShiftRight",
        keysym: 0xffe2,
        scancode: 0x36,
    },
    NamedKey {
        name: "ControlLeft",
        keysym: 0xffe3,
        scancode: 0x1d,
    },
    NamedKey {
        name: "ControlRight",
        keysym: 0xffe4,
        scancode: 0x9d,
    },
    NamedKey {
        name: "AltLeft",
        keysym: 0xffe9,
        scancode: 0x38,
    },
    NamedKey {
        name: "AltRight",
        keysym: 0xffea,
        scancode: 0xb8,
    },
    NamedKey {
        name: "MetaLeft",
        keysym: 0xffeb,
        scancode: 0xdb,
    },
    NamedKey {
        name: "MetaRight",
        keysym: 0xffec,
        scancode: 0xdc,
    },
    // Letters, digits and punctuation, named by DOM `code`, so a chord such as
    // ctrl+c or super+r can be pressed at all. The keysym is the character
    // the key gives unshifted on a US layout, and the scancode is that key's
    // position in `CODE_TO_XT_SCANCODE`, which is exactly what the webview
    // sends when a person presses the same key. RDP needs the scancode,
    // because a key with none goes out as a unicode event, and Windows does
    // not treat Ctrl plus a unicode event as a shortcut.
    NamedKey {
        name: "KeyA",
        keysym: 0x0061,
        scancode: 0x1e,
    },
    NamedKey {
        name: "KeyB",
        keysym: 0x0062,
        scancode: 0x30,
    },
    NamedKey {
        name: "KeyC",
        keysym: 0x0063,
        scancode: 0x2e,
    },
    NamedKey {
        name: "KeyD",
        keysym: 0x0064,
        scancode: 0x20,
    },
    NamedKey {
        name: "KeyE",
        keysym: 0x0065,
        scancode: 0x12,
    },
    NamedKey {
        name: "KeyF",
        keysym: 0x0066,
        scancode: 0x21,
    },
    NamedKey {
        name: "KeyG",
        keysym: 0x0067,
        scancode: 0x22,
    },
    NamedKey {
        name: "KeyH",
        keysym: 0x0068,
        scancode: 0x23,
    },
    NamedKey {
        name: "KeyI",
        keysym: 0x0069,
        scancode: 0x17,
    },
    NamedKey {
        name: "KeyJ",
        keysym: 0x006a,
        scancode: 0x24,
    },
    NamedKey {
        name: "KeyK",
        keysym: 0x006b,
        scancode: 0x25,
    },
    NamedKey {
        name: "KeyL",
        keysym: 0x006c,
        scancode: 0x26,
    },
    NamedKey {
        name: "KeyM",
        keysym: 0x006d,
        scancode: 0x32,
    },
    NamedKey {
        name: "KeyN",
        keysym: 0x006e,
        scancode: 0x31,
    },
    NamedKey {
        name: "KeyO",
        keysym: 0x006f,
        scancode: 0x18,
    },
    NamedKey {
        name: "KeyP",
        keysym: 0x0070,
        scancode: 0x19,
    },
    NamedKey {
        name: "KeyQ",
        keysym: 0x0071,
        scancode: 0x10,
    },
    NamedKey {
        name: "KeyR",
        keysym: 0x0072,
        scancode: 0x13,
    },
    NamedKey {
        name: "KeyS",
        keysym: 0x0073,
        scancode: 0x1f,
    },
    NamedKey {
        name: "KeyT",
        keysym: 0x0074,
        scancode: 0x14,
    },
    NamedKey {
        name: "KeyU",
        keysym: 0x0075,
        scancode: 0x16,
    },
    NamedKey {
        name: "KeyV",
        keysym: 0x0076,
        scancode: 0x2f,
    },
    NamedKey {
        name: "KeyW",
        keysym: 0x0077,
        scancode: 0x11,
    },
    NamedKey {
        name: "KeyX",
        keysym: 0x0078,
        scancode: 0x2d,
    },
    NamedKey {
        name: "KeyY",
        keysym: 0x0079,
        scancode: 0x15,
    },
    NamedKey {
        name: "KeyZ",
        keysym: 0x007a,
        scancode: 0x2c,
    },
    NamedKey {
        name: "Digit0",
        keysym: 0x0030,
        scancode: 0x0b,
    },
    NamedKey {
        name: "Digit1",
        keysym: 0x0031,
        scancode: 0x02,
    },
    NamedKey {
        name: "Digit2",
        keysym: 0x0032,
        scancode: 0x03,
    },
    NamedKey {
        name: "Digit3",
        keysym: 0x0033,
        scancode: 0x04,
    },
    NamedKey {
        name: "Digit4",
        keysym: 0x0034,
        scancode: 0x05,
    },
    NamedKey {
        name: "Digit5",
        keysym: 0x0035,
        scancode: 0x06,
    },
    NamedKey {
        name: "Digit6",
        keysym: 0x0036,
        scancode: 0x07,
    },
    NamedKey {
        name: "Digit7",
        keysym: 0x0037,
        scancode: 0x08,
    },
    NamedKey {
        name: "Digit8",
        keysym: 0x0038,
        scancode: 0x09,
    },
    NamedKey {
        name: "Digit9",
        keysym: 0x0039,
        scancode: 0x0a,
    },
    NamedKey {
        name: "Minus",
        keysym: 0x002d,
        scancode: 0x0c,
    },
    NamedKey {
        name: "Equal",
        keysym: 0x003d,
        scancode: 0x0d,
    },
    NamedKey {
        name: "BracketLeft",
        keysym: 0x005b,
        scancode: 0x1a,
    },
    NamedKey {
        name: "BracketRight",
        keysym: 0x005d,
        scancode: 0x1b,
    },
    NamedKey {
        name: "Semicolon",
        keysym: 0x003b,
        scancode: 0x27,
    },
    NamedKey {
        name: "Quote",
        keysym: 0x0027,
        scancode: 0x28,
    },
    NamedKey {
        name: "Backquote",
        keysym: 0x0060,
        scancode: 0x29,
    },
    NamedKey {
        name: "Backslash",
        keysym: 0x005c,
        scancode: 0x2b,
    },
    NamedKey {
        name: "Comma",
        keysym: 0x002c,
        scancode: 0x33,
    },
    NamedKey {
        name: "Period",
        keysym: 0x002e,
        scancode: 0x34,
    },
    NamedKey {
        name: "Slash",
        keysym: 0x002f,
        scancode: 0x35,
    },
    // Numpad.
    NamedKey {
        name: "NumpadEnter",
        keysym: 0xff8d,
        scancode: 0x9c,
    },
    NamedKey {
        name: "NumpadMultiply",
        keysym: 0xffaa,
        scancode: 0x37,
    },
    NamedKey {
        name: "NumpadAdd",
        keysym: 0xffab,
        scancode: 0x4e,
    },
    NamedKey {
        name: "NumpadSubtract",
        keysym: 0xffad,
        scancode: 0x4a,
    },
    NamedKey {
        name: "NumpadDecimal",
        keysym: 0xffae,
        scancode: 0x53,
    },
    NamedKey {
        name: "NumpadDivide",
        keysym: 0xffaf,
        scancode: 0xb5,
    },
    NamedKey {
        name: "Numpad0",
        keysym: 0xffb0,
        scancode: 0x52,
    },
    NamedKey {
        name: "Numpad1",
        keysym: 0xffb1,
        scancode: 0x4f,
    },
    NamedKey {
        name: "Numpad2",
        keysym: 0xffb2,
        scancode: 0x50,
    },
    NamedKey {
        name: "Numpad3",
        keysym: 0xffb3,
        scancode: 0x51,
    },
    NamedKey {
        name: "Numpad4",
        keysym: 0xffb4,
        scancode: 0x4b,
    },
    NamedKey {
        name: "Numpad5",
        keysym: 0xffb5,
        scancode: 0x4c,
    },
    NamedKey {
        name: "Numpad6",
        keysym: 0xffb6,
        scancode: 0x4d,
    },
    NamedKey {
        name: "Numpad7",
        keysym: 0xffb7,
        scancode: 0x47,
    },
    NamedKey {
        name: "Numpad8",
        keysym: 0xffb8,
        scancode: 0x48,
    },
    NamedKey {
        name: "Numpad9",
        keysym: 0xffb9,
        scancode: 0x49,
    },
];

/// The classical X11 Arabic keysyms, as `(codepoint, keysym)`.
///
/// X11R6.9 added a Unicode keysym form, `0x01000000 + codepoint`, and every
/// current server understands it. The Arabic block below is older than that:
/// it is the set from X11R4, and it is the ONLY Arabic a server that predates
/// the Unicode form recognises. `x11vnc` without XKB, QEMU's built-in VNC,
/// RealVNC 4.x and a TigerVNC with a plain X11 map all fall in that group, and
/// they ignore a Unicode keysym silently: the keystroke arrives, is dropped,
/// and nothing anywhere reports it.
///
/// So the wire vocabulary for an Arabic character is the classical keysym, and
/// this table is the single copy of it. Two directions, because the same
/// vocabulary comes back in: the webview sends `0x05d6` for `ض` (`ص` is
/// `0x05d5`), and the RDP core, which carries the character in a Unicode
/// Fast-Path event rather than a keysym, has to turn that back into the
/// codepoint before it can type it.
///
/// The values are `keysymdef.h`'s (`XK_Arabic_*`), cross-checked against
/// noVNC's generated `keysymdef.js`. Both columns ascend, which is what lets
/// the two lookups below binary-search the same array; a test pins that rather
/// than leaving it a comment.
///
/// Deliberately absent: the newer Hebrew-script additions at `0x05f3` and
/// `0x05f4` (gershayim and geresh), so a range check on this block cannot
/// claim them.
pub const ARABIC_KEYSYMS: [(u32, u32); 48] = [
    (0x060c, 0x05ac), // ARABIC COMMA                  XK_Arabic_comma
    (0x061b, 0x05bb), // ARABIC SEMICOLON              XK_Arabic_semicolon
    (0x061f, 0x05bf), // ARABIC QUESTION MARK          XK_Arabic_question_mark
    (0x0621, 0x05c1), // ARABIC LETTER HAMZA           XK_Arabic_hamza
    (0x0622, 0x05c2), // ALEF WITH MADDA ABOVE         XK_Arabic_maddaonalef
    (0x0623, 0x05c3), // ALEF WITH HAMZA ABOVE         XK_Arabic_hamzaonalef
    (0x0624, 0x05c4), // WAW WITH HAMZA ABOVE          XK_Arabic_hamzaonwaw
    (0x0625, 0x05c5), // ALEF WITH HAMZA BELOW         XK_Arabic_hamzaunderalef
    (0x0626, 0x05c6), // YEH WITH HAMZA ABOVE          XK_Arabic_hamzaonyeh
    (0x0627, 0x05c7), // ALEF                          XK_Arabic_alef
    (0x0628, 0x05c8), // BEH                           XK_Arabic_beh
    (0x0629, 0x05c9), // TEH MARBUTA                   XK_Arabic_tehmarbuta
    (0x062a, 0x05ca), // TEH                           XK_Arabic_teh
    (0x062b, 0x05cb), // THEH                          XK_Arabic_theh
    (0x062c, 0x05cc), // JEEM                          XK_Arabic_jeem
    (0x062d, 0x05cd), // HAH                           XK_Arabic_hah
    (0x062e, 0x05ce), // KHAH                          XK_Arabic_khah
    (0x062f, 0x05cf), // DAL                           XK_Arabic_dal
    (0x0630, 0x05d0), // THAL                          XK_Arabic_thal
    (0x0631, 0x05d1), // RA                            XK_Arabic_ra
    (0x0632, 0x05d2), // ZAIN                          XK_Arabic_zain
    (0x0633, 0x05d3), // SEEN                          XK_Arabic_seen
    (0x0634, 0x05d4), // SHEEN                         XK_Arabic_sheen
    (0x0635, 0x05d5), // SAD                           XK_Arabic_sad
    (0x0636, 0x05d6), // DAD                           XK_Arabic_dad
    (0x0637, 0x05d7), // TAH                           XK_Arabic_tah
    (0x0638, 0x05d8), // ZAH                           XK_Arabic_zah
    (0x0639, 0x05d9), // AIN                           XK_Arabic_ain
    (0x063a, 0x05da), // GHAIN                         XK_Arabic_ghain
    (0x0640, 0x05e0), // TATWEEL                       XK_Arabic_tatweel
    (0x0641, 0x05e1), // FEH                           XK_Arabic_feh
    (0x0642, 0x05e2), // QAF                           XK_Arabic_qaf
    (0x0643, 0x05e3), // KAF                           XK_Arabic_kaf
    (0x0644, 0x05e4), // LAM                           XK_Arabic_lam
    (0x0645, 0x05e5), // MEEM                          XK_Arabic_meem
    (0x0646, 0x05e6), // NOON                          XK_Arabic_noon
    (0x0647, 0x05e7), // HEH                           XK_Arabic_ha
    (0x0648, 0x05e8), // WAW                           XK_Arabic_waw
    (0x0649, 0x05e9), // ALEF MAKSURA                  XK_Arabic_alefmaksura
    (0x064a, 0x05ea), // YEH                           XK_Arabic_yeh
    (0x064b, 0x05eb), // FATHATAN                      XK_Arabic_fathatan
    (0x064c, 0x05ec), // DAMMATAN                      XK_Arabic_dammatan
    (0x064d, 0x05ed), // KASRATAN                      XK_Arabic_kasratan
    (0x064e, 0x05ee), // FATHA                         XK_Arabic_fatha
    (0x064f, 0x05ef), // DAMMA                         XK_Arabic_damma
    (0x0650, 0x05f0), // KASRA                         XK_Arabic_kasra
    (0x0651, 0x05f1), // SHADDA                        XK_Arabic_shadda
    (0x0652, 0x05f2), // SUKUN                         XK_Arabic_sukun
];

/// The classical keysym one Arabic character types, or `None` for anything
/// outside the table.
///
/// Only the characters X11R4 named are here. A codepoint in the Arabic block
/// that has no classical keysym (the extended letters, the presentation
/// forms, the Arabic-Indic digits) has to travel as the Unicode form, which is
/// what a caller does with the `None`.
#[must_use]
pub fn arabic_keysym_for_char(c: char) -> Option<u32> {
    let cp = c as u32;
    ARABIC_KEYSYMS
        .binary_search_by_key(&cp, |&(codepoint, _)| codepoint)
        .ok()
        .map(|at| ARABIC_KEYSYMS[at].1)
}

/// The character a classical Arabic keysym names, or `None` when the keysym is
/// not one of them.
///
/// This is the direction the RDP core needs: its Unicode Fast-Path event takes
/// a character, and an Arabic keystroke arrives as a keysym. It answers `None`
/// rather than a replacement character for an unknown keysym, because typing
/// `?` over somebody's text is worse than typing nothing.
#[must_use]
pub fn char_for_arabic_keysym(keysym: u32) -> Option<char> {
    ARABIC_KEYSYMS
        .binary_search_by_key(&keysym, |&(_, keysym)| keysym)
        .ok()
        .and_then(|at| char::from_u32(ARABIC_KEYSYMS[at].0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both lookups binary-search this array, and binary search on an
    /// unsorted array is a wrong answer with no symptom. Ascending, strictly,
    /// on both columns.
    #[test]
    fn the_arabic_table_ascends_on_both_columns() {
        for pair in ARABIC_KEYSYMS.windows(2) {
            assert!(
                pair[0].0 < pair[1].0,
                "codepoints must ascend: {:#06x} then {:#06x}",
                pair[0].0,
                pair[1].0
            );
            assert!(
                pair[0].1 < pair[1].1,
                "keysyms must ascend: {:#06x} then {:#06x}",
                pair[0].1,
                pair[1].1
            );
        }
    }

    /// Every row reads back as itself, which is the property the RDP core
    /// depends on: it receives the keysym the webview minted and must recover
    /// the exact character.
    #[test]
    fn every_arabic_keysym_round_trips() {
        for &(cp, keysym) in &ARABIC_KEYSYMS {
            let ch = char::from_u32(cp).expect("a table of valid codepoints");
            assert_eq!(arabic_keysym_for_char(ch), Some(keysym), "U+{cp:04X}");
            assert_eq!(char_for_arabic_keysym(keysym), Some(ch), "{keysym:#06x}");
        }
    }

    /// The three the plan and the protocol notes name by hand, so a
    /// transposition in the table cannot pass on round-tripping alone.
    #[test]
    fn the_named_arabic_characters_are_the_documented_keysyms() {
        assert_eq!(arabic_keysym_for_char('،'), Some(0x05ac));
        assert_eq!(arabic_keysym_for_char('؛'), Some(0x05bb));
        assert_eq!(arabic_keysym_for_char('؟'), Some(0x05bf));
        assert_eq!(arabic_keysym_for_char('ض'), Some(0x05d6));
        assert_eq!(arabic_keysym_for_char('ا'), Some(0x05c7));
        assert_eq!(arabic_keysym_for_char('ب'), Some(0x05c8));
    }

    /// A character with no classical keysym is `None`, not a neighbouring
    /// entry: the caller's fallback is the Unicode form, and a wrong keysym
    /// there would type a different letter.
    #[test]
    fn characters_outside_the_classical_block_are_none() {
        assert_eq!(arabic_keysym_for_char('ک'), None); // U+06A9, extended
        assert_eq!(arabic_keysym_for_char('١'), None); // U+0661, Arabic-Indic
        assert_eq!(arabic_keysym_for_char('a'), None);
        assert_eq!(char_for_arabic_keysym(0x05f3), None); // Hebrew geresh
        assert_eq!(char_for_arabic_keysym(0x05ab), None);
    }
}
