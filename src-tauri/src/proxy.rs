//! The global SOCKS5 proxy preference.
//!
//! Three settings in the app's key-value table — `proxy_enabled`,
//! `proxy_host`, `proxy_port` — read by the connect path at the moment a
//! session opens and turned into a [`vnc_transport::socks5::Socks5Connector`].
//! A preference rather than a per-host field on purpose: a proxy is a property
//! of the network a person is on, and they should not have to re-enter it for
//! every machine in the library.
//!
//! It applies to **VNC, RDP and SSH** sessions, and to the other SSH carriers
//! the shell opens for them: the Files panel, an agent's file transfer, a
//! remote shell, and the gateway of a per-host SSH tunnel. VNC and RDP honour
//! an injected connector directly; SSH adapts the same connector into the
//! carrier's dialer, so its reconnect supervisor dials through the proxy on
//! every attempt too. When a host has an SSH tunnel, the session still rides
//! that tunnel — the proxy is how the tunnel reaches its gateway, not a
//! second path around it.
//!
//! A switched-on proxy with a missing or unreadable address is an ERROR, not a
//! quiet fallback to a direct connection: someone who turned the proxy on did
//! it to route their traffic through it, and connecting around it would be
//! the exact outcome they asked to avoid.

use std::sync::Arc;
use std::time::Duration;

/// Whether the proxy is switched on. Anything but the words the interface
/// writes is off, which is the fail-safe direction: off means "dial directly".
pub const ENABLED_KEY: &str = "proxy_enabled";
/// The proxy's own address: a host name or IP, never a URL.
pub const HOST_KEY: &str = "proxy_host";
/// The proxy's port.
pub const PORT_KEY: &str = "proxy_port";

/// A validated preference, ready to build a connector from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxySettings {
    pub host: String,
    pub port: u16,
}

impl ProxySettings {
    /// Read the three stored strings into a usable preference.
    ///
    /// `Ok(None)` when the switch is off — a switched-off proxy ignores
    /// whatever half-typed address is beside it, because the person may have
    /// turned it off precisely to abandon that edit. `Err` when it is on and
    /// the address cannot be used, with a sentence the connect path can hand
    /// back unchanged.
    pub fn parse(
        enabled: Option<&str>,
        host: Option<&str>,
        port: Option<&str>,
    ) -> Result<Option<Self>, String> {
        let enabled = enabled
            .map(|value| value.trim().to_ascii_lowercase())
            .is_some_and(|value| matches!(value.as_str(), "true" | "1" | "on"));
        if !enabled {
            return Ok(None);
        }

        let host = host.unwrap_or_default().trim().to_string();
        if host.is_empty() {
            return Err(
                "the SOCKS5 proxy is switched on but has no address. Set one in Preferences, or switch the proxy off"
                    .to_string(),
            );
        }
        if host.contains("://") {
            return Err(format!(
                "`{host}` is a URL, not a proxy address: enter the host name or IP on its own, and the port separately"
            ));
        }
        if host.chars().any(char::is_whitespace) {
            return Err(format!(
                "`{host}` has whitespace in it, which a host name cannot carry"
            ));
        }

        let port_text = port.unwrap_or_default().trim();
        let port: u16 = port_text.parse().map_err(|_| {
            format!("`{port_text}` is not a TCP port for the SOCKS5 proxy (1-65535)")
        })?;
        if port == 0 {
            return Err("port 0 is not a usable SOCKS5 proxy port (1-65535)".to_string());
        }

        Ok(Some(Self { host, port }))
    }

    /// `host:port`, for a log line. Never carries a credential, because the
    /// connector does not support one.
    #[must_use]
    pub fn describe(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Read the stored preference off the async runtime.
///
/// `Ok(None)` when the switch is off. `Err` when it is on and the address
/// cannot be used — callers must surface that sentence rather than dial
/// directly.
pub async fn load_settings(store: Arc<vnc_store::Store>) -> Result<Option<ProxySettings>, String> {
    tokio::task::spawn_blocking(move || {
        let enabled = store.get_setting(ENABLED_KEY).map_err(|e| e.to_string())?;
        let host = store.get_setting(HOST_KEY).map_err(|e| e.to_string())?;
        let port = store.get_setting(PORT_KEY).map_err(|e| e.to_string())?;
        ProxySettings::parse(enabled.as_deref(), host.as_deref(), port.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The SSH carrier's dialer for the stored preference.
///
/// Same rules as [`load_settings`]: off is `Ok(None)`, a broken address is
/// `Err`. The dialer is the [`vnc_transport::socks5::Socks5Connector`] adapted
/// once, in `ssh-core`, so a shell and a file transfer cannot grow two
/// slightly different proxies.
pub async fn load_dialer(
    store: Arc<vnc_store::Store>,
) -> Result<Option<ssh_transport::DialerHandle>, String> {
    Ok(load_settings(store).await?.map(|proxy| ssh_dialer(&proxy)))
}

fn ssh_dialer(proxy: &ProxySettings) -> ssh_transport::DialerHandle {
    let connector = remote_core::Connector(Arc::new(vnc_transport::socks5::Socks5Connector::new(
        proxy.host.clone(),
        proxy.port,
    )));
    ssh_core::dialer_for(&connector)
}

/// Preferences → "Test proxy". Greeting only: the proxy must answer SOCKS5
/// and accept no authentication. A particular machine is not contacted.
#[tauri::command]
pub async fn test_socks5_proxy(host: String, port: String) -> Result<String, String> {
    let settings = ProxySettings::parse(Some("true"), Some(&host), Some(&port))?
        .ok_or_else(|| "the proxy address could not be read".to_string())?;
    vnc_transport::socks5::Socks5Connector::new(settings.host.clone(), settings.port)
        .probe(Duration::from_secs(8))
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "the proxy at {} answered a SOCKS5 greeting and accepted a connection with no authentication",
        settings.describe()
    ))
}

#[cfg(test)]
mod tests {
    use super::ProxySettings;

    #[test]
    fn off_ignores_a_half_typed_address() {
        for enabled in [None, Some(""), Some("false"), Some("off"), Some("0")] {
            assert_eq!(
                ProxySettings::parse(enabled, Some(""), Some("")),
                Ok(None),
                "{enabled:?}"
            );
        }
    }

    #[test]
    fn on_needs_a_usable_address_and_says_why() {
        let err = ProxySettings::parse(Some("true"), Some(""), Some("1080")).unwrap_err();
        assert!(err.contains("no address"), "{err}");

        let err = ProxySettings::parse(Some("true"), Some("socks5://proxy.local"), Some("1080"))
            .unwrap_err();
        assert!(err.contains("URL"), "{err}");

        let err =
            ProxySettings::parse(Some("true"), Some("proxy.local"), Some("nope")).unwrap_err();
        assert!(err.contains("1-65535"), "{err}");

        let err = ProxySettings::parse(Some("true"), Some("proxy.local"), Some("0")).unwrap_err();
        assert!(err.contains("port 0"), "{err}");

        let err = ProxySettings::parse(Some("true"), Some("two words"), Some("1080")).unwrap_err();
        assert!(err.contains("whitespace"), "{err}");
    }

    #[test]
    fn on_with_a_good_address_parses_and_trims() {
        let proxy = ProxySettings::parse(Some(" TRUE "), Some(" proxy.local "), Some(" 1080 "))
            .expect("valid")
            .expect("switched on");
        assert_eq!(proxy.host, "proxy.local");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.describe(), "proxy.local:1080");
    }
}
