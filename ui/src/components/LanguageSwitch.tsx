import type { ReactNode } from "react";
import { useI18n, type Lang } from "../lib/i18n";

/**
 * The language choice, shown at the top of Preferences so it is one click away
 * from anywhere. Arabic is the default; switching to English mirrors the layout
 * back to LTR immediately, and the choice is remembered.
 */
export function LanguageSwitch(): ReactNode {
  const { lang, setLang, t } = useI18n();
  const option = (value: Lang, label: string) => (
    <button
      type="button"
      aria-pressed={lang === value}
      onClick={() => setLang(value)}
      className={`px-3 py-1.5 text-sm ${
        lang === value
          ? "bg-accent text-accent-fg"
          : "border border-subtle text-primary hover:bg-inset"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-subtle bg-inset/40 p-3">
      <span className="text-sm text-secondary">{t("app.language")}</span>
      <div className="flex overflow-hidden rounded">
        {option("ar", t("app.arabic"))}
        {option("en", t("app.english"))}
      </div>
    </div>
  );
}
