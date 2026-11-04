"use client";

import { Reveal, Section, TextLink } from "./shared";
import { useLang } from "./lang";

/** Technical facts — an honest grid, every claim traced to README.md. */
export function Comparison() {
  const { t } = useLang();
  const f = t.facts;

  return (
    <Section id="facts" tone="white">
      <div className="mx-auto w-full max-w-[1100px] px-6">
        <Reveal>
          <p className="t-product-kicker text-ink">{f.kicker}</p>
          <h2 className="t-feature-heading mt-3 text-balance text-ink">{f.title}</h2>
          <p className="t-feature-copy mt-4 max-w-md text-pretty text-slate">{f.sub}</p>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {f.cards.map((card, i) => (
            <Reveal key={card.title} delay={(i % 3) * 90} className="h-full">
              <article className="h-full rounded-[22px] border border-hairline-silver bg-gallery-white p-6">
                <h3 className="text-[17px] font-medium leading-snug text-ink">
                  {card.title}
                </h3>
                <p className="t-body-small mt-2.5 text-pretty text-slate">{card.copy}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-8">
          <TextLink href="#download">{t.download.title}</TextLink>
        </Reveal>
      </div>
    </Section>
  );
}
