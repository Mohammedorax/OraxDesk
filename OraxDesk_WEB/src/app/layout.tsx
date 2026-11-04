import type { Metadata, Viewport } from "next";
import "./globals.css";

/* The Pages URL (project site) — lets Next resolve absolute OG/Twitter URLs. */
const SITE_URL = "https://mohammedorax.github.io/OraxDesk";

/* Metadata URLs are not treated alike by Next 16: OG/Twitter image paths
   get the basePath prepended automatically (a manual prefix would double
   it), while the icon href is emitted verbatim and needs the Pages prefix
   by hand. NEXT_PUBLIC_BASE_PATH is inlined at build time. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "OraxDesk — كلُّ أجهزتك في نافذةٍ واحدة",
  description:
    "يجمع «أوراكس ديسك» الأجهزة التي تعتني بها في مكتبةٍ واحدة — عبر VNC وRDP وSSH. مكتوب بلغة Rust على Tauri، يعمل على Windows وmacOS وLinux، وبلا حساب ولا تتبّع، حرٌّ ومفتوح المصدر.",
  keywords: [
    "OraxDesk",
    "أوراكس ديسك",
    "remote desktop",
    "VNC",
    "RDP",
    "SSH",
    "MCP",
    "AI agent",
    "Tauri",
    "Rust",
  ],
  authors: [{ name: "OraxDesk" }],
  icons: {
    icon: `${BASE}/oraxdesk.svg`,
  },
  openGraph: {
    title: "OraxDesk — كلُّ أجهزتك في نافذةٍ واحدة",
    description:
      "مكتبةٌ واحدة لكل جهاز تعتني به عبر VNC وRDP وSSH — حرٌّ ومفتوح المصدر. One window for every machine you look after.",
    type: "website",
    url: SITE_URL,
    siteName: "OraxDesk",
    images: [
      {
        /* No manual prefix here — basePath is added automatically. */
        url: "/screens/01-library-dark.png",
        width: 1600,
        height: 1000,
        alt: "مكتبة الأجهزة في أوراكس ديسك — الوضع الداكن",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OraxDesk — كلُّ أجهزتك في نافذةٍ واحدة",
    description:
      "مكتبةٌ واحدة لكل جهاز تعتني به عبر VNC وRDP وSSH — حرٌّ ومفتوح المصدر.",
    images: ["/screens/01-library-dark.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased">
        {/* Follow the system color scheme before first paint — and keep
            following it live (no manual override, no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");var f=function(){document.documentElement.classList.toggle("dark",m.matches)};f();if(m.addEventListener)m.addEventListener("change",f);else if(m.addListener)m.addListener(f);}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
