//! 模型列表获取服务
//!
//! 通过 OpenAI 兼容的 GET /v1/models 端点获取供应商可用模型列表。
//! 主要面向第三方聚合站（硅基流动、OpenRouter 等），以及把 Anthropic
//! 协议挂在兼容子路径上的官方供应商（DeepSeek、Kimi、智谱 GLM 等）。

use reqwest::header::{HeaderValue, USER_AGENT};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// 获取到的模型信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedModel {
    pub id: String,
    pub owned_by: Option<String>,
}

/// OpenAI 兼容的 /v1/models 响应格式
#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Option<Vec<ModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
    owned_by: Option<String>,
}

const FETCH_TIMEOUT_SECS: u64 = 15;

/// 404/405 响应体截断长度：避免把几十 KB HTML 404 页整页保留到错误串里。
const ERROR_BODY_MAX_CHARS: usize = 512;

/// 已知的「Anthropic 协议兼容子路径」后缀；按长度降序，最长前缀优先匹配。
/// baseURL 命中这些后缀时，候选列表会追加「剥离后缀再拼 /v1/models / /models」的版本。
const KNOWN_COMPAT_SUFFIXES: &[&str] = &[
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
];

/// 获取供应商的可用模型列表
///
/// 使用 OpenAI 兼容的 GET /v1/models 端点，按候选列表顺序尝试。
pub async fn fetch_models(
    base_url: &str,
    api_key: &str,
    is_full_url: bool,
    models_url_override: Option<&str>,
    user_agent: Option<HeaderValue>,
) -> Result<Vec<FetchedModel>, String> {
    if api_key.is_empty() {
        return Err("API Key is required to fetch models".to_string());
    }

    let candidates = build_models_url_candidates(base_url, is_full_url, models_url_override)?;
    let client = crate::proxy::http_client::get();
    let mut last_err: Option<String> = None;

    for url in &candidates {
        log::debug!("[ModelFetch] Trying endpoint: {url}");
        let mut request = client
            .get(url)
            .header("Authorization", format!("Bearer {api_key}"))
            .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS));
        // 自定义 User-Agent：部分 /models 端点同样有 UA 白名单（如 Kimi Coding Plan），
        // 与转发 / 检测路径共用同一 UA，避免"代理可用但取模型失败"。
        if let Some(ua) = &user_agent {
            request = request.header(USER_AGENT, ua.clone());
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                return Err(format!("Request failed: {e}"));
            }
        };

        let status = response.status();

        if status.is_success() {
            let resp: ModelsResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {e}"))?;

            let mut models: Vec<FetchedModel> = resp
                .data
                .unwrap_or_default()
                .into_iter()
                .map(|m| FetchedModel {
                    id: m.id,
                    owned_by: m.owned_by,
                })
                .collect();

            models.sort_by(|a, b| a.id.cmp(&b.id));
            return Ok(models);
        }

        if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
            let body = truncate_body(response.text().await.unwrap_or_default());
            last_err = Some(format!("HTTP {status}: {body}"));
            continue;
        }

        let body = truncate_body(response.text().await.unwrap_or_default());
        return Err(format!("HTTP {status}: {body}"));
    }

    Err(format!(
        "All candidates failed: {}",
        last_err.unwrap_or_else(|| "no candidates".to_string())
    ))
}

/// 构造「模型列表端点」的候选 URL 列表
///
/// 候选顺序：
/// 1. `models_url_override` 非空 → 只返回它
/// 2. baseURL 拼 `/v1/models`；若已以版本段 `/v{N}` 结尾（`/v1`、智谱
///    `/api/coding/paas/v4` 等），版本号已在路径里，改拼 `/models`
/// 3. 版本段非 `/v1`（如 `/v4`）时再追加 `/v1/models` 作为兜底次候选
/// 4. 若 baseURL 命中 [`KNOWN_COMPAT_SUFFIXES`]，剥离后缀再拼 `/v1/models`、`/models`
///
/// 结果已去重且保持首次出现顺序。
pub fn build_models_url_candidates(
    base_url: &str,
    is_full_url: bool,
    models_url_override: Option<&str>,
) -> Result<Vec<String>, String> {
    if let Some(raw) = models_url_override {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(vec![trimmed.to_string()]);
        }
    }

    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is empty".to_string());
    }

    let mut candidates: Vec<String> = Vec::new();

    if is_full_url {
        if let Some(idx) = trimmed.find("/v1/") {
            candidates.push(format!("{}/v1/models", &trimmed[..idx]));
        } else if let Some(idx) = trimmed.rfind('/') {
            let root = &trimmed[..idx];
            if root.contains("://") && root.len() > root.find("://").unwrap() + 3 {
                candidates.push(format!("{root}/v1/models"));
            }
        }
        if candidates.is_empty() {
            return Err("Cannot derive models endpoint from full URL".to_string());
        }
        return Ok(candidates);
    }

    // baseURL 已以版本段 /v{N} 结尾时（如 `/v1`、智谱 `/api/coding/paas/v4`），
    // OpenAI 惯例的模型端点是 `{base}/models`，不能再补 `/v1`
    // （否则 .../coding/paas/v4/v1/models → 404）。
    if ends_with_version_segment(trimmed) {
        candidates.push(format!("{trimmed}/models"));
        // 版本段非 /v1 时，保留旧的 /v1/models 作为兜底次候选（正确路径已在前）。
        if !trimmed.ends_with("/v1") {
            candidates.push(format!("{trimmed}/v1/models"));
        }
    } else {
        candidates.push(format!("{trimmed}/v1/models"));
    }

    if let Some(stripped) = strip_compat_suffix(trimmed) {
        let root = stripped.trim_end_matches('/');
        if !root.is_empty() && root.contains("://") {
            candidates.push(format!("{root}/v1/models"));
            candidates.push(format!("{root}/models"));
        }
    }

    // 候选最多 3 条，线性去重即可，不值得上 HashSet。
    let mut unique: Vec<String> = Vec::with_capacity(candidates.len());
    for url in candidates {
        if !unique.iter().any(|u| u == &url) {
            unique.push(url);
        }
    }

    Ok(unique)
}

// ───────────────────────── Chat 探活兜底 ─────────────────────────
//
// 背景：`fetch_models` 只探 GET /v1/models。企业私有化 / 自签中转网关经常
// 压根不开放 /models 列表接口（只有 /chat/completions），于是验证 key 时被
// 401/403 拒，前端误报「Key 无效」。这里补一条 POST /chat/completions 的
// 探活：网关的通例是「先验鉴权、再校验模型」，所以哪怕故意发一个不存在的
// 哨兵模型名，只要不是 401/403，就说明这把 key 鉴权是过的（哨兵模型触发
// 404 / 400，不产生真实生成、不计费）。

/// 探活用的哨兵模型名：故意不存在，用来在「鉴权已过」时触发 404/400 而非真实生成。
const PROBE_SENTINEL_MODEL: &str = "__cc_switch_probe__";

/// key 探活结论。区分「鉴权失败（key 坏）」「鉴权通过（key 有效）」「够不着（网络）」。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyProbeResult {
    /// "ok" | "authFailed" | "unreachable"
    pub outcome: String,
    pub http_status: Option<u16>,
    pub message: String,
}

impl KeyProbeResult {
    fn ok(status: u16) -> Self {
        Self {
            outcome: "ok".to_string(),
            http_status: Some(status),
            message: String::new(),
        }
    }
    fn auth_failed(status: u16, body: String) -> Self {
        Self {
            outcome: "authFailed".to_string(),
            http_status: Some(status),
            message: body,
        }
    }
    fn unreachable(status: Option<u16>, message: String) -> Self {
        Self {
            outcome: "unreachable".to_string(),
            http_status: status,
            message,
        }
    }
}

/// 用 POST /chat/completions 探测一把 key 是否有效（鉴权层判定，不依赖 /models）。
///
/// `model` 传 `None` 时用哨兵模型名（不烧 token）；传具体模型则做一次真实最小请求。
pub async fn probe_chat_key(
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
    user_agent: Option<HeaderValue>,
) -> Result<KeyProbeResult, String> {
    if api_key.is_empty() {
        return Err("API Key is required to probe".to_string());
    }

    let url = build_chat_completions_url(base_url)?;
    let model_name = model
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or(PROBE_SENTINEL_MODEL);
    let payload = serde_json::json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": "ping" }],
        "max_tokens": 1,
        "stream": false,
    });

    let client = crate::proxy::http_client::get();
    let mut request = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS));
    if let Some(ua) = &user_agent {
        request = request.header(USER_AGENT, ua.clone());
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(KeyProbeResult::unreachable(
                None,
                format!("Request failed: {e}"),
            ))
        }
    };

    let status = response.status();
    // 鉴权失败时读一段截断 body，保留网关自定义的错误信息方便排查；其余情况不需要 body。
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        let body = truncate_body(response.text().await.unwrap_or_default());
        return Ok(KeyProbeResult::auth_failed(status.as_u16(), body));
    }
    Ok(classify_probe_status(status))
}

/// 把 chat 探活的 HTTP 状态码翻译成 key 探活结论。
///
/// - 401 / 403 → 鉴权失败（key 坏或没权限）
/// - 2xx / 429 → 鉴权通过（429 说明认证成功只是被限流）
/// - 其它 4xx（400/404/405/422…）→ 鉴权通过：哨兵模型或路由问题，但请求已过认证层
/// - 5xx / 其它 → 够不着 / 服务器异常，结论不确定，按 unreachable 处理（不误报 key 坏）
///
/// 注意：调用处对 401/403 会先读一段 body 再走 [`KeyProbeResult::auth_failed`]，
/// 这里同样把 401/403 归为 authFailed（body 为空），保证函数自洽、可单测。
fn classify_probe_status(status: StatusCode) -> KeyProbeResult {
    let code = status.as_u16();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return KeyProbeResult::auth_failed(code, String::new());
    }
    if status.is_success() || status == StatusCode::TOO_MANY_REQUESTS || status.is_client_error() {
        return KeyProbeResult::ok(code);
    }
    KeyProbeResult::unreachable(Some(code), format!("HTTP {status}"))
}

/// 构造 chat/completions 探活 URL：baseURL 已以 `/v{N}` 结尾则直接拼
/// `/chat/completions`，否则补 `/v1/chat/completions`。
fn build_chat_completions_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is empty".to_string());
    }
    if ends_with_version_segment(trimmed) {
        Ok(format!("{trimmed}/chat/completions"))
    } else {
        Ok(format!("{trimmed}/v1/chat/completions"))
    }
}

/// 截断响应体到 [`ERROR_BODY_MAX_CHARS`] 字符，避免 HTML 404 页占用错误串。
fn truncate_body(body: String) -> String {
    if body.chars().count() <= ERROR_BODY_MAX_CHARS {
        body
    } else {
        let mut s: String = body.chars().take(ERROR_BODY_MAX_CHARS).collect();
        s.push('…');
        s
    }
}

/// 若 baseURL 以任一已知兼容子路径结尾，返回剥离后的剩余部分；否则 `None`。
///
/// 依赖 [`KNOWN_COMPAT_SUFFIXES`] 按长度降序排列，确保最长前缀优先命中
/// （否则 `/anthropic` 会提前匹配掉 `/api/anthropic` 的场景）。
fn strip_compat_suffix(base_url: &str) -> Option<&str> {
    for suffix in KNOWN_COMPAT_SUFFIXES {
        if base_url.ends_with(*suffix) {
            return Some(&base_url[..base_url.len() - suffix.len()]);
        }
    }
    None
}

/// 判断 baseURL 是否以 OpenAI 风格的版本段 `/v{N}` 结尾（`N` 为一个或多个数字），
/// 例如 `/v1`、`.../paas/v4`。这类 URL 版本号已在路径中，模型端点应为
/// `{base}/models`，不能再补 `/v1`（智谱 Coding Plan 即 `.../coding/paas/v4`）。
fn ends_with_version_segment(url: &str) -> bool {
    let last = url.rsplit('/').next().unwrap_or("");
    last.strip_prefix('v')
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_candidates_plain_root() {
        let c = build_models_url_candidates("https://api.siliconflow.cn", false, None).unwrap();
        assert_eq!(c, vec!["https://api.siliconflow.cn/v1/models"]);
    }

    #[test]
    fn test_candidates_trailing_slash() {
        let c = build_models_url_candidates("https://api.example.com/", false, None).unwrap();
        assert_eq!(c, vec!["https://api.example.com/v1/models"]);
    }

    #[test]
    fn test_candidates_with_v1() {
        let c = build_models_url_candidates("https://api.example.com/v1", false, None).unwrap();
        assert_eq!(c, vec!["https://api.example.com/v1/models"]);
    }

    #[test]
    fn test_candidates_zhipu_coding_paas_v4() {
        // 智谱 Coding Plan 端点以 /v4 版本段结尾：模型端点是 {base}/models，
        // 正确路径必须排在 .../v4/v1/models（404）之前。
        let c =
            build_models_url_candidates("https://open.bigmodel.cn/api/coding/paas/v4", false, None)
                .unwrap();
        assert_eq!(
            c,
            vec![
                "https://open.bigmodel.cn/api/coding/paas/v4/models",
                "https://open.bigmodel.cn/api/coding/paas/v4/v1/models",
            ]
        );
    }

    #[test]
    fn test_candidates_zai_coding_paas_v4() {
        let c = build_models_url_candidates("https://api.z.ai/api/coding/paas/v4", false, None)
            .unwrap();
        assert_eq!(
            c,
            vec![
                "https://api.z.ai/api/coding/paas/v4/models",
                "https://api.z.ai/api/coding/paas/v4/v1/models",
            ]
        );
    }

    #[test]
    fn test_ends_with_version_segment() {
        assert!(ends_with_version_segment("https://x.com/v1"));
        assert!(ends_with_version_segment(
            "https://open.bigmodel.cn/api/coding/paas/v4"
        ));
        assert!(ends_with_version_segment("https://x.com/v10"));
        assert!(!ends_with_version_segment("https://x.com/api"));
        assert!(!ends_with_version_segment("https://x.com/vX"));
        assert!(!ends_with_version_segment("https://x.com/models"));
        assert!(!ends_with_version_segment("https://api.siliconflow.cn"));
    }

    #[test]
    fn test_candidates_full_url() {
        let c = build_models_url_candidates(
            "https://proxy.example.com/v1/chat/completions",
            true,
            None,
        )
        .unwrap();
        assert_eq!(c, vec!["https://proxy.example.com/v1/models"]);
    }

    #[test]
    fn test_candidates_empty() {
        assert!(build_models_url_candidates("", false, None).is_err());
    }

    #[test]
    fn test_candidates_override_returns_single() {
        let c = build_models_url_candidates(
            "https://api.deepseek.com/anthropic",
            false,
            Some("https://api.deepseek.com/models"),
        )
        .unwrap();
        assert_eq!(c, vec!["https://api.deepseek.com/models"]);
    }

    #[test]
    fn test_candidates_override_empty_falls_through() {
        let c =
            build_models_url_candidates("https://api.siliconflow.cn", false, Some("   ")).unwrap();
        assert_eq!(c, vec!["https://api.siliconflow.cn/v1/models"]);
    }

    #[test]
    fn test_candidates_deepseek_strip_anthropic() {
        let c =
            build_models_url_candidates("https://api.deepseek.com/anthropic", false, None).unwrap();
        assert_eq!(
            c,
            vec![
                "https://api.deepseek.com/anthropic/v1/models",
                "https://api.deepseek.com/v1/models",
                "https://api.deepseek.com/models",
            ]
        );
    }

    #[test]
    fn test_candidates_zhipu_strip_api_anthropic() {
        let c = build_models_url_candidates("https://open.bigmodel.cn/api/anthropic", false, None)
            .unwrap();
        assert_eq!(
            c,
            vec![
                "https://open.bigmodel.cn/api/anthropic/v1/models",
                "https://open.bigmodel.cn/v1/models",
                "https://open.bigmodel.cn/models",
            ]
        );
    }

    #[test]
    fn test_candidates_bailian_strip_apps_anthropic() {
        let c = build_models_url_candidates(
            "https://dashscope.aliyuncs.com/apps/anthropic",
            false,
            None,
        )
        .unwrap();
        assert_eq!(
            c,
            vec![
                "https://dashscope.aliyuncs.com/apps/anthropic/v1/models",
                "https://dashscope.aliyuncs.com/v1/models",
                "https://dashscope.aliyuncs.com/models",
            ]
        );
    }

    #[test]
    fn test_candidates_stepfun_strip_step_plan() {
        let c =
            build_models_url_candidates("https://api.stepfun.com/step_plan", false, None).unwrap();
        assert_eq!(
            c,
            vec![
                "https://api.stepfun.com/step_plan/v1/models",
                "https://api.stepfun.com/v1/models",
                "https://api.stepfun.com/models",
            ]
        );
    }

    #[test]
    fn test_candidates_doubao_strip_api_coding() {
        let c = build_models_url_candidates(
            "https://ark.cn-beijing.volces.com/api/coding",
            false,
            None,
        )
        .unwrap();
        assert_eq!(
            c,
            vec![
                "https://ark.cn-beijing.volces.com/api/coding/v1/models",
                "https://ark.cn-beijing.volces.com/v1/models",
                "https://ark.cn-beijing.volces.com/models",
            ]
        );
    }

    #[test]
    fn test_candidates_rightcode_strip_claude() {
        let c = build_models_url_candidates("https://www.right.codes/claude", false, None).unwrap();
        assert_eq!(
            c,
            vec![
                "https://www.right.codes/claude/v1/models",
                "https://www.right.codes/v1/models",
                "https://www.right.codes/models",
            ]
        );
    }

    #[test]
    fn test_candidates_longer_suffix_wins() {
        // baseURL 以 /api/anthropic 结尾时，应剥离整个 /api/anthropic，
        // 而不是只剥离 /anthropic（那样会得到残缺的 https://.../api 根）。
        let c = build_models_url_candidates("https://api.z.ai/api/anthropic", false, None).unwrap();
        assert_eq!(
            c,
            vec![
                "https://api.z.ai/api/anthropic/v1/models",
                "https://api.z.ai/v1/models",
                "https://api.z.ai/models",
            ]
        );
    }

    #[test]
    fn test_candidates_no_suffix_no_strip() {
        let c = build_models_url_candidates("https://openrouter.ai/api", false, None).unwrap();
        assert_eq!(c, vec!["https://openrouter.ai/api/v1/models"]);
    }

    #[test]
    fn test_candidates_deduplicate() {
        // 虚构 case：baseURL 就是 "scheme://host"，剥不出子路径，应只有一个候选。
        let c = build_models_url_candidates("https://host.example.com", false, None).unwrap();
        assert_eq!(c.len(), 1);
    }

    #[test]
    fn test_parse_response() {
        let json = r#"{"object":"list","data":[{"id":"gpt-4","object":"model","owned_by":"openai"},{"id":"claude-3-sonnet","object":"model","owned_by":"anthropic"}]}"#;
        let resp: ModelsResponse = serde_json::from_str(json).unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].id, "gpt-4");
        assert_eq!(data[0].owned_by.as_deref(), Some("openai"));
        assert_eq!(data[1].id, "claude-3-sonnet");
    }

    #[test]
    fn test_parse_response_no_owned_by() {
        let json = r#"{"object":"list","data":[{"id":"my-model","object":"model"}]}"#;
        let resp: ModelsResponse = serde_json::from_str(json).unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data[0].id, "my-model");
        assert!(data[0].owned_by.is_none());
    }

    #[test]
    fn test_parse_response_empty_data() {
        let json = r#"{"object":"list","data":[]}"#;
        let resp: ModelsResponse = serde_json::from_str(json).unwrap();
        assert!(resp.data.unwrap().is_empty());
    }

    // ── chat 探活 ──────────────────────────────────────────────────

    #[test]
    fn test_chat_completions_url_plain_root() {
        assert_eq!(
            build_chat_completions_url("http://42.240.165.205:3020").unwrap(),
            "http://42.240.165.205:3020/v1/chat/completions"
        );
    }

    #[test]
    fn test_chat_completions_url_trailing_slash_and_v1() {
        // 用户填的 base 常以 /v1 结尾（后台复制的），不能拼成 /v1/v1/chat/completions
        assert_eq!(
            build_chat_completions_url("http://42.240.165.205:3020/v1/").unwrap(),
            "http://42.240.165.205:3020/v1/chat/completions"
        );
    }

    #[test]
    fn test_chat_completions_url_empty() {
        assert!(build_chat_completions_url("   ").is_err());
    }

    #[test]
    fn test_classify_probe_auth_failed() {
        // 401/403 是唯一判「key 坏」的信号
        assert_eq!(
            classify_probe_status(StatusCode::UNAUTHORIZED).outcome,
            "authFailed"
        );
        assert_eq!(
            classify_probe_status(StatusCode::FORBIDDEN).outcome,
            "authFailed"
        );
    }

    #[test]
    fn test_classify_probe_ok() {
        // 200 = 真通；404/400 = 哨兵模型触发但鉴权已过；429 = 认证成功只是被限流
        for s in [
            StatusCode::OK,
            StatusCode::NOT_FOUND,
            StatusCode::BAD_REQUEST,
            StatusCode::UNPROCESSABLE_ENTITY,
            StatusCode::TOO_MANY_REQUESTS,
        ] {
            assert_eq!(
                classify_probe_status(s).outcome,
                "ok",
                "status {s} should be ok"
            );
        }
    }

    #[test]
    fn test_classify_probe_server_error_unreachable() {
        // 5xx 结论不确定，不能误报 key 坏
        assert_eq!(
            classify_probe_status(StatusCode::BAD_GATEWAY).outcome,
            "unreachable"
        );
    }
}
