import {
  Activity,
  BarChart3,
  Check,
  Copy,
  Edit,
  Loader2,
  Minus,
  Play,
  Plus,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppId } from "@/lib/api";

interface ProviderActionsProps {
  appId?: AppId;
  isCurrent: boolean;
  isInConfig?: boolean;
  isTesting?: boolean;
  isProxyTakeover?: boolean;
  isOmo?: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onTest?: () => void;
  onConfigureUsage?: () => void;
  onDelete: () => void;
  onRemoveFromConfig?: () => void;
  onDisableOmo?: () => void;
  onOpenTerminal?: () => void;
  isAutoFailoverEnabled?: boolean;
  isInFailoverQueue?: boolean;
  onToggleFailover?: (enabled: boolean) => void;
  isOfficialBlockedByProxy?: boolean;
  // Hermes v12+ providers: dict overlay — edit/delete must go through Web UI
  isReadOnly?: boolean;
  // 302.AI 内置种子：产品招牌入口，不可删除
  isProtected?: boolean;
  // Anthropic 官方卡：必须永远是干净官方，禁止编辑（避免被写进第三方地址/key）
  isOfficialLocked?: boolean;
  // 有值时禁用「启用/切换」按钮并把该文案作为 hover 提示（如 302 种子卡还没填 Key）
  switchDisabledHint?: string;
  // OpenClaw: default model
  isDefaultModel?: boolean;
  onSetAsDefault?: () => void;
}

// 主按钮的呈现状态。title 用于 disabled 态向用户解释为何不可点击；
// 因 Button 基类带 disabled:pointer-events-none，title 必须挂在外层非禁用
// 的 wrapper 上才会在 hover 时显示（见下方 <span> 包裹）。
interface MainButtonState {
  disabled: boolean;
  variant: "default" | "secondary";
  className: string;
  icon: JSX.Element;
  text: string;
  title?: string;
}

export function ProviderActions({
  appId,
  isCurrent,
  isInConfig = false,
  isTesting,
  isProxyTakeover = false,
  isOmo = false,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onConfigureUsage,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onOpenTerminal,
  isAutoFailoverEnabled = false,
  isInFailoverQueue = false,
  onToggleFailover,
  isOfficialBlockedByProxy = false,
  isReadOnly = false,
  isProtected = false,
  isOfficialLocked = false,
  switchDisabledHint,
  // OpenClaw: default model
  isDefaultModel = false,
  onSetAsDefault,
}: ProviderActionsProps) {
  const { t } = useTranslation();
  const iconButtonClass = "h-8 w-8 p-1";
  // 只读（Hermes）或官方锁定都禁止编辑；官方锁定给自己的解释文案
  const editDisabled = isReadOnly || isOfficialLocked;
  const officialLockedHint = t("provider.officialLockedHint", {
    defaultValue: "官方供应商已锁定，始终连接官方且不可编辑",
  });

  // 累加模式应用（OpenCode 非 OMO / OpenClaw / Hermes）
  const isAdditiveMode =
    (appId === "opencode" && !isOmo) ||
    appId === "openclaw" ||
    appId === "hermes";

  // 故障转移模式下的按钮逻辑（累加模式和 OMO 应用不支持故障转移）
  const isFailoverMode =
    !isAdditiveMode && !isOmo && isAutoFailoverEnabled && onToggleFailover;

  const handleMainButtonClick = () => {
    if (isOmo) {
      if (isCurrent) {
        onDisableOmo?.();
      } else {
        onSwitch();
      }
    } else if (isAdditiveMode) {
      // 累加模式：切换配置状态（添加/移除）
      if (isInConfig) {
        if (onRemoveFromConfig) {
          onRemoveFromConfig();
        } else {
          onDelete();
        }
      } else {
        onSwitch(); // 添加到配置
      }
    } else if (isFailoverMode) {
      onToggleFailover(!isInFailoverQueue);
    } else {
      onSwitch();
    }
  };

  const getMainButtonState = (): MainButtonState => {
    if (isOmo) {
      if (isCurrent) {
        return {
          disabled: false,
          variant: "secondary" as const,
          className:
            "bg-gray-200 text-muted-foreground hover:bg-gray-200 hover:text-muted-foreground dark:bg-gray-700 dark:hover:bg-gray-700",
          icon: <Check className="h-4 w-4" />,
          text: t("provider.inUse"),
        };
      }
      return {
        disabled: false,
        variant: "default" as const,
        className: "",
        icon: <Play className="h-4 w-4" />,
        text: t("provider.enable"),
      };
    }

    // 累加模式（OpenCode 非 OMO / OpenClaw）
    if (isAdditiveMode) {
      if (isInConfig) {
        return {
          disabled: isDefaultModel === true,
          variant: "secondary" as const,
          className: cn(
            "bg-orange-100 text-orange-600 hover:bg-orange-200 dark:bg-orange-900/50 dark:text-orange-400 dark:hover:bg-orange-900/70",
            isDefaultModel && "opacity-40 cursor-not-allowed",
          ),
          icon: <Minus className="h-4 w-4" />,
          text: t("provider.removeFromConfig", { defaultValue: "移除" }),
        };
      }
      // 缺 Key 的 302 种子卡：加进配置也是条空 key 的坏条目，点了没用 → 置灰
      return {
        disabled: Boolean(switchDisabledHint),
        variant: "default" as const,
        className: switchDisabledHint
          ? ""
          : "bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700",
        icon: <Plus className="h-4 w-4" />,
        text: t("provider.addToConfig", { defaultValue: "添加" }),
        title: switchDisabledHint,
      };
    }

    if (isFailoverMode) {
      if (isInFailoverQueue) {
        return {
          disabled: false,
          variant: "secondary" as const,
          className:
            "bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-400 dark:hover:bg-blue-900/70",
          icon: <Check className="h-4 w-4" />,
          text: t("failover.inQueue", { defaultValue: "已加入" }),
        };
      }
      return {
        disabled: false,
        variant: "default" as const,
        className:
          "bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700",
        icon: <Plus className="h-4 w-4" />,
        text: t("failover.addQueue", { defaultValue: "加入" }),
      };
    }

    if (isCurrent) {
      return {
        disabled: true,
        variant: "secondary" as const,
        className:
          "bg-gray-200 text-muted-foreground hover:bg-gray-200 hover:text-muted-foreground dark:bg-gray-700 dark:hover:bg-gray-700",
        icon: <Check className="h-4 w-4" />,
        text: t("provider.inUse"),
      };
    }

    if (isOfficialBlockedByProxy) {
      return {
        disabled: true,
        variant: "default" as const,
        className: "",
        icon: <Play className="h-4 w-4" />,
        text: t("provider.enable"),
        title: t("provider.blockedByProxyHint"),
      };
    }

    // 缺 Key 的 302 种子卡：不能启用，按钮置灰并解释原因（配合卡片上的「填入 Key」CTA）
    if (switchDisabledHint) {
      return {
        disabled: true,
        variant: "default" as const,
        className: "",
        icon: <Play className="h-4 w-4" />,
        text: t("provider.enable"),
        title: switchDisabledHint,
      };
    }

    return {
      disabled: false,
      variant: "default" as const,
      className: isProxyTakeover
        ? "bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
        : "",
      icon: <Play className="h-4 w-4" />,
      text: t("provider.enable"),
    };
  };

  const buttonState = getMainButtonState();

  const canDelete =
    !isReadOnly &&
    !isProtected &&
    (isOmo || isAdditiveMode ? true : !isCurrent);
  const readOnlyHint = t("provider.managedByHermesHint", {
    defaultValue: "由 Hermes 管理，请在 Hermes Web UI 中编辑",
  });
  const protectedHint = t("provider.ai302ProtectedHint", {
    defaultValue: "302.AI 预设供应商不可删除",
  });

  return (
    <div className="flex items-center gap-1.5">
      {(appId === "openclaw" || appId === "hermes") &&
        isInConfig &&
        onSetAsDefault &&
        (() => {
          const activeLabel =
            appId === "hermes"
              ? t("provider.inUse", { defaultValue: "已在用" })
              : t("provider.isDefault", { defaultValue: "当前默认" });
          const inactiveLabel =
            appId === "hermes"
              ? t("provider.enable", { defaultValue: "启用" })
              : t("provider.setAsDefault", { defaultValue: "设为默认" });
          return (
            <Button
              size="sm"
              variant={isDefaultModel ? "secondary" : "default"}
              onClick={isDefaultModel ? undefined : onSetAsDefault}
              disabled={isDefaultModel}
              className={cn(
                "w-fit px-2.5",
                isDefaultModel
                  ? "bg-gray-200 text-muted-foreground dark:bg-gray-700 opacity-60 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700",
              )}
            >
              <Zap className="h-4 w-4" />
              {isDefaultModel ? activeLabel : inactiveLabel}
            </Button>
          );
        })()}

      {/* wrapper span 承接 hover：disabled 按钮自身 pointer-events:none，
          原生 title 与 cursor 都必须挂在未禁用的外层元素上才会生效 */}
      <span
        title={buttonState.title}
        className={cn(
          "inline-flex",
          buttonState.disabled && "cursor-not-allowed",
        )}
      >
        <Button
          size="sm"
          variant={buttonState.variant}
          onClick={handleMainButtonClick}
          disabled={buttonState.disabled}
          className={cn("w-[4.5rem] px-2.5", buttonState.className)}
        >
          {buttonState.icon}
          {buttonState.text}
        </Button>
      </span>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={editDisabled ? undefined : onEdit}
          disabled={editDisabled}
          title={
            isReadOnly
              ? readOnlyHint
              : isOfficialLocked
                ? officialLockedHint
                : t("common.edit")
          }
          className={cn(
            iconButtonClass,
            editDisabled &&
              "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <Edit className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onDuplicate}
          title={t("provider.duplicate")}
          className={iconButtonClass}
        >
          <Copy className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onTest || undefined}
          disabled={isTesting}
          title={t("provider.connectivityCheck", "检测连通")}
          className={cn(
            iconButtonClass,
            !onTest && "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          {isTesting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Activity className="h-4 w-4" />
          )}
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onConfigureUsage || undefined}
          title={t("provider.configureUsage")}
          className={cn(
            iconButtonClass,
            !onConfigureUsage &&
              "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <BarChart3 className="h-4 w-4" />
        </Button>

        {onOpenTerminal && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onOpenTerminal}
            title={t("provider.openTerminal", "打开终端")}
            className={cn(
              iconButtonClass,
              "hover:text-emerald-600 dark:hover:text-emerald-400",
            )}
          >
            <Terminal className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={canDelete ? onDelete : undefined}
          title={
            isProtected
              ? protectedHint
              : isReadOnly
                ? readOnlyHint
                : t("common.delete")
          }
          className={cn(
            iconButtonClass,
            canDelete && "hover:text-red-500 dark:hover:text-red-400",
            !canDelete && "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
