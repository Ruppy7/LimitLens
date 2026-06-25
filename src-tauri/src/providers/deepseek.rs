use serde::{Deserialize, Serialize};
use std::time::Duration;

const BALANCE_URL: &str = "https://api.deepseek.com/user/balance";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub struct BalanceResponse {
    pub is_available: bool,
    pub balance_infos: Vec<BalanceInfo>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub struct BalanceInfo {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
}

#[derive(Debug)]
pub enum DeepSeekError {
    Http(reqwest::Error),
    Json(serde_json::Error),
}

impl From<reqwest::Error> for DeepSeekError {
    fn from(error: reqwest::Error) -> Self {
        Self::Http(error)
    }
}

impl From<serde_json::Error> for DeepSeekError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl std::fmt::Display for DeepSeekError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(error) => write!(formatter, "DeepSeek HTTP error: {error}"),
            Self::Json(error) => write!(formatter, "DeepSeek JSON error: {error}"),
        }
    }
}

impl std::error::Error for DeepSeekError {}

pub fn fetch_balance_json(api_key: &str) -> Result<String, DeepSeekError> {
    let response = reqwest::blocking::Client::new()
        .get(BALANCE_URL)
        .bearer_auth(api_key)
        .timeout(REQUEST_TIMEOUT)
        .send()?
        .error_for_status()?
        .json::<BalanceResponse>()?;

    Ok(serde_json::to_string(&response)?)
}

pub fn parse_balance_json(json: &str) -> Result<BalanceResponse, DeepSeekError> {
    Ok(serde_json::from_str(json)?)
}

pub fn usd_total_balance(response: &BalanceResponse) -> f64 {
    response
        .balance_infos
        .iter()
        .filter(|info| info.currency.eq_ignore_ascii_case("USD"))
        .filter_map(|info| info.total_balance.parse::<f64>().ok())
        .sum()
}

pub fn usd_balance_json(usd_remaining: f64) -> Result<String, DeepSeekError> {
    Ok(serde_json::to_string(&BalanceResponse {
        is_available: true,
        balance_infos: vec![BalanceInfo {
            currency: "USD".to_string(),
            total_balance: format!("{usd_remaining:.2}"),
            granted_balance: "0.00".to_string(),
            topped_up_balance: "0.00".to_string(),
        }],
    })?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_documented_balance_response() {
        let response = parse_balance_json(
            r#"
            {
              "is_available": true,
              "balance_infos": [
                {
                  "currency": "CNY",
                  "total_balance": "110.00",
                  "granted_balance": "10.00",
                  "topped_up_balance": "100.00"
                }
              ]
            }
            "#,
        )
        .expect("documented DeepSeek response should parse");

        assert_eq!(
            response,
            BalanceResponse {
                is_available: true,
                balance_infos: vec![BalanceInfo {
                    currency: "CNY".to_string(),
                    total_balance: "110.00".to_string(),
                    granted_balance: "10.00".to_string(),
                    topped_up_balance: "100.00".to_string(),
                }],
            }
        );
    }

    #[test]
    fn sums_only_usd_total_balance() {
        let response = BalanceResponse {
            is_available: true,
            balance_infos: vec![
                BalanceInfo {
                    currency: "USD".to_string(),
                    total_balance: "12.50".to_string(),
                    granted_balance: "0.00".to_string(),
                    topped_up_balance: "12.50".to_string(),
                },
                BalanceInfo {
                    currency: "CNY".to_string(),
                    total_balance: "99.00".to_string(),
                    granted_balance: "0.00".to_string(),
                    topped_up_balance: "99.00".to_string(),
                },
            ],
        };

        assert_eq!(usd_total_balance(&response), 12.50);
    }
}
