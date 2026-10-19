import { useTranslation } from "react-i18next";
import { Button } from "@/ui/button";
import { LOCALE_NAMES, setLocale, type Locale } from "./index";

/** Flips between the two shipped languages. Shows the code of the language it switches to, like a toggle on a keyboard. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const next: Locale = i18n.language === "en" ? "id" : "en";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      data-testid="language-switch"
      aria-label={t("language.switch", { name: LOCALE_NAMES[next] })}
      title={t("language.switch", { name: LOCALE_NAMES[next] })}
      onClick={() => void setLocale(next)}
    >
      <span className="text-[0.8125rem] font-extrabold tracking-wide">{next.toUpperCase()}</span>
    </Button>
  );
}
