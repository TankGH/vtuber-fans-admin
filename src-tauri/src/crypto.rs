use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::{AddressValue, BirthdayValue};

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// 主密钥：随机 32 字节，落盘前经 Windows DPAPI（CurrentUser）保护
#[derive(Clone)]
pub struct Crypto {
    key: [u8; KEY_LEN],
}

impl Crypto {
    #[cfg(test)]
    pub fn from_key_for_test(key: [u8; KEY_LEN]) -> Self {
        Self { key }
    }

    pub fn load(data_dir: &Path) -> AppResult<Self> {
        let path = data_dir.join("app.key");
        let key = if path.exists() {
            let protected = std::fs::read(&path).map_err(|e| AppError::new("E_CRYPTO_KEY", format!("主密钥读取失败：{e}")))?;
            let raw = unprotect_key(&protected)?;
            if raw.len() != KEY_LEN {
                return Err(AppError::new("E_CRYPTO_KEY", "主密钥长度异常，可能已损坏"));
            }
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&raw);
            key
        } else {
            let mut key = [0u8; KEY_LEN];
            rand::rngs::OsRng.fill_bytes(&mut key);
            let protected = protect_key(&key)?;
            std::fs::write(&path, protected).map_err(|e| AppError::new("E_CRYPTO_KEY", format!("主密钥写入失败：{e}")))?;
            key
        };
        Ok(Self { key })
    }

    /// 输出格式：12 字节随机 nonce || AES-256-GCM 密文（含 tag）
    pub fn encrypt(&self, plaintext: &[u8]) -> AppResult<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| AppError::new("E_CRYPTO_KEY", format!("加密器初始化失败：{e}")))?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| AppError::new("E_CRYPTO_KEY", "字段加密失败"))?;
        let mut out = nonce_bytes.to_vec();
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    pub fn decrypt(&self, blob: &[u8]) -> AppResult<Vec<u8>> {
        if blob.len() <= NONCE_LEN {
            return Err(AppError::new("E_CRYPTO_KEY", "密文格式无效"));
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| AppError::new("E_CRYPTO_KEY", format!("加密器初始化失败：{e}")))?;
        let nonce = Nonce::from_slice(&blob[..NONCE_LEN]);
        cipher
            .decrypt(nonce, &blob[NONCE_LEN..])
            .map_err(|_| AppError::new("E_CRYPTO_KEY", "密文校验失败，内容可能已被篡改"))
    }

    pub fn encrypt_json<T: serde::Serialize>(&self, value: &T) -> AppResult<Vec<u8>> {
        let json = serde_json::to_vec(value)?;
        self.encrypt(&json)
    }

    pub fn decrypt_json<T: serde::de::DeserializeOwned>(&self, blob: &[u8]) -> AppResult<T> {
        let json = self.decrypt(blob)?;
        Ok(serde_json::from_slice(&json)?)
    }

    pub fn mask_address(&self, address: &Option<Vec<u8>>) -> Option<String> {
        let blob = address.as_ref()?;
        let value: AddressValue = self.decrypt_json(blob).ok()?;
        let parts: Vec<&str> = [&value.province, &value.city, &value.district]
            .iter()
            .map(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.is_empty() { None } else { Some(parts.join(" · ")) }
    }

    pub fn mask_birthday(&self, birthday: &Option<Vec<u8>>, hide_year: bool) -> Option<String> {
        let blob = birthday.as_ref()?;
        let value: BirthdayValue = self.decrypt_json(blob).ok()?;
        if !hide_year {
            if let Some(year) = value.year {
                return Some(format!("{:04}-{:02}-{:02}", year, value.month, value.day));
            }
        }
        Some(format!("{:02}-{:02}", value.month, value.day))
    }

    pub fn decrypt_address(&self, blob: &Option<Vec<u8>>) -> AppResult<AddressValue> {
        match blob {
            Some(b) => self.decrypt_json(b),
            None => Ok(AddressValue::default()),
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest.iter() {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// 统一使用本地时间：UTC+8 的 00:00–08:00 不应把「今天」算成昨天。
pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

// ---- Windows DPAPI：主密钥只以受保护形态落盘 ----
#[cfg(windows)]
mod dpapi {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    fn run(data: &[u8], unprotect: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let entropy: *const CRYPT_INTEGER_BLOB = std::ptr::null();
        let reserved: *const c_void = std::ptr::null();
        let ok = unsafe {
            if unprotect {
                // CryptUnprotectData 的描述参数是 *mut *mut u16（输出参数）
                let mut desc: *mut u16 = std::ptr::null_mut();
                CryptUnprotectData(
                    &input, &mut desc, entropy, reserved, std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN, &mut output,
                )
            } else {
                let desc: *const u16 = std::ptr::null();
                CryptProtectData(
                    &input, desc, entropy, reserved, std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN, &mut output,
                )
            }
        };
        if ok == 0 || output.pbData.is_null() {
            return Err("Windows DPAPI 调用失败".to_string());
        }
        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe {
            LocalFree(output.pbData as HLOCAL);
        }
        Ok(bytes)
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> { run(data, false) }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> { run(data, true) }
}

#[cfg(windows)]
fn protect_key(data: &[u8]) -> AppResult<Vec<u8>> {
    dpapi::protect(data).map_err(|e| AppError::new("E_CRYPTO_KEY", e))
}

#[cfg(windows)]
fn unprotect_key(data: &[u8]) -> AppResult<Vec<u8>> {
    dpapi::unprotect(data).map_err(|e| AppError::new("E_CRYPTO_KEY", e))
}

/// 非 Windows 仅用于单元测试：可逆封装，不对外宣称提供 OS 级保护
#[cfg(not(windows))]
fn protect_key(data: &[u8]) -> AppResult<Vec<u8>> {
    Ok(data.iter().map(|b| b ^ 0xA5).collect())
}

#[cfg(not(windows))]
fn unprotect_key(data: &[u8]) -> AppResult<Vec<u8>> {
    Ok(data.iter().map(|b| b ^ 0xA5).collect())
}
