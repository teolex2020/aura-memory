use aura::crypto::{compute_hmac, decrypt_data, encrypt_data, EncryptionKey};
use serde_json::json;

fn main() -> anyhow::Result<()> {
    let password = "pw";
    let salt: [u8; 16] = [
        0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ];

    let key = EncryptionKey::from_password(password, &salt)?;

    let plaintext = b"aura-ts-crypto-oracle";
    let encrypted = encrypt_data(plaintext, &key)?;
    let decrypted = decrypt_data(&encrypted, &key)?;
    if decrypted.as_slice() != plaintext {
        return Err(anyhow::anyhow!("decrypt_mismatch"));
    }

    let hmac = compute_hmac(&encrypted, &key);

    let out = json!({
        "key_hex": hex::encode(key.as_bytes()),
        "encrypted_hex": hex::encode(&encrypted),
        "hmac_hex": hex::encode(hmac),
    });
    println!("{}", out.to_string());

    Ok(())
}
