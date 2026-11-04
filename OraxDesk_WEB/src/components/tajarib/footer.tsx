"use client";

import { Download, Mail, Moon } from "lucide-react";
import { useLang } from "./lang";
import { BrandMark } from "./shared";
import { releases } from "@/lib/tajarib/releases";

const CONTACT_EMAIL = "orax2004@gmail.com";

export function SiteFooter() {
  const { t, lang, setLang } = useLang();

  return (
    <footer
      id="support"
      className="mt-auto scroll-mt-[100px] border-t border-hairline-silver bg-studio-mist"
    >
      <div className="mx-auto w-full max-w-[1200px] px-6 py-12 pb-[calc(3rem+env(safe-area-inset-bottom))]">
        <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr]">
          {/* Brand + the single contact channel: email */}
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="t-product-nav-title text-ink">{t.brand}</span>
            </div>
            <p className="t-body-small mt-3 max-w-[240px] text-slate">
              {t.footer.tagline}
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="t-body-small mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-hairline-silver bg-gallery-white px-4 text-ink transition-colors duration-200 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
              aria-label={t.footer.emailLabel}
            >
              <Mail
                className="size-4 shrink-0 text-apple-blue"
                aria-hidden="true"
              />
              <span dir="ltr">{CONTACT_EMAIL}</span>
            </a>

            {/* Downloadable copy of the project source — the repo archive on
                GitHub, always current, instead of a stale zip in the bundle. */}
            <a
              href={releases.source}
              className="t-body-small mt-2.5 inline-flex h-10 items-center gap-2 rounded-full border border-hairline-silver bg-gallery-white px-4 text-ink transition-colors duration-200 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
              aria-label={t.footer.downloadProject}
            >
              <Download
                className="size-4 shrink-0 text-apple-blue"
                aria-hidden="true"
              />
              <span>{t.footer.downloadProject}</span>
            </a>
          </div>

          {/* Link columns */}
          {t.footer.columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="t-compact font-medium text-ink">{column.title}</h3>
              <ul className="mt-3 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith("http") ? "_blank" : undefined}
                      rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                      className="t-compact text-slate transition-colors hover:text-ink"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Legal bar */}
        <div className="mt-10 border-t border-hairline-silver pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="t-compact text-slate">{t.footer.legal}</p>

            <div className="flex items-center gap-2">
              <p className="t-compact hidden text-slate sm:inline">{t.footer.license}</p>
              <p className="t-compact hidden text-slate md:inline">{t.footer.note}</p>
              {/* Language switch — one moon icon button, like the header's */}
              <button
                type="button"
                aria-label={t.langSwitch}
                title={t.langSwitch}
                onClick={() => setLang(lang === "ar" ? "en" : "ar")}
                className="grid size-8 place-items-center rounded-full border border-hairline-silver bg-gallery-white text-ink/70 transition-colors duration-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
              >
                <Moon className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
