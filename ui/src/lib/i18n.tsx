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
  "registry.healthy": "السجل يعمل.",
  "registry.degraded": "السجل لا يعمل كما ينبغي (قاعدة البيانات: {db}، مفتاح الإغلاق: {key}).",
  "device.number": "رقم هذا الجهاز — اقرأه لمن يساعدك",
  "device.copyNumber": "نسخ الرقم",
  "device.numberHint": "تسعة أرقام ثابتة لهذا الجهاز. اقرأها على الهاتف لمن يساعدك، أو انسخها.",
  "device.id": "معرّف هذا الجهاز، للوصول دون الحضور",
  "device.copyId": "نسخ المعرّف",

  // شريط الاتصال السريع
  "quick.placeholder": "اتصل بعنوان، مثل 192.168.1.20:1 أو rdp://frontdesk  ({key}T)",
  "quick.label": "العنوان الذي تريد الاتصال به",
  "quick.connect": "اتصال",
  "quick.savedHost": "مضيف محفوظ",
  "quick.recent": "مؤخّر",
  "quick.viaSaved": "يتصل عبر {name}",
  "quick.remembered": "يتصل الآن — يُحفظ العنوان في هذه القائمة",
  "quick.chipSaved": "محفوظ",
  "quick.chipDisplay": "{protocol} · شاشة {display}",
  "quick.chipSavedTitle": "{name} محفوظ كـ {protocol}. يتصل هذا العنوان عبر ذلك المضيف.",
  "quick.chipTitle": "اتصل بـ {protocol}. انقر لاستخدام {next} بدلًا منها.",
  "quick.connectTo": "اتصل بـ {target}",

  // نوافذ الدعم عن بُعد
  "support.helpSomeone": "ساعد شخصًا",
  "support.helpSomeoneNow": "يساعدني الآن",
  "support.reachComputer": "أصل إلى جهاز",
  "support.yourName": "اسمك، يظهر أمام الشخص",
  "support.theirCode": "رمزه أو دعوته",
  "support.theirCodePlaceholder": "1234 5678 9012، أو boundary1:…",
  "support.registryUrl": "عنوان سجل Orax (اختياري)",
  "support.registryHint":
    "يُبحث عن الرقم في هذا السجل أولًا. اتركه فارغًا لاستخدام خدمة الرموز بالأسفل.",
  "support.codeServiceUrl": "عنوان خدمة الرموز",
  "support.codeServiceHint":
    "الرمز يحتاج إلى خدمة الرموز نفسها التي استخدمها الشخص. وإلا فاطلب منه نص الدعوة.",
  "support.computerId": "معرّف الجهاز أو رقمه",
  "support.computerIdHint": "اطلب منه الرقم التسعيني، أو المعرّف الكامل من «نسخ المعرّف».",
  "support.notAnId":
    "ليس هذا معرّف جهاز ولا رقمًا. اطلب الرقم التسعيني، أو المعرّف الكامل من «نسخ المعرّف».",
  "support.numberNeedsRegistry": "الرقم يحتاج إلى عنوان سجل بالأعلى، أو المعرّف الكامل.",
  "support.libraryName": "الاسم في مكتبتك",
  "support.unattendedPassword": "كلمة المرور، إن لم يكن أحد هناك للموافقة",
  "support.unattendedPasswordHint":
    "كلمة المرور للجهاز غير المزعج، المضبوطة على ذلك الجهاز. تُحفظ في خزنة مفاتيح نظامك، لا في ملف المكتبة.",
  "support.pasted": "منسوخ من الحافظة.",
  "support.cancel": "إلغاء",
  "support.connect": "اتصال",
  "support.saveAndConnect": "احفظ واتصل",
  "support.opening": "جارٍ الفتح…",

  // نافذة «احصل على المساعدة»
  "gethelp.button": "احصل على مساعدة",
  "gethelp.sharing": "جارٍ المشاركة",
  "gethelp.title": "احصل على مساعدة",
  "gethelp.intro": "اسمح لشخص تثق به برؤية هذا الجهاز أو التحكم فيه. لا يرى شيئًا حتى توافق عليه.",
  "gethelp.close": "إغلاق",
  "gethelp.settings": "الإعدادات",
  "gethelp.loading": "جارٍ فتح نافذة المساعدة…",
  "gethelp.unavailable": "خدمة الدعم غير متاحة في هذه النسخة.",
  "gethelp.shareTitle": "شارك هذا الجهاز",
  "gethelp.shareIntro": "امنح الشخص الذي يساعدك رمزًا واحدًا لكل جلسة. ينتهي خلال ١٠ دقائق إن لم يتصل أحد.",
  "gethelp.getCode": "احصل على رمز",
  "gethelp.createInvitation": "أنشئ دعوة",
  "gethelp.copyCode": "نسخ الرمز",
  "gethelp.copyInvitation": "نسخ الدعوة كاملة",
  "gethelp.readOut": "اقرأه له أو أرسله. يدخله مساعدك، وأنت توافق عليه هنا.",
  "gethelp.endSession": "إنهاء الجلسة",
  "gethelp.unattended": "الوصول دون حضورك",
  "gethelp.paired": "المساعدون المقبولون",

  // جدار الوكلاء
  "wall.idle": "يمسك الإيجار، ولا شيء قيد التنفيذ",
  "wall.stopAll": "أوقفهم كلهم",
  "wall.stopAllTitle": "تسحب الإيجار من كل وكيل على كل جهاز دفعة واحدة",
  "wall.stopAllAskOne": "إيقاف الوكيل على الجهاز الوحيد؟ سيحتاج أن يطلب من جديد.",
  "wall.stopAllAskMany": "إيقاف كل الوكلاء على {count} أجهزة؟ سيحتاجون أن يطلبوا من جديد.",
  "wall.stopAllConfirm": "أوقفهم كلهم",
  "wall.cancel": "إلغاء",
  "wall.explain":
    "وكيل ذكي يقود هذه الأجهزة. كل بطاقة تقول ما يفعله، والمربع يأخذ جهازًا واحدًا. يبقى الشريط هنا حتى حين لا تنظر إليه.",
  "wall.explainHide": "إخفاء هذا الشرح",
  "wall.stopAllDialog": "إيقاف كل الوكلاء",
  "wall.yoursNow": "التحكم لك، وأُوقف الوكيل",
  "wall.tookWheel": "أخذت التحكم من {agent}",
  "wall.doing": "ينفّذ",
  "wall.sent": "أُرسل",
  "wall.refused": "رُفض",
  "wall.failed": "فشل",
  "wall.unread": "غير مقروء",
  "wall.title": "نشاط الوكلاء",
  "wall.planeNone": "لا وكيل متصل",
  "wall.planeIdleOne": "وكيل واحد متصل، لا شيء يقود",
  "wall.planeIdleMany": "{agents} وكلاء متصلون، لا شيء يقاد",
  "wall.planeDrivingOne": "وكيل واحد يقود {driving}",
  "wall.planeDrivingMany": "{agents} وكلاء يقودون {driving}",
  "wall.planeDrivingOneOf": "وكيل واحد يقود {driving} من {sessions}",
  "wall.planeDrivingManyOf": "{agents} وكلاء يقودون {driving} من {sessions}",
  "wall.holderNone": "لا أحد",
  "wall.holderAgent": "وكيل {name}",
  "wall.holderService": "خدمة {name}",
  "wall.holderDriver": "سائق {name}",
  "wall.remoteTerminal": "طرفية البعيد",
  "wall.remoteScreen": "شاشة البعيد",
  "wall.showMachine": "اعرض هذا الجهاز",
  "wall.stopAgent": "أوقف الوكيل الذي يقود {name}، واستعد التحكم",

  "wall.detailNone": "لا وكيل متصل بهذا الجهاز.",
  "wall.detailSessionsOne": "جلسة حيّة واحدة في المجموع.",
  "wall.detailSessionsMany": "{sessions} جلسات حيّة في المجموع.",
  "wall.detailHeldNone": "لا واحد منهم يمسك الإيجار، فلا شيء يُقاد",
  "wall.detailHeldOne": "جهاز واحد يُقاد",
  "wall.detailHeldMany": "{machines} أجهزة تُقاد",
  "wall.detailAttachedOne": "وكيل واحد متصل.",
  "wall.detailAttachedMany": "{agents} وكلاء متصلون.",
  "wall.detailTail":
    "القيادة تعني أن الوكيل يمسك الإيجار؛ والوكيل المتصل الذي لا يمسك شيئًا لا يقود شيئًا",

  // ما يفعله الوكيل، بصيغة إنسان
  "act.click": "ينقر",
  "act.move": "يحرّك المؤشر",
  "act.drag": "يسحب",
  "act.scroll": "يمرّر",
  "act.press": "يضغط مفتاحًا",
  "act.type": "يكتب",
  "act.wait": "ينتظر",
  "act.capture": "يلتقط الشاشة",
  "act.exec": "يشغّل أمرًا",
  "act.declare": "يصرّح",
  "act.sendBytes": "يرسل بيانات",
  "act.tune": "يضبط الاتصال",
  "act.cancel": "يلغي",
  "act.readScreen": "يقرأ الشاشة",
  "act.readClipboard": "يقرأ الحافظة",
  "act.writeClipboard": "يكتب في الحافظة",
  "act.readFile": "يقرأ ملفًا",
  "act.writeFile": "يكتب ملفًا",

  // حقول النموذج
  "field.optional": "(اختياري)",
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
  "registry.healthy": "The registry is working.",
  "registry.degraded": "The registry is not in good shape (database: {db}, sealing key: {key}).",
  "device.number": "This computer's number — read it out",
  "device.copyNumber": "Copy number",
  "device.numberHint":
    "Nine digits that never change for this computer. Read them down the phone to whoever is helping you, or copy them.",
  "device.id": "This computer's ID, for reaching it unattended",
  "device.copyId": "Copy ID",

  // The quick connect bar
  "quick.placeholder": "Connect to an address, e.g. 192.168.1.20:1 or rdp://frontdesk  ({key}T)",
  "quick.label": "Address to connect to",
  "quick.connect": "Connect",
  "quick.savedHost": "saved host",
  "quick.recent": "recent",
  "quick.viaSaved": "Connects through {name}",
  "quick.remembered": "Connects now — the address is remembered in this list",
  "quick.chipSaved": "saved",
  "quick.chipDisplay": "{protocol} · display {display}",
  "quick.chipSavedTitle": "{name} is saved as {protocol}. This address connects through that profile.",
  "quick.chipTitle": "Connect with {protocol}. Click to use {next} instead.",
  "quick.connectTo": "Connect to {target}",

  // The remote support dialogs
  "support.helpSomeone": "Help someone",
  "support.helpSomeoneNow": "Someone asked me for help",
  "support.reachComputer": "A computer I can reach",
  "support.yourName": "Your name, shown to the person",
  "support.theirCode": "Their code or invitation",
  "support.theirCodePlaceholder": "1234 5678 9012, or boundary1:…",
  "support.registryUrl": "Orax registry URL (optional)",
  "support.registryHint":
    "A number is looked up through this registry first. Leave it empty to use the code service below.",
  "support.codeServiceUrl": "Code service URL",
  "support.codeServiceHint":
    "A number needs the same code service the person used. Otherwise ask them for the invitation text.",
  "support.computerId": "Computer ID or number",
  "support.computerIdHint": "Ask them for the number they can read out, or for the full ID from Copy ID.",
  "support.notAnId":
    "That is not a computer ID or a number. Ask for the nine-digit number, or for the full ID from Copy ID.",
  "support.numberNeedsRegistry": "A number needs a registry URL above, or the full ID.",
  "support.libraryName": "Name in your Library",
  "support.unattendedPassword": "Password, if nobody is there to approve you",
  "support.unattendedPasswordHint":
    "The unattended password set on that computer. Kept in your system keychain, never in the Library file.",
  "support.pasted": "Pasted from your clipboard.",
  "support.cancel": "Cancel",
  "support.connect": "Connect",
  "support.saveAndConnect": "Save and connect",
  "support.opening": "Opening…",

  // The "Get help" window
  "gethelp.button": "Get help",
  "gethelp.sharing": "Sharing",
  "gethelp.title": "Get help",
  "gethelp.intro":
    "Let someone you trust see or control this computer. They see nothing until you approve them.",
  "gethelp.close": "Close",
  "gethelp.settings": "Settings",
  "gethelp.loading": "Opening the support window…",
  "gethelp.unavailable": "The support service is not available in this build.",
  "gethelp.shareTitle": "Share this computer",
  "gethelp.shareIntro":
    "One code per session. It expires after 10 minutes if nobody connects.",
  "gethelp.getCode": "Get a code",
  "gethelp.createInvitation": "Create invitation",
  "gethelp.copyCode": "Copy code",
  "gethelp.copyInvitation": "Copy the full invitation instead",
  "gethelp.readOut": "Read it out or send it. Your helper enters it, and you approve them here.",
  "gethelp.endSession": "End session",
  "gethelp.unattended": "Unattended access",
  "gethelp.paired": "Paired helpers",

  // The agent wall
  "wall.idle": "Holding the lease, nothing in flight",
  "wall.stopAll": "Stop all",
  "wall.stopAllTitle": "Take every lease back from every agent, at once",
  "wall.stopAllAskOne": "Stop the agent on the one machine? They will have to ask again.",
  "wall.stopAllAskMany": "Stop every agent on all {count} machines? They will have to ask again.",
  "wall.stopAllConfirm": "Stop them all",
  "wall.cancel": "Cancel",
  "wall.explain":
    "An AI agent is driving these computers. Each card says what it is doing; the square button takes one machine back. The bar stays here even when you are not looking at it.",
  "wall.explainHide": "Hide this explanation",
  "wall.stopAllDialog": "Stop every agent",
  "wall.yoursNow": "Input is yours, the agent was stopped",
  "wall.tookWheel": "You took the wheel from {agent}",
  "wall.doing": "doing",
  "wall.sent": "sent",
  "wall.refused": "refused",
  "wall.failed": "failed",
  "wall.unread": "unread",
  "wall.title": "Agent activity",
  "wall.planeNone": "No agent connected",
  "wall.planeIdleOne": "1 agent connected, none driving",
  "wall.planeIdleMany": "{agents} agents connected, none driving",
  "wall.planeDrivingOne": "1 agent driving {driving}",
  "wall.planeDrivingMany": "{agents} agents driving {driving}",
  "wall.planeDrivingOneOf": "1 agent driving {driving} of {sessions}",
  "wall.planeDrivingManyOf": "{agents} agents driving {driving} of {sessions}",
  "wall.holderNone": "Nobody",
  "wall.holderAgent": "Agent {name}",
  "wall.holderService": "Service {name}",
  "wall.holderDriver": "Driver {name}",
  "wall.remoteTerminal": "remote terminal",
  "wall.remoteScreen": "remote screen",
  "wall.showMachine": "Show this machine",
  "wall.stopAgent": "Stop the agent driving {name}, and take control",
  "wall.detailNone": "No agent is attached to this computer.",
  "wall.detailSessionsOne": "1 session is live in all.",
  "wall.detailSessionsMany": "{sessions} sessions are live in all.",
  "wall.detailHeldNone": "None of them holds a lease, so nothing is being driven",
  "wall.detailHeldOne": "1 machine is being driven",
  "wall.detailHeldMany": "{machines} machines are being driven",
  "wall.detailAttachedOne": "1 agent attached.",
  "wall.detailAttachedMany": "{agents} agents attached.",
  "wall.detailTail":
    "Driving means an agent holds the lease; an attached agent that holds none is driving nothing.",

  // What the agent is doing, in a person's words
  "act.click": "clicking",
  "act.move": "moving the mouse",
  "act.drag": "dragging",
  "act.scroll": "scrolling",
  "act.press": "pressing a key",
  "act.type": "typing",
  "act.wait": "waiting",
  "act.capture": "capturing the screen",
  "act.exec": "running a command",
  "act.declare": "declaring",
  "act.sendBytes": "sending data",
  "act.tune": "tuning the connection",
  "act.cancel": "cancelling",
  "act.readScreen": "reading the screen",
  "act.readClipboard": "reading the clipboard",
  "act.writeClipboard": "writing the clipboard",
  "act.readFile": "reading a file",
  "act.writeFile": "writing a file",

  // Form fields
  "field.optional": "(optional)",
};

export type MessageKey = keyof typeof ar;

/**
 * Every key the catalogue holds.
 *
 * Exported so a test can walk the whole catalogue rather than a hand kept
 * list of it. A list that has to be updated by hand is a list that will be
 * forgotten, and a forgotten key is a key nobody checked.
 */
export const MESSAGE_KEYS = Object.keys(ar) as MessageKey[];

/**
 * The translator, as a value.
 *
 * `t` is a function of the key and its substitutions, so it can be passed
 * down to a helper that is not a component. The keys are checked at the type
 * level: a helper that asks for a key the catalogue does not have will not
 * compile.
 */
export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | boolean>,
) => string;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ar, en };

export interface I18n {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Record<string, string | number | boolean>) => string;
  setLang: (lang: Lang) => void;
}


const Context = createContext<I18n | null>(null);

/**
 * The translator for one language, as a plain function.
 *
 * It lives here rather than inside the provider so that a helper which is not
 * a component can be given one, and so that a test can ask for the English
 * sentence without mounting a provider and a React tree. One implementation,
 * so the interpolation cannot drift between the app and its tests.
 */
export function translatorFor(lang: Lang): Translate {
  const table = dictionaries[lang];
  return (key, vars) => {
    let text = table[key] ?? key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return text;
  };
}

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
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      t: translatorFor(lang),
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

/**
 * Shortcut for components that only format text.
 *
 * It does not throw when there is no provider. `useI18n` does, because a
 * component that wants to CHANGE the language has nowhere to put the change
 * without one, and failing loudly is right. A component that only wants to
 * format a string has a perfectly good answer without one: the language the
 * app would start in.
 *
 * That matters because a component rendered on its own, in a test or in a
 * preview, would otherwise crash on a missing provider rather than on
 * anything to do with the component.
 */
export function useT(): I18n["t"] {
  const context = useContext(Context);
  const fallback = useMemo(() => translatorFor(rememberedLanguage()), []);
  return context?.t ?? fallback;
}
