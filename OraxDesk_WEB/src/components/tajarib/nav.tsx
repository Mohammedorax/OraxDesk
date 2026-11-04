"use client";

import Link from "next/link";
import { Moon } from "lucide-react";
import { useLang } from "./lang";
import { BrandMark, BluePill } from "./shared";

/** Language switch — a single moon-style icon button, one click flips
 *  Arabic ↔ English. First visit follows the device language; appearance
 *  simply follows the system scheme. */
function LangToggle() {
  const { t, lang, setLang } = useLang();
  return (
    <button
      type="button"
      aria-label={t.langSwitch}
      title={t.langSwitch}
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className="grid size-8 shrink-0 place-items-center rounded-full text-ink/70 transition-colors duration-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
    >
      <Moon className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * One floating glass capsule — detached from the viewport edges, softly
 * rounded, and the single persistent bar for the whole page.
 */
export function SiteHeader() {
  const { t } = useLang();

  return (
    <header className="sticky top-0 z-40 px-4 pt-4 pb-3 sm:px-6">
      <nav
        aria-label="Global"
        className="glass-strong float-shadow mx-auto flex h-14 w-full max-w-[1024px] items-center justify-between gap-3 rounded-full border border-hairline-silver/60 pe-2 ps-4 sm:pe-3"
      >
        <Link
          href="#top"
          aria-label={t.brand}
          className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-apple-blue"
        >
          <BrandMark />
          <span className="t-global-nav hidden font-medium text-ink sm:inline">
            {t.brand}
          </span>
          <span className="t-compact hidden font-medium text-launch-orange lg:inline">
            {t.localNav.newLabel}
          </span>
        </Link>

        <ul className="hidden items-center gap-7 md:flex">
          {t.nav.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="t-global-nav text-ink/80 transition-colors hover:text-ink"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5">
          <LangToggle />
          <BluePill href="#download" className="inline-flex">
            {t.localNav.download}
          </BluePill>
        </div>
      </nav>
    </header>
  );
}
