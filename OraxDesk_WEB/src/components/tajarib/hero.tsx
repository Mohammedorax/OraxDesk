"use client";

import Image from "next/image";
import { useLang } from "./lang";
import { BluePill, TextLink, useThemeSrc } from "./shared";

export function Hero() {
  const { t } = useLang();
  const heroImg = useThemeSrc(t.hero.img, t.hero.imgDark);

  return (
    <section id="top" className="bg-gallery-white">
      <div className="mx-auto w-full max-w-[1200px] px-6 pt-12 text-center">
        {/* Product label + launch marker */}
        <p className="t-product-kicker anim-rise text-ink">
          {t.hero.kicker}
          <span className="t-compact ms-3 align-middle font-medium text-launch-orange">
            {t.hero.newLabel}
          </span>
        </p>

        {/* Display statement */}
        <h1 className="t-hero-display anim-rise mt-4 max-w-[900px] text-balance text-ink [animation-delay:100ms]">
          {t.hero.titleLines[0]}
          <br />
          {t.hero.titleLines[1]}
        </h1>

        <p className="t-feature-copy anim-rise mx-auto mt-5 max-w-[620px] text-pretty text-slate [animation-delay:200ms]">
          {t.hero.sub}
        </p>

        <div className="anim-rise mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-4 [animation-delay:300ms]">
          <BluePill href="#download">{t.hero.cta}</BluePill>
          <TextLink href="#highlights">{t.hero.more}</TextLink>
        </div>

        <p className="t-body-small anim-rise mt-4 text-slate [animation-delay:400ms]">
          {t.hero.avail}
        </p>
      </div>

      {/* Hero product stage — no containing card */}
      <div className="anim-rise relative mx-auto mt-12 w-full max-w-[1020px] px-6 pb-20 [animation-delay:500ms]">
        <Image
          key={heroImg}
          src={heroImg}
          alt={t.hero.alt}
          width={1600}
          height={1000}
          priority
          sizes="(max-width: 1020px) 100vw, 1020px"
          className="w-full rounded-[28px] border border-hairline-silver"
        />

        {/* Floating pricing callout — frosted glass capsule */}
        <div className="absolute inset-x-6 bottom-14 flex justify-center">
          <div className="glass-strong flex flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-[28px] border border-hairline-silver/40 px-6 py-4">
            <div className="text-center sm:text-start">
              <p className="text-[14px] font-medium leading-snug text-ink">
                {t.hero.callout.price}
              </p>
              <p className="t-compact text-slate">{t.hero.callout.detail}</p>
            </div>
            <BluePill href="#download">{t.hero.callout.cta}</BluePill>
          </div>
        </div>
      </div>
    </section>
  );
}
