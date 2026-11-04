/**
 * Bakes the latest GitHub release into src/lib/tajarib/releases.json so the
 * page's download links are generated at build time — never by calling the
 * GitHub API from a visitor's browser (rate limits, latency, no token).
 *
 * Only the assets that actually exist are recorded. A platform with no asset
 * in the latest release gets `null` and the UI falls back to the releases
 * page instead of a 404 deep link.
 *
 * CI supplies GITHUB_TOKEN automatically; locally it runs unauthenticated.
 * On any failure the previous releases.json is kept and the build proceeds —
 * a stale download link beats a broken build.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "src", "lib", "tajarib", "releases.json");
const FALLBACK = join(ROOT, "src", "lib", "tajarib", "releases.fallback.json");
const REPO = "Mohammedorax/OraxDesk";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

function pick(assets, re) {
  const hit = assets.find((a) => re.test(a.name));
  return hit ? { name: hit.name } : null;
}

try {
  const headers = {
    "User-Agent": "oraxdesk-website",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers,
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const rel = await res.json();

  const assets = rel.assets ?? [];
  const data = {
    tag: rel.tag_name,
    version: rel.tag_name.replace(/^v/, ""),
    page: RELEASES_PAGE,
    source: `https://github.com/${REPO}/archive/refs/heads/main.zip`,
    platforms: {
      windows: {
        // NSIS installer first: it upgrades in place and is the one the
        // README walks people through.
        nsis: pick(assets, /-setup\.exe$/),
        msi: pick(assets, /\.msi$/),
      },
      macos: { dmg: pick(assets, /\.dmg$/) },
      linux: {
        deb: pick(assets, /\.deb$/),
        rpm: pick(assets, /\.rpm$/),
        appImage: pick(assets, /\.AppImage$/),
      },
    },
  };

  // Never regress to a release with fewer platforms than the baked one had:
  // the previous file (if any) stays when this release is a partial upload.
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, "utf8"));
      // Count actual assets (nsis/msi/dmg/deb/rpm/appImage that exist), not
      // platform groups — every group object is present even when empty.
      const count = (p) =>
        Object.values(p?.platforms ?? {})
          .flatMap((group) => Object.values(group ?? {}))
          .filter(Boolean).length;
      if (count(prev) > count(data)) {
        console.log("Latest release has fewer assets than the baked one; keeping it.");
        process.exit(0);
      }
    } catch {
      /* unreadable previous file — overwrite */
    }
  }

  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`releases.json <- ${rel.tag_name} (${assets.length} assets)`);
} catch (err) {
  if (existsSync(FALLBACK) && !existsSync(OUT)) {
    writeFileSync(OUT, readFileSync(FALLBACK, "utf8"));
    console.log(`GitHub fetch failed (${err.message}); used committed fallback.`);
  } else {
    console.warn(
      `GitHub fetch failed (${err.message}); keeping the existing releases.json.`
    );
  }
}
