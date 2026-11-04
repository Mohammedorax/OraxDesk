"use client";

import { useSyncExternalStore } from "react";
import { Download, FileCode2, Laptop, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "./lang";
import { Reveal, Section } from "./shared";
import { releases } from "@/lib/tajarib/releases";

/* Platform detection without setState-in-effect: useSyncExternalStore hands
   over the client snapshot after hydration, so the server render stays
   neutral and hydration never mismatches. The UA never changes mid-session,
   so the subscription never needs to fire. */
const subscribeNever = () => () => {};

function detectPlatform(ua: string): "windows" | "macos" | "linux" | null {
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac|iPhone|iPad/i.test(ua)) return "macos";
  if (/Linux|Android|X11/i.test(ua)) return "linux";
  return null;
}

function usePlatform(): "windows" | "macos" | "linux" | null {
  return useSyncExternalStore(
    subscribeNever,
    () => detectPlatform(navigator.userAgent),
    () => null
  );
}

const PLATFORM_ICON = {
  windows: MonitorSmartphone,
  macos: Laptop,
  linux: FileCode2,
} as const;

function DownloadCard({
  keyName,
  label,
  note,
  assets,
  detected,
  missingNote,
}: {
  keyName: "windows" | "macos" | "linux";
  label: string;
  note: string;
  assets: { label: string; href: string }[];
  detected: boolean;
  missingNote: string;
}) {
  const Icon = PLATFORM_ICON[keyName];
  const primary = assets[0];
  const rest = assets.slice(1);

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-[28px] border bg-gallery-white p-7 transition-[box-shadow,transform] duration-300",
        detected
          ? "border-pricing-blue/60 shadow-[0_10px_30px_rgba(0,113,227,0.10)]"
          : "border-hairline-silver"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[12px]",
            detected ? "bg-pricing-blue text-white" : "bg-control-gray text-ink"
          )}
        >
          <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <h3 className="t-product-kicker text-ink">{label}</h3>
          <p className="t-compact mt-1 text-slate">{note}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        {primary ? (
          <a
            href={primary.href}
            className={cn(
              "t-body-small inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 font-medium text-white transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue",
              detected
                ? "bg-pricing-blue hover:bg-[var(--cta-blue-hover)]"
                : "bg-ink/80 hover:bg-ink"
            )}
            aria-label={primary.label}
          >
            <Download className="size-4" aria-hidden="true" />
            {/* A real asset name reads LTR; the "via the releases page"
                fallback is natural copy and must not be forced LTR. */}
            <span dir={primary.href === releases.page ? undefined : "ltr"}>
              {primary.label.replace(/^(Windows|macOS|Linux) · /, "")}
            </span>
          </a>
        ) : (
          <span className="t-compact text-slate">{missingNote}</span>
        )}

        {rest.map((asset) => (
          <a
            key={asset.href}
            href={asset.href}
            className="t-compact inline-flex h-9 items-center justify-center gap-2 rounded-full border border-hairline-silver bg-transparent px-5 text-ink transition-colors duration-200 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
          >
            <span dir={asset.href === releases.page ? undefined : "ltr"}>
              {asset.label.replace(/^(Windows|macOS|Linux) · /, "")}
            </span>
          </a>
        ))}

        <a
          href={releases.page}
          className="t-compact mt-1 text-apple-blue hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {releases.page.replace("https://github.com/", "")} ↗
        </a>
      </div>
    </article>
  );
}

/** The download section — platform links baked from the latest release at
 *  build time (fetch-release.mjs); no GitHub API call in the visitor's browser. */
export function DownloadSection() {
  const { t } = useLang();
  const platform = usePlatform();

  return (
    <Section id="download" tone="mist">
      <div className="mx-auto w-full max-w-[1100px] px-6">
        <Reveal>
          <p className="t-product-kicker text-center text-ink">{t.download.kicker}</p>
          <h2 className="t-feature-heading mt-3 text-center text-ink">
            {t.download.title}
          </h2>
          <p className="t-feature-copy mx-auto mt-4 max-w-lg text-center text-pretty text-slate">
            {t.download.sub}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {t.download.platforms.map((plat, i) => (
            <Reveal key={plat.key} delay={i * 90} className="h-full">
              <DownloadCard
                keyName={plat.key}
                label={plat.label}
                note={plat.note}
                assets={plat.assets}
                detected={platform === plat.key}
                missingNote={t.download.missingNote}
              />
            </Reveal>
          ))}
        </div>

        <Reveal delay={220} className="mt-10">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-[22px] border border-hairline-silver bg-gallery-white px-6 py-5 text-center">
            <p className="text-[15px] font-medium text-ink">
              {t.download.supportLabel}
            </p>
            <p className="t-body-small text-pretty text-slate">
              {t.download.supportCopy}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <a
                href={releases.source}
                className="t-compact inline-flex h-9 items-center gap-2 rounded-full border border-hairline-silver bg-transparent px-4 text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
              >
                <FileCode2 className="size-4 text-apple-blue" aria-hidden="true" />
                <span>{t.download.sourceLabel}</span>
              </a>
              <a
                href={releases.page}
                target="_blank"
                rel="noreferrer"
                className="t-compact inline-flex h-9 items-center gap-2 rounded-full border border-hairline-silver bg-transparent px-4 text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue"
              >
                <Download className="size-4 text-apple-blue" aria-hidden="true" />
                <span>{t.download.pageLabel}</span>
              </a>
            </div>
            <p className="t-compact text-slate">{t.download.checksumLabel}</p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
