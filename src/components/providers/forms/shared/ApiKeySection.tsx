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
      {afterInputSlot}
      {/* API Key 获取链接：做成小按钮，与「填入上次的 Key」按钮保持统一 */}
      {shouldShowLink && websiteUrl && (
        <div className="space-y-2">
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

          {/* 促销信息（与 isPartner 解耦：仅凭 partnerPromotionKey 即可展示，星标仍由 isPartner 控制） */}
          {partnerPromotionKey && (
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
      )}
    </div>
  );
}
