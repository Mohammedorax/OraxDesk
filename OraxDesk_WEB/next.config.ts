import type { NextConfig } from "next";

/**
 * The site ships as a fully static export, published to GitHub Pages at
 * https://mohammedorax.github.io/OraxDesk/ — hence the basePath matching the
 * repository name. Images are already optimised at build-prep time
 * (convert_webp.mjs: WebP + AVIF + PNG fallback at 1600/1280/1024), so the
 * runtime optimiser is switched off: with `output: "export"` it cannot run.
 */
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/OraxDesk",
  assetPrefix: "/OraxDesk/",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  /* Inlined into client bundles so hand-written asset paths (screenshot
     srcs, the favicon, OG images) can carry the same prefix. next/image
     with unoptimized:true does NOT add basePath to raw src strings, so the
     site prefixes them itself via NEXT_PUBLIC_BASE_PATH. */
  env: {
    NEXT_PUBLIC_BASE_PATH: "/OraxDesk",
  },
  reactStrictMode: true,
};

export default nextConfig;
