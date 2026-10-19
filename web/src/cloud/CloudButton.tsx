import { Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";
import { useCloudChanged } from "./hooks";
import { useCloud } from "./store";

/** Header button of the cloud dialog; a small dot says whether the linked face is saved (green), changed or saving (amber) or failed (red). */
export function CloudButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation("cloud");
  const linked = useCloud((s) => s.linked !== null);
  const status = useCloud((s) => s.status);
  const changed = useCloudChanged();

  const dot = !linked ? null : status === "error" || status === "conflict" ? "bg-destructive" : status === "saving" || changed ? "bg-warning" : "bg-battery";
  const state = !linked ? "unlinked" : status === "error" || status === "conflict" ? status : status === "saving" ? "saving" : changed ? "changed" : "saved";

  return (
    <Button variant="ghost" size="icon" className={cn("relative", className)} aria-label={t("button")} title={t("button")} onClick={onClick} data-testid="open-cloud" data-cloud-state={state}>
      <Cloud />
      {dot && <span aria-hidden className={cn("absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2 ring-background", dot)} />}
    </Button>
  );
}
