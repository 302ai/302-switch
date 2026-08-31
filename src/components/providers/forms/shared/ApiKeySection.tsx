import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import ApiKeyInput from "../ApiKeyInput";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProviderCategory } from "@/types";

interface ApiKeySectionProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  category?: ProviderCategory;
  shouldShowLink: boolean;
  websiteUrl: string;
  placeholder?: {
    official: string;
    thirdParty: string;
  };
  disabled?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  onGetApiKey?: () => void;
  getApiKeyDisabled?: boolean;
  // 紧贴 Key 输入框下方的插槽（用于企业私有化「填入上次的 Key」按钮等）
  afterInputSlot?: ReactNode;
  // 覆盖默认占位符（企业私有化引导用户去点下方按钮）
  placeholderOverride?: string;
}

export function ApiKeySection({
  id,
  label,
  value,
  onChange,
  category,
  shouldShowLink,
  websiteUrl,
  placeholder,
  disabled,
  partnerPromotionKey,
  onGetApiKey,
  getApiKeyDisabled,
  afterInputSlot,
  placeholderOverride,
}: ApiKeySectionProps) {
  const { t } = useTranslation();

  const defaultPlaceholder = {
    official: t("providerForm.officialNoApiKey", {
      defaultValue: "官方供应商无需 API Key",
    }),
    thirdParty: t("providerForm.apiKeyAutoFill", {
      defaultValue: "输入 API Key，将自动填充到配置",
    }),
  };

  const finalPlaceholder = placeholder || defaultPlaceholder;

  return (
    <div className="space-y-1">
      <ApiKeyInput
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        placeholder={
          placeholderOverride ??
          (category === "official"
            ? finalPlaceholder.official
            : finalPlaceholder.thirdParty)
        }
        disabled={disabled ?? category === "official"}
      />
      {/* 插槽（如「填入上次的 Key」按钮）与「获取 API Key」按钮并排一行，样式统一 */}
      {(afterInputSlot || (shouldShowLink && (websiteUrl || onGetApiKey))) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {afterInputSlot}
          {shouldShowLink &&
            (websiteUrl || onGetApiKey) &&
            (onGetApiKey ? (
              <button
                type="button"
                onClick={onGetApiKey}
                disabled={getApiKeyDisabled}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-7 w-fit gap-1 disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("providerForm.getApiKey", {
                  defaultValue: "获取 API Key",
                })}
              </button>
            ) : (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-7 w-fit gap-1",
                )}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("providerForm.getApiKey", {
                  defaultValue: "获取 API Key",
                })}
              </a>
            ))}
        </div>
      )}
      {/* 促销信息（与 isPartner 解耦：仅凭 partnerPromotionKey 即可展示，星标仍由 isPartner 控制） */}
      {shouldShowLink && (websiteUrl || onGetApiKey) && partnerPromotionKey && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 p-2.5 border border-blue-200 dark:border-blue-800">
          <p className="text-xs leading-relaxed text-blue-700 dark:text-blue-300">
            💡{" "}
            {t(`providerForm.partnerPromotion.${partnerPromotionKey}`, {
              defaultValue: "",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
