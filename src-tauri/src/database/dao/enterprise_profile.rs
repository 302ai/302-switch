//! 企业私有化档案 DAO
//!
//! 引导（FirstRunNoticeDialog 的「企业版」分支）里用户填的私有部署地址 + key，
//! 除了写进当次配置的三个 302 种子槽，还额外落一份「企业档案」在这里。它是
//! 后续两处的唯一数据源：
//! - Claude Desktop 无 CLI 可检测，引导结束时据此自动建一张企业 provider 卡
//! - 之后点「添加供应商 → 企业私有化」时，据此回填 Base URL / 一键填入 key
//!
//! 存法与 `stream_check_config` 一样：settings 键值表里存一段 JSON，键
//! `enterprise_profile`。空串视为「没存过」。

use crate::database::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

const ENTERPRISE_PROFILE_KEY: &str = "enterprise_profile";

/// 一份企业私有化档案。key 是敏感凭据，和现有的网关 token、provider key 一样
/// 落在本地 DB（同一套 settings 表），不额外加密——这里只做「记住上次填的」。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnterpriseProfile {
    /// 私有部署根地址，形如 https://your-company.302.ai（已 normalize，无尾斜杠）
    pub base_url: String,
    /// 品牌名，用于 provider 卡片命名；私有部署不一定有，留空即可
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    /// 上次填的 key。留着给「同步 key」按钮点一下回填；用户怕忘记 key 在哪
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

impl Database {
    /// 读企业档案。没存过或存的是空串都返回 None。
    pub fn get_enterprise_profile(&self) -> Result<Option<EnterpriseProfile>, AppError> {
        match self.get_setting(ENTERPRISE_PROFILE_KEY)? {
            Some(json) if !json.trim().is_empty() => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| AppError::Message(format!("解析企业档案失败: {e}"))),
            _ => Ok(None),
        }
    }

    /// 写企业档案（整体覆盖）。base_url 为空视为无意义的档案，直接清掉，
    /// 避免留一张只有 key、没地址的残档。
    pub fn save_enterprise_profile(&self, profile: &EnterpriseProfile) -> Result<(), AppError> {
        if profile.base_url.trim().is_empty() {
            return self.clear_enterprise_profile();
        }
        let json = serde_json::to_string(profile)
            .map_err(|e| AppError::Message(format!("序列化企业档案失败: {e}")))?;
        self.set_setting(ENTERPRISE_PROFILE_KEY, &json)
    }

    /// 清掉企业档案（切回公共版时调用）。存空串即可，get 侧会当 None 处理。
    pub fn clear_enterprise_profile(&self) -> Result<(), AppError> {
        self.set_setting(ENTERPRISE_PROFILE_KEY, "")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_clear() {
        let db = Database::memory().expect("in-memory db");

        // 没存过 → None
        assert!(db.get_enterprise_profile().unwrap().is_none());

        let profile = EnterpriseProfile {
            base_url: "https://co.302.ai".into(),
            brand_name: Some("Co".into()),
            api_key: Some("sk-secret".into()),
        };
        db.save_enterprise_profile(&profile).unwrap();

        let got = db.get_enterprise_profile().unwrap().expect("saved");
        assert_eq!(got.base_url, "https://co.302.ai");
        assert_eq!(got.brand_name.as_deref(), Some("Co"));
        assert_eq!(got.api_key.as_deref(), Some("sk-secret"));

        // 空 base_url 的保存等于清除
        db.save_enterprise_profile(&EnterpriseProfile::default())
            .unwrap();
        assert!(db.get_enterprise_profile().unwrap().is_none());
    }
}
