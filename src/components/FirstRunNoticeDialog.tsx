import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Cloud,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import ApiKeyInput from "@/components/providers/forms/ApiKeyInput";
import { ProviderIcon } from "@/components/ProviderIcon";
import { useSettingsQuery } from "@/lib/query";
import { providersApi, settingsApi } from "@/lib/api";
import type { EnterpriseProfile } from "@/lib/api";
import {
  CLAUDE_DESKTOP_ROLE_ROUTE_IDS,
  claudeDesktopProviderPresets,
} from "@/config/claudeDesktopProviderPresets";
import { generateUUID } from "@/utils/uuid";
import { requiresClaudeDesktopLocalRoute } from "@/utils/claudeDesktopConnection";
import { fetchModelsForConfig, probeChatKey } from "@/lib/api/model-fetch";
import { streamCheckProvider } from "@/lib/api/model-test";
import {
  AI302_API_KEY_URL,
  AI302_ONBOARDING_APPS,
  type Ai302OnboardingApp,
  type Ai302Region,
  detectAi302ApiKeyLabel,
  detectAi302BrandName,
  getAi302ModelStrategy,
  getAi302RegionBaseUrl,
  getAi302SeedId,
  isAi302SeedProvider,
  isValidAi302BaseUrl,
  normalizeAi302RootUrl,
  readAi302ApiKey,
  writeAi302ApiKey,
  writeAi302BaseUrl,
} from "@/config/ai302";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import type { Provider } from "@/types";
import { cn } from "@/lib/utils";
import { useEnterpriseApiKeyAuthorization } from "@/hooks/useEnterpriseApiKeyAuthorization";

type ToolState = "idle" | "checking" | "installed" | "missing" | "broken";
type VerifyState = "idle" | "checking" | "ok" | "error";
type ModelMode = "follow" | "fixed";

interface ToolResult {
  state: ToolState;
  version?: string;
  error?: string;
}

interface ConfigureResult {
  appId: Ai302OnboardingApp;
  success: boolean;
  reachable: boolean;
  error?: string;
}

const APP_DETAILS: Record<
  Ai302OnboardingApp,
  { name: string; icon: string; configLabel: string }
> = {
  claude: {
    name: "Claude Code",
    icon: "anthropic",
    configLabel: "~/.claude/settings.json",
  },
  codex: {
    name: "Codex",
    icon: "openai",
    configLabel: "~/.codex/config.toml",
  },
  gemini: {
    name: "Gemini CLI",
    icon: "gemini",
    configLabel: "~/.gemini/.env",
  },
};

// 检测不到 CLI 时给一条能直接复制粘贴的安装命令——下载这个 app 的小白
// 八成还没装工具，光标一句"未检测到"就是死胡同。命令与 AboutSection 里那份
// 一键安装清单保持一致（纯 npm，跨平台都能跑）。
const APP_INSTALL_COMMANDS: Record<Ai302OnboardingApp, string> = {
  claude: "npm i -g @anthropic-ai/claude-code@latest",
  codex: "npm i -g @openai/codex@latest",
  gemini: "npm i -g @google/gemini-cli@latest",
};

// 配完之后在终端里真正跑起来的命令——完成页照着念给用户即可。
const APP_LAUNCH_COMMANDS: Record<Ai302OnboardingApp, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

const INITIAL_TOOLS: Record<Ai302OnboardingApp, ToolResult> = {
  claude: { state: "idle" },
  codex: { state: "idle" },
  gemini: { state: "idle" },
};

const INITIAL_SELECTION: Record<Ai302OnboardingApp, boolean> = {
  claude: false,
  codex: false,
  gemini: false,
};

const INITIAL_FIXED_MODELS = {
  sonnet: "",
  opus: "",
  fable: "",
  haiku: "",
};

// 引导页展示的"默认模型 / 接口地址"来自 302.AI 预设本身，而不是写死的字符串——
// 这样预设改了默认模型或地址后，这两处展示会跟着变，不会悄悄显示过期信息。
const AI302_CODEX_PRESET = codexProviderPresets.find(
  (preset) => preset.name === "302.AI",
);
const AI302_GEMINI_PRESET = geminiProviderPresets.find(
  (preset) => preset.name === "302.AI",
);

function ai302OnboardingDefaultModel(appId: Ai302OnboardingApp): string {
  if (appId === "codex" && AI302_CODEX_PRESET) {
    const strategy = getAi302ModelStrategy("codex", {
      auth: AI302_CODEX_PRESET.auth,
      config: AI302_CODEX_PRESET.config,
    });
    return strategy.mappings[0]?.model ?? "";
  }
  if (appId === "gemini" && AI302_GEMINI_PRESET) {
    const strategy = getAi302ModelStrategy(
      "gemini",
      AI302_GEMINI_PRESET.settingsConfig as Record<string, unknown>,
    );
    return strategy.mappings[0]?.model ?? "";
  }
  return "";
}

// Codex 的 302.AI 接口地址在 TOML 里带 /v1 后缀，Claude/Gemini 直接用根域名——
// 用来在"技术详情"里如实展示写入内容，不管当前选的是国内/海外/企业自定义地址。
function ai302DisplayBaseUrl(appId: Ai302OnboardingApp, root: string): string {
  return appId === "codex" ? `${root}/v1` : root;
}

// 用系统时区猜一个默认接入节点，猜错了用户自己在下一行切换即可，
// 目标只是让大多数人 0 次点击就落在对的选项上。
function guessDefaultRegion(): Ai302Region {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (
      timeZone === "Asia/Shanghai" ||
      timeZone === "Asia/Chongqing" ||
      timeZone === "Asia/Urumqi" ||
      timeZone === "Asia/Harbin"
    ) {
      return "cn";
    }
  } catch {
    // Intl 不可用时（几乎不会发生）退回海外默认值
  }
  return "global";
}

// 企业私有化跟 302 公共接口无关，必须是"另起的一张独立卡"，绝不能改写 302 国内/海外
// 种子。按官网链接（= 私有根地址）定位已建过的企业卡，做到：引导重跑 / 一键诊断不会
// 重复建卡，也不会误碰 302 那两张。排除 302 种子与官方卡（它们的 websiteUrl 不是私有地址）。
function findEnterpriseProvider(
  providers: Record<string, Provider>,
  root: string,
): Provider | undefined {
  return Object.values(providers).find(
    (p) =>
      p.websiteUrl === root &&
      !isAi302SeedProvider(p) &&
      p.category !== "official",
  );
}

// 企业卡的显示名字，方便用户以后在供应商卡片上认出"这是我司自己的部署"，
// 而不是误以为还连着 302.AI 公共接口。
function enterpriseProviderLabel(root: string): string {
  try {
    return `302.AI（企业版 · ${new URL(root).host}）`;
  } catch {
    return "302.AI（企业版）";
  }
}

// 公共版的标准名字，和后端种子（providers_seed.rs）里写死的一致——
// 切回公共版时要用它覆盖掉可能残留的企业版名字，不能假设 provider.name 还是原样。
function ai302RegionProviderLabel(region: Ai302Region): string {
  return region === "cn" ? "302.AI（国内）" : "302.AI（海外）";
}

// Claude Desktop 没有 CLI 可检测，引导也不覆盖它。企业版用户填完私有地址后，
// 这里照 CD 表单落库那套结构自动建卡；非本机 HTTP 地址使用本地路由，其他地址
// 保持直连。routeMap 走 sonnet/opus/haiku 透传，与 claudeDesktopProviderPresets
// 里 302.AI 那条的 passthroughRoutes() 一致。
export function buildClaudeDesktopEnterpriseProvider(
  root: string,
  key: string,
): Provider {
  const preset = claudeDesktopProviderPresets.find(
    (p) => p.nameKey === "providerPreset.enterprise",
  );
  const roles = CLAUDE_DESKTOP_ROLE_ROUTE_IDS;
  const modelRoutes: Record<string, { model: string }> = {};
  for (const routeId of [roles.sonnet, roles.opus, roles.haiku]) {
    modelRoutes[routeId] = { model: routeId };
  }
  return {
    id: generateUUID(),
    name: enterpriseProviderLabel(root),
    websiteUrl: root,
    category: "third_party",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: root,
        ANTHROPIC_AUTH_TOKEN: key,
      },
    },
    meta: {
      claudeDesktopMode: requiresClaudeDesktopLocalRoute(root)
        ? "proxy"
        : "direct",
      apiFormat: "anthropic",
      claudeDesktopModelRoutes: modelRoutes,
    },
    icon: preset?.icon ?? "ai302",
    iconColor: preset?.iconColor ?? "#7C3AED",
  };
}

// 引导「企业版」收尾：把这次填的私有地址 + key 存成企业档案，并给 Claude Desktop
// 补一张等价卡。两步都是「有则跳过、错则吞掉」——引导主流程（配置 Claude/Codex/
// Gemini）已经成功了，这里是锦上添花，绝不能因为它抛错把用户卡在引导最后一步。
async function finalizeEnterpriseOnboarding(
  root: string,
  key: string,
  brand: string | null,
): Promise<void> {
  const trimmedKey = key.trim();
  const profile: EnterpriseProfile = {
    baseUrl: root,
    brandName: brand ?? undefined,
    apiKey: trimmedKey || undefined,
  };
  try {
    await settingsApi.setEnterpriseProfile(profile);
  } catch (error) {
    console.error("[Onboarding] Failed to persist enterprise profile", error);
  }

  // Claude Desktop 自动建卡：只让卡片出现在列表里，不激活、不写 live。
  // 两道闸门：
  // 1) 同地址已存在 → 幂等跳过。
  // 2) CD 必须已有「当前供应商」再建——否则后端 add() 的 "current is none" 分支会
  //    把这张卡设成 current 并写 live（对 CD 是 addToLive 管不到的独占写入）。启动
  //    编排（migrate_default_to_ai302_domestic）正常会给 CD 落一个默认 current，
  //    这里只是兜底，避免极端状态下悄悄激活了用户没选过的私有部署。
  try {
    const [existing, current] = await Promise.all([
      providersApi.getAll("claude-desktop"),
      providersApi.getCurrent("claude-desktop").catch(() => ""),
    ]);
    const already = Object.values(existing).some(
      (p) =>
        (p.settingsConfig?.env as Record<string, unknown> | undefined)?.[
          "ANTHROPIC_BASE_URL"
        ] === root,
    );
    if (!already && current) {
      const provider = buildClaudeDesktopEnterpriseProvider(root, trimmedKey);
      await providersApi.add(provider, "claude-desktop", false);
    }
  } catch (error) {
    console.error(
      "[Onboarding] Failed to seed Claude Desktop enterprise provider",
      error,
    );
  }
}

function applyClaudeModelMode(
  config: Record<string, unknown>,
  mode: ModelMode,
  models: typeof INITIAL_FIXED_MODELS,
): Record<string, unknown> {
  const env = { ...((config.env ?? {}) as Record<string, unknown>) };
  const fields = {
    sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
    opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
    fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
    haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  } as const;

  for (const field of Object.values(fields)) delete env[field];
  if (mode === "fixed") {
    for (const [role, field] of Object.entries(fields) as Array<
      [keyof typeof fields, (typeof fields)[keyof typeof fields]]
    >) {
      const model = models[role].trim();
      if (model) env[field] = model;
    }
  }
  return { ...config, env };
}

/** 首次运行配置向导，仅在全新安装且用户尚未确认时展示。 */
export function FirstRunNoticeDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const isOpen = settings != null && settings.firstRunNoticeConfirmed !== true;

  const [step, setStep] = useState(0);
  const [edition, setEdition] = useState<"public" | "enterprise">("public");
  const [region, setRegion] = useState<Ai302Region>(guessDefaultRegion);
  const [enterpriseUrl, setEnterpriseUrl] = useState("");
  const [tools, setTools] = useState(INITIAL_TOOLS);
  const [selection, setSelection] = useState(INITIAL_SELECTION);
  const [detectionStarted, setDetectionStarted] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [modelCount, setModelCount] = useState(0);
  // 走了 chat 探活兜底（/models 没开、靠对话接口确认 key）时置真，成功文案改口。
  const [verifiedViaChat, setVerifiedViaChat] = useState(false);
  const [modelMode, setModelMode] = useState<ModelMode>("follow");
  const [fixedModels, setFixedModels] = useState(INITIAL_FIXED_MODELS);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [configureResults, setConfigureResults] = useState<ConfigureResult[]>(
    [],
  );
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const verificationGeneration = useRef(0);

  const selectedApps = useMemo(
    () => AI302_ONBOARDING_APPS.filter((appId) => selection[appId]),
    [selection],
  );

  const fixedModeValid =
    modelMode === "follow" ||
    Object.values(fixedModels).some((model) => model.trim());

  const enterpriseUrlTrimmed = enterpriseUrl.trim();
  const enterpriseUrlValid =
    enterpriseUrlTrimmed !== "" && isValidAi302BaseUrl(enterpriseUrlTrimmed);

  // 当前生效的根地址：公共版按区域取标准节点，企业版取用户自己填的地址。
  const resolvedBaseUrlRoot = useMemo(
    () =>
      edition === "enterprise"
        ? normalizeAi302RootUrl(enterpriseUrl)
        : getAi302RegionBaseUrl(region),
    [edition, region, enterpriseUrl],
  );

  // 地址一变（改企业地址、切国内/海外），之前"验证通过"的结论就不作数了——
  // 否则从 step3 退回 step1 改完地址再前进，会拿着旧的 verifyState==="ok" 跳过重新验证。
  useEffect(() => {
    verificationGeneration.current += 1;
    setVerifyState("idle");
    setVerifyError("");
    setVerifiedViaChat(false);
  }, [resolvedBaseUrlRoot]);

  const resetWizardState = useCallback(() => {
    verificationGeneration.current += 1;
    setStep(0);
    setEdition("public");
    setRegion(guessDefaultRegion());
    setEnterpriseUrl("");
    setTools(INITIAL_TOOLS);
    setSelection(INITIAL_SELECTION);
    setDetectionStarted(false);
    setApiKey("");
    setVerifyState("idle");
    setVerifyError("");
    setModelCount(0);
    setVerifiedViaChat(false);
    setModelMode("follow");
    setFixedModels(INITIAL_FIXED_MODELS);
    setIsConfiguring(false);
    setConfigureResults([]);
    setIsDiagnosing(false);
  }, []);

  useEffect(() => {
    if (isOpen) resetWizardState();
  }, [isOpen, resetWizardState]);

  const saveCompletion = useCallback(async () => {
    if (!settings) return;
    const { webdavSync: _, ...rest } = settings;
    await settingsApi.save({ ...rest, firstRunNoticeConfirmed: true });
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  }, [queryClient, settings]);

  const detectTools = useCallback(async () => {
    setDetectionStarted(true);
    setTools({
      claude: { state: "checking" },
      codex: { state: "checking" },
      gemini: { state: "checking" },
    });
    try {
      const batches = await Promise.all(
        AI302_ONBOARDING_APPS.map((appId) =>
          settingsApi.getToolVersions([appId]),
        ),
      );
      const nextTools = { ...INITIAL_TOOLS };
      const nextSelection = { ...INITIAL_SELECTION };
      AI302_ONBOARDING_APPS.forEach((appId, index) => {
        const result = batches[index][0];
        if (result?.version) {
          nextTools[appId] = {
            state: "installed",
            version: result.version,
          };
          nextSelection[appId] = true;
        } else if (result?.installed_but_broken) {
          nextTools[appId] = {
            state: "broken",
            error: result.error ?? undefined,
          };
        } else {
          nextTools[appId] = {
            state: "missing",
            error: result?.error ?? undefined,
          };
        }
      });
      setTools(nextTools);
      setSelection((current) =>
        Object.values(current).some(Boolean) ? current : nextSelection,
      );
    } catch (error) {
      const message = String(error);
      setTools({
        claude: { state: "broken", error: message },
        codex: { state: "broken", error: message },
        gemini: { state: "broken", error: message },
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen && step === 2 && !detectionStarted) void detectTools();
  }, [detectTools, detectionStarted, isOpen, step]);

  const verifyKey = useCallback(
    async (returnedKey?: string): Promise<boolean> => {
      const key = (returnedKey ?? apiKey).trim();
      const generation = verificationGeneration.current;
      if (!key) {
        setVerifyState("error");
        setVerifyError(
          t("onboarding.keyRequired", { defaultValue: "请先填写 API Key" }),
        );
        return false;
      }
      setVerifyState("checking");
      setVerifyError("");
      try {
        const models = await fetchModelsForConfig(resolvedBaseUrlRoot, key);
        if (generation !== verificationGeneration.current) return false;
        setModelCount(models.length);
        setVerifiedViaChat(false);
        setVerifyState("ok");
        return true;
      } catch (error) {
        if (generation !== verificationGeneration.current) return false;
        const message = String(error);
        const authFailed = message.includes("401") || message.includes("403");

        // 企业私有化 / 自签中转网关常不开放 GET /v1/models，401/403 未必是 key 坏。
        // 降级用 POST /chat/completions 探活确认：真过了就判通过（详见 probe_chat_key）。
        if (authFailed && edition === "enterprise") {
          try {
            const probe = await probeChatKey(resolvedBaseUrlRoot, key);
            if (generation !== verificationGeneration.current) return false;
            if (probe.outcome === "ok") {
              setVerifiedViaChat(true);
              setVerifyState("ok");
              return true;
            }
            if (probe.outcome === "unreachable") {
              setVerifyError(
                t("onboarding.keyNetworkErrorEnterprise", {
                  defaultValue: "无法连接该地址，请检查 Base URL 是否正确",
                }),
              );
              setVerifyState("error");
              return false;
            }
            // outcome === "authFailed" → 确实是 key 坏，落到下面统一提示
          } catch {
            // 探活命令本身异常：退回按 /models 的原始结论提示，不吞错
          }
        }

        if (generation !== verificationGeneration.current) return false;
        setVerifyError(
          authFailed
            ? t("onboarding.keyInvalid", {
                defaultValue: "Key 无效或没有访问权限",
              })
            : edition === "enterprise"
              ? t("onboarding.keyNetworkErrorEnterprise", {
                  defaultValue: "无法连接该地址，请检查 Base URL 是否正确",
                })
              : t("onboarding.keyNetworkError", {
                  defaultValue: "无法连接 302.AI，请检查网络后重试",
                }),
        );
        setVerifyState("error");
        return false;
      }
    },
    [apiKey, edition, resolvedBaseUrlRoot, t],
  );

  const handleAuthorizedKey = useCallback(
    (key: string) => {
      verificationGeneration.current += 1;
      setApiKey(key);
      setVerifyError("");
      void verifyKey(key);
    },
    [verifyKey],
  );
  const enterpriseAuthorization = useEnterpriseApiKeyAuthorization(
    "onboarding",
    handleAuthorizedKey,
  );
  useEffect(() => {
    if (!isOpen || edition !== "enterprise") {
      enterpriseAuthorization.discard();
    }
  }, [edition, enterpriseAuthorization.discard, isOpen]);

  const configureApp = useCallback(
    async (appId: Ai302OnboardingApp): Promise<ConfigureResult> => {
      try {
        const providers = await providersApi.getAll(appId);

        // 计算本 app 要落库的 settingsConfig：以某张 302 种子的"配置形状"为模板
        // （claude 走 env、codex 走 TOML+/v1、gemini 走 env），写入 key + 地址。
        const buildConfig = (template: Provider): Record<string, unknown> => {
          let config = writeAi302ApiKey(
            appId,
            template.settingsConfig as Record<string, unknown>,
            apiKey.trim(),
          );
          config = writeAi302BaseUrl(appId, config, resolvedBaseUrlRoot);
          if (appId === "claude") {
            config = applyClaudeModelMode(config, modelMode, fixedModels);
          }
          return config;
        };

        if (edition === "enterprise") {
          // 企业版：用海外种子当"形状模板"，建/更一张独立企业卡，绝不改写 302 种子。
          const template = providers[getAi302SeedId(appId, "global")];
          if (!template) {
            throw new Error(
              t("onboarding.presetMissing", {
                app: APP_DETAILS[appId].name,
                defaultValue: `${APP_DETAILS[appId].name} 的 302.AI 预设不存在`,
              }),
            );
          }
          const settingsConfig = buildConfig(template);
          const existing = findEnterpriseProvider(
            providers,
            resolvedBaseUrlRoot,
          );
          const enterprise: Provider = {
            ...(existing ?? {}),
            id: existing?.id ?? generateUUID(),
            name: enterpriseProviderLabel(resolvedBaseUrlRoot),
            websiteUrl: resolvedBaseUrlRoot,
            category: "third_party",
            settingsConfig,
            icon: existing?.icon ?? template.icon,
            iconColor: existing?.iconColor ?? template.iconColor,
          } as Provider;

          if (existing) {
            await providersApi.update(enterprise, appId, existing.id);
          } else {
            await providersApi.add(enterprise, appId, false);
          }
          await providersApi.switch(enterprise.id, appId);

          let reachable = false;
          try {
            const check = await streamCheckProvider(appId, enterprise.id);
            reachable = check.status !== "failed";
          } catch {
            reachable = false;
          }
          return { appId, success: true, reachable };
        }

        // 公共版：把选中区域（国内/海外）的 302 种子填上 key + 地址，另一张原样保留。
        const provider = providers[getAi302SeedId(appId, region)];
        if (!provider) {
          throw new Error(
            t("onboarding.presetMissing", {
              app: APP_DETAILS[appId].name,
              defaultValue: `${APP_DETAILS[appId].name} 的 302.AI 预设不存在`,
            }),
          );
        }
        const updated: Provider = {
          ...provider,
          name: ai302RegionProviderLabel(region),
          websiteUrl: resolvedBaseUrlRoot,
          settingsConfig: buildConfig(provider),
        };
        await providersApi.update(updated, appId, provider.id);
        await providersApi.switch(provider.id, appId);

        let reachable = false;
        try {
          const check = await streamCheckProvider(appId, provider.id);
          reachable = check.status !== "failed";
        } catch {
          reachable = false;
        }
        return { appId, success: true, reachable };
      } catch (error) {
        return {
          appId,
          success: false,
          reachable: false,
          error: String(error),
        };
      }
    },
    [apiKey, edition, fixedModels, modelMode, region, resolvedBaseUrlRoot, t],
  );

  const configureSelectedApps = useCallback(async () => {
    if (selectedApps.length === 0 || !fixedModeValid) return;
    setIsConfiguring(true);
    try {
      const keyOk = verifyState === "ok" ? true : await verifyKey();
      if (!keyOk) {
        setStep(3);
        return;
      }
      const results = await Promise.all(selectedApps.map(configureApp));
      setConfigureResults(results);

      // 企业版收尾：记住私有档案 + 给 Claude Desktop 补卡（只在至少配成一个 app 后）。
      // 公共版则清掉可能残留的企业档案，语义同别处「切回公共版」。
      if (edition === "enterprise") {
        if (results.some((r) => r.success)) {
          await finalizeEnterpriseOnboarding(
            resolvedBaseUrlRoot,
            apiKey,
            detectAi302BrandName(resolvedBaseUrlRoot),
          );
          await queryClient.invalidateQueries({
            queryKey: ["providers", "claude-desktop"],
          });
        }
      } else {
        try {
          await settingsApi.setEnterpriseProfile(null);
        } catch (error) {
          console.error(
            "[Onboarding] Failed to clear enterprise profile",
            error,
          );
        }
      }

      await Promise.all(
        selectedApps.map((appId) =>
          queryClient.invalidateQueries({ queryKey: ["providers", appId] }),
        ),
      );
      try {
        await providersApi.updateTrayMenu();
      } catch (error) {
        console.error("[Onboarding] Failed to refresh the tray menu", error);
      }
      setStep(6);
    } finally {
      setIsConfiguring(false);
    }
  }, [
    apiKey,
    configureApp,
    edition,
    fixedModeValid,
    queryClient,
    resolvedBaseUrlRoot,
    selectedApps,
    verifyKey,
    verifyState,
  ]);

  const runDiagnosis = useCallback(async () => {
    setIsDiagnosing(true);
    try {
      await detectTools();
      await verifyKey();
      const results = await Promise.all(
        selectedApps.map(async (appId): Promise<ConfigureResult> => {
          try {
            const providers = await providersApi.getAll(appId);
            // 企业版查那张独立企业卡，公共版查选中区域的种子——和 configureApp 落库口径一致。
            const provider =
              edition === "enterprise"
                ? findEnterpriseProvider(providers, resolvedBaseUrlRoot)
                : providers[getAi302SeedId(appId, region)];
            if (!provider) {
              throw new Error(
                t("onboarding.presetMissing", {
                  app: APP_DETAILS[appId].name,
                  defaultValue: `${APP_DETAILS[appId].name} 的 302.AI 预设不存在`,
                }),
              );
            }
            if (
              readAi302ApiKey(
                appId,
                provider.settingsConfig as Record<string, unknown>,
              ) !== apiKey.trim()
            ) {
              throw new Error(
                t("onboarding.configNotApplied", {
                  defaultValue: "302.AI 配置尚未写入",
                }),
              );
            }

            let reachable = false;
            try {
              const check = await streamCheckProvider(appId, provider.id);
              reachable = check.status !== "failed";
            } catch {
              reachable = false;
            }
            return {
              appId,
              success: true,
              reachable,
            };
          } catch (error) {
            return {
              appId,
              success: false,
              reachable: false,
              error: String(error),
            };
          }
        }),
      );
      setConfigureResults(results);
    } finally {
      setIsDiagnosing(false);
    }
  }, [
    apiKey,
    detectTools,
    edition,
    region,
    resolvedBaseUrlRoot,
    selectedApps,
    t,
    verifyKey,
  ]);

  const copyInstallCommand = useCallback(
    async (command: string) => {
      try {
        await navigator.clipboard.writeText(command);
        toast.success(t("settings.installCommandsCopied"), {
          closeButton: true,
        });
      } catch {
        toast.error(t("settings.installCommandsCopyFailed"));
      }
    },
    [t],
  );

  const goBack = () => setStep((current) => Math.max(0, current - 1));
  const goNext = () => setStep((current) => Math.min(6, current + 1));
  const allConfigured =
    configureResults.length > 0 &&
    configureResults.every((result) => result.success);
  // 完成页只对"真的配成了"的客户端给出终端命令，配失败的不误导用户去跑。
  const launchableApps = useMemo(
    () =>
      configureResults
        .filter((result) => result.success)
        .map((result) => result.appId),
    [configureResults],
  );

  const enterpriseBrand =
    edition === "enterprise" ? detectAi302BrandName(resolvedBaseUrlRoot) : null;
  const keyStepTitle =
    edition === "enterprise"
      ? enterpriseBrand
        ? t("onboarding.keyTitleBrand", {
            brand: enterpriseBrand,
            defaultValue: `连接你的 ${enterpriseBrand} 账户`,
          })
        : t("onboarding.keyTitleEnterprise", {
            defaultValue: "连接你的接口账户",
          })
      : t("onboarding.keyTitle", { defaultValue: "连接你的 302.AI 账户" });

  const stepTitle = [
    t("onboarding.introTitle", { defaultValue: "一个入口，管理所有配置" }),
    t("onboarding.editionTitle", { defaultValue: "选择接入方式" }),
    t("onboarding.detectTitle", { defaultValue: "看看你正在使用哪些工具" }),
    keyStepTitle,
    t("onboarding.appsTitle", { defaultValue: "选择要接入的客户端" }),
    t("onboarding.modelsTitle", { defaultValue: "确认模型策略" }),
    allConfigured
      ? t("onboarding.doneTitle", { defaultValue: "配置已经就绪" })
      : t("onboarding.partialDoneTitle", {
          defaultValue: "检查配置结果",
        }),
  ][step];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) void saveCompletion();
      }}
    >
      <DialogContent
        className="max-w-[760px] overflow-hidden"
        zIndex="top"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-2.5">
              <ProviderIcon icon="ai302" name="302.AI" size={24} />
              {stepTitle}
            </DialogTitle>
            {step > 0 && step < 6 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {step}/5
              </span>
            )}
          </div>
          {step > 0 && step < 6 && (
            <div className="grid grid-cols-5 gap-1.5" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className={cn(
                    "h-1 rounded-full transition-colors",
                    item <= step ? "bg-primary" : "bg-muted",
                  )}
                />
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="min-h-[390px] overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="flex min-h-[350px] flex-col justify-center">
              <div className="max-w-[560px] space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold">
                    {t("onboarding.introHeading", {
                      defaultValue: "一个 Key，连接你的编码工具",
                    })}
                  </h2>
                  <DialogDescription className="max-w-[54ch] text-base leading-relaxed">
                    {t("onboarding.introBody", {
                      defaultValue:
                        "302 Switch 统一管理 Claude Code、Codex 和 Gemini CLI 的 API 配置。切换供应商时，原配置会自动保留。",
                    })}
                  </DialogDescription>
                </div>
                <div className="grid gap-3 pt-3 sm:grid-cols-[1fr_1.2fr]">
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <KeyRound className="h-5 w-5 text-primary" />
                    <div>
                      <div className="text-sm font-medium">
                        {t("onboarding.oneKey", {
                          defaultValue: "只填一次 Key",
                        })}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("onboarding.oneKeyBody", {
                          defaultValue:
                            "选择客户端后，自动写入正确的地址和认证字段。",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <Route className="h-5 w-5 text-primary" />
                    <div>
                      <div className="text-sm font-medium">
                        {t("onboarding.switchSafely", {
                          defaultValue: "多套配置，随时切换",
                        })}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("onboarding.switchSafelyBody", {
                          defaultValue:
                            "官方、302.AI 和自定义配置互不覆盖，当前模型始终可见。",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="mx-auto max-w-[560px] space-y-5 py-2">
              <DialogDescription>
                {t("onboarding.editionBody", {
                  defaultValue:
                    "告诉我们你用的是哪种 302.AI 接入方式，其余选项会自动配好。",
                })}
              </DialogDescription>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setEdition("public")}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    edition === "public"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Cloud className="h-5 w-5 text-primary" />
                    {edition === "public" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="mt-3 text-sm font-medium">
                    {t("onboarding.editionPublic", { defaultValue: "公共版" })}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.editionPublicBody", {
                      defaultValue:
                        "使用 302.AI 官方接口，地址已经配好，只需要一把 Key。",
                    })}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setEdition("enterprise")}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    edition === "enterprise"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Building2 className="h-5 w-5 text-primary" />
                    {edition === "enterprise" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="mt-3 text-sm font-medium">
                    {t("onboarding.editionEnterprise", {
                      defaultValue: "企业版（私有部署）",
                    })}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.editionEnterpriseBody", {
                      defaultValue:
                        "填入你司自己部署的接口地址，其余流程完全一致。",
                    })}
                  </p>
                </button>
              </div>

              {edition === "public" && (
                <div className="space-y-2.5 rounded-lg border border-border p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Globe className="h-4 w-4 text-primary" />
                    {t("onboarding.regionLabel", { defaultValue: "接入节点" })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRegion("cn")}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm transition-colors",
                        region === "cn"
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      {t("onboarding.regionCn", { defaultValue: "国内" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegion("global")}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm transition-colors",
                        region === "global"
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      {t("onboarding.regionGlobal", { defaultValue: "海外" })}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.regionHint", {
                      defaultValue:
                        "已根据你的系统时区自动选择，不确定就保持默认。",
                    })}
                  </p>
                </div>
              )}

              {edition === "enterprise" && (
                <div className="space-y-2">
                  <label
                    htmlFor="onboarding-enterprise-url"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t("onboarding.enterpriseUrlLabel", {
                      defaultValue: "接口地址（Base URL）",
                    })}
                  </label>
                  <Input
                    id="onboarding-enterprise-url"
                    value={enterpriseUrl}
                    onChange={(event) => setEnterpriseUrl(event.target.value)}
                    placeholder="https://your-company.302.ai"
                  />
                  {enterpriseUrlTrimmed !== "" && !enterpriseUrlValid && (
                    <p className="text-xs text-destructive">
                      {t("onboarding.enterpriseUrlInvalid", {
                        defaultValue:
                          "地址格式不对，需要以 http:// 或 https:// 开头",
                      })}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.enterpriseUrlHint", {
                      defaultValue:
                        "形如 https://your-company.302.ai，可以在企业版管理后台的「API 设置」里找到。不用加 /v1，我们会按各客户端的要求自动拼接。",
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <DialogDescription>
                {t("onboarding.detectBody", {
                  defaultValue:
                    "我们只读取本机安装状态，不会修改任何工具。未安装的客户端也可以稍后配置。",
                })}
              </DialogDescription>
              <div className="overflow-hidden rounded-lg border border-border">
                {AI302_ONBOARDING_APPS.map((appId, index) => {
                  const detail = APP_DETAILS[appId];
                  const result = tools[appId];
                  return (
                    <div
                      key={appId}
                      className={cn(
                        "flex min-h-16 items-center gap-3 px-4 py-3",
                        index > 0 && "border-t border-border",
                      )}
                    >
                      <ProviderIcon
                        icon={detail.icon}
                        name={detail.name}
                        size={22}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{detail.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {result.state === "checking"
                            ? t("onboarding.detecting", {
                                defaultValue: "正在检测",
                              })
                            : result.state === "installed"
                              ? result.version
                              : result.state === "broken"
                                ? t("onboarding.installedBroken", {
                                    defaultValue: "已安装，但暂时无法运行",
                                  })
                                : t("onboarding.notInstalled", {
                                    defaultValue: "未检测到",
                                  })}
                        </div>
                        {(result.state === "missing" ||
                          result.state === "broken") && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                              {APP_INSTALL_COMMANDS[appId]}
                            </code>
                            <button
                              type="button"
                              onClick={() =>
                                void copyInstallCommand(
                                  APP_INSTALL_COMMANDS[appId],
                                )
                              }
                              className="flex-shrink-0 text-xs font-medium text-primary hover:underline"
                            >
                              {t("onboarding.copyInstallCommand", {
                                defaultValue: "复制安装命令",
                              })}
                            </button>
                          </div>
                        )}
                      </div>
                      {result.state === "checking" ||
                      result.state === "idle" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : result.state === "installed" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : result.state === "broken" ? (
                        <CircleAlert className="h-5 w-5 text-amber-500" />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("onboarding.optional", { defaultValue: "可选" })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void detectTools()}
                disabled={Object.values(tools).some(
                  (tool) => tool.state === "checking",
                )}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("onboarding.detectAgain", { defaultValue: "重新检测" })}
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto max-w-[520px] space-y-5 py-4">
              <DialogDescription className="leading-relaxed">
                {edition === "enterprise"
                  ? t("onboarding.keyBodyEnterprise", {
                      defaultValue:
                        "Key 只保存在本机，并写入你选中的客户端配置。",
                    })
                  : t("onboarding.keyBody", {
                      defaultValue:
                        "Key 只保存在本机，并写入你选中的客户端配置。验证不会产生模型调用费用。",
                    })}
              </DialogDescription>
              {edition === "enterprise" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {t("onboarding.enterpriseUrlConfirmLabel", {
                      defaultValue: "接口地址",
                    })}
                    ：
                    <span className="font-mono text-foreground">
                      {resolvedBaseUrlRoot}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-shrink-0 text-primary hover:underline"
                  >
                    {t("common.edit", { defaultValue: "编辑" })}
                  </button>
                </div>
              )}
              <ApiKeyInput
                id="onboarding-ai302-key"
                value={apiKey}
                onChange={(value) => {
                  verificationGeneration.current += 1;
                  setApiKey(value);
                  setVerifyState("idle");
                  setVerifyError("");
                }}
                placeholder="sk-..."
                label={
                  edition === "enterprise"
                    ? detectAi302ApiKeyLabel(resolvedBaseUrlRoot)
                    : "302.AI API Key"
                }
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                {edition === "enterprise" ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void enterpriseAuthorization.start(resolvedBaseUrlRoot)
                      }
                      disabled={enterpriseAuthorization.status === "waiting"}
                    >
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      {t("onboarding.getEnterpriseKey", {
                        defaultValue: "获取 API Key",
                      })}
                    </Button>
                    {enterpriseAuthorization.status === "waiting" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={enterpriseAuthorization.cancel}
                      >
                        {t("common.cancel", { defaultValue: "取消" })}
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void settingsApi.openExternal(AI302_API_KEY_URL)
                    }
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("onboarding.getKey", {
                      defaultValue: "前往 302.AI 获取 Key",
                    })}
                  </button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void verifyKey()}
                  disabled={verifyState === "checking"}
                >
                  {verifyState === "checking" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-4 w-4" />
                  )}
                  {t("onboarding.verifyAndDiagnose", {
                    defaultValue: "验证并诊断",
                  })}
                </Button>
              </div>
              {verifyState === "ok" && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  {verifiedViaChat
                    ? t("onboarding.keyOkChatVerified", {
                        defaultValue: "Key 可用（已通过对话接口验证）",
                      })
                    : t("onboarding.keyOk", {
                        count: modelCount,
                        defaultValue: `Key 可用，已读取 ${modelCount} 个模型`,
                      })}
                </div>
              )}
              {verifyState === "error" && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  <XCircle className="h-4 w-4 flex-shrink-0" />
                  {verifyError}
                </div>
              )}
              {enterpriseAuthorization.status !== "idle" &&
                enterpriseAuthorization.status !== "waiting" && (
                  <div className="text-sm text-destructive">
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
                  </div>
                )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <DialogDescription>
                {t("onboarding.appsBody", {
                  defaultValue:
                    "已安装的客户端会默认选中。你也可以提前配置尚未安装的客户端。",
                })}
              </DialogDescription>
              <div className="overflow-hidden rounded-lg border border-border">
                {AI302_ONBOARDING_APPS.map((appId, index) => {
                  const detail = APP_DETAILS[appId];
                  return (
                    <label
                      key={appId}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40",
                        index > 0 && "border-t border-border",
                      )}
                    >
                      <Checkbox
                        checked={selection[appId]}
                        onCheckedChange={(checked) =>
                          setSelection((current) => ({
                            ...current,
                            [appId]: checked === true,
                          }))
                        }
                      />
                      <ProviderIcon
                        icon={detail.icon}
                        name={detail.name}
                        size={22}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{detail.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {detail.configLabel}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {tools[appId].state === "installed"
                          ? t("onboarding.installed", {
                              defaultValue: "已安装",
                            })
                          : t("onboarding.notInstalled", {
                              defaultValue: "未检测到",
                            })}
                      </span>
                    </label>
                  );
                })}
              </div>
              {selectedApps.length === 0 && (
                <p className="text-sm text-destructive">
                  {t("onboarding.selectOne", {
                    defaultValue: "至少选择一个客户端",
                  })}
                </p>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <DialogDescription>
                {selection.claude
                  ? edition === "enterprise"
                    ? t("onboarding.modelsBodyEnterprise", {
                        defaultValue:
                          "Claude Code 默认把当前选择的模型原样发送给你配置的接口。需要锁定版本时，可以设置固定映射。",
                      })
                    : t("onboarding.modelsBody", {
                        defaultValue:
                          "Claude Code 默认把当前选择的模型原样发送给 302.AI。需要锁定版本时，可以设置固定映射。",
                      })
                  : t("onboarding.modelsBodyNoClaude", {
                      defaultValue: "确认各客户端将要写入的默认模型。",
                    })}
              </DialogDescription>

              {selection.claude && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setModelMode("follow")}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors",
                      modelMode === "follow"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Route className="h-5 w-5 text-primary" />
                      {modelMode === "follow" && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="mt-3 text-sm font-medium">
                      {t("onboarding.followClaude", {
                        defaultValue: "跟随官方调用",
                      })}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("onboarding.followClaudeBody", {
                        defaultValue:
                          "Opus 4.8 会请求 claude-opus-4-8，不额外替换。",
                      })}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelMode("fixed")}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors",
                      modelMode === "fixed"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <SlidersHorizontal className="h-5 w-5 text-primary" />
                      {modelMode === "fixed" && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="mt-3 text-sm font-medium">
                      {t("onboarding.fixedModels", {
                        defaultValue: "固定模型映射",
                      })}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("onboarding.fixedModelsBody", {
                        defaultValue:
                          "为角色指定版本，适合成本控制和稳定复现。",
                      })}
                    </p>
                  </button>
                </div>
              )}

              {selection.claude && (
                <p className="text-xs text-muted-foreground">
                  {t("onboarding.modelModeHint", {
                    defaultValue: "不确定就用「跟随官方调用」，之后随时能改。",
                  })}
                </p>
              )}

              {selection.claude && modelMode === "fixed" && (
                <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
                  {(
                    Object.keys(fixedModels) as Array<keyof typeof fixedModels>
                  ).map((role) => (
                    <label key={role} className="space-y-1.5">
                      <span className="text-xs font-medium capitalize">
                        {role}
                      </span>
                      <Input
                        value={fixedModels[role]}
                        onChange={(event) =>
                          setFixedModels((current) => ({
                            ...current,
                            [role]: event.target.value,
                          }))
                        }
                        placeholder={
                          role === "sonnet"
                            ? "claude-sonnet-5"
                            : role === "opus"
                              ? "claude-opus-4-8"
                              : role === "fable"
                                ? "claude-fable-5"
                                : "claude-haiku-4-5"
                        }
                      />
                    </label>
                  ))}
                  {!fixedModeValid && (
                    <p className="text-xs text-destructive sm:col-span-2">
                      {t("onboarding.fixedModelRequired", {
                        defaultValue:
                          "至少填写一个模型，其余角色由 Claude Code 处理。",
                      })}
                    </p>
                  )}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-border">
                {selectedApps.map((appId, index) => (
                  <div
                    key={appId}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <ProviderIcon
                      icon={APP_DETAILS[appId].icon}
                      name={APP_DETAILS[appId].name}
                      size={20}
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium">
                      {APP_DETAILS[appId].name}
                    </span>
                    <span className="max-w-[55%] truncate text-xs text-muted-foreground">
                      {appId === "claude"
                        ? modelMode === "follow"
                          ? t("onboarding.passthrough", {
                              defaultValue: "原样转发",
                            })
                          : t("onboarding.customMapping", {
                              defaultValue: "自定义映射",
                            })
                        : ai302OnboardingDefaultModel(appId) ||
                          t("onboarding.autoRouting", {
                            defaultValue: "自动路由",
                          })}
                    </span>
                  </div>
                ))}
              </div>

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group w-full justify-between px-2 text-muted-foreground"
                  >
                    <span className="inline-flex items-center gap-2">
                      <TerminalSquare className="h-4 w-4" />
                      {t("onboarding.technicalDetails", {
                        defaultValue: "查看写入位置和接口地址",
                      })}
                    </span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                  {selectedApps.map((appId) => (
                    <div
                      key={appId}
                      className="flex items-start justify-between gap-4"
                    >
                      <span>{APP_DETAILS[appId].configLabel}</span>
                      <span className="text-right font-mono text-foreground">
                        {ai302DisplayBaseUrl(appId, resolvedBaseUrlRoot)}
                      </span>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-5">
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4",
                  allConfigured
                    ? "border-primary/25 bg-primary/5"
                    : "border-amber-500/30 bg-amber-500/5",
                )}
              >
                {allConfigured ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                ) : (
                  <CircleAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                )}
                <div>
                  <div className="text-sm font-medium">
                    {allConfigured
                      ? edition === "enterprise"
                        ? t("onboarding.doneSummaryEnterprise", {
                            defaultValue: "接口配置已写入并启用",
                          })
                        : t("onboarding.doneSummary", {
                            defaultValue: "302.AI 已写入并启用",
                          })
                      : t("onboarding.partialSummary", {
                          defaultValue: "部分客户端需要处理",
                        })}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.doneBody", {
                      defaultValue:
                        "以后可以在供应商卡片看到当前模型策略，也可以随时切回官方配置。",
                    })}
                  </p>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                {configureResults.map((result, index) => (
                  <div
                    key={result.appId}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <ProviderIcon
                      icon={APP_DETAILS[result.appId].icon}
                      name={APP_DETAILS[result.appId].name}
                      size={21}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {APP_DETAILS[result.appId].name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {!result.success
                          ? result.error
                          : result.reachable
                            ? t("onboarding.configuredReachable", {
                                defaultValue: "已启用，接口可达",
                              })
                            : t("onboarding.configuredUnreachable", {
                                defaultValue: "已启用，但当前网络无法访问接口",
                              })}
                      </div>
                    </div>
                    {result.success && result.reachable ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <CircleAlert className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                ))}
              </div>
              {launchableApps.length > 0 && (
                <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <TerminalSquare className="h-4 w-4 text-primary" />
                    {t("onboarding.nextStepsTitle", {
                      defaultValue: "接下来：在终端里用起来",
                    })}
                  </div>
                  <ul className="space-y-1.5">
                    {launchableApps.map((appId) => (
                      <li
                        key={appId}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span className="min-w-0 truncate">
                          {APP_DETAILS[appId].name}
                        </span>
                        <span aria-hidden="true">→</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                          {APP_LAUNCH_COMMANDS[appId]}
                        </code>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.nextStepsRestartHint", {
                      defaultValue:
                        "已经打开的终端需要重开一个新窗口，配置才会生效。",
                    })}
                  </p>
                </div>
              )}
              {verifyState === "error" && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  <XCircle className="h-4 w-4 flex-shrink-0" />
                  {verifyError}
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => void runDiagnosis()}
                disabled={isDiagnosing}
              >
                {isDiagnosing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                {t("onboarding.diagnoseAgain", {
                  defaultValue: "重新运行一键诊断",
                })}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <div>
            {step === 0 ? (
              <Button variant="ghost" onClick={() => void saveCompletion()}>
                {t("onboarding.skip", { defaultValue: "暂时跳过" })}
              </Button>
            ) : step < 6 ? (
              <Button variant="ghost" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("common.back", { defaultValue: "返回" })}
              </Button>
            ) : (
              <span />
            )}
          </div>
          {step === 0 ? (
            <Button onClick={goNext}>
              {t("onboarding.start", { defaultValue: "开始配置" })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : step === 1 ? (
            <Button
              onClick={goNext}
              disabled={edition === "enterprise" && !enterpriseUrlValid}
            >
              {t("common.next", { defaultValue: "下一步" })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : step === 2 ? (
            <Button
              onClick={goNext}
              disabled={Object.values(tools).some(
                (tool) => tool.state === "checking" || tool.state === "idle",
              )}
            >
              {t("common.next", { defaultValue: "下一步" })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : step === 3 ? (
            <Button
              onClick={() => {
                if (verifyState === "ok") goNext();
                else void verifyKey().then((ok) => ok && goNext());
              }}
              disabled={verifyState === "checking" || !apiKey.trim()}
            >
              {t("common.next", { defaultValue: "下一步" })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : step === 4 ? (
            <Button onClick={goNext} disabled={selectedApps.length === 0}>
              {t("common.next", { defaultValue: "下一步" })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : step === 5 ? (
            <Button
              onClick={() => void configureSelectedApps()}
              disabled={isConfiguring || !fixedModeValid}
            >
              {isConfiguring ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              {t("onboarding.apply", { defaultValue: "写入并启用" })}
            </Button>
          ) : (
            <Button onClick={() => void saveCompletion()}>
              {t("onboarding.enterApp", { defaultValue: "进入 302 Switch" })}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
