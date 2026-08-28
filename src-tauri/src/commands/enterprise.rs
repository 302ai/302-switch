//! 企业私有化档案命令
//!
//! 前端在引导「企业版」分支保存后写一份档案；之后「添加供应商 → 企业私有化」
//! 读回来做回填 / 一键填 key。详见 `database::dao::enterprise_profile`。

use crate::database::EnterpriseProfile;
use crate::error::AppError;
use crate::store::AppState;
use tauri::State;

/// 读企业档案。没存过返回 null。
#[tauri::command]
pub fn get_enterprise_profile(
    state: State<'_, AppState>,
) -> Result<Option<EnterpriseProfile>, AppError> {
    state.db.get_enterprise_profile()
}

/// 写企业档案；传 null 表示清除（切回公共版时用）。
#[tauri::command]
pub fn set_enterprise_profile(
    state: State<'_, AppState>,
    profile: Option<EnterpriseProfile>,
) -> Result<(), AppError> {
    match profile {
        Some(p) => state.db.save_enterprise_profile(&p),
        None => state.db.clear_enterprise_profile(),
    }
}
