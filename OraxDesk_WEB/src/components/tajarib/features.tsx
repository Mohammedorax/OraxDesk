"use client";

import Image from "next/image";
import { useLang } from "./lang";
import { Reveal, Section, TextLink, useThemeSrc } from "./shared";

function KickerStatementCopy({
  kicker,
  statement,
  copy,
  link,
}: {
  kicker: string;
  statement: string;
  copy: string;
  link?: string;
}) {
  return (
    <div>
      <p className="t-product-kicker text-ink">{kicker}</p>
      <h2 className="t-feature-heading mt-3 text-balance text-ink">{statement}</h2>
      <p className="t-feature-copy mt-5 max-w-md text-pretty text-slate">{copy}</p>
      {link ? (
        <div className="mt-6">
          <TextLink href="#download">{link}</TextLink>
        </div>
      ) : null}
    </div>
  );
}

/** Editorial chapter — the AI assistant, render entering from the near side. */
export function AIFeature() {
  const { t } = useLang();
  const img = useThemeSrc(t.ai.img, t.ai.imgDark);
  return (
    <Section id="ai" tone="white">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-14 px-6 lg:grid-cols-2">
        <Reveal className="order-last lg:order-first lg:-ms-8 xl:-ms-16">
          <Image
            key={img}
            src={img}
            alt={t.ai.alt}
            width={1600}
            height={1000}
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="w-full rounded-[28px]"
          />
        </Reveal>
        <Reveal delay={100}>
          <KickerStatementCopy
            kicker={t.ai.kicker}
            statement={t.ai.statement}
            copy={t.ai.copy}
            link={t.ai.link}
          />
        </Reveal>
      </div>
    </Section>
  );
}
