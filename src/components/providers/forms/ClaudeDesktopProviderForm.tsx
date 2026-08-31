import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BasicFormFields } from "./BasicFormFields";
import { CodexOAuthSection } from "./CodexOAuthSection";
import { CopilotAuthSection } from "./CopilotAuthSection";
import { ApiKeySection } from "./shared/ApiKeySection";
import { EndpointField } from "./shared/EndpointField";
import { ModelDropdown } from "./shared/ModelDropdown";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import { useApiKeyLink } from "./hooks/useApiKeyLink";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import type {
  ClaudeApiFormat,
  ClaudeDesktopModelRoute,
  ProviderCategory,
  ProviderMeta,
} from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import {
  CLAUDE_DESKTOP_ROLE_ROUTE_IDS,
  claudeDesktopProviderPresets,
  type ClaudeDesktopProviderPreset,
  type ClaudeDesktopRoleId,
} from "@/config/claudeDesktopProviderPresets";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import {
  providersApi,
  type ClaudeDesktopDefaultRoute,
} from "@/lib/api/providers";
import { settingsApi, type EnterpriseProfile } from "@/lib/api";
import { resolveManagedAccountId } from "@/lib/authBinding";
import { copyText } from "@/lib/clipboard";
import { requiresClaudeDesktopLocalRoute } from "@/utils/claudeDesktopConnection";
import { isAi302CustomEndpoint, normalizeAi302RootUrl } from "@/config/ai302";
import { useEnterpriseApiKeyAuthorization } from "@/hooks/useEnterpriseApiKeyAuthorization";

export type ClaudeDesktopProviderFormValues = ProviderFormData & {
  presetId?: string;
  presetCategory?: ProviderCategory;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  meta?: ProviderMeta;
  providerKey?: string;
  suggestedDefaults?: OpenClawSuggestedDefaults;
};

type ApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

type PresetEntry = {
  id: string;
  preset: ClaudeDesktopProviderPreset;
};

export interface ClaudeDesktopProviderFormProps {
  providerId?: string;
  submitLabel: string;
  onSubmit: (values: ClaudeDesktopProviderFormValues) => Promise<void> | void;
  onCancel: () => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  initialData?: {
    name?: string;
    websiteUrl?: string;
    notes?: string;
    settingsConfig?: Record<string, unknown>;
    category?: ProviderCategory;
    meta?: ProviderMeta;
    icon?: string;
    iconColor?: string;
  };
  showButtons?: boolean;
}

type RouteRow = {
  rowId: string;
  route: string;
  model: string;
  labelOverride: string;
  supports1m: boolean;
};

type RouteRowValues = Omit<RouteRow, "rowId">;
type RouteRole = ClaudeDesktopRoleId;

const CLAUDE_ROUTE_PREFIX = "claude-";
const ANTHROPIC_CLAUDE_ROUTE_PREFIX = "anthropic/claude-";
const LEGACY_ONE_M_MARKER = "[1m]";
const ROLE_ROUTE_IDS = CLAUDE_DESKTOP_ROLE_ROUTE_IDS;
const ROLE_ORDER: RouteRole[] = ["sonnet", "opus", "fable", "haiku"];

function envString(
  settingsConfig: Record<string, unknown> | undefined,
  key: string,
) {
  const env = settingsConfig?.env;
  if (!env || typeof env !== "object") return "";
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function clonePlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function routeRoleFromId(route: string): RouteRole {
  const normalized = route.trim().toLowerCase();
  // 与后端 claude_role_keyword 同序（opus → haiku → fable → sonnet）。
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("haiku")) return "haiku";
  if (normalized.includes("fable")) return "fable";
  return "sonnet";
}

function routeIdForRole(role: RouteRole, usedRoutes: Set<string>) {
  const baseRoute = ROLE_ROUTE_IDS[role];
  if (!usedRoutes.has(baseRoute)) return baseRoute;

  let index = 2;
  while (usedRoutes.has(`${baseRoute}-r${index}`)) {
    index += 1;
  }
  return `${baseRoute}-r${index}`;
}

function fallbackCatalogRouteId(usedRoutes: Set<string>) {
  const role = ROLE_ORDER.find((candidate) => {
    const route = ROLE_ROUTE_IDS[candidate];
    return !usedRoutes.has(route);
  });
  return routeIdForRole(role ?? "sonnet", usedRoutes);
}

function createRouteRow(row: RouteRowValues): RouteRow {
  return {
    rowId: crypto.randomUUID(),
    ...row,
  };
}

function initialRouteRows(
  routes: Record<string, ClaudeDesktopModelRoute> | undefined,
): RouteRow[] {
  const usedRoutes = new Set(
    Object.keys(routes ?? {}).filter((route) => isClaudeSafeRoute(route)),
  );

  return Object.entries(routes ?? {}).map(([route, value]) => {
    const routeId = isClaudeSafeRoute(route)
      ? route
      : fallbackCatalogRouteId(usedRoutes);
    usedRoutes.add(routeId);

    return createRouteRow({
      route: routeId,
      model: value.model ?? "",
      labelOverride:
        value.labelOverride ??
        (!isClaudeSafeRoute(route) ? value.model || route : ""),
      supports1m: value.supports1m ?? false,
    });
  });
}

// Proxy 模式对齐 Claude Code：固定 Sonnet / Opus / Fable / Haiku 四档。
// 把任意来源的 route 行按角色归类到固定四槽（缺档留空），保证 UI 永远四行、
// 用户不会漏配某档导致子 agent 找不到模型。
// （fable 自 Desktop 1.12603.1+ 起被 fail-all 校验放行，可作为独立档位。）
function normalizeProxyRows(rows: RouteRow[]): RouteRow[] {
  return ROLE_ORDER.map((role) => {
    const match = rows.find(
      (row) => row.route.trim() && routeRoleFromId(row.route) === role,
    );
    return createRouteRow({
      route: ROLE_ROUTE_IDS[role],
      model: match?.model ?? "",
      labelOverride: match?.labelOverride ?? "",
      supports1m: match?.supports1m ?? false,
    });
  });
}

function isClaudeSafeRoute(route: string) {
  const normalized = route.trim().toLowerCase();
  if (normalized.includes(LEGACY_ONE_M_MARKER)) return false;
  const routeTail = normalized.startsWith(ANTHROPIC_CLAUDE_ROUTE_PREFIX)
    ? normalized.slice(ANTHROPIC_CLAUDE_ROUTE_PREFIX.length)
    : normalized.startsWith(CLAUDE_ROUTE_PREFIX)
      ? normalized.slice(CLAUDE_ROUTE_PREFIX.length)
      : "";

  // 角色前缀后必须还有实际模型标识，拒绝 claude-sonnet- 这类退化值
  // （否则会写入 profile 并触发 Claude Desktop fail-all 拒收整组）。
  // 与后端 is_claude_safe_model_id 镜像；fable 自 Desktop 1.12603.1+ 起被校验放行。
  return ["sonnet-", "opus-", "haiku-", "fable-"].some(
    (prefix) =>
      routeTail.startsWith(prefix) && routeTail.length > prefix.length,
  );
}

function defaultRouteRows(
  defaults: ClaudeDesktopDefaultRoute[],
  defaultModel: string,
): RouteRow[] {
  return defaults.map((route, index) =>
    createRouteRow({
      route: route.routeId,
      model: index === 0 ? defaultModel : "",
      labelOverride: "",
      supports1m: route.supports1m,
    }),
  );
}

export function ClaudeDesktopProviderForm({
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: ClaudeDesktopProviderFormProps) {
  const { t } = useTranslation();
  const initialMode = initialData?.meta?.claudeDesktopMode ?? "direct";
  const [mode, setMode] = useState<"direct" | "proxy">(initialMode);
  const usesLocalRoute = mode === "proxy";
  const [showGatewayToken, setShowGatewayToken] = useState(false);
  const [isSyncingGatewayToken, setIsSyncingGatewayToken] = useState(false);
  const [apiFormat, setApiFormat] = useState<ClaudeApiFormat>(
    initialData?.meta?.apiFormat ?? "anthropic",
  );
  const [baseUrl, setBaseUrl] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_BASE_URL"),
  );
  const publicHttpRequiresLocalRoute = useMemo(
    () => requiresClaudeDesktopLocalRoute(baseUrl),
    [baseUrl],
  );
  const [apiKey, setApiKey] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_AUTH_TOKEN") ||
      envString(initialData?.settingsConfig, "ANTHROPIC_API_KEY"),
  );
  const [apiKeyField, setApiKeyField] = useState<ApiKeyField>(() =>
    envString(initialData?.settingsConfig, "ANTHROPIC_API_KEY")
      ? "ANTHROPIC_API_KEY"
      : "ANTHROPIC_AUTH_TOKEN",
  );
  const [selectedGitHubAccountId, setSelectedGitHubAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "github_copilot"));
  const [selectedCodexAccountId, setSelectedCodexAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "codex_oauth"));
  const [codexFastMode, setCodexFastMode] = useState<boolean>(
    () => initialData?.meta?.codexFastMode ?? false,
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    "custom",
  );
  // 企业私有化档案：引导里填过的私有部署地址 + key（Claude Desktop 侧）。
  const [enterpriseProfile, setEnterpriseProfile] =
    useState<EnterpriseProfile | null>(null);
  const [enterpriseKeyFilled, setEnterpriseKeyFilled] = useState(false);
  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    settingsApi
      .getEnterpriseProfile()
      .then((profile) => {
        if (!cancelled) setEnterpriseProfile(profile);
      })
      .catch(() => {
        // 读不到就静默关闭回填
      });
    return () => {
      cancelled = true;
    };
  }, [initialData]);
  const [activePreset, setActivePreset] = useState<{
    id: string;
    category?: ProviderCategory;
    isPartner?: boolean;
    partnerPromotionKey?: string;
    providerType?: string;
    requiresOAuth?: boolean;
  } | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>(() => {
    const rows = initialRouteRows(initialData?.meta?.claudeDesktopModelRoutes);
    // proxy 模式归一化成固定三档；但初始无任何 route 时保持空数组，交给 seed
    // effect 用默认路由回填（默认 1M 声明、ANTHROPIC_MODEL 预填），避免过早
    // normalize 成空三档把 routes.length 撑到 3、永久挡住 seed。
    return initialMode === "proxy" && rows.length > 0
      ? normalizeProxyRows(rows)
      : rows;
  });
  const didSeedDefaultRoutes = useRef(
    Object.keys(initialData?.meta?.claudeDesktopModelRoutes ?? {}).length > 0,
  );
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [directModelsExpanded, setDirectModelsExpanded] = useState(
    initialMode === "direct" &&
      Object.keys(initialData?.meta?.claudeDesktopModelRoutes ?? {}).length > 0,
  );
  const { data: defaultRoutes = [] } = useQuery({
    queryKey: ["claudeDesktopDefaultRoutes"],
    queryFn: () => providersApi.getClaudeDesktopDefaultRoutes(),
  });
  const {
    data: gatewayToken = "",
    isLoading: isGatewayTokenLoading,
    refetch: refetchGatewayToken,
  } = useQuery({
    queryKey: ["claudeDesktopGatewayToken"],
    queryFn: () => providersApi.getClaudeDesktopGatewayToken(),
    enabled: usesLocalRoute,
    staleTime: Infinity,
  });
  const { data: currentClaudeDesktopProviderId = "" } = useQuery({
    queryKey: ["claudeDesktopCurrentProvider"],
    queryFn: () => providersApi.getCurrent("claude-desktop"),
    enabled: usesLocalRoute && Boolean(providerId),
  });
  const canResyncGatewayToken =
    Boolean(providerId) && providerId === currentClaudeDesktopProviderId;
  const defaultProxyRouteRows = useMemo(
    () =>
      defaultRouteRows(
        defaultRoutes,
        envString(initialData?.settingsConfig, "ANTHROPIC_MODEL"),
      ),
    [defaultRoutes, initialData?.settingsConfig],
  );

  useEffect(() => {
    if (publicHttpRequiresLocalRoute && mode !== "proxy") {
      setMode("proxy");
      setRoutes((current) => {
        const source = current.length > 0 ? current : defaultProxyRouteRows;
        if (source.length === 0) {
          didSeedDefaultRoutes.current = false;
          return current;
        }
        didSeedDefaultRoutes.current = true;
        return normalizeProxyRows(source);
      });
    }
  }, [defaultProxyRouteRows, mode, publicHttpRequiresLocalRoute]);

  const defaultValues: ProviderFormData = useMemo(
    () => ({
      name: initialData?.name ?? "",
      websiteUrl: initialData?.websiteUrl ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: JSON.stringify(
        initialData?.settingsConfig ?? { env: {} },
        null,
        2,
      ),
      icon: initialData?.icon ?? "",
      iconColor: initialData?.iconColor ?? "",
    }),
    [initialData],
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: "onSubmit",
  });

  useEffect(() => {
    onSubmittingChange?.(form.formState.isSubmitting || isFetchingModels);
  }, [form.formState.isSubmitting, isFetchingModels, onSubmittingChange]);

  const presetEntries = useMemo<PresetEntry[]>(
    () =>
      claudeDesktopProviderPresets.map((preset, index) => ({
        id: `claude-desktop-${index}`,
        preset,
      })),
    [],
  );

  const presetCategoryLabels: Record<string, string> = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial", { defaultValue: "官方" }),
      cn_official: t("providerForm.categoryCnOfficial", {
        defaultValue: "国内官方",
      }),
      aggregator: t("providerForm.categoryAggregation", {
        defaultValue: "聚合服务",
      }),
      third_party: t("providerForm.categoryThirdParty", {
        defaultValue: "第三方",
      }),
    }),
    [t],
  );
  const activeProviderType =
    activePreset?.providerType ?? initialData?.meta?.providerType;
  const isOfficial =
    initialData?.category === "official" ||
    activePreset?.category === "official";
  // 当前选中的是不是「企业私有化」预设，且引导里存过私有档案——决定回填提示条。
  const selectedPresetEntry = selectedPresetId
    ? presetEntries.find((e) => e.id === selectedPresetId)
    : undefined;
  const isEnterprisePresetSelected =
    selectedPresetEntry?.preset.nameKey === "providerPreset.enterprise";
  const usesEnterpriseAuthorization =
    isEnterprisePresetSelected ||
    Boolean(
      initialData?.name?.startsWith("302.AI（企业版") &&
        isAi302CustomEndpoint(baseUrl),
    );
  const showEnterprisePrefill =
    !initialData &&
    selectedPresetEntry?.preset.nameKey === "providerPreset.enterprise" &&
    Boolean(enterpriseProfile?.baseUrl?.trim());
  const hasStoredEnterpriseKey = Boolean(enterpriseProfile?.apiKey?.trim());
  const usesManagedOAuth =
    activePreset?.requiresOAuth === true ||
    activeProviderType === "github_copilot" ||
    activeProviderType === "codex_oauth";

  // API Key 获取/邀请链接（与 Claude Code 表单同款，见 ClaudeFormFields）
  const apiKeyLinkCategory = activePreset?.category ?? initialData?.category;
  const {
    shouldShowApiKeyLink,
    websiteUrl: apiKeyLinkWebsiteUrl,
    isPartner: apiKeyLinkIsPartner,
    partnerPromotionKey: apiKeyLinkPromotionKey,
  } = useApiKeyLink({
    appId: "claude-desktop",
    category: apiKeyLinkCategory,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });
  const handleEnterpriseAuthorizedKey = useCallback((key: string) => {
    setApiKey(key);
    setEnterpriseKeyFilled(true);
  }, []);
  const enterpriseAuthorization = useEnterpriseApiKeyAuthorization(
    "editor",
    handleEnterpriseAuthorizedKey,
  );

  useEffect(() => {
    if (!usesEnterpriseAuthorization) enterpriseAuthorization.discard();
  }, [enterpriseAuthorization.discard, usesEnterpriseAuthorization]);

  const applyDesktopPreset = (
    preset: ClaudeDesktopProviderPreset,
    opts?: { fillEnterpriseKey?: boolean },
  ) => {
    // 「企业私有化」预设：Base URL 用引导里存过的私有档案回填，官网链接跟着填；
    // key 只在用户点「填入上次的 key」时才灌进去，否则留空让用户自己填。
    const isEnterprisePreset = preset.nameKey === "providerPreset.enterprise";
    const enterpriseBaseUrl =
      isEnterprisePreset && enterpriseProfile?.baseUrl?.trim()
        ? enterpriseProfile.baseUrl.trim()
        : "";
    const fillKey = isEnterprisePreset && Boolean(opts?.fillEnterpriseKey);
    setEnterpriseKeyFilled(fillKey);

    form.setValue("name", preset.nameKey ? t(preset.nameKey) : preset.name);
    form.setValue("websiteUrl", preset.websiteUrl || enterpriseBaseUrl);
    form.setValue("notes", "");
    form.setValue("icon", preset.icon ?? "");
    form.setValue("iconColor", preset.iconColor ?? "");

    const nextBaseUrl = enterpriseBaseUrl || preset.baseUrl;
    const nextMode =
      preset.mode === "proxy" || requiresClaudeDesktopLocalRoute(nextBaseUrl)
        ? "proxy"
        : "direct";
    setBaseUrl(nextBaseUrl);
    setApiKey(
      fillKey && enterpriseProfile?.apiKey?.trim()
        ? enterpriseProfile.apiKey.trim()
        : "",
    );
    setApiKeyField(preset.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN");
    setApiFormat(preset.apiFormat ?? "anthropic");

    setMode(nextMode);
    if (nextMode === "proxy" && preset.modelRoutes?.length) {
      didSeedDefaultRoutes.current = true;
      setRoutes(
        normalizeProxyRows(
          preset.modelRoutes.map((r) =>
            createRouteRow({
              route: r.routeId,
              model: r.upstreamModel,
              labelOverride: r.labelOverride ?? "",
              supports1m: r.supports1m,
            }),
          ),
        ),
      );
    } else {
      didSeedDefaultRoutes.current = nextMode !== "proxy";
      setRoutes([]);
    }
  };

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);

    if (value === "custom") {
      setActivePreset(null);
      setEnterpriseKeyFilled(false);
      form.reset(defaultValues);
      setBaseUrl("");
      setApiKey("");
      setApiKeyField("ANTHROPIC_AUTH_TOKEN");
      setApiFormat("anthropic");
      didSeedDefaultRoutes.current = false;
      setMode("direct");
      setRoutes([]);
      return;
    }

    const entry = presetEntries.find((item) => item.id === value);
    if (!entry) return;

    setActivePreset({
      id: value,
      category: entry.preset.category,
      isPartner: entry.preset.isPartner,
      partnerPromotionKey: entry.preset.partnerPromotionKey,
      providerType: entry.preset.providerType,
      requiresOAuth: entry.preset.requiresOAuth,
    });
    applyDesktopPreset(entry.preset);
  };

  // ── 新建模式默认选中 302.AI ──────────────────────────────────────────
  // 打开「添加 Claude Desktop 供应商」时自动套用 302.AI 预设（而非停在"自定义"）。
  // 必须走 handlePresetChange（→ applyDesktopPreset）才会回填端点 / 直连模式 /
  // 图标——单改 selectedPresetId 不触发回填。布尔哨兵只生效一次：用户若手动切回
  // "自定义"不会被反复覆盖。编辑模式尊重已有数据，不套预设。
  const didAutoSelect302 = useRef(false);
  useEffect(() => {
    if (initialData) return;
    if (didAutoSelect302.current) return;
    const entry = presetEntries.find((item) =>
      item.preset.name.toLowerCase().includes("302"),
    );
    if (!entry) return;
    didAutoSelect302.current = true;
    handlePresetChange(entry.id);
    // handlePresetChange 未 memo 化，靠布尔哨兵保证只生效一次，故不纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, presetEntries]);

  const updateRoute = (index: number, patch: Partial<RouteRowValues>) => {
    setRoutes((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const handleLocalRouteChange = (checked: boolean) => {
    if (!checked && publicHttpRequiresLocalRoute) return;
    setMode(checked ? "proxy" : "direct");
    if (checked) {
      // 切到 proxy：归一化成固定 Sonnet / Opus / Haiku 三档；
      // 若当前无路由则以后端默认路由作为来源（保留 Sonnet 默认模型）。
      setRoutes((current) => {
        // 默认路由（默认 1M 声明、ANTHROPIC_MODEL 预填）异步加载完成前，若当前
        // 无路由则保持空数组，交给 seed effect 在加载后回填；不要过早 normalize
        // 成空三档（会把 routes.length 撑到 3、永久挡住 seed）。
        if (current.length === 0 && defaultProxyRouteRows.length === 0) {
          return current;
        }
        const useDefaults =
          current.length === 0 && defaultProxyRouteRows.length > 0;
        if (useDefaults) {
          didSeedDefaultRoutes.current = true;
        }
        return normalizeProxyRows(
          useDefaults ? defaultProxyRouteRows : current,
        );
      });
    }
  };

  useEffect(() => {
    if (
      didSeedDefaultRoutes.current ||
      mode !== "proxy" ||
      routes.length > 0 ||
      defaultProxyRouteRows.length === 0
    ) {
      return;
    }

    didSeedDefaultRoutes.current = true;
    setRoutes(normalizeProxyRows(defaultProxyRouteRows));
  }, [defaultProxyRouteRows, mode, routes.length]);

  const handleFetchModels = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      showFetchModelsError(null, t, {
        hasBaseUrl: Boolean(baseUrl.trim()),
        hasApiKey: Boolean(apiKey.trim()),
      });
      return;
    }

    setIsFetchingModels(true);
    try {
      const models = await fetchModelsForConfig(baseUrl.trim(), apiKey.trim());
      setFetchedModels(models);
      toast.success(
        t("providerForm.fetchModelsSuccess", {
          count: models.length,
          defaultValue: `已获取 ${models.length} 个模型`,
        }),
      );
    } catch (error) {
      showFetchModelsError(error, t, {
        hasBaseUrl: Boolean(baseUrl.trim()),
        hasApiKey: Boolean(apiKey.trim()),
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!gatewayToken) return;
    try {
      await copyText(gatewayToken);
      toast.success(
        t("claudeDesktop.gatewayTokenCopied", {
          defaultValue: "内部 Token 已复制",
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleResyncGatewayToken = async () => {
    if (!providerId || !canResyncGatewayToken) return;
    setIsSyncingGatewayToken(true);
    try {
      await providersApi.resyncClaudeDesktopGatewayToken(providerId);
      await refetchGatewayToken();
      toast.success(
        t("claudeDesktop.gatewayTokenSynced", {
          defaultValue: "Gateway 凭证已同步，请重启 Claude Desktop",
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSyncingGatewayToken(false);
    }
  };

  const handleSubmit = async (values: ProviderFormData) => {
    if (!values.name.trim()) {
      toast.error(
        t("providerForm.fillSupplierName", {
          defaultValue: "请填写供应商名称",
        }),
      );
      return;
    }
    if (isOfficial) {
      // 官方供应商使用 Claude Desktop 内置 1P 模式，保持空 env 占位；
      // 不写 claudeDesktopMode / claudeDesktopModelRoutes / apiFormat，
      // 与启动 seed 的 OFFICIAL_SEEDS 占位语义一致。
      const settingsConfig = clonePlainRecord(initialData?.settingsConfig);
      settingsConfig.env = {};
      const meta: ProviderMeta = { ...(initialData?.meta ?? {}) };
      delete meta.claudeDesktopMode;
      delete meta.claudeDesktopModelRoutes;
      delete meta.apiFormat;
      delete meta.endpointAutoSelect;
      delete meta.isFullUrl;
      await onSubmit({
        ...values,
        name: values.name.trim(),
        websiteUrl: values.websiteUrl?.trim() ?? "",
        notes: values.notes?.trim() ?? "",
        settingsConfig: JSON.stringify(settingsConfig, null, 2),
        meta,
        presetId: activePreset?.id,
        presetCategory: "official",
      });
      return;
    }
    if (!baseUrl.trim()) {
      toast.error(
        t("providerForm.fetchModelsNeedEndpoint", {
          defaultValue: "请先填写接口地址",
        }),
      );
      return;
    }
    if (!usesManagedOAuth && !apiKey.trim()) {
      toast.error(
        t("providerForm.fetchModelsNeedApiKey", {
          defaultValue: "请先填写 API Key",
        }),
      );
      return;
    }

    const routeEntries = routes
      .map((route) => ({
        ...route,
        route: route.route.trim(),
        model: route.model.trim(),
        labelOverride: route.labelOverride.trim(),
      }))
      .filter((route) => route.route || route.model);

    if (usesLocalRoute) {
      // 固定四档（Sonnet / Opus / Fable / Haiku），route_id 由 UI 生成、恒合法，
      // 因此只要求至少填一个实际请求模型；留空档继承第一个已填档（Sonnet 优先），
      // 对齐 Claude Code 的兜底，保证落库四档齐全、子 agent 不会找不到模型。
      const primary = routeEntries.find((route) => route.model);
      if (!primary) {
        toast.error(
          t("claudeDesktop.routesRequired", {
            defaultValue: "至少填写一个模型映射",
          }),
        );
        return;
      }
      for (const route of routeEntries) {
        if (!route.model) {
          route.model = primary.model;
          if (!route.labelOverride) {
            route.labelOverride = primary.labelOverride || primary.model;
          }
          // 回填的是同一个上游模型，1M 能力声明应与 primary 一致，
          // 避免同模型在不同档声明不同 1M（除非该档用户已显式勾选）。
          if (!route.supports1m) {
            route.supports1m = primary.supports1m;
          }
        }
      }
    } else {
      const invalid = routeEntries.find(
        (route) => !route.route || !isClaudeSafeRoute(route.route),
      );
      if (invalid) {
        toast.error(
          t("claudeDesktop.directModelInvalid", {
            defaultValue:
              "直连模型必须使用 Claude Desktop 可识别的 Sonnet / Opus / Haiku 模型名",
          }),
        );
        return;
      }
    }

    const settingsConfig = clonePlainRecord(initialData?.settingsConfig);
    const env = clonePlainRecord(settingsConfig.env);
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    settingsConfig.env = usesManagedOAuth
      ? {
          ...env,
          ANTHROPIC_BASE_URL: baseUrl.trim().replace(/\/+$/, ""),
        }
      : {
          ...env,
          ANTHROPIC_BASE_URL: baseUrl.trim().replace(/\/+$/, ""),
          [apiKeyField]: apiKey.trim(),
        };

    const routeMap = routeEntries.reduce<
      Record<string, ClaudeDesktopModelRoute>
    >((acc, route) => {
      acc[route.route] = {
        model: usesLocalRoute ? route.model || route.route : route.route,
        labelOverride:
          route.labelOverride || (usesLocalRoute ? route.model : undefined),
        supports1m: route.supports1m || undefined,
      };
      return acc;
    }, {});

    const meta: ProviderMeta = {
      ...(initialData?.meta ?? {}),
      claudeDesktopMode: mode,
      apiFormat: usesLocalRoute ? apiFormat : "anthropic",
    };

    meta.claudeDesktopModelRoutes = routeMap;
    meta.providerType = activeProviderType;
    meta.authBinding =
      activeProviderType === "github_copilot"
        ? {
            source: "managed_account",
            authProvider: "github_copilot",
            accountId: selectedGitHubAccountId ?? undefined,
          }
        : activeProviderType === "codex_oauth"
          ? {
              source: "managed_account",
              authProvider: "codex_oauth",
              accountId: selectedCodexAccountId ?? undefined,
            }
          : undefined;
    meta.codexFastMode =
      activeProviderType === "codex_oauth" ? codexFastMode : undefined;

    delete meta.endpointAutoSelect;
    delete meta.isFullUrl;

    await onSubmit({
      ...values,
      name: values.name.trim(),
      websiteUrl: values.websiteUrl?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      settingsConfig: JSON.stringify(settingsConfig, null, 2),
      meta,
      presetId: activePreset?.id,
      presetCategory: activePreset?.category,
      isPartner: activePreset?.isPartner,
      partnerPromotionKey: activePreset?.partnerPromotionKey,
    });
  };

  const renderActionButtons = (onAdd: () => void, addLabel: string) => (
    <div className="flex gap-1">
      {!usesManagedOAuth && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleFetchModels}
          disabled={isFetchingModels}
          className="h-7 gap-1"
        >
          {isFetchingModels ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {t("providerForm.fetchModels", { defaultValue: "获取模型" })}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="h-7 gap-1"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );

  return (
    <Form {...form}>
      <form
        id="provider-form"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
      >
        {!initialData && (
          <ProviderPresetSelector
            selectedPresetId={selectedPresetId}
            presetEntries={presetEntries}
            presetCategoryLabels={presetCategoryLabels}
            onPresetChange={handlePresetChange}
            category={activePreset?.category}
          />
        )}

        {showEnterprisePrefill && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {t("providerForm.enterprisePrefill.hint", {
                defaultValue:
                  "已按上次填写回填私有部署地址（Base URL）。API Key 需你自己填。",
              })}
            </span>
            {hasStoredEnterpriseKey &&
              (enterpriseKeyFilled ? (
                <span className="shrink-0 text-primary">
                  {t("providerForm.enterprisePrefill.keyFilled", {
                    defaultValue: "已填入上次的 Key",
                  })}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() =>
                    selectedPresetEntry &&
                    applyDesktopPreset(selectedPresetEntry.preset, {
                      fillEnterpriseKey: true,
                    })
                  }
                >
                  {t("providerForm.enterprisePrefill.fillKey", {
                    defaultValue: "填入上次的 Key",
                  })}
                </Button>
              ))}
          </div>
        )}

        <BasicFormFields form={form} />

        {isOfficial && (
          <div className="rounded-lg border border-border-default bg-muted/20 p-3 text-sm text-muted-foreground">
            {t("claudeDesktop.officialNotice", {
              defaultValue:
                "Claude Desktop 官方供应商使用应用内置的 1P 登录，无需配置 API Key 和接口地址。",
            })}
          </div>
        )}

        {!isOfficial && (
          <>
            {usesManagedOAuth ? (
              <div className="rounded-lg border border-border-default bg-muted/20 p-3">
                {activeProviderType === "github_copilot" ? (
                  <CopilotAuthSection
                    selectedAccountId={selectedGitHubAccountId}
                    onAccountSelect={setSelectedGitHubAccountId}
                  />
                ) : (
                  <CodexOAuthSection
                    selectedAccountId={selectedCodexAccountId}
                    onAccountSelect={setSelectedCodexAccountId}
                    fastModeEnabled={codexFastMode}
                    onFastModeChange={setCodexFastMode}
                  />
                )}
              </div>
            ) : (
              <ApiKeySection
                value={apiKey}
                onChange={(value) => {
                  setApiKey(value);
                  setEnterpriseKeyFilled(false);
                }}
                category={apiKeyLinkCategory}
                shouldShowLink={shouldShowApiKeyLink}
                websiteUrl={apiKeyLinkWebsiteUrl}
                isPartner={apiKeyLinkIsPartner}
                partnerPromotionKey={apiKeyLinkPromotionKey}
                onGetApiKey={
                  usesEnterpriseAuthorization
                    ? () =>
                        void enterpriseAuthorization.start(
                          normalizeAi302RootUrl(baseUrl),
                        )
                    : undefined
                }
                getApiKeyDisabled={enterpriseAuthorization.status === "waiting"}
              />
            )}

            {usesEnterpriseAuthorization &&
              enterpriseAuthorization.status !== "idle" &&
              enterpriseAuthorization.status !== "waiting" && (
                <p className="text-sm text-destructive">
                  {enterpriseAuthorization.status === "pageUnavailable"
                    ? t("onboarding.authorizationPageUnavailable", {
                        defaultValue: "授权页面无法访问，请检查地址和网络",
                      })
                    : enterpriseAuthorization.status === "cancelled"
                      ? t("onboarding.authorizationCancelled", {
                          defaultValue: "已取消获取 API Key",
                        })
                      : enterpriseAuthorization.status === "stateMismatch"
                        ? t("onboarding.authorizationStateMismatch", {
                            defaultValue: "授权状态不匹配，请重新获取",
                          })
                        : t("onboarding.authorizationInvalidCallback", {
                            defaultValue: "授权返回内容无效，请重新获取",
                          })}
                </p>
              )}

            <EndpointField
              id="baseUrl"
              label={t("providerForm.apiEndpoint")}
              value={baseUrl}
              onChange={(v) => setBaseUrl(v)}
              placeholder={t("providerForm.apiEndpointPlaceholder")}
              hint={
                usesLocalRoute && apiFormat === "openai_responses"
                  ? t("providerForm.apiHintResponses")
                  : usesLocalRoute && apiFormat === "openai_chat"
                    ? t("providerForm.apiHintOAI")
                    : usesLocalRoute && apiFormat === "gemini_native"
                      ? t("providerForm.apiHintGeminiNative")
                      : t("providerForm.apiHint")
              }
              showManageButton={false}
            />

            <div className="space-y-2 rounded-lg border border-border-default bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Network className="h-4 w-4 text-muted-foreground" />
                {t("claudeDesktop.connectionPreviewTitle", {
                  defaultValue: "连接预览",
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md border bg-background px-2 py-1 text-foreground">
                  Claude Desktop
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
                {usesLocalRoute && (
                  <>
                    <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-800 dark:text-sky-200">
                      {t("claudeDesktop.localRouteNode", {
                        defaultValue: "302 Switch 本地路由",
                      })}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
                <span className="max-w-full truncate rounded-md border bg-background px-2 py-1 font-mono text-foreground">
                  {baseUrl.trim() ||
                    t("claudeDesktop.upstreamEndpointPending", {
                      defaultValue: "等待填写上游地址",
                    })}
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border-default bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label>
                    {t("claudeDesktop.localRouteToggle", {
                      defaultValue: "通过 302 Switch 本地路由",
                    })}
                  </Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {publicHttpRequiresLocalRoute
                      ? t("claudeDesktop.publicHttpAutoRouteHint", {
                          defaultValue:
                            "检测到非本机 HTTP 地址。Claude Desktop 不允许直接访问，已自动使用本地路由。供应商地址仍保持不变。",
                        })
                      : usesLocalRoute
                        ? t("claudeDesktop.localRouteOnHint", {
                            defaultValue:
                              "Claude Desktop 会先连接 302 Switch，再由当前 Claude Desktop 供应商访问上游；模型映射和格式转换也在这里完成。",
                          })
                        : t("claudeDesktop.localRouteOffHint", {
                            defaultValue:
                              "Claude Desktop 将直接连接上游。仅适用于可公开访问的 HTTPS Anthropic 接口和 Claude Desktop 可识别的模型名。",
                          })}
                  </p>
                </div>
                <Switch
                  checked={usesLocalRoute}
                  onCheckedChange={handleLocalRouteChange}
                  disabled={publicHttpRequiresLocalRoute}
                  aria-label={t("claudeDesktop.localRouteToggle", {
                    defaultValue: "通过 302 Switch 本地路由",
                  })}
                />
              </div>

              {usesLocalRoute && (
                <div className="space-y-2 border-t border-border-default pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="claude-desktop-gateway-token">
                      {t("claudeDesktop.gatewayTokenLabel", {
                        defaultValue: "内部 Gateway Token",
                      })}
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      onClick={handleResyncGatewayToken}
                      disabled={!canResyncGatewayToken || isSyncingGatewayToken}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          isSyncingGatewayToken ? "animate-spin" : ""
                        }`}
                      />
                      {t("claudeDesktop.gatewayTokenResync", {
                        defaultValue: "重新同步",
                      })}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="claude-desktop-gateway-token"
                      type={showGatewayToken ? "text" : "password"}
                      value={gatewayToken}
                      readOnly
                      placeholder={
                        isGatewayTokenLoading
                          ? t("common.loading", { defaultValue: "加载中..." })
                          : ""
                      }
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowGatewayToken((visible) => !visible)}
                      disabled={!gatewayToken}
                      aria-label={t(
                        showGatewayToken
                          ? "claudeDesktop.gatewayTokenHide"
                          : "claudeDesktop.gatewayTokenShow",
                        {
                          defaultValue: showGatewayToken
                            ? "隐藏内部 Token"
                            : "显示内部 Token",
                        },
                      )}
                    >
                      {showGatewayToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleCopyGatewayToken}
                      disabled={!gatewayToken}
                      aria-label={t("claudeDesktop.gatewayTokenCopy", {
                        defaultValue: "复制内部 Token",
                      })}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {canResyncGatewayToken
                      ? t("claudeDesktop.gatewayTokenHint", {
                          defaultValue:
                            "该 Token 用于 Claude Desktop 连接本机 Gateway。重新同步后请重启 Claude Desktop。",
                        })
                      : t("claudeDesktop.gatewayTokenInactiveHint", {
                          defaultValue:
                            "该 Token 由所有 Claude Desktop 本地路由供应商共用。保存并切换到此供应商后可以重新同步。",
                        })}
                  </p>
                </div>
              )}
            </div>

            {usesLocalRoute && (
              <div className="space-y-4 rounded-lg border border-border-default p-4">
                <div className="space-y-2">
                  <Label>
                    {t("providerForm.apiFormat", { defaultValue: "API 格式" })}
                  </Label>
                  <Select
                    value={apiFormat}
                    onValueChange={(value) =>
                      setApiFormat(value as ClaudeApiFormat)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anthropic">
                        {t("providerForm.apiFormatAnthropic", {
                          defaultValue: "Anthropic Messages (原生)",
                        })}
                      </SelectItem>
                      <SelectItem value="openai_chat">
                        {t("providerForm.apiFormatOpenAIChat", {
                          defaultValue: "OpenAI Chat Completions (需开启路由)",
                        })}
                      </SelectItem>
                      <SelectItem value="openai_responses">
                        {t("providerForm.apiFormatOpenAIResponses", {
                          defaultValue: "OpenAI Responses API (需开启路由)",
                        })}
                      </SelectItem>
                      <SelectItem value="gemini_native">
                        {t("providerForm.apiFormatGeminiNative", {
                          defaultValue:
                            "Gemini Native generateContent (需开启路由)",
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1 border-t border-border-default pt-4">
                    <div className="flex items-center justify-between">
                      <Label>
                        {t("claudeDesktop.routeMapTitle", {
                          defaultValue: "模型映射",
                        })}
                      </Label>
                      {!usesManagedOAuth && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleFetchModels}
                          disabled={isFetchingModels}
                          className="h-7 gap-1"
                        >
                          {isFetchingModels ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          {t("providerForm.fetchModels", {
                            defaultValue: "获取模型",
                          })}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("claudeDesktop.routeMapHint", {
                        defaultValue:
                          "为 Sonnet、Opus、Haiku 三档分别填写实际请求模型；菜单显示名可写 DeepSeek、Kimi 等品牌名。留空的档会自动沿用 Sonnet（或第一个已填档）的模型，确保子 agent 调用的 Haiku 始终可用。",
                      })}
                    </p>
                  </div>

                  <div className="hidden grid-cols-[140px_1fr_1fr_116px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                    <span>
                      {t("claudeDesktop.routeModelLabel", {
                        defaultValue: "模型角色",
                      })}
                    </span>
                    <span>
                      {t("claudeDesktop.labelOverrideLabel", {
                        defaultValue: "菜单显示名",
                      })}
                    </span>
                    <span>
                      {t("claudeDesktop.upstreamModelLabel", {
                        defaultValue: "实际请求模型",
                      })}
                    </span>
                    <span>
                      {t("claudeDesktop.supports1mLabel", {
                        defaultValue: "声明支持 1M",
                      })}
                    </span>
                  </div>
                  {routes.map((route, index) => {
                    const role = routeRoleFromId(route.route);
                    const roleLabel =
                      role === "opus"
                        ? t("claudeDesktop.routeRoleOpus", {
                            defaultValue: "Opus",
                          })
                        : role === "haiku"
                          ? t("claudeDesktop.routeRoleHaiku", {
                              defaultValue: "Haiku",
                            })
                          : role === "fable"
                            ? t("claudeDesktop.routeRoleFable", {
                                defaultValue: "Fable",
                              })
                            : t("claudeDesktop.routeRoleSonnet", {
                                defaultValue: "Sonnet",
                              });
                    // Haiku 档示范映射到轻量模型（flash），其余档映射到 pro；
                    // 两列占位联动，保持每行「菜单显示名 ↔ 实际请求模型」品牌一致。
                    const isHaikuRole = role === "haiku";
                    const labelPlaceholder = isHaikuRole
                      ? "DeepSeek V4 Flash"
                      : "DeepSeek V4 Pro";
                    const modelPlaceholder = isHaikuRole
                      ? "deepseek-v4-flash"
                      : "deepseek-v4-pro";
                    return (
                      <div
                        key={route.rowId}
                        className="grid grid-cols-1 gap-2 md:grid-cols-[140px_1fr_1fr_116px]"
                      >
                        <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                          {roleLabel}
                        </div>
                        <Input
                          value={route.labelOverride}
                          onChange={(event) =>
                            updateRoute(index, {
                              labelOverride: event.target.value,
                            })
                          }
                          placeholder={labelPlaceholder}
                        />
                        <div className="flex gap-1">
                          <Input
                            value={route.model}
                            onChange={(event) =>
                              updateRoute(index, { model: event.target.value })
                            }
                            placeholder={modelPlaceholder}
                            className="flex-1"
                          />
                          {fetchedModels.length > 0 && (
                            <ModelDropdown
                              models={fetchedModels}
                              onSelect={(id) =>
                                updateRoute(index, {
                                  model: id,
                                  labelOverride: route.labelOverride || id,
                                })
                              }
                            />
                          )}
                        </div>
                        <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox
                            checked={route.supports1m}
                            onCheckedChange={(checked) =>
                              updateRoute(index, {
                                supports1m: checked === true,
                              })
                            }
                          />
                          {t("claudeDesktop.supports1mShort", {
                            defaultValue: "1M",
                          })}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!usesLocalRoute && (
              <Collapsible
                open={directModelsExpanded}
                onOpenChange={setDirectModelsExpanded}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant={null}
                    size="sm"
                    className="h-8 gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
                  >
                    {directModelsExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {t("claudeDesktop.directModelListTitle", {
                      defaultValue:
                        "手动指定 Claude Desktop 模型列表（高级，可选）",
                    })}
                  </Button>
                </CollapsibleTrigger>
                {!directModelsExpanded && (
                  <p className="ml-1 mt-1 text-xs text-muted-foreground">
                    {t("claudeDesktop.directModelListCollapsedHint", {
                      defaultValue:
                        "原生 Claude 模型供应商通常不用填写，Claude Desktop 会自动读取 /v1/models。",
                    })}
                  </p>
                )}
                <CollapsibleContent className="space-y-4 pt-2">
                  <div className="space-y-4 rounded-lg border border-border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                        {t("claudeDesktop.directModelListHint", {
                          defaultValue:
                            "仅当供应商的 /v1/models 不可用或没有返回 Claude Desktop 可识别的 Sonnet / Opus / Haiku 模型名时填写；勾选 1M 会向 Claude Desktop 声明支持 1M 上下文。",
                        })}
                      </p>
                      {renderActionButtons(
                        () =>
                          setRoutes((current) => [
                            ...current,
                            createRouteRow({
                              route: "",
                              model: "",
                              labelOverride: "",
                              supports1m: false,
                            }),
                          ]),
                        t("claudeDesktop.addModel", {
                          defaultValue: "添加模型",
                        }),
                      )}
                    </div>

                    {routes.length > 0 ? (
                      <div className="space-y-2">
                        {routes.map((route, index) => (
                          <div
                            key={route.rowId}
                            className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_116px_36px]"
                          >
                            <div className="flex gap-1">
                              <Input
                                value={route.route}
                                onChange={(event) =>
                                  updateRoute(index, {
                                    route: event.target.value,
                                  })
                                }
                                placeholder="claude-sonnet-4-6"
                                className="flex-1"
                              />
                              {fetchedModels.length > 0 && (
                                <ModelDropdown
                                  models={fetchedModels}
                                  onSelect={(id) =>
                                    updateRoute(index, { route: id })
                                  }
                                />
                              )}
                            </div>
                            <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                              <Checkbox
                                checked={route.supports1m}
                                onCheckedChange={(checked) =>
                                  updateRoute(index, {
                                    supports1m: checked === true,
                                  })
                                }
                              />
                              {t("claudeDesktop.supports1mShort", {
                                defaultValue: "1M",
                              })}
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setRoutes((current) =>
                                  current.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <FormField
              control={form.control}
              name="settingsConfig"
              render={() => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <input type="hidden" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {showButtons && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
