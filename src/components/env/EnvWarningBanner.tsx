import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ChevronUp, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { EnvConflict } from "@/types/env";
import { deleteEnvVars } from "@/lib/api/env";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EnvWarningBannerProps {
  conflicts: EnvConflict[];
  onDismiss: () => void;
  onDeleted: () => void;
}

export function EnvWarningBanner({
  conflicts,
  onDismiss,
  onDeleted,
}: EnvWarningBannerProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedConflicts, setSelectedConflicts] = useState<Set<string>>(
    new Set(),
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  if (conflicts.length === 0) {
    return null;
  }

  // 两类来源区别对待：
  // - file：写在 .zshrc 等配置文件里 → 能真的删（改文件、自动备份、可恢复）。
  // - system：飘在进程/系统环境里 → 在 macOS 根本删不掉（详见 env_manager 的 no-op），
  //   所以这类只展示 + 给出人话引导，不给勾选和删除按钮，免得用户以为删了其实没删。
  const fileConflicts = conflicts.filter((c) => c.sourceType === "file");
  const envConflicts = conflicts.filter((c) => c.sourceType !== "file");

  const toggleSelection = (key: string) => {
    const newSelection = new Set(selectedConflicts);
    if (newSelection.has(key)) {
      newSelection.delete(key);
    } else {
      newSelection.add(key);
    }
    setSelectedConflicts(newSelection);
  };

  // 全选只针对「文件来源」——进程来源不可删，不进选择集。
  const allFilesSelected =
    fileConflicts.length > 0 && selectedConflicts.size === fileConflicts.length;
  const toggleSelectAll = () => {
    if (allFilesSelected) {
      setSelectedConflicts(new Set());
    } else {
      setSelectedConflicts(
        new Set(fileConflicts.map((c) => `${c.varName}:${c.sourcePath}`)),
      );
    }
  };

  const handleDelete = async () => {
    setShowConfirmDialog(false);
    setIsDeleting(true);

    try {
      const conflictsToDelete = conflicts.filter((c) =>
        selectedConflicts.has(`${c.varName}:${c.sourcePath}`),
      );

      if (conflictsToDelete.length === 0) {
        toast.warning(t("env.error.noSelection"));
        return;
      }

      const backupInfo = await deleteEnvVars(conflictsToDelete);

      toast.success(t("env.delete.success"), {
        description: t("env.backup.location", {
          path: backupInfo.backupPath,
        }),
        duration: 5000,
        closeButton: true,
      });

      // 清空选择并通知父组件
      setSelectedConflicts(new Set());
      onDeleted();
    } catch (error) {
      console.error("删除环境变量失败:", error);
      toast.error(t("env.delete.error"), {
        description: String(error),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const getSourceDescription = (conflict: EnvConflict): string => {
    if (conflict.sourceType === "system") {
      if (conflict.sourcePath.includes("HKEY_CURRENT_USER")) {
        return t("env.source.userRegistry");
      } else if (conflict.sourcePath.includes("HKEY_LOCAL_MACHINE")) {
        return t("env.source.systemRegistry");
      } else {
        return t("env.source.systemEnv");
      }
    } else {
      return conflict.sourcePath;
    }
  };

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[100] bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 dark:border-yellow-900 shadow-lg animate-slide-down">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
                    {t("env.warning.title")}
                  </h3>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-0.5">
                    {t("env.warning.description", { count: conflicts.length })}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-yellow-900 dark:text-yellow-100 hover:bg-yellow-100 dark:hover:bg-yellow-900/50"
                  >
                    {isExpanded ? (
                      <>
                        {t("env.actions.collapse")}
                        <ChevronUp className="h-4 w-4 ml-1" />
                      </>
                    ) : (
                      <>
                        {t("env.actions.expand")}
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </>
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDismiss}
                    className="text-yellow-900 dark:text-yellow-100 hover:bg-yellow-100 dark:hover:bg-yellow-900/50"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-4 space-y-4">
                  {/* 冲突到底会怎样：让用户明白横幅在担心什么 */}
                  <p className="text-xs leading-relaxed text-yellow-800 dark:text-yellow-200">
                    {t("env.warning.impact", {
                      defaultValue:
                        "这些环境变量的优先级高于本应用写入的配置，会覆盖你在这里选择的供应商，导致切换看起来不生效。",
                    })}
                  </p>

                  {/* 可删除：来自配置文件 */}
                  {fileConflicts.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 pb-2 border-b border-yellow-200 dark:border-yellow-900/50">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="select-all"
                            checked={allFilesSelected}
                            onCheckedChange={toggleSelectAll}
                          />
                          <label
                            htmlFor="select-all"
                            className="text-sm font-medium text-yellow-900 dark:text-yellow-100 cursor-pointer"
                          >
                            {t("env.actions.selectAll")}
                          </label>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {t("env.group.fileHint", {
                            defaultValue:
                              "来自配置文件，可安全删除（自动备份、可恢复）",
                          })}
                        </span>
                      </div>

                      <div className="max-h-72 overflow-y-auto space-y-2">
                        {fileConflicts.map((conflict) => {
                          const key = `${conflict.varName}:${conflict.sourcePath}`;
                          return (
                            <div
                              key={key}
                              className="flex items-start gap-3 p-3 bg-white dark:bg-gray-900 rounded-md border border-yellow-200 dark:border-yellow-900/50"
                            >
                              <Checkbox
                                id={key}
                                checked={selectedConflicts.has(key)}
                                onCheckedChange={() => toggleSelection(key)}
                              />

                              <div className="flex-1 min-w-0">
                                <label
                                  htmlFor={key}
                                  className="block text-sm font-medium text-foreground cursor-pointer"
                                >
                                  {conflict.varName}
                                </label>
                                <p className="text-xs text-muted-foreground mt-1 break-all">
                                  {t("env.field.value")}: {conflict.varValue}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {t("env.field.source")}:{" "}
                                  {getSourceDescription(conflict)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-yellow-200 dark:border-yellow-900/50">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedConflicts(new Set())}
                          disabled={selectedConflicts.size === 0}
                          className="text-yellow-900 dark:text-yellow-100 border-yellow-300 dark:border-yellow-800"
                        >
                          {t("env.actions.clearSelection")}
                        </Button>

                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setShowConfirmDialog(true)}
                          disabled={selectedConflicts.size === 0 || isDeleting}
                          className="gap-1"
                        >
                          <Trash2 className="h-4 w-4" />
                          {isDeleting
                            ? t("env.actions.deleting")
                            : t("env.actions.deleteSelected", {
                                count: selectedConflicts.size,
                              })}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* 不可删除：来自进程 / 系统环境——只展示 + 引导，不给删除 */}
                  {envConflicts.length > 0 && (
                    <div className="space-y-2 rounded-md border border-yellow-200 dark:border-yellow-900/50 p-3">
                      <div className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                        {t("env.group.processTitle", {
                          defaultValue: "来自进程 / 系统环境（无法在此删除）",
                        })}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("env.group.processHint", {
                          defaultValue:
                            "这些变量不在配置文件里，无法从这里删除。要让切换生效：在设置它们的地方取消，或从一个干净的新终端启动应用。",
                        })}
                      </p>
                      <div className="space-y-2 pt-1">
                        {envConflicts.map((conflict) => {
                          const key = `${conflict.varName}:${conflict.sourcePath}`;
                          return (
                            <div
                              key={key}
                              className="p-3 bg-white dark:bg-gray-900 rounded-md border border-yellow-200 dark:border-yellow-900/50"
                            >
                              <div className="text-sm font-medium text-foreground">
                                {conflict.varName}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 break-all">
                                {t("env.field.value")}: {conflict.varValue}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {t("env.field.source")}:{" "}
                                {getSourceDescription(conflict)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md" zIndex="top">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("env.confirm.title")}
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                {t("env.confirm.message", { count: selectedConflicts.size })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("env.confirm.backupNotice")}
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("env.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
