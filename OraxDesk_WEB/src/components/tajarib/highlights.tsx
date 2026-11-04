"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "./lang";
import { Section, TextLink, useThemeSrc } from "./shared";
import type { Slide } from "@/lib/tajarib/content";

export function Highlights() {
  const { t } = useLang();
  const slides = t.highlights.slides;

  const trackRef = useRef<HTMLUListElement>(null);
  const slideRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);

  /* Move the carousel itself — never the page. Slides align to the rail's
   * leading edge (no mid-screen centering), RTL-aware, so the visitor's
   * scroll position is never hijacked. */
  const goTo = useCallback((index: number) => {
    const track = trackRef.current;
    const slide = slideRefs.current[index];
    if (!track || !slide) return;
    const trackRect = track.getBoundingClientRect();
    const rect = slide.getBoundingClientRect();
    const pad = 24; /* px-6 rail padding */
    const rtl = getComputedStyle(track).direction === "rtl";
    const delta = rtl
      ? rect.right - (trackRect.right - pad)
      : rect.left - (trackRect.left + pad);
    track.scrollTo({ left: track.scrollLeft + delta, behavior: "smooth" });
    setActive(index);
  }, []);

  /* Track the slide closest to the viewport centre (RTL-safe). */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            const index = slideRefs.current.indexOf(entry.target as HTMLLIElement);
            if (index !== -1) setActive(index);
          }
        }
      },
      { root: track, threshold: [0.55] }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [slides.length]);

  /* Auto-advance runs only while the carousel is itself on screen —
   * the page is never dragged back to it against the reader's will. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 }
    );
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !inView) return;
    const id = window.setInterval(() => {
      setActive((prev) => {
        const next = (prev + 1) % slides.length;
        goTo(next);
        return next;
      });
    }, 4200);
    return () => window.clearInterval(id);
  }, [paused, inView, slides.length, goTo]);

  return (
    <Section id="highlights" tone="mist">
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="t-feature-heading text-balance text-ink">
            {t.highlights.title}
          </h2>
          <TextLink href="#facts">{t.highlights.link}</TextLink>
        </div>

        {/* Feature media cards */}
        <ul
          ref={trackRef}
          className="no-scrollbar -mx-6 mt-10 flex gap-5 overflow-x-auto px-6 pb-2"
        >
          {slides.map((slide, index) => (
            <li
              key={slide.img}
              ref={(el) => {
                slideRefs.current[index] = el;
              }}
              className="w-[86vw] shrink-0 rounded-[28px] bg-gallery-white p-7 sm:w-[560px]"
            >
              <SlideFigure slide={slide} />
            </li>
          ))}
        </ul>

        {/* Carousel playback control — translucent pill */}
        <div className="mt-6 flex justify-center">
          <div
            className="flex items-center gap-2 rounded-full px-4 py-2"
            style={{ backgroundColor: "var(--playback-track)" }}
          >
            {slides.map((slide, index) => (
              <button
                key={slide.img}
                type="button"
                onClick={() => goTo(index)}
                aria-label={`${t.highlights.goTo} ${index + 1}: ${slide.title}`}
                className="grid size-6 place-items-center"
              >
                <span
                  className={cn(
                    "block h-1.5 rounded-full transition-all duration-300",
                    index === active ? "w-5" : "w-1.5"
                  )}
                  style={{
                    backgroundColor:
                      index === active
                        ? "var(--playback-dot-active)"
                        : "var(--playback-dot)",
                  }}
                />
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-ink/15" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? t.highlights.play : t.highlights.pause}
              className="grid size-7 place-items-center rounded-full transition-transform duration-200 hover:scale-110"
            >
              {paused ? (
                <Play
                  className="size-3.5"
                  style={{ color: "var(--playback-dot-active)" }}
                  aria-hidden="true"
                />
              ) : (
                <Pause
                  className="size-3.5"
                  style={{ color: "var(--playback-dot-active)" }}
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function SlideFigure({ slide }: { slide: Slide }) {
  const src = useThemeSrc(slide.img, slide.imgDark);
  return (
    <figure>
      <Image
        key={src}
        src={src}
        alt={slide.alt}
        width={1600}
        height={1000}
        sizes="(max-width: 640px) 86vw, 560px"
        className="w-full rounded-[18px] border border-hairline-silver"
      />
      <figcaption className="mt-5">
        <h3 className="text-[24px] font-medium leading-tight text-balance text-ink">
          {slide.title}
        </h3>
        <p className="t-body-small mt-1.5 text-pretty text-slate">{slide.copy}</p>
      </figcaption>
    </figure>
  );
}
