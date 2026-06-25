use serde::{Deserialize, Serialize};

const SERVICE: &str = "InfUsage";
const DEEPSEEK_USER: &str = "deepseek-api-key";
const OPENCODE_QUOTA_SESSION_USER: &str = "opencode-quota-session";
pub const MAX_DEEPSEEK_KEYS: u8 = 1;

#[derive(Debug, Serialize)]
pub struct DeepSeekKeySlot {
    pub id: u8,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenCodeQuotaSession {
    pub cookie: String,
    pub workspace_id: String,
}

pub fn save_opencode_quota_session(session: &OpenCodeQuotaSession) -> Result<(), keyring::Error> {
    let json = serde_json::to_string(session)
        .map_err(|error| keyring::Error::PlatformFailure(Box::new(error)))?;
    opencode_quota_session_entry()?.set_password(&json)
}

pub fn load_opencode_quota_session() -> Option<OpenCodeQuotaSession> {
    let json = opencode_quota_session_entry().ok()?.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

pub fn delete_opencode_quota_session() -> Result<(), keyring::Error> {
    match opencode_quota_session_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn has_opencode_quota_session() -> bool {
    load_opencode_quota_session().is_some()
}

fn opencode_quota_session_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, OPENCODE_QUOTA_SESSION_USER)
}

pub fn save_deepseek_api_key(api_key: &str) -> Result<u8, keyring::Error> {
    deepseek_entry()?.set_password(api_key)?;
    Ok(1)
}

pub fn delete_deepseek_api_key(slot: u8) -> Result<(), keyring::Error> {
    if slot != 1 {
        return Err(keyring::Error::NoEntry);
    }
    match deepseek_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn list_deepseek_key_slots() -> Vec<DeepSeekKeySlot> {
    vec![DeepSeekKeySlot {
        id: 1,
        has_key: load_deepseek_api_key().is_ok(),
    }]
}

pub fn load_deepseek_api_keys() -> Vec<(u8, String)> {
    load_deepseek_api_key()
        .ok()
        .map(|api_key| vec![(1, api_key)])
        .unwrap_or_default()
}

fn load_deepseek_api_key() -> Result<String, keyring::Error> {
    deepseek_entry()?.get_password()
}

fn deepseek_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, DEEPSEEK_USER)
}
