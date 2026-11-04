"use client";

import { LangProvider } from "@/components/tajarib/lang";
import { CursorFollower } from "@/components/tajarib/cursor";
import { SiteHeader } from "@/components/tajarib/nav";
import { Hero } from "@/components/tajarib/hero";
import { Highlights } from "@/components/tajarib/highlights";
import { Comparison } from "@/components/tajarib/comparison";
import { AIFeature } from "@/components/tajarib/features";
import { DownloadSection } from "@/components/tajarib/pricing";
import { SiteFooter } from "@/components/tajarib/footer";

export default function Home() {
  return (
    <LangProvider>
      <CursorFollower />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Highlights />
        <AIFeature />
        <Comparison />
        <DownloadSection />
      </main>
      <SiteFooter />
    </LangProvider>
  );
}
