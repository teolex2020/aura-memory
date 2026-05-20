use aura::crypto::EncryptionKey;
use aura::storage::AuraStorage;
use serde_json::json;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let brain_path = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing brain_path"))?;
    let brain_path = PathBuf::from(brain_path);

    let password = "pw";
    let salt: [u8; 16] = [
        0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ];
    let key = EncryptionKey::from_password(password, &salt)?;

    let storage = AuraStorage::with_encryption(brain_path, Some(key))?;

    let count = storage.count();
    let plain_record = storage.read("id_plain")?;
    let enc_record = storage.read("id_enc")?;

    let out = json!({
        "count": count,
        "plain_text": plain_record.as_ref().map(|r| r.text.clone()),
        "enc_text": enc_record.as_ref().map(|r| r.text.clone()),
        "enc_flag": enc_record.as_ref().map(|r| r.encrypted_flag),
    });
    println!("{}", out.to_string());

    Ok(())
}
