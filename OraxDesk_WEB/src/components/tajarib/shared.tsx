"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AudioWaveform, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "./lang";

/** Gentle scroll-in reveal — fades and rises once, then stays put.
 *  Deliberately quiet: 18px of travel, ~0.7s ease, and disabled
 *  entirely for users who prefer reduced motion. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn("reveal", shown && "reveal-shown", className)}
    >
      {children}
    </div>
  );
}

/** Compact brand mark — blue rounded square with a white waveform. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[8px] bg-pricing-blue text-white",
        className
      )}
    >
      <AudioWaveform className="size-4" strokeWidth={2.2} />
    </span>
  );
}

/** Filled conversion control — Pricing Blue, 9999px radius, compact 12px type. */
export function BluePill({
  href,
  children,
  className,
  onClick,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const classes = cn(
    "t-compact inline-flex h-9 items-center justify-center rounded-full bg-pricing-blue px-5 font-normal text-white transition-colors duration-200 hover:bg-[var(--cta-blue-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue",
    className
  );
  if (href) {
    return (
      <Link href={href} className={classes} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} onClick={onClick}>
      {children}
    </button>
  );
}

/** Secondary control — transparent fill, 1px Steel outline, 9999px radius. */
export function OutlinePill({
  href,
  children,
  className,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const classes = cn(
    "t-compact inline-flex h-9 items-center justify-center rounded-full border border-steel bg-transparent px-5 font-normal text-ink transition-colors duration-200 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apple-blue",
    className
  );
  if (href) {
    return <Link href={href} className={classes}>{children}</Link>;
  }
  return <span className={classes}>{children}</span>;
}

/** Apple-blue inline text link with a trailing chevron that flips for RTL. */
export function TextLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const { rtl } = useLang();
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-[17px] font-medium text-apple-blue transition-opacity hover:opacity-80",
        className
      )}
    >
      {children}
      <Chevron className="size-4 shrink-0" strokeWidth={2.4} aria-hidden="true" />
    </a>
  );
}

/** Section scaffold — consistent 90px rhythm and scroll offset for sticky navs. */
export function Section({
  id,
  tone = "white",
  className,
  children,
}: {
  id?: string;
  tone?: "white" | "mist";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-[100px] py-[90px]",
        tone === "mist" ? "bg-studio-mist" : "bg-gallery-white",
        className
      )}
    >
      {children}
    </section>
  );
}

/** Theme-aware screenshot source (dark render in dark mode).
 *  Reads the live <html> class (set by next-themes) through an external
 *  store subscription — hydration-safe and reactive to theme toggles. */
function subscribeToClassChange(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

export function useThemeSrc(light: string, dark?: string): string {
  const isDark = useSyncExternalStore(
    subscribeToClassChange,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );
  return isDark && dark ? dark : light;
}
