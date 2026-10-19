import { Trans, useTranslation } from "react-i18next";
import { Dialog } from "@/ui/dialog";
import { Button } from "@/ui/button";
import { SHORTCUTS } from "./shortcuts";

const STEPS = ["design", "export", "move", "pick"] as const;

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("help");
  const bold = { b: <span className="font-semibold" /> };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t("description")}
      className="max-w-2xl"
      testId="help-dialog"
      footer={
        <Button onClick={onClose} data-testid="help-start">
          {t("start")}
        </Button>
      }
    >
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-bold text-primary tabular-nums">{i + 1}</span>
            <div>
              <p className="text-sm font-bold">{t(`steps.${s}.title`)}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{t(`steps.${s}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-2xl bg-warning-soft p-4 text-[0.8125rem] leading-relaxed">
        <p className="font-bold">{t("notice.title")}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <Trans t={t} i18nKey="notice.signed" components={bold} />
          </li>
          <li>{t("notice.photo")}</li>
          <li>{t("notice.devices")}</li>
          <li>
            <Trans
              t={t}
              i18nKey="notice.marks"
              values={{ preview: t("notice.previewOnly"), unconfirmed: t("notice.unconfirmed") }}
              components={bold}
            />
          </li>
          <li>{t("notice.reset")}</li>
        </ul>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-bold">{t("keyboard")}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
        {SHORTCUTS.map((s) => (
          <div key={s} className="contents">
            <dt className="font-mono text-xs font-semibold text-foreground/80">{t(`shortcuts.${s}.keys`)}</dt>
            <dd className="text-muted-foreground">{t(`shortcuts.${s}.action`)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
