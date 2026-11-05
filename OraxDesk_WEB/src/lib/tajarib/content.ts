import { releases } from "./releases";

export type Lang = "ar" | "en";

export interface Slide {
  img: string;
  imgDark?: string;
  alt: string;
  title: string;
  copy: string;
}

export interface LinkItem {
  label: string;
  href: string;
}

/** One honest capability card — every claim traced to README.md. */
export interface Fact {
  title: string;
  copy: string;
}

/** A platform download row: deep link when the asset exists in the latest
 *  release, otherwise the releases page (never a link that 404s). */
export interface PlatformItem {
  key: "windows" | "macos" | "linux";
  label: string;
  note: string;
  assets: { label: string; href: string }[];
}

export interface Dict {
  brand: string;
  langSwitch: string;
  nav: LinkItem[];
  localNav: {
    newLabel: string;
    download: string;
  };
  hero: {
    kicker: string;
    newLabel: string;
    titleLines: [string, string];
    sub: string;
    cta: string;
    more: string;
    avail: string;
    img: string;
    imgDark?: string;
    alt: string;
    callout: {
      price: string;
      detail: string;
      cta: string;
    };
  };
  highlights: {
    title: string;
    link: string;
    slides: Slide[];
    pause: string;
    play: string;
    goTo: string;
  };
  ai: {
    kicker: string;
    statement: string;
    copy: string;
    link: string;
    img: string;
    imgDark?: string;
    alt: string;
  };
  facts: {
    kicker: string;
    title: string;
    sub: string;
    cards: Fact[];
  };
  download: {
    kicker: string;
    title: string;
    sub: string;
    primaryNote: string;
    otherLabel: string;
    missingNote: string;
    pageLabel: string;
    sourceLabel: string;
    supportLabel: string;
    supportCopy: string;
    checksumLabel: string;
    platforms: PlatformItem[];
  };
  footer: {
    tagline: string;
    emailLabel: string;
    downloadProject: string;
    columns: { title: string; links: LinkItem[] }[];
    legal: string;
    license: string;
    note: string;
  };
}

/* ------------------------------------------------------------------ */
/* Shared honest strings, built from the baked release data.           */
/* ------------------------------------------------------------------ */

const RELEASE_TAG = releases.tag;
const RELEASE_VERSION = releases.version;

/* Public assets are served under the Pages project path. next/image with
   unoptimized:true does not add basePath to raw src strings, so the site
   prefixes them itself — NEXT_PUBLIC_BASE_PATH is inlined at build time
   from next.config.ts. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const WEBP = {
  libLight: `${BASE}/screens/01-library-light.webp`,
  libDark: `${BASE}/screens/01-library-dark.webp`,
  gridLight: `${BASE}/screens/01b-library-grid-light.webp`,
  gridDark: `${BASE}/screens/01b-library-grid-dark.webp`,
  appearLight: `${BASE}/screens/02-settings-appearance-light.webp`,
  appearDark: `${BASE}/screens/02-settings-appearance-dark.webp`,
  aiLight: `${BASE}/screens/03-settings-ai-light.webp`,
  aiDark: `${BASE}/screens/03-settings-ai-dark.webp`,
};

/** GitHub deep links for the assets that exist; the releases page otherwise. */
type AssetEntry = { name: string } | null;

function assetLinks(
  plat: Record<string, AssetEntry>,
  names: { key: string; label: string }[]
): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  for (const n of names) {
    const asset = plat[n.key];
    if (asset?.name) {
      links.push({
        label: n.label,
        href: `https://github.com/Mohammedorax/OraxDesk/releases/latest/download/${asset.name}`,
      });
    }
  }
  return links;
}

const windowsAssets = assetLinks(releases.platforms.windows, [
  { key: "nsis", label: "Windows · NSIS (exe)" },
  { key: "msi", label: "Windows · MSI" },
]);
const macosAssets = assetLinks(releases.platforms.macos, [
  { key: "dmg", label: "macOS · dmg (universal)" },
]);
const linuxAssets = assetLinks(releases.platforms.linux, [
  { key: "deb", label: "Linux · deb" },
  { key: "rpm", label: "Linux · rpm" },
  { key: "appImage", label: "Linux · AppImage" },
]);

const ar: Dict = {
  brand: "أوراكس ديسك",
  langSwitch: "التبديل إلى الإنجليزية",
  nav: [
    { label: "المزايا", href: "#highlights" },
    { label: "المساعد الذكي", href: "#ai" },
    { label: "تحت الغطاء", href: "#facts" },
    { label: "التنزيل", href: "#download" },
    { label: "الدعم", href: "#support" },
  ],
  localNav: {
    newLabel: "جديد",
    download: "تنزيل",
  },
  hero: {
    kicker: "أوراكس ديسك",
    newLabel: "جديد",
    titleLines: ["كل أجهزتك.", "في نافذة واحدة."],
    sub: "أوراكس ديسك يجمع أجهزتك التي تعتني بها في مكتبة واحدة — عبر VNC وRDP وSSH. مكتوب بلغة Rust على Tauri، يعمل على Windows وmacOS وLinux، وبلا حساب ولا تتبّع.",
    cta: "نزّله مجانًا",
    more: "اكتشف المزيد",
    avail: `الإصدار ${RELEASE_VERSION} · مجاني ومفتوح المصدر`,
    img: WEBP.libLight,
    imgDark: WEBP.libDark,
    alt: "مكتبة الأجهزة في تطبيق أوراكس ديسك بالوضع الفاتح: قائمة بالأجهزة مع المجموعات والبروتوكولات ووقت آخر اتصال",
    callout: {
      price: "مجاني ومفتوح المصدر",
      detail: "‏MIT OR Apache-2.0 — بلا خطط مدفوعة ولا ميزة محجوزة",
      cta: "احصل عليه",
    },
  },
  highlights: {
    title: "أبرز المزايا",
    link: "استكشف المزيد",
    slides: [
      {
        img: WEBP.libLight,
        imgDark: WEBP.libDark,
        alt: "عرض قائمة المكتبة: كل جهاز مع العنوان والمجموعة والبروتوكول وآخر اتصال",
        title: "مكتبة منظمة",
        copy: "كل جهاز في مكانه: عنوان يكتب كما تفكّر فيه، ومجموعة، وبروتوكول، وآخر تواصل.",
      },
      {
        img: WEBP.gridLight,
        imgDark: WEBP.gridDark,
        alt: "عرض شبكة المكتبة: بطاقات لكل جهاز مع نظام التشغيل والبروتوكول",
        title: "عرض شبكي أنيق",
        copy: "بطاقة لكل جهاز بنظامه وبروتوكوله، واتصال بنقرة مزدوجة.",
      },
      {
        img: WEBP.appearLight,
        imgDark: WEBP.appearDark,
        alt: "إعدادات المظهر في أوراكس ديسك مع خيارات الفاتح والداكن وتابع النظام",
        title: "مظهر يشبهك",
        copy: "فاتح أو داكن أو تبعًا لنظامك — بلمسة واحدة، بالعربية أولًا.",
      },
      {
        img: WEBP.aiLight,
        imgDark: WEBP.aiDark,
        alt: "إعدادات وكلاء الذكاء الاصطناعي: الموافقة على الأجهزة المصرّح بها",
        title: "وكلاء بموافقتك",
        copy: "ربط وكلاء الذكاء الاصطناعي بأجهزتك، وكل فتح وتنفيذ أمر بعلمك وموافقتك.",
      },
    ],
    pause: "إيقاف التمرير التلقائي",
    play: "تشغيل التمرير التلقائي",
    goTo: "الانتقال إلى الشريحة",
  },
  ai: {
    kicker: "مستوى التحكم للوكلاء",
    statement: "دَع الوكيل يقود نفس الجهاز الذي تقودَه أنت.",
    copy: "أوراكس ديسك يصل وكلاء مثل Claude Code وOpenCode بجلساتك عبر VNC وRDP وSSH — بلا تثبيت أي شيء على الجهاز البعيد. النظر والتقاط مجانيان، أما فتح جهاز أو تنفيذ أمر فلا يحدثان إلا بموافقتك، ويمكنك سحب العجلة من الوكيل بنقرة واحدة في أي لحظة.",
    link: "اعرف أكثر عن الطبقة",
    img: WEBP.aiLight,
    imgDark: WEBP.aiDark,
    alt: "لوحة وكلاء الذكاء الاصطناعي في أوراكس ديسك بالوضع الداكن: الموافقات والأجهزة المصرّح بها",
  },
  facts: {
    kicker: "تحت الغطاء",
    title: "بُني ليعمل بلا مفاجآت.",
    sub: "ثلاثة أنوية بروتوكول مكتوبة هنا من الصفر — ليست أغلفة حول مكتبات الغير.",
    cards: [
      {
        title: "أنوية بروتوكول أصيلة",
        copy: "VNC ‏(RFB 3.3–3.8 مع كل الترميزات الشائعة وVeNCrypt وRA2)، وRDP بنظام NLA، وSSH بمحطة تنجو من الانقطاع وSFTP — مقابل خوادم حقيقية: x11vnc وTigerVNC وQEMU وRealVNC ومشاركة شاشة macOS.",
      },
      {
        title: "كلمات السر في خزنة نظامك",
        copy: "الأسرار تعيش في Keychain وCredential Manager وSecret Service — لا في قاعدة بيانات بجوار الملفات الشخصية، مع اختبار يضمن ألا يُكتب شيء حسّاس فيها.",
      },
      {
        title: "فكّ ترميز في Rust ورسم عبر WebGL2",
        copy: "الإطارات الكاملة لا تعبر حدود العملية، وH.264 يُفكّك بتسريع عتادي حيث تتيح الواجهة — فتبقى الحركة سلسة والذاكرة هادئة.",
      },
      {
        title: "جلسات متعددة في نافذة واحدة",
        copy: "كل جلسة تبويب، وكل تبويب ينقسم ألواحًا يحمل كلًّا منها جهازًا وبروتوكولًا مختلفًا: سطح Windows عبر RDP بجوار سطر أوامر SSH أمرٌ عادي هنا.",
      },
      {
        title: "الصورة تعود إن قُطعت",
        copy: "الجلسة التي تنقطع تعود من تلقاء نفسها وتخبرك بما حدث، وعجلة التمرير واللوحة الملموسة تتصرفان على البعيد كما تتصرفان على جهازك.",
      },
      {
        title: "بلا حساب ولا تتبّع",
        copy: "لا حساب، ولا قياسات استخدام، ولا شريحة مدفوعة تحجز ميزة. المشروع حر ومفتوح المصدر تحت MIT أو Apache-2.0.",
      },
    ],
  },
  download: {
    kicker: "التنزيل",
    title: "احصل على أوراكس ديسك.",
    sub: `الإصدار ${RELEASE_VERSION} (${RELEASE_TAG}) — نُزل ملف المنصة التي تستعملها، أو من صفحة الإصدارات مباشرة.`,
    primaryNote: "اكتشفنا منصّتك تلقائيًا",
    otherLabel: "منصات أخرى",
    missingNote: "لم يُرفع لهذا الإصدار بعد — من صفحة الإصدارات",
    pageLabel: "صفحة الإصدارات",
    sourceLabel: "المصدر (ZIP)",
    supportLabel: "أوراكس ديسك للدعم",
    supportCopy:
      "لتقديم العون لشخص خارج شبكتك: تطبيق صغير يعمل دون تثبيت، يحصل على رمز وتوافق على الاتصال — متاح لـmacOS وWindows وLinux في صفحة الإصدار نفسها.",
    checksumLabel: "مجاميع التحقق SHA-256 مرفقة بكل ملف في صفحة الإصدار.",
    platforms: [
      {
        key: "windows",
        label: "Windows",
        note: "‏10/11 ‏x64 · مثبّت NSIS أو MSI",
        assets:
          windowsAssets.length > 0
            ? windowsAssets
            : [{ label: "من صفحة الإصدارات", href: releases.page }],
      },
      {
        key: "macos",
        label: "macOS",
        note: "‏Apple Silicon وIntel معًا · موقّع وموثّق",
        assets:
          macosAssets.length > 0
            ? macosAssets
            : [{ label: "من صفحة الإصدارات", href: releases.page }],
      },
      {
        key: "linux",
        label: "Linux",
        note: "‏deb · rpm · AppImage",
        assets:
          linuxAssets.length > 0
            ? linuxAssets
            : [{ label: "من صفحة الإصدارات", href: releases.page }],
      },
    ],
  },
  footer: {
    tagline: "نافذة واحدة لكل جهاز تعتني به — عبر VNC وRDP وSSH.",
    emailLabel: "راسلنا عبر البريد",
    downloadProject: "المصدر (ZIP)",
    columns: [
      {
        title: "المشروع",
        links: [
          { label: "المستودع على GitHub", href: "https://github.com/Mohammedorax/OraxDesk" },
          { label: "صفحة الإصدارات", href: releases.page },
          { label: "الإبلاغ عن مشكلة", href: "https://github.com/Mohammedorax/OraxDesk/issues" },
        ],
      },
      {
        title: "الوثائق",
        links: [
          { label: "دليل التثبيت", href: "https://github.com/Mohammedorax/OraxDesk/blob/main/docs/INSTALL.md" },
          { label: "بنية المشروع", href: "https://github.com/Mohammedorax/OraxDesk/blob/main/docs/ARCHITECTURE.md" },
          { label: "قيادة الجهاز بواسطة وكيل", href: "https://github.com/Mohammedorax/OraxDesk/blob/main/docs/AGENTS.md" },
        ],
      },
    ],
    legal: "© 2026 OraxDesk. جميع الحقوق محفوظة.",
    license: "‏MIT OR Apache-2.0",
    note: "صُنع بحب في اليمن.",
  },
};

const en: Dict = {
  brand: "OraxDesk",
  langSwitch: "Switch to Arabic",
  nav: [
    { label: "Highlights", href: "#highlights" },
    { label: "Agent Plane", href: "#ai" },
    { label: "Under the hood", href: "#facts" },
    { label: "Download", href: "#download" },
    { label: "Support", href: "#support" },
  ],
  localNav: {
    newLabel: "New",
    download: "Download",
  },
  hero: {
    kicker: "OraxDesk",
    newLabel: "New",
    titleLines: ["All your machines.", "One window."],
    sub: "OraxDesk gathers the machines you look after into a single library — over VNC, RDP and SSH. Written in Rust on Tauri, running on Windows, macOS and Linux, with no account and no telemetry.",
    cta: "Download free",
    more: "Discover more",
    avail: `Version ${RELEASE_VERSION} · free and open source`,
    img: WEBP.libLight,
    imgDark: WEBP.libDark,
    alt: "The OraxDesk device library in light mode: a detailed list of machines with groups, protocols and last contact",
    callout: {
      price: "Free and open source",
      detail: "MIT OR Apache-2.0 — no paid tier holding a feature back",
      cta: "Get it",
    },
  },
  highlights: {
    title: "Highlights",
    link: "Explore more",
    slides: [
      {
        img: WEBP.libLight,
        imgDark: WEBP.libDark,
        alt: "Library list view: every machine with address, group, protocol and last contact",
        title: "An organized library",
        copy: "Every machine in its place — an address written the way you think of it, a group, a protocol, and last contact.",
      },
      {
        img: WEBP.gridLight,
        imgDark: WEBP.gridDark,
        alt: "Library grid view: visual cards for each machine with OS and protocol",
        title: "Grid view, refined",
        copy: "A card for every machine — its system and protocol, connected on a double click.",
      },
      {
        img: WEBP.appearLight,
        imgDark: WEBP.appearDark,
        alt: "OraxDesk appearance settings with light, dark and system options",
        title: "An appearance that fits",
        copy: "Light, dark, or follow the system — one click, Arabic first.",
      },
      {
        img: WEBP.aiLight,
        imgDark: WEBP.aiDark,
        alt: "OraxDesk AI agents settings: consents and approved machines",
        title: "Agents with your consent",
        copy: "Connect AI agents to your machines — every open and command runs with your knowledge and approval.",
      },
    ],
    pause: "Pause auto-advance",
    play: "Resume auto-advance",
    goTo: "Go to slide",
  },
  ai: {
    kicker: "The agent control plane",
    statement: "Let an agent drive the same machine you drive.",
    copy: "OraxDesk hands agents like Claude Code and OpenCode your sessions over VNC, RDP and SSH — nothing installed on the far end. Looking and capturing are free; opening a machine or running a command happens only with your consent, and you can take the wheel back with one click at any moment.",
    link: "More about the plane",
    img: WEBP.aiLight,
    imgDark: WEBP.aiDark,
    alt: "The OraxDesk AI agents panel in dark mode: consents and approved machines",
  },
  facts: {
    kicker: "Under the hood",
    title: "Built to work without surprises.",
    sub: "Three protocol cores written here from scratch — not wrapped around somebody else's library.",
    cards: [
      {
        title: "First-party protocol cores",
        copy: "VNC (RFB 3.3–3.8 with every common encoding, VeNCrypt, RA2), RDP with NLA, and SSH with a terminal that survives a drop and SFTP — filed against real servers: x11vnc, TigerVNC, QEMU, RealVNC and macOS Screen Sharing.",
      },
      {
        title: "Secrets in your OS keychain",
        copy: "Credentials live in Keychain Services, Credential Manager or Secret Service — not in a database next to the profiles, with a test asserting nothing sensitive is written there.",
      },
      {
        title: "Decoded in Rust, painted via WebGL2",
        copy: "Whole frames never cross the process boundary, and H.264 decodes with hardware acceleration where the webview offers it — motion stays smooth and memory stays quiet.",
      },
      {
        title: "Several machines, one window",
        copy: "Every session is a tab, and any tab splits into panes each holding a different machine and protocol: a Windows desktop over RDP next to an SSH shell is an ordinary arrangement.",
      },
      {
        title: "A session that comes back",
        copy: "A dropped session reconnects on its own and tells you what happened; your scroll wheel and trackpad behave on the remote exactly as they do on your own machine.",
      },
      {
        title: "No account, no telemetry",
        copy: "No account, no usage measurements, no paid tier holding a feature back. The project is free and open source under MIT or Apache-2.0.",
      },
    ],
  },
  download: {
    kicker: "Download",
    title: "Get OraxDesk.",
    sub: `Version ${RELEASE_VERSION} (${RELEASE_TAG}) — grab the file for your platform, or visit the releases page directly.`,
    primaryNote: "We detected your platform automatically",
    otherLabel: "Other platforms",
    missingNote: "not yet uploaded for this release — via the releases page",
    pageLabel: "Releases page",
    sourceLabel: "Source (ZIP)",
    supportLabel: "OraxDesk Support",
    supportCopy:
      "To help someone outside your network: a small app that runs without installing — they get a code and approve your connection. Available for macOS, Windows and Linux on the same release page.",
    checksumLabel: "SHA-256 checksums ship beside every file on the release page.",
    platforms: [
      {
        key: "windows",
        label: "Windows",
        note: "10/11 x64 · NSIS installer or MSI",
        assets:
          windowsAssets.length > 0
            ? windowsAssets
            : [{ label: "From the releases page", href: releases.page }],
      },
      {
        key: "macos",
        label: "macOS",
        note: "Apple Silicon and Intel · signed and notarized",
        assets:
          macosAssets.length > 0
            ? macosAssets
            : [{ label: "From the releases page", href: releases.page }],
      },
      {
        key: "linux",
        label: "Linux",
        note: "deb · rpm · AppImage",
        assets:
          linuxAssets.length > 0
            ? linuxAssets
            : [{ label: "From the releases page", href: releases.page }],
      },
    ],
  },
  footer: {
    tagline: "One window for every machine you look after — over VNC, RDP and SSH.",
    emailLabel: "Write to us by email",
    downloadProject: "Source (ZIP)",
    columns: [
      {
        title: "Project",
        links: [
          { label: "Repository on GitHub", href: "https://github.com/Mohammedorax/OraxDesk" },
          { label: "Releases page", href: releases.page },
          { label: "Report an issue", href: "https://github.com/Mohammedorax/OraxDesk/issues" },
        ],
      },
      {
        title: "Documentation",
        links: [
          { label: "Install guide", href: "https://github.com/Mohammedorax/OraxDesk/blob/main/docs/INSTALL.md" },
          { label: "Architecture", href: "https://github.com/Mohammedorax/OraxDesk/blob/main/docs/ARCHITECTURE.md" },
          { label: "Driving a machine by agent", href: "https://github.com/Mohammedorax/OraxDesk/blob/main/docs/AGENTS.md" },
        ],
      },
    ],
    legal: "© 2026 OraxDesk. All rights reserved.",
    license: "MIT OR Apache-2.0",
    note: "Crafted with love in Yemen.",
  },
};

export const content: Record<Lang, Dict> = { ar, en };
