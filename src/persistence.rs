//! Authenticated payload encoding shared by durable memory surfaces.
use crate::crypto::{decrypt_data, encrypt_data, EncryptionKey};
use anyhow::{bail, Context, Result};
use std::io::Write;
use std::path::Path;

const MAGIC: &[u8] = b"AEF1";
pub(crate) const KEY_FILE: &str = "memory.key";

#[derive(Clone, Default)]
pub(crate) struct PersistenceCodec {
    key: Option<EncryptionKey>,
}

impl std::fmt::Debug for PersistenceCodec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PersistenceCodec")
            .field("encrypted", &self.is_encrypted())
            .finish()
    }
}

impl PersistenceCodec {
    pub(crate) fn new(key: Option<EncryptionKey>) -> Self {
        Self { key }
    }
    pub(crate) fn is_encrypted(&self) -> bool {
        self.key.is_some()
    }

    pub(crate) fn encode(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        match &self.key {
            None => Ok(bytes.to_vec()),
            Some(key) => {
                let mut out = MAGIC.to_vec();
                out.extend(encrypt_data(bytes, key)?);
                Ok(out)
            }
        }
    }

    pub(crate) fn decode(&self, bytes: &[u8]) -> Result<Vec<u8>> {
        match (&self.key, bytes.strip_prefix(MAGIC)) {
            (Some(key), Some(payload)) => decrypt_data(payload, key),
            (None, None) => Ok(bytes.to_vec()),
            (None, Some(_)) => bail!("Password required for encrypted memory"),
            (Some(_), None) => {
                bail!("Plaintext payload in encrypted memory; explicit migration required")
            }
        }
    }

    pub(crate) fn read(&self, path: &Path) -> Result<Vec<u8>> {
        self.decode(&std::fs::read(path)?)
    }

    pub(crate) fn read_text(&self, path: &Path) -> Result<String> {
        Ok(String::from_utf8(self.read(path)?)?)
    }

    pub(crate) fn write(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        let encoded = self.encode(bytes)?;
        // Unique sibling keeps concurrent snapshots from sharing a staging file.
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<()> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(&encoded)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    }
}

/// Validate credentials before opening or changing any memory files.
pub(crate) fn open_key(root: &Path, password: Option<&str>) -> Result<Option<EncryptionKey>> {
    let key_path = root.join(KEY_FILE);
    if key_path.exists() {
        let password = password.context("Password required for encrypted memory")?;
        return Ok(Some(
            EncryptionKey::load_from_file(&key_path, password)
                .context("Unable to unlock memory: invalid password or damaged key file")?,
        ));
    }
    let Some(password) = password else {
        return Ok(None);
    };
    #[cfg(not(feature = "encryption"))]
    {
        let _ = password;
        bail!("Password-protected storage requires the 'encryption' feature");
    }
    #[cfg(feature = "encryption")]
    {
        if password.is_empty() {
            bail!("Encryption password must not be empty");
        }
        if std::fs::read_dir(root)?.next().is_some() {
            bail!("Cannot enable encryption on an existing store in place; migrate into a new empty directory to avoid leaving plaintext history");
        }
        let key = EncryptionKey::generate();
        // Write the wrapped key once. create_new prevents concurrent creators
        // from replacing the key protecting another writer's records.
        let salt = crate::crypto::generate_salt();
        let wrapping = EncryptionKey::from_password(password, &salt)?;
        let wrapped = encrypt_data(key.as_bytes(), &wrapping)?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&key_path)?;
        file.write_all(&salt)?;
        file.write_all(&wrapped)?;
        file.sync_all()?;
        Ok(Some(key))
    }
}

#[cfg(all(test, feature = "encryption"))]
mod tests {
    use super::*;

    #[test]
    fn protected_payloads_reject_tampering_wrong_keys_and_plaintext() -> Result<()> {
        let codec = PersistenceCodec::new(Some(EncryptionKey::generate()));
        let mut encoded = codec.encode(b"private memory")?;
        assert_eq!(codec.decode(&encoded)?, b"private memory");
        assert!(PersistenceCodec::default().decode(&encoded).is_err());
        assert!(PersistenceCodec::new(Some(EncryptionKey::generate()))
            .decode(&encoded)
            .is_err());
        assert!(codec.decode(b"private memory").is_err());
        *encoded.last_mut().unwrap() ^= 1;
        assert!(codec.decode(&encoded).is_err());
        Ok(())
    }
}
