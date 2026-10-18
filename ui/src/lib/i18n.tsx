import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * العربية هي اللغة الافتراضية، والإنجليزية بديل كامل البنية. كل نص واجهة يمرّ
 * عبر `t()` حتى يمكن تعريب بقية الشاشات تدريجيًا دون هدم أي شيء.
 *
 * The default language is Arabic and the document direction is set from it, so
 * the whole layout mirrors to RTL. English stays available for engineering and
 * for users who prefer it.
 */
export type Lang = "ar" | "en";

const STORAGE_KEY = "deskvnc.language";

const ar = {
  "app.language": "اللغة",
  "app.arabic": "العربية",
  "app.english": "English",
  "registry.title": "سجل Orax (اختياري)",
  "registry.description":
    "انشر هذه الدعوة كرمز قصير عبر سجلك الخاص. لا يُخزَّن سوى الدعوة، مشفّرة، لدقائق؛ الشاشة والإدخال لا يمرّان عبره.",
  "registry.url": "عنوان السجل",
  "registry.create": "احصل على رمز من السجل",
  "registry.createAnother": "أنشئ رمزًا آخر",
  "registry.copy": "نسخ الرمز",
  "registry.withdraw": "سحب الرمز",
  "registry.ready": "الرمز جاهز، صالح حتى {time}.",
  "registry.withdrawn": "تم سحب الرمز. لا يمكن لأحد استخدامه الآن.",
  "registry.failed": "تعذّر إنشاء الرمز: {reason}",
  "registry.withdrawFailed": "تعذّر سحب الرمز: {reason}",
  "device.number": "رقم هذا الجهاز",
  "device.copyNumber": "نسخ الرقم",
  "device.numberHint": "رقم ثابت لهذا الجهاز لا يتغيّر. اقرأه لمن يساعدك، أو انسخه.",
} as const;

const en: Record<keyof typeof ar, string> = {
  "app.language": "Language",
  "app.arabic": "العربية",
  "app.english": "English",
  "registry.title": "Orax registry (optional)",
  "registry.description":
    "Publish this invitation as a short code through your own registry. Only the invitation is stored, sealed, for minutes; screen and input never go through it.",
  "registry.url": "Registry URL",
  "registry.create": "Get a code from the registry",
  "registry.createAnother": "Create another code",
  "registry.copy": "Copy code",
  "registry.withdraw": "Withdraw",
  "registry.ready": "Code ready, valid until {time}.",
  "registry.withdrawn": "Code withdrawn. Nobody can use it now.",
  "registry.failed": "The code could not be created: {reason}",
  "registry.withdrawFailed": "The code could not be withdrawn: {reason}",
  "device.number": "This computer's number",
  "device.copyNumber": "Copy number",
  "device.numberHint": "A stable number for this computer. Read it to whoever helps you, or copy it.",
};

export type MessageKey = keyof typeof ar;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ar, en };

export interface I18n {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
}

const Context = createContext<I18n | null>(null);

function rememberedLanguage(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // Blocked storage: Arabic, the default, for this run.
  }
  return "ar";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(rememberedLanguage);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const table = dictionaries[lang];
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      t: (key, vars) => {
        let text = table[key] ?? key;
        if (vars) {
          for (const [name, replacement] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(replacement));
          }
        }
        return text;
      },
      setLang: (next) => {
        setLangState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // The choice lasts until the app quits.
        }
      },
    };
  }, [lang]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(Context);
  if (context === null) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

/** Shortcut for components that only format text. */
export function useT(): I18n["t"] {
  return useI18n().t;
}
