"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { content, type Dict, type Lang } from "@/lib/tajarib/content";

/* localStorage as an external store — no setState-in-effect, hydration-safe. */
const STORAGE_KEY = "oraxdesk-lang";
const CHANGE_EVENT = "oraxdesk-lang-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): Lang {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "ar") return stored;
  /* First visit: follow the device language. */
  const device = navigator.language || "ar";
  return device.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function getServerSnapshot(): Lang {
  return "ar";
}

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
  rtl: boolean;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const rtl = lang === "ar";
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (next: Lang) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  const rtl = lang === "ar";

  return (
    <LangContext.Provider value={{ lang, setLang, t: content[lang], rtl }}>
      <div dir={rtl ? "rtl" : "ltr"} className="flex min-h-screen flex-col bg-gallery-white">
        {children}
      </div>
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}
