use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::provider::{Provider, ProviderMeta};
use indexmap::IndexMap;
use rusqlite::params;
use std::collections::{HashMap, HashSet};

type OmoProviderRow = (
    String,
    String,
    String,
    Option<String>,
    Option<i64>,
    Option<usize>,
    Option<String>,
    String,
);

fn apply_seed_api_format(provider: &mut Provider, api_format: Option<&str>) {
    let Some(api_format) = api_format else {
        return;
    };
    provider
        .meta
        .get_or_insert_with(ProviderMeta::default)
        .api_format = Some(api_format.to_string());
}

impl Database {
    pub fn get_all_providers(
        &self,
        app_type: &str,
    ) -> Result<IndexMap<String, Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn.prepare(
            "SELECT id, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, in_failover_queue
             FROM providers WHERE app_type = ?1
             ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC"
        ).map_err(|e| AppError::Database(e.to_string()))?;

        let provider_iter = stmt
            .query_map(params![app_type], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let settings_config_str: String = row.get(2)?;
                let website_url: Option<String> = row.get(3)?;
                let category: Option<String> = row.get(4)?;
                let created_at: Option<i64> = row.get(5)?;
                let sort_index: Option<usize> = row.get(6)?;
                let notes: Option<String> = row.get(7)?;
                let icon: Option<String> = row.get(8)?;
                let icon_color: Option<String> = row.get(9)?;
                let meta_str: String = row.get(10)?;
                let in_failover_queue: bool = row.get(11)?;

                let settings_config =
                    serde_json::from_str(&settings_config_str).unwrap_or(serde_json::Value::Null);
                let meta: ProviderMeta = serde_json::from_str(&meta_str).unwrap_or_default();

                Ok((
                    id,
                    Provider {
                        id: "".to_string(), // Placeholder, set below
                        name,
                        settings_config,
                        website_url,
                        category,
                        created_at,
                        sort_index,
                        notes,
                        meta: Some(meta),
                        icon,
                        icon_color,
                        in_failover_queue,
                    },
                ))
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut providers = IndexMap::new();
        for provider_res in provider_iter {
            let (id, mut provider) = provider_res.map_err(|e| AppError::Database(e.to_string()))?;
            provider.id = id.clone();

            let mut stmt_endpoints = conn.prepare(
                "SELECT url, added_at FROM provider_endpoints WHERE provider_id = ?1 AND app_type = ?2 ORDER BY added_at ASC, url ASC"
            ).map_err(|e| AppError::Database(e.to_string()))?;

            let endpoints_iter = stmt_endpoints
                .query_map(params![id, app_type], |row| {
                    let url: String = row.get(0)?;
                    let added_at: Option<i64> = row.get(1)?;
                    Ok((
                        url,
                        crate::settings::CustomEndpoint {
                            url: "".to_string(),
                            added_at: added_at.unwrap_or(0),
                            last_used: None,
                        },
                    ))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut custom_endpoints = HashMap::new();
            for ep_res in endpoints_iter {
                let (url, mut ep) = ep_res.map_err(|e| AppError::Database(e.to_string()))?;
                ep.url = url.clone();
                custom_endpoints.insert(url, ep);
            }

            if let Some(meta) = &mut provider.meta {
                meta.custom_endpoints = custom_endpoints;
            }

            providers.insert(id, provider);
        }

        Ok(providers)
    }

    pub fn get_current_provider(&self, app_type: &str) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1 AND is_current = 1 LIMIT 1")
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut rows = stmt
            .query(params![app_type])
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            Ok(Some(
                row.get(0).map_err(|e| AppError::Database(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    pub fn get_provider_by_id(
        &self,
        id: &str,
        app_type: &str,
    ) -> Result<Option<Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, in_failover_queue
             FROM providers WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
            |row| {
                let name: String = row.get(0)?;
                let settings_config_str: String = row.get(1)?;
                let website_url: Option<String> = row.get(2)?;
                let category: Option<String> = row.get(3)?;
                let created_at: Option<i64> = row.get(4)?;
                let sort_index: Option<usize> = row.get(5)?;
                let notes: Option<String> = row.get(6)?;
                let icon: Option<String> = row.get(7)?;
                let icon_color: Option<String> = row.get(8)?;
                let meta_str: String = row.get(9)?;
                let in_failover_queue: bool = row.get(10)?;

                let settings_config = serde_json::from_str(&settings_config_str).unwrap_or(serde_json::Value::Null);
                let meta: ProviderMeta = serde_json::from_str(&meta_str).unwrap_or_default();

                Ok(Provider {
                    id: id.to_string(),
                    name,
                    settings_config,
                    website_url,
                    category,
                    created_at,
                    sort_index,
                    notes,
                    meta: Some(meta),
                    icon,
                    icon_color,
                    in_failover_queue,
                })
            },
        );

        match result {
            Ok(provider) => Ok(Some(provider)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn save_provider(&self, app_type: &str, provider: &Provider) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut meta_clone = provider.meta.clone().unwrap_or_default();
        let endpoints = std::mem::take(&mut meta_clone.custom_endpoints);

        let existing: Option<(bool, bool)> = tx
            .query_row(
                "SELECT is_current, in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                params![provider.id, app_type],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let is_update = existing.is_some();
        let (is_current, in_failover_queue) =
            existing.unwrap_or((false, provider.in_failover_queue));

        if is_update {
            tx.execute(
                "UPDATE providers SET
                    name = ?1,
                    settings_config = ?2,
                    website_url = ?3,
                    category = ?4,
                    created_at = ?5,
                    sort_index = ?6,
                    notes = ?7,
                    icon = ?8,
                    icon_color = ?9,
                    meta = ?10,
                    is_current = ?11,
                    in_failover_queue = ?12
                WHERE id = ?13 AND app_type = ?14",
                params![
                    provider.name,
                    serde_json::to_string(&provider.settings_config).map_err(|e| {
                        AppError::Database(format!("Failed to serialize settings_config: {e}"))
                    })?,
                    provider.website_url,
                    provider.category,
                    provider.created_at,
                    provider.sort_index,
                    provider.notes,
                    provider.icon,
                    provider.icon_color,
                    serde_json::to_string(&meta_clone).map_err(|e| AppError::Database(format!(
                        "Failed to serialize meta: {e}"
                    )))?,
                    is_current,
                    in_failover_queue,
                    provider.id,
                    app_type,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        } else {
            tx.execute(
                "INSERT INTO providers (
                    id, app_type, name, settings_config, website_url, category,
                    created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    provider.id,
                    app_type,
                    provider.name,
                    serde_json::to_string(&provider.settings_config)
                        .map_err(|e| AppError::Database(format!("Failed to serialize settings_config: {e}")))?,
                    provider.website_url,
                    provider.category,
                    provider.created_at,
                    provider.sort_index,
                    provider.notes,
                    provider.icon,
                    provider.icon_color,
                    serde_json::to_string(&meta_clone)
                        .map_err(|e| AppError::Database(format!("Failed to serialize meta: {e}")))?,
                    is_current,
                    in_failover_queue,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

            for (url, endpoint) in endpoints {
                tx.execute(
                    "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![provider.id, app_type, url, endpoint.added_at],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            }
        }

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_provider(&self, app_type: &str, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM providers WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn set_current_provider(&self, app_type: &str, id: &str) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1",
            params![app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE providers SET is_current = 1 WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_provider_settings_config(
        &self,
        app_type: &str,
        provider_id: &str,
        settings_config: &serde_json::Value,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET settings_config = ?1 WHERE id = ?2 AND app_type = ?3",
            params![
                serde_json::to_string(settings_config).map_err(|e| AppError::Database(format!(
                    "Failed to serialize settings_config: {e}"
                )))?,
                provider_id,
                app_type
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn add_custom_endpoint(
        &self,
        app_type: &str,
        provider_id: &str,
        url: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let added_at = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![provider_id, app_type, url, added_at],
        ).map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn remove_custom_endpoint(
        &self,
        app_type: &str,
        provider_id: &str,
        url: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM provider_endpoints WHERE provider_id = ?1 AND app_type = ?2 AND url = ?3",
            params![provider_id, app_type, url],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn set_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND category = ?2",
            params![app_type, category],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        // OMO ↔ OMO Slim mutually exclusive: deactivate the opposite category
        let opposite = match category {
            "omo" => Some("omo-slim"),
            "omo-slim" => Some("omo"),
            _ => None,
        };
        if let Some(opp) = opposite {
            tx.execute(
                "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND category = ?2",
                params![app_type, opp],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        let updated = tx
            .execute(
                "UPDATE providers SET is_current = 1 WHERE id = ?1 AND app_type = ?2 AND category = ?3",
                params![provider_id, app_type, category],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        if updated != 1 {
            return Err(AppError::Database(format!(
                "Failed to set {category} provider current: provider '{provider_id}' not found in app '{app_type}'"
            )));
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn is_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        match conn.query_row(
            "SELECT is_current FROM providers
             WHERE id = ?1 AND app_type = ?2 AND category = ?3",
            params![provider_id, app_type, category],
            |row| row.get(0),
        ) {
            Ok(is_current) => Ok(is_current),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn clear_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET is_current = 0
             WHERE id = ?1 AND app_type = ?2 AND category = ?3",
            params![provider_id, app_type, category],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_current_omo_provider(
        &self,
        app_type: &str,
        category: &str,
    ) -> Result<Option<Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let row_data: Result<OmoProviderRow, rusqlite::Error> = conn.query_row(
            "SELECT id, name, settings_config, category, created_at, sort_index, notes, meta
             FROM providers
             WHERE app_type = ?1 AND category = ?2 AND is_current = 1
             LIMIT 1",
            params![app_type, category],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        );

        let (id, name, settings_config_str, _row_category, created_at, sort_index, notes, meta_str) =
            match row_data {
                Ok(v) => v,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
                Err(e) => return Err(AppError::Database(e.to_string())),
            };

        let settings_config = serde_json::from_str(&settings_config_str).map_err(|e| {
            AppError::Database(format!(
                "Failed to parse {category} provider settings_config (provider_id={id}): {e}"
            ))
        })?;
        let meta: crate::provider::ProviderMeta = if meta_str.trim().is_empty() {
            crate::provider::ProviderMeta::default()
        } else {
            serde_json::from_str(&meta_str).map_err(|e| {
                AppError::Database(format!(
                    "Failed to parse {category} provider meta (provider_id={id}): {e}"
                ))
            })?
        };

        Ok(Some(Provider {
            id,
            name,
            settings_config,
            website_url: None,
            category: Some(category.to_string()),
            created_at,
            sort_index,
            notes,
            meta: Some(meta),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        }))
    }

    /// 判断 providers 表是否为空（全 app_type 一起算）。
    ///
    /// 用于区分"全新安装"和"升级用户"：在启动流程 import/seed 之前调用。
    /// 使用 `EXISTS` 短路查询，比 `COUNT(*)` 在将来表变大时更高效。
    pub fn is_providers_empty(&self) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM providers)", [], |row| {
                row.get(0)
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(!exists)
    }

    /// 仅获取指定 app 下所有 provider 的 id 集合。
    ///
    /// 比 `get_all_providers` 轻量得多：只读 id 列、无 endpoint 子查询。
    /// 用于只需要做存在性检查的场景（如 additive 模式的 live 同步去重）。
    pub fn get_provider_ids(&self, app_type: &str) -> Result<HashSet<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map(params![app_type], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut ids = HashSet::new();
        for row in rows {
            ids.insert(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(ids)
    }

    /// 判断指定 app 下是否已存在任意 provider。
    ///
    /// 启动阶段的 live import 需要使用这个更严格的判断：
    /// 只要该 app 已经有任何 provider（包括官方 seed），就不应再自动导入 `default`。
    pub fn has_any_provider_for_app(&self, app_type: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM providers WHERE app_type = ?1)",
                params![app_type],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(exists)
    }

    /// 判断指定 app 下是否存在非官方种子的供应商。
    ///
    /// 比 `get_all_providers` 轻量得多：只读 id 列、无 endpoint 子查询、首条命中即返回。
    /// 用于 `import_default_config` 决定是否跳过 live 导入。
    pub fn has_non_official_seed_provider(&self, app_type: &str) -> Result<bool, AppError> {
        use crate::database::dao::providers_seed::is_builtin_seed_id;
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut rows = stmt
            .query(params![app_type])
            .map_err(|e| AppError::Database(e.to_string()))?;
        while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            let id: String = row.get(0).map_err(|e| AppError::Database(e.to_string()))?;
            if !is_builtin_seed_id(&id) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// 计算指定 app 下一个可用的 sort_index（追加到末尾）。
    fn next_sort_index_for_app(&self, app_type: &str) -> Result<usize, AppError> {
        let conn = lock_conn!(self.conn);
        let max: Option<i64> = conn
            .query_row(
                "SELECT MAX(sort_index) FROM providers WHERE app_type = ?1",
                params![app_type],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(max.map(|v| (v + 1) as usize).unwrap_or(0))
    }

    /// 启动时调用：补齐缺失的官方预设供应商（Claude / Codex / Gemini）。
    ///
    /// 使用 settings flag `official_providers_seeded` 保证每个数据库只执行一次：
    /// - 全新用户：seed 三条官方预设
    /// - 老用户升级：同样会触发一次（flag 不存在），追加到末尾，不影响已有排序
    /// - 用户删除 seed 后：不再重建（flag 已为 true），尊重用户意图
    ///
    /// 与 `Database::save_provider` 的 UPSERT 语义配合，即使被意外重复调用
    /// 也不会覆盖用户当前激活的供应商（is_current 字段会被保留）。
    pub fn init_default_official_providers(&self) -> Result<usize, AppError> {
        use crate::database::dao::providers_seed::OFFICIAL_SEEDS;

        if self
            .get_bool_flag("official_providers_seeded")
            .unwrap_or(false)
        {
            return Ok(0);
        }

        let mut inserted = 0_usize;
        let now_ms = chrono::Utc::now().timestamp_millis();

        for seed in OFFICIAL_SEEDS {
            let app_type_str = seed.app_type.as_str();

            // 若该 id 已存在（极端情况：用户曾手动用过同 id），跳过
            if self.get_provider_by_id(seed.id, app_type_str)?.is_some() {
                continue;
            }

            let next_sort_index = self.next_sort_index_for_app(app_type_str)?;

            let settings_config: serde_json::Value =
                serde_json::from_str(seed.settings_config_json).map_err(|e| {
                    AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
                })?;

            let mut provider = Provider::with_id(
                seed.id.to_string(),
                seed.name.to_string(),
                settings_config,
                Some(seed.website_url.to_string()),
            );
            provider.category = Some(seed.category.to_string());
            provider.icon = Some(seed.icon.to_string());
            provider.icon_color = Some(seed.icon_color.to_string());
            provider.sort_index = Some(next_sort_index);
            provider.created_at = Some(now_ms);
            apply_seed_api_format(&mut provider, seed.api_format);

            self.save_provider(app_type_str, &provider)?;
            inserted += 1;
            log::info!(
                "✓ Seeded official provider: {} ({})",
                seed.name,
                app_type_str
            );
        }

        // 即使 inserted=0（例如用户手动创建过同 id）也设置 flag 防止反复检查
        self.set_setting("official_providers_seeded", "true")?;

        Ok(inserted)
    }

    /// 强制把 Anthropic 官方卡（Claude Code / Claude Desktop）拉回规范空配置。
    ///
    /// official 卡按设计就是「空 env、走订阅登录 → 真官方 api.anthropic.com」，可历史上
    /// 它是可编辑的，一旦被写进 302 地址 / key / 模型映射就变成「假官方」。这里每次启动
    /// 比对：配置偏离规范就重置——既清掉已有污染，也保证官方卡永远干净。只覆盖
    /// settings_config，名字 / 图标 / 排序 / 是否当前都由 save_provider 原样保留。
    ///
    /// 只管 Anthropic 两张（规范都是 {"env":{}}）。codex/gemini 官方卡的 config 里可能存着
    /// OAuth 登录态，重置会误删，故不在此列。
    pub fn normalize_anthropic_official_providers(&self) -> Result<usize, AppError> {
        use crate::database::dao::providers_seed::{
            CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, OFFICIAL_SEEDS,
        };

        let mut fixed = 0_usize;
        for seed in OFFICIAL_SEEDS {
            if seed.id != "claude-official" && seed.id != CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID {
                continue;
            }
            let app_type_str = seed.app_type.as_str();
            let Some(mut provider) = self.get_provider_by_id(seed.id, app_type_str)? else {
                continue;
            };
            let canonical: serde_json::Value = serde_json::from_str(seed.settings_config_json)
                .map_err(|e| {
                    AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
                })?;
            if provider.settings_config == canonical {
                continue;
            }
            provider.settings_config = canonical;
            self.save_provider(app_type_str, &provider)?;
            fixed += 1;
            log::info!(
                "✓ Reset official provider to clean state: {} ({})",
                seed.name,
                app_type_str
            );
        }

        Ok(fixed)
    }

    /// 修复历史遗留：老版引导「企业版」是直接改写 302 海外种子（ai302-{app}）的地址+名字，
    /// 结果海外卡被顶掉，列表里只剩「国内 + 企业」。这里一次性修回：把被顶掉的海外种子
    /// 拆成两张——新建一张独立企业卡（保留其「当前选中」态），种子本身还原成干净的
    /// 「302.AI（海外）」。判定「被顶掉」的依据：种子配置里出现了 enterprise_profile 记录的
    /// 私有 baseUrl。用一次性 flag 防重复；从没存过 enterprise_profile 的库直接跳过。
    pub fn restore_cannibalized_ai302_overseas_seeds(&self) -> Result<usize, AppError> {
        use crate::database::dao::providers_seed::AI302_SEEDS;

        if self
            .get_bool_flag("ai302_overseas_restored_v1")
            .unwrap_or(false)
        {
            return Ok(0);
        }

        // 私有地址来自引导落库的企业档案；没有它就无从判断哪张是被顶掉的海外种子。
        let ent_base_url = match self.get_setting("enterprise_profile")? {
            Some(json) => serde_json::from_str::<serde_json::Value>(&json)
                .ok()
                .and_then(|v| {
                    v.get("baseUrl")
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string())
                }),
            None => None,
        };
        let Some(ent_base_url) = ent_base_url.filter(|s| !s.trim().is_empty()) else {
            self.set_setting("ai302_overseas_restored_v1", "true")?;
            return Ok(0);
        };

        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut restored = 0_usize;

        for seed in AI302_SEEDS {
            // 只看海外（全局）种子：id 形如 ai302-{app}，排除国内 ai302-cn-*
            if seed.id.starts_with("ai302-cn-") {
                continue;
            }
            let app = seed.app_type.as_str();
            let Some(existing) = self.get_provider_by_id(seed.id, app)? else {
                continue;
            };
            // 种子配置里出现了私有地址 = 这张海外种子被顶成了企业卡
            let existing_str = serde_json::to_string(&existing.settings_config).unwrap_or_default();
            if !existing_str.contains(&ent_base_url) {
                continue;
            }

            // 1) 新建一张独立企业卡：复制现状、换新 id、归 third_party
            let mut enterprise = existing.clone();
            enterprise.id = uuid::Uuid::new_v4().to_string();
            enterprise.category = Some("third_party".to_string());
            enterprise.created_at = Some(now_ms);
            self.save_provider(app, &enterprise)?;

            // 2) 海外种子还原成规范值（save_provider 会保留库里的 is_current，先不动当前态）
            let canonical: serde_json::Value = serde_json::from_str(seed.settings_config_json)
                .map_err(|e| {
                    AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
                })?;
            let mut restored_seed = existing.clone();
            restored_seed.settings_config = canonical;
            restored_seed.name = seed.name.to_string();
            restored_seed.website_url = Some(seed.website_url.to_string());
            restored_seed.category = Some(seed.category.to_string());
            restored_seed.icon = Some(seed.icon.to_string());
            restored_seed.icon_color = Some(seed.icon_color.to_string());
            self.save_provider(app, &restored_seed)?;

            // 3) 如果「当前」原本就是这张（现已还原成海外的）种子，把当前态转移到新企业卡，
            //    让用户仍停在自己的企业接口上，而不是被切到空 key 的海外卡。
            if self.get_current_provider(app)?.as_deref() == Some(seed.id) {
                self.set_current_provider(app, &enterprise.id)?;
            }

            restored += 1;
            log::info!(
                "✓ Restored overseas 302.AI seed and split off enterprise card: {} ({})",
                seed.id,
                app
            );
        }

        self.set_setting("ai302_overseas_restored_v1", "true")?;
        Ok(restored)
    }

    /// 启动时调用：补齐 302.AI 聚合供应商（无 key 占位）。
    ///
    /// 每次启动都按固定 id 扫描缺失项，而不是靠历史 flag 提前返回。这样新增支持
    /// OpenCode / OpenClaw / Hermes 时，已经写过区域种子 flag 的老数据库也能补齐。
    /// 扫描只有少量主键查询，已有条目不会覆盖用户配置。
    ///
    /// 302 种子 id 全部在 `is_builtin_seed_id` 覆盖范围内，因此不会被
    /// `has_non_official_seed_provider` 当成「用户自建第三方」而挡住 live 导入。
    pub fn init_ai302_providers(&self) -> Result<usize, AppError> {
        use crate::database::dao::providers_seed::AI302_SEEDS;

        let mut inserted = 0_usize;
        let now_ms = chrono::Utc::now().timestamp_millis();

        for seed in AI302_SEEDS {
            let app_type_str = seed.app_type.as_str();

            // 若该 id 已存在（用户曾手动用过同 id，或上一轮已种），跳过
            if self.get_provider_by_id(seed.id, app_type_str)?.is_some() {
                continue;
            }

            let next_sort_index = self.next_sort_index_for_app(app_type_str)?;

            let settings_config: serde_json::Value =
                serde_json::from_str(seed.settings_config_json).map_err(|e| {
                    AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
                })?;

            let mut provider = Provider::with_id(
                seed.id.to_string(),
                seed.name.to_string(),
                settings_config,
                Some(seed.website_url.to_string()),
            );
            provider.category = Some(seed.category.to_string());
            provider.icon = Some(seed.icon.to_string());
            provider.icon_color = Some(seed.icon_color.to_string());
            provider.sort_index = Some(next_sort_index);
            provider.created_at = Some(now_ms);
            apply_seed_api_format(&mut provider, seed.api_format);

            self.save_provider(app_type_str, &provider)?;
            inserted += 1;
            log::info!("✓ Seeded 302.AI provider: {} ({})", seed.name, app_type_str);
        }

        // 兼容仍读取旧标记的历史版本；当前版本不再用 flag 跳过缺失项扫描。
        self.set_setting("ai302_providers_seeded", "true")?;
        self.set_setting("ai302_regional_providers_seeded", "true")?;
        self.repair_ai302_providers()?;

        Ok(inserted)
    }

    /// 补内置卡片缺失的运行时元数据，并把未改动过的旧版单卡名称、网址迁移为
    /// “海外”标识；顺带剥掉旧 Codex 种子钉死的 model = "gpt-5.5" 行（改为自动
    /// 路由），并把旧 Codex 种子的错误出厂端点迁移到 /v1。
    /// 用户自行改过的名称、网址、格式和模型值都不覆盖。
    fn repair_ai302_providers(&self) -> Result<usize, AppError> {
        use crate::app_config::AppType;
        use crate::database::dao::providers_seed::AI302_SEEDS;

        let mut repaired = 0_usize;
        for seed in AI302_SEEDS {
            let app_type = seed.app_type.as_str();
            let Some(mut provider) = self.get_provider_by_id(seed.id, app_type)? else {
                continue;
            };
            let mut changed = false;

            if provider.name == "302.AI" {
                provider.name = seed.name.to_string();
                changed = true;
            }
            if provider.website_url.as_deref() == Some("https://302.ai") {
                provider.website_url = Some(seed.website_url.to_string());
                changed = true;
            }

            if let Some(api_format) = seed.api_format {
                let meta = provider.meta.get_or_insert_with(ProviderMeta::default);
                if meta
                    .api_format
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty())
                {
                    meta.api_format = Some(api_format.to_string());
                    changed = true;
                }
            }

            // 旧版 Codex 种子钉死了 model = "gpt-5.5"，现在默认改为自动路由
            // （不写 model 行，跟随客户端按任务自选）。只剥掉与旧默认逐字相同
            // 的那一行——用户自己改过的模型值不匹配，原样保留。
            if seed.app_type == AppType::Codex {
                let legacy_line = "model = \"gpt-5.5\"";
                if let Some(config_text) = provider
                    .settings_config
                    .get("config")
                    .and_then(|value| value.as_str())
                {
                    if config_text.lines().any(|line| line.trim() == legacy_line) {
                        let stripped: Vec<&str> = config_text
                            .lines()
                            .filter(|line| line.trim() != legacy_line)
                            .collect();
                        provider.settings_config["config"] =
                            serde_json::Value::String(stripped.join("\n"));
                        changed = true;
                    }
                }

                if let Some(config_text) = provider
                    .settings_config
                    .get("config")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
                {
                    match crate::codex_config::repair_ai302_codex_auth_routing(
                        &config_text,
                        None,
                    ) {
                        Ok(Some(repaired)) => {
                            provider.settings_config["config"] =
                                serde_json::Value::String(repaired);
                            changed = true;
                        }
                        Ok(None) => {}
                        Err(error) => log::warn!(
                            "Skipping malformed Codex config while repairing 302.AI auth ({}): {error}",
                            provider.id
                        ),
                    }
                }
            }

            if changed {
                self.save_provider(app_type, &provider)?;
                repaired += 1;
            }
        }
        repaired += self.repair_ai302_codex_endpoints()?;
        if repaired > 0 {
            log::info!("✓ Repaired {repaired} 302.AI provider(s)");
        }
        Ok(repaired)
    }

    /// 旧版允许在同一张 302 Codex 卡上切换国内/海外节点，所以不能只按内置卡 id
    /// 修复。扫描全部 Codex 卡片及地址候选表，精确迁移错误发布的 302.AI URL。
    fn repair_ai302_codex_endpoints(&self) -> Result<usize, AppError> {
        use crate::app_config::AppType;
        use crate::codex_config::{
            corrected_ai302_codex_base_url, repair_ai302_codex_auth_routing,
            repair_ai302_codex_base_urls,
        };

        let app_type = AppType::Codex.as_str();
        let providers = self.get_all_providers(app_type)?;
        let mut repaired = 0_usize;

        for (_, mut provider) in providers {
            let Some(config_text) = provider
                .settings_config
                .get("config")
                .and_then(|value| value.as_str())
            else {
                continue;
            };

            let mut migrated = config_text.to_string();
            let mut changed = false;

            match repair_ai302_codex_base_urls(&migrated) {
                Ok(Some(next)) => {
                    migrated = next;
                    changed = true;
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!(
                        "Skipping malformed Codex config while repairing 302.AI endpoint ({}): {error}",
                        provider.id
                    );
                    continue;
                }
            }

            match repair_ai302_codex_auth_routing(&migrated, None) {
                Ok(Some(next)) => {
                    migrated = next;
                    changed = true;
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!(
                        "Skipping malformed Codex config while repairing 302.AI auth ({}): {error}",
                        provider.id
                    );
                    continue;
                }
            }

            if !changed {
                continue;
            }

            provider.settings_config["config"] = serde_json::Value::String(migrated);
            self.save_provider(app_type, &provider)?;
            repaired += 1;
        }

        let conn = lock_conn!(self.conn);
        let endpoint_candidates = {
            let mut stmt = conn
                .prepare("SELECT id, url FROM provider_endpoints WHERE app_type = ?1")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map(params![app_type], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Database(e.to_string()))?
        };
        let mut endpoint_rows = 0;
        for (id, url) in endpoint_candidates {
            let Some(current) = corrected_ai302_codex_base_url(&url) else {
                continue;
            };
            endpoint_rows += conn
                .execute(
                    "UPDATE provider_endpoints SET url = ?1 WHERE id = ?2",
                    params![current, id],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
        }
        if endpoint_rows > 0 {
            log::info!("✓ Repaired {endpoint_rows} legacy 302.AI Codex endpoint candidate(s)");
        }

        Ok(repaired)
    }

    /// 按 id 兜底插入单条 official seed（仅当目标表中该 id 不存在时插入）。
    ///
    /// 与 `init_default_official_providers` 不同：
    /// - 不触碰 `official_providers_seeded` 全局 flag，是 on-demand 修复
    /// - 只处理一条 seed，由调用方决定 id + app_type
    /// - 已存在则尊重用户自定义，不覆盖
    ///
    /// 返回 Ok(true) 表示插入了新行，Ok(false) 表示已存在被跳过。
    pub fn ensure_official_seed_by_id(
        &self,
        seed_id: &str,
        app_type: crate::app_config::AppType,
    ) -> Result<bool, AppError> {
        use crate::database::dao::providers_seed::OFFICIAL_SEEDS;

        let seed = OFFICIAL_SEEDS
            .iter()
            .find(|s| s.id == seed_id && s.app_type == app_type)
            .ok_or_else(|| {
                AppError::Database(format!(
                    "unknown official seed: id={seed_id}, app_type={}",
                    app_type.as_str()
                ))
            })?;

        let app_type_str = seed.app_type.as_str();

        if self.get_provider_by_id(seed_id, app_type_str)?.is_some() {
            return Ok(false);
        }

        let settings_config: serde_json::Value = serde_json::from_str(seed.settings_config_json)
            .map_err(|e| {
                AppError::Database(format!("Seed JSON parse failed for {}: {e}", seed.id))
            })?;

        let next_sort_index = self.next_sort_index_for_app(app_type_str)?;
        let now_ms = chrono::Utc::now().timestamp_millis();

        let mut provider = Provider::with_id(
            seed.id.to_string(),
            seed.name.to_string(),
            settings_config,
            Some(seed.website_url.to_string()),
        );
        provider.category = Some("official".to_string());
        provider.icon = Some(seed.icon.to_string());
        provider.icon_color = Some(seed.icon_color.to_string());
        provider.sort_index = Some(next_sort_index);
        provider.created_at = Some(now_ms);
        apply_seed_api_format(&mut provider, seed.api_format);

        self.save_provider(app_type_str, &provider)?;

        Ok(true)
    }
}

#[cfg(test)]
mod ensure_official_seed_tests {
    use crate::app_config::AppType;
    use crate::database::{Database, CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID};
    use crate::provider::Provider;

    fn legacy_ai302_codex_url(api_root: &str) -> String {
        format!("{api_root}/{}/v1", "codex")
    }

    #[test]
    fn ensure_inserts_when_missing() {
        let db = Database::memory().expect("memory db");
        let inserted = db
            .ensure_official_seed_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, AppType::ClaudeDesktop)
            .expect("ensure ok");
        assert!(inserted, "should insert when missing");

        let provider = db
            .get_provider_by_id(
                CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
                AppType::ClaudeDesktop.as_str(),
            )
            .expect("query ok")
            .expect("provider exists after ensure");

        assert_eq!(provider.id, CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID);
        assert_eq!(provider.name, "Claude Desktop Official");
        assert_eq!(provider.category.as_deref(), Some("official"));
        assert_eq!(provider.icon.as_deref(), Some("anthropic"));
        assert_eq!(provider.icon_color.as_deref(), Some("#D4915D"));
    }

    #[test]
    fn ensure_skips_when_present_and_preserves_customization() {
        let db = Database::memory().expect("memory db");
        db.init_default_official_providers().expect("seed");

        let mut renamed = db
            .get_provider_by_id(
                CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
                AppType::ClaudeDesktop.as_str(),
            )
            .expect("query ok")
            .expect("seed present");
        renamed.name = "My Custom Backup".to_string();
        db.save_provider(AppType::ClaudeDesktop.as_str(), &renamed)
            .expect("save customization");

        let inserted = db
            .ensure_official_seed_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, AppType::ClaudeDesktop)
            .expect("ensure ok");
        assert!(!inserted, "should skip when present");

        let after = db
            .get_provider_by_id(
                CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
                AppType::ClaudeDesktop.as_str(),
            )
            .expect("query ok")
            .expect("still present");
        assert_eq!(
            after.name, "My Custom Backup",
            "customization must not be overwritten"
        );
    }

    #[test]
    fn ensure_rejects_unknown_seed() {
        let db = Database::memory().expect("memory db");
        let result = db.ensure_official_seed_by_id("nonexistent-id", AppType::ClaudeDesktop);
        assert!(result.is_err(), "unknown seed id should be Err");
    }

    #[test]
    fn ensure_rejects_seed_app_type_mismatch() {
        let db = Database::memory().expect("memory db");
        let result =
            db.ensure_official_seed_by_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID, AppType::Claude);
        assert!(result.is_err(), "(id, app_type) mismatch should be Err");
    }

    #[test]
    fn ai302_codex_seed_sets_responses_format_metadata() {
        let db = Database::memory().expect("memory db");
        assert_eq!(db.init_ai302_providers().expect("seed"), 14);

        let provider = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("codex seed");
        assert_eq!(
            provider.meta.and_then(|meta| meta.api_format),
            Some("openai_responses".to_string())
        );

        let domestic = db
            .get_provider_by_id("ai302-cn-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("domestic codex seed");
        assert_eq!(domestic.name, "302.AI（国内）");
        assert_eq!(
            domestic.website_url.as_deref(),
            Some("https://api.302ai.cn")
        );
        assert_eq!(
            domestic.meta.and_then(|meta| meta.api_format),
            Some("openai_responses".to_string())
        );
    }

    #[test]
    fn ai302_regional_seed_flag_upgrades_legacy_installations() {
        let db = Database::memory().expect("memory db");
        db.set_setting("ai302_providers_seeded", "true")
            .expect("set legacy flag");

        assert_eq!(db.init_ai302_providers().expect("regional upgrade"), 14);
        assert!(db
            .get_provider_by_id("ai302-cn-claude", AppType::Claude.as_str())
            .expect("query domestic provider")
            .is_some());
        assert!(db
            .get_bool_flag("ai302_regional_providers_seeded")
            .expect("read regional flag"));
        assert_eq!(db.init_ai302_providers().expect("repeat init"), 0);
    }

    #[test]
    fn ai302_seed_init_backfills_additive_apps_after_flag_is_set() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed all apps");

        for (app_type, id) in [
            (AppType::OpenCode, "ai302-opencode"),
            (AppType::OpenCode, "ai302-cn-opencode"),
            (AppType::OpenClaw, "ai302-openclaw"),
            (AppType::OpenClaw, "ai302-cn-openclaw"),
            (AppType::Hermes, "ai302-hermes"),
            (AppType::Hermes, "ai302-cn-hermes"),
        ] {
            db.delete_provider(app_type.as_str(), id)
                .expect("simulate older seeded database");
        }

        assert_eq!(
            db.init_ai302_providers().expect("backfill additive apps"),
            6
        );
        for (app_type, id) in [
            (AppType::OpenCode, "ai302-opencode"),
            (AppType::OpenCode, "ai302-cn-opencode"),
            (AppType::OpenClaw, "ai302-openclaw"),
            (AppType::OpenClaw, "ai302-cn-openclaw"),
            (AppType::Hermes, "ai302-hermes"),
            (AppType::Hermes, "ai302-cn-hermes"),
        ] {
            assert!(db
                .get_provider_by_id(id, app_type.as_str())
                .expect("query additive seed")
                .is_some());
        }
    }

    #[test]
    fn ai302_seed_repair_labels_legacy_overseas_cards() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");

        let mut provider = db
            .get_provider_by_id("ai302-claude", AppType::Claude.as_str())
            .expect("query")
            .expect("overseas seed");
        provider.name = "302.AI".to_string();
        provider.website_url = Some("https://302.ai".to_string());
        db.save_provider(AppType::Claude.as_str(), &provider)
            .expect("save legacy card");

        assert_eq!(db.init_ai302_providers().expect("repair"), 0);
        let repaired = db
            .get_provider_by_id("ai302-claude", AppType::Claude.as_str())
            .expect("query repaired")
            .expect("repaired overseas seed");
        assert_eq!(repaired.name, "302.AI（海外）");
        assert_eq!(repaired.website_url.as_deref(), Some("https://api.302.ai"));
    }

    #[test]
    fn ai302_seed_repair_only_fills_missing_metadata() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");

        let mut provider = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("codex seed");
        provider.settings_config["auth"]["OPENAI_API_KEY"] =
            serde_json::Value::String("preserved-key".to_string());
        provider.meta.as_mut().expect("meta").api_format = None;
        db.save_provider(AppType::Codex.as_str(), &provider)
            .expect("save legacy shape");

        assert_eq!(db.init_ai302_providers().expect("repair"), 0);
        let repaired = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query repaired")
            .expect("repaired provider");
        assert_eq!(
            repaired
                .meta
                .as_ref()
                .and_then(|meta| meta.api_format.as_deref()),
            Some("openai_responses")
        );
        assert_eq!(
            repaired.settings_config["auth"]["OPENAI_API_KEY"].as_str(),
            Some("preserved-key")
        );

        // 用户显式改成 openai_chat（旧机器就是这个形态），repair 不许覆盖
        let mut explicit = repaired;
        explicit.meta.as_mut().expect("meta").api_format = Some("openai_chat".to_string());
        db.save_provider(AppType::Codex.as_str(), &explicit)
            .expect("save explicit format");
        db.init_ai302_providers().expect("repeat repair");

        let after = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query explicit")
            .expect("explicit provider");
        assert_eq!(
            after.meta.and_then(|meta| meta.api_format),
            Some("openai_chat".to_string()),
            "explicit user format must not be overwritten"
        );
    }

    /// 已发布版本曾把海外地址错误写成 /codex/v1，repair 要改回 /v1；
    /// 用户自定义的地址必须原样保留。
    #[test]
    fn ai302_seed_repair_corrects_legacy_overseas_codex_endpoint() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");
        let legacy_url = legacy_ai302_codex_url("https://api.302.ai");

        // 模拟错误版本的出厂形态：/codex/v1 + 用户已填的 key
        let mut provider = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("codex seed");
        provider.settings_config["config"] = serde_json::Value::String(format!(
            "model_provider = \"custom\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"302ai\"\nbase_url = \"{legacy_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
        ));
        provider.settings_config["auth"]["OPENAI_API_KEY"] =
            serde_json::Value::String("user-key".to_string());
        db.save_provider(AppType::Codex.as_str(), &provider)
            .expect("save bad shipped endpoint");
        db.add_custom_endpoint(AppType::Codex.as_str(), "ai302-codex", &legacy_url)
            .expect("save legacy endpoint candidate");

        assert_eq!(db.init_ai302_providers().expect("repair"), 0);
        let repaired = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query repaired")
            .expect("repaired provider");
        let config = repaired.settings_config["config"].as_str().expect("toml");
        assert!(config.contains("base_url = \"https://api.302.ai/v1\""));
        assert!(!config.contains(&legacy_url));
        assert!(config.contains("requires_openai_auth = false"));
        assert_eq!(
            repaired
                .meta
                .as_ref()
                .and_then(|meta| meta.api_format.as_deref()),
            Some("openai_responses")
        );
        assert_eq!(
            repaired.settings_config["auth"]["OPENAI_API_KEY"].as_str(),
            Some("user-key")
        );
        let providers = db
            .get_all_providers(AppType::Codex.as_str())
            .expect("list providers");
        let endpoints = &providers["ai302-codex"]
            .meta
            .as_ref()
            .expect("meta")
            .custom_endpoints;
        assert!(endpoints.contains_key("https://api.302.ai/v1"));
        assert!(!endpoints.contains_key(&legacy_url));

        // 用户自定义的地址不是旧默认值，repair 不许碰（格式也保持用户的选择）
        let mut custom = repaired;
        custom.settings_config["config"] = serde_json::Value::String(
            "model_provider = \"custom\"\n\n[model_providers.custom]\nname = \"302ai\"\nbase_url = \"https://my-gateway.example.com/v1\"\nwire_api = \"responses\"".to_string(),
        );
        custom.meta.as_mut().expect("meta").api_format = Some("openai_chat".to_string());
        db.save_provider(AppType::Codex.as_str(), &custom)
            .expect("save custom endpoint");
        db.init_ai302_providers().expect("repeat repair");

        let after = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query custom")
            .expect("custom provider");
        assert!(after.settings_config["config"]
            .as_str()
            .expect("toml")
            .contains("base_url = \"https://my-gateway.example.com/v1\""));
        assert_eq!(
            after.meta.and_then(|meta| meta.api_format),
            Some("openai_chat".to_string())
        );
    }

    /// 国内 Codex 卡曾错误使用 /codex/v1；启动 repair 必须改回 /v1，
    /// 同时保留用户已经填写的 Key 和原生 Responses 格式。
    #[test]
    fn ai302_seed_repair_corrects_domestic_codex_endpoint() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");
        let legacy_url = legacy_ai302_codex_url("https://api.302ai.cn");

        let mut provider = db
            .get_provider_by_id("ai302-cn-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("domestic codex seed");
        provider.settings_config["config"] = serde_json::Value::String(format!(
            "model_provider = \"custom\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"302ai-cn\"\nbase_url = \"{legacy_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
        ));
        provider.settings_config["auth"]["OPENAI_API_KEY"] =
            serde_json::Value::String("domestic-key".to_string());
        db.save_provider(AppType::Codex.as_str(), &provider)
            .expect("save bad shipped endpoint");

        assert_eq!(db.init_ai302_providers().expect("repair"), 0);
        let repaired = db
            .get_provider_by_id("ai302-cn-codex", AppType::Codex.as_str())
            .expect("query repaired")
            .expect("repaired domestic provider");
        let config = repaired.settings_config["config"].as_str().expect("toml");
        assert!(config.contains("base_url = \"https://api.302ai.cn/v1\""));
        assert!(!config.contains(&legacy_url));
        assert!(config.contains("requires_openai_auth = false"));
        assert_eq!(
            repaired.settings_config["auth"]["OPENAI_API_KEY"].as_str(),
            Some("domestic-key")
        );
        assert_eq!(
            repaired.meta.and_then(|meta| meta.api_format),
            Some("openai_responses".to_string())
        );
    }

    /// 旧版只有一张 302 Codex 卡，用户从地址管理切到国内节点后，卡片 id 仍是
    /// ai302-codex。修复不能只看国内卡 id，还要按实际地址迁移配置和候选端点。
    #[test]
    fn ai302_seed_repair_corrects_domestic_endpoint_on_legacy_overseas_card() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");
        let legacy_url = legacy_ai302_codex_url("https://api.302ai.cn");

        let mut provider = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("legacy 302 codex card");
        provider.settings_config["config"] = serde_json::Value::String(format!(
            "model_provider = \"custom\"\nmodel_reasoning_effort = \"high\"\n\n[model_providers.custom]\nname = \"302ai\"\nbase_url = \"{legacy_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
        ));
        db.save_provider(AppType::Codex.as_str(), &provider)
            .expect("save selected domestic endpoint");
        db.add_custom_endpoint(AppType::Codex.as_str(), "ai302-codex", &legacy_url)
            .expect("save legacy endpoint candidate");

        db.init_ai302_providers().expect("repair");

        let repaired = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query repaired")
            .expect("repaired provider");
        let config = repaired.settings_config["config"].as_str().expect("toml");
        assert!(config.contains("base_url = \"https://api.302ai.cn/v1\""));
        assert!(!config.contains(&legacy_url));
        assert!(config.contains("requires_openai_auth = false"));

        let providers = db
            .get_all_providers(AppType::Codex.as_str())
            .expect("list providers");
        let endpoints = &providers["ai302-codex"]
            .meta
            .as_ref()
            .expect("meta")
            .custom_endpoints;
        assert!(endpoints.contains_key("https://api.302ai.cn/v1"));
        assert!(!endpoints.contains_key(&legacy_url));
    }

    #[test]
    fn ai302_repair_fixes_auth_routing_on_custom_provider_ids() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");

        let mut provider = Provider::with_id(
            "my-302-provider".to_string(),
            "My 302".to_string(),
            serde_json::json!({
                "auth": {"OPENAI_API_KEY": "custom-key"},
                "config": "model_provider = \"my302\"\n\n[model_providers.my302]\nname = \"My 302\"\nbase_url = \"https://api.302.ai/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true"
            }),
            None,
        );
        provider.category = Some("custom".to_string());
        db.save_provider(AppType::Codex.as_str(), &provider)
            .expect("save custom provider");

        db.init_ai302_providers().expect("repair");

        let repaired = db
            .get_provider_by_id("my-302-provider", AppType::Codex.as_str())
            .expect("query repaired")
            .expect("custom provider");
        let config = repaired.settings_config["config"].as_str().expect("toml");
        assert!(config.contains("requires_openai_auth = false"));
        assert_eq!(
            repaired.settings_config["auth"]["OPENAI_API_KEY"].as_str(),
            Some("custom-key")
        );
    }

    /// 旧安装的 Codex 种子里钉着 model = "gpt-5.5"，repair 要把这一行剥掉
    /// （改为自动路由），但用户自己改过的模型值必须原样保留。
    #[test]
    fn ai302_seed_repair_strips_legacy_codex_model_pin() {
        let db = Database::memory().expect("memory db");
        db.init_ai302_providers().expect("seed");

        // 模拟旧版种子形态：config 里带旧默认 model 行 + 用户已填的 key
        let mut provider = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query")
            .expect("codex seed");
        let legacy_config = "model_provider = \"custom\"\nmodel = \"gpt-5.5\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"302ai\"\nbase_url = \"https://api.302.ai/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true";
        provider.settings_config["config"] = serde_json::Value::String(legacy_config.to_string());
        provider.settings_config["auth"]["OPENAI_API_KEY"] =
            serde_json::Value::String("user-key".to_string());
        db.save_provider(AppType::Codex.as_str(), &provider)
            .expect("save legacy shape");

        assert_eq!(db.init_ai302_providers().expect("repair"), 0);
        let repaired = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query repaired")
            .expect("repaired provider");
        let config = repaired.settings_config["config"].as_str().expect("toml");
        assert!(!config.contains("model = \"gpt-5.5\""));
        assert!(config.contains("model_reasoning_effort = \"high\""));
        assert!(config.contains("base_url = \"https://api.302.ai/v1\""));
        assert!(!config.contains("/codex/"));
        assert!(config.contains("requires_openai_auth = false"));
        assert_eq!(
            repaired.settings_config["auth"]["OPENAI_API_KEY"].as_str(),
            Some("user-key")
        );

        // 用户自己钉的模型不是旧默认值，repair 不许碰
        let mut custom = repaired;
        custom.settings_config["config"] = serde_json::Value::String(
            "model_provider = \"custom\"\nmodel = \"gpt-5.6-sol\"\n\n[model_providers.custom]\nname = \"302ai\"\nbase_url = \"https://api.302.ai/v1\"".to_string(),
        );
        db.save_provider(AppType::Codex.as_str(), &custom)
            .expect("save custom model");
        db.init_ai302_providers().expect("repeat repair");

        let after = db
            .get_provider_by_id("ai302-codex", AppType::Codex.as_str())
            .expect("query custom")
            .expect("custom provider");
        assert!(after.settings_config["config"]
            .as_str()
            .expect("toml")
            .contains("model = \"gpt-5.6-sol\""));
    }
}
