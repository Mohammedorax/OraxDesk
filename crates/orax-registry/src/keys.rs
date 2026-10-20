//! The key a device signs its registry calls with.
//!
//! It is deliberately NOT the device's iroh identity, and the difference is
//! the whole point of this module.
//!
//! The iroh identity is the device's name in the peer-to-peer world. It is
//! what a machine that has paired a helper accepts that helper under, so it
//! travels in every handshake and is stored in every peer's access file. A
//! leak of that key is not a leak of one account: it is a leak of every
//! machine that ever trusted the holder, and the holder can then take the
//! wheel on all of them, with their tools, without a password.
//!
//! The registry key signs HTTP requests and nothing else. It authorises a
//! device to mint signal codes and to write its own record. A leak of it is a
//! leak of that one account, and it can be rotated from the server side
//! without touching a single peer's access file.
//!
//! So the two are separate keys, generated separately, stored separately, and
//! neither is derived from the other.
//!
//! The key lives in the OS keychain, which is a real improvement on the
//! iroh identity's plain file: on Windows it is Credential Manager, on macOS
//! the login keychain, and on Linux the secret service. Where no keychain
//! answers, a file with owner-only permissions is used instead, which is
//! exactly where the iroh identity already lives, so nothing is worse than
//! the thing it replaces.

use std::path::PathBuf;

use iroh::SecretKey;

use crate::Error;

/// The keychain service the registry keys live under.
pub const KEYRING_SERVICE: &str = "com.deskvncviewer.registry";

/// The account a key is stored under. One per role, so a helper's key and a
/// machine's key are never the same key.
pub const ACCOUNT_MACHINE: &str = "device";
pub const ACCOUNT_HELPER: &str = "helper";

/// A signing key for the registry, and nothing else.
#[derive(Clone)]
pub struct RegistryKey {
    secret: SecretKey,
    /// Where it was found, for the log line that says where a key lives.
    storage: Storage,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Storage {
    Keychain,
    File,
}

impl RegistryKey {
    /// Load the key for `account`, or make one and keep it.
    ///
    /// The keychain is tried first. A machine with no keychain (a headless
    /// Linux box, a locked session) falls back to a file beside the other
    /// identity material, with owner-only permissions where the platform has
    /// them.
    pub fn load_or_create(account: &str, fallback_dir: PathBuf) -> Result<Self, Error> {
        if let Some(secret) = read_keychain(account) {
            return Ok(Self {
                secret,
                storage: Storage::Keychain,
            });
        }
        let path = fallback_dir.join(format!("registry-{account}.key"));
        if let Some(secret) = read_file(&path) {
            // The key exists on disk but not in the keychain: a machine that
            // had no keychain once, or one whose keychain became available
            // later. Move it up rather than leaving the weaker copy behind.
            if write_keychain(account, &secret).is_ok() {
                return Ok(Self {
                    secret,
                    storage: Storage::Keychain,
                });
            }
            return Ok(Self {
                secret,
                storage: Storage::File,
            });
        }
        let secret = SecretKey::generate();
        if write_keychain(account, &secret).is_ok() {
            return Ok(Self {
                secret,
                storage: Storage::Keychain,
            });
        }
        write_file(&path, &secret)?;
        Ok(Self {
            secret,
            storage: Storage::File,
        })
    }

    /// The secret, for signing.
    pub fn secret(&self) -> &SecretKey {
        &self.secret
    }

    /// The public key, in the hex the registry stores.
    pub fn public_hex(&self) -> String {
        hex::encode(self.secret.public().as_bytes())
    }

    /// Where the key is kept, for a line in the log.
    pub fn storage(&self) -> &'static str {
        match self.storage {
            Storage::Keychain => "keychain",
            Storage::File => "file",
        }
    }
}

fn read_keychain(account: &str) -> Option<SecretKey> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).ok()?;
    let text = match entry.get_password() {
        Ok(text) => text,
        Err(_) => return None,
    };
    parse_secret(&text)
}

fn write_keychain(account: &str, secret: &SecretKey) -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)?;
    entry.set_password(&hex::encode(secret.to_bytes()))
}

fn read_file(path: &PathBuf) -> Option<SecretKey> {
    let text = std::fs::read_to_string(path).ok()?;
    parse_secret(&text)
}

fn write_file(path: &PathBuf, secret: &SecretKey) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::Keychain(e.to_string()))?;
    }
    std::fs::write(path, hex::encode(secret.to_bytes()))
        .map_err(|e| Error::Keychain(e.to_string()))?;
    restrict(path);
    Ok(())
}

/// Owner-only where the platform has such a thing. Windows inherits the
/// profile directory's own ACL, which is per-user already.
fn restrict(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn parse_secret(text: &str) -> Option<SecretKey> {
    let bytes = hex::decode(text.trim()).ok()?;
    let array: [u8; 32] = bytes.try_into().ok()?;
    Some(SecretKey::from_bytes(&array))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_written_to_a_file_comes_back_the_same() {
        let dir = std::env::temp_dir().join(format!("orax-registry-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("registry-device.key");
        let secret = SecretKey::generate();
        write_file(&path, &secret).unwrap();
        let back = read_file(&path).unwrap();
        assert_eq!(back.to_bytes(), secret.to_bytes());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_key_is_not_a_key() {
        assert!(parse_secret("not hex").is_none());
        assert!(parse_secret("00").is_none());
        assert!(parse_secret("").is_none());
    }
}
