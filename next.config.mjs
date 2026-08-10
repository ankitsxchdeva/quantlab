/** @type {import('next').NextConfig} */

// Three build shapes from one config:
//
//   (default)         `next dev` / `next start` — UI and API on one origin.
//   STATIC_EXPORT=1   static UI for GitHub Pages. No API; the routes are moved
//                     aside by scripts/build-static.mjs because Next cannot
//                     export a POST route handler.
//   DOCKER_BUILD=1    standalone server for the home box, API only in practice.
//
// basePath is only correct for the Pages project site (ankitsxchdeva.github.io
// /quantlab). A custom domain would need it emptied.
const isStaticExport = process.env.STATIC_EXPORT === "1";
const isDockerBuild = process.env.DOCKER_BUILD === "1";
const basePath = process.env.PAGES_BASE_PATH ?? "/quantlab";

const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        basePath,
        assetPrefix: basePath,
        // Pages serves /foo/ as /foo/index.html; without this the routes 404.
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
  ...(isDockerBuild ? { output: "standalone" } : {}),
};

export default nextConfig;
