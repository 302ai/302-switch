//! 模型列表获取命令
//!
//! 提供 Tauri 命令，供前端在供应商表单中获取可用模型列表。

use crate::services::model_fetch::{self, FetchedModel, KeyProbeResult};

/// 获取供应商的可用模型列表
///
/// 使用 OpenAI 兼容的 GET /v1/models 端点。优先使用 `models_url` 精确覆写；
/// 否则对 baseURL 生成候选列表（含「剥离 Anthropic 兼容子路径」兜底），按序尝试。
#[tauri::command(rename_all = "camelCase")]
pub async fn fetch_models_for_config(
    base_url: String,
    api_key: String,
    is_full_url: Option<bool>,
    models_url: Option<String>,
    custom_user_agent: Option<String>,
) -> Result<Vec<FetchedModel>, String> {
    // 与转发 / 检测路径共用 parse_custom_user_agent：非法 UA 静默忽略（不阻断取模型）。
    let user_agent = crate::provider::parse_custom_user_agent(custom_user_agent.as_deref())
        .ok()
        .flatten();
    model_fetch::fetch_models(
        &base_url,
        &api_key,
        is_full_url.unwrap_or(false),
        models_url.as_deref(),
        user_agent,
    )
    .await
}

/// 用 POST /chat/completions 探活一把 key（不依赖 /models 列表接口）。
///
/// 面向企业私有化 / 自签中转：这类网关常不开放 GET /v1/models，导致 `fetch_models`
/// 拿 401/403 让前端误判「Key 无效」。本命令把「鉴权失败」和「只是 /models 没开」
/// 分开——只有 401/403 才算 key 坏，其余（含哨兵模型触发的 404）都算鉴权通过。
#[tauri::command(rename_all = "camelCase")]
pub async fn probe_chat_key(
    base_url: String,
    api_key: String,
    model: Option<String>,
    custom_user_agent: Option<String>,
) -> Result<KeyProbeResult, String> {
    let user_agent = crate::provider::parse_custom_user_agent(custom_user_agent.as_deref())
        .ok()
        .flatten();
    model_fetch::probe_chat_key(&base_url, &api_key, model.as_deref(), user_agent).await
}
