// autumn — electron-builder configuration (cross-platform).
//
// The old setup had NO build config at all (electron-builder fell back to its
// defaults: the whole repo in the asar, a generic app name, no installer) and
// the build script used Unix `cp -r`, so it could not build on Windows.
//
// This config makes ONE tree build on Windows, macOS and Linux:
//
//   * `files`     — the app tree: the Electron main/preload/IPC/backend, the
//                   packaged Next server is shipped separately (extraResources,
//                   because the standalone server is EXECUTED and must live on
//                   the real disk — an asar cannot be executed by node),
//                   plus the Prisma schema (the CLI needs it at runtime to
//                   create the database in the user's data dir).
//   * `asarUnpack` — the native modules that cannot live inside an asar:
//                   node-pty, Prisma's query engine, sharp.
//   * `win`/`mac`/`linux` — the installers (NSIS + zip, dmg + zip, AppImage +
//                   deb) with the RE's naming convention.
//   * `publish`    — the GitHub provider electron-updater reads (the same
//                   owner/repo the update.ts handler already points at).
//
// The Prisma query engine is platform-specific, so the installer must be
// built on its target OS (the standard electron-builder rule for native
// modules). See autumn/34-packaging.md.

const path = require("node:path");

/** The app's own product identity. */
const APP_NAME = "Autumn";
const APP_ID = "com.autumn.desktop";
const PUBLISH = { provider: "github", owner: "Adi103-ETAI", repo: "autumn" };

/** The icon: a 512×512 PNG is enough — electron-builder converts it to
 *  .ico (Windows) and .icns (macOS) itself. */
const ICON = path.join(__dirname, "assets", "icon.png");

/**
 * The node_modules the Electron MAIN process actually loads at runtime
 * (computed from the installed tree — see scripts/compute-packaging-files.mjs).
 * Everything else is excluded from the asar: it is either bundled into the
 * Next build or only used by the renderer.
 */
function computeKeepList() {
  const file = path.join(__dirname, "assets", "packaging-files.json");
  if (!require("node:fs").existsSync(file)) {
    console.warn("[electron-builder] assets/packaging-files.json is missing — run `npm run pack:files` first");
    return [];
  }
  const data = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
  // electron-builder always copies the production node_modules, so the
  // keep-list has to become an exclusion list.
  const exclude = (data.exclude ?? []).map((pkg) => `!node_modules/${pkg}/**/*`);
  return exclude;
}
const keepList = computeKeepList();

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: APP_ID,
  productName: APP_NAME,
  copyright: "Autumn",
  // Keep the installers out of the repo tree. `build` is gitignored and is
  // where electron-builder writes the icons it generates (icon.ico, icon.icns)
  // — pointing buildResources at the tracked assets/ would dirty the repo.
  directories: {
    output: "release",
    buildResources: "build",
  },
  // The Next server is EXECUTED by node (ELECTRON_RUN_AS_NODE) — it cannot live
  // inside the asar, so it ships as a resource next to app.asar.
  extraResources: [{ from: ".next/standalone", to: "standalone" }],
  files: [
    // The Electron app: main, preload, the IPC layer and the backend bundle.
    "electron/**/*",
    "!electron/backend/**/*.ts",
    "!electron/**/*.test.js",
    // The Prisma schema — the CLI creates the DB in the user's data dir.
    "prisma/**/*",
    "!prisma/db/**/*",
    // The GENERATED Prisma client (prisma/generated) — it carries its own
    // query engine and schema, so it is shipped as part of the app tree.
    "prisma/generated/**/*",
    // The runtime config the packaged app reads.
    "resources/**/*",
    "package.json",
    // The Next server ships SEPARATELY (resources/standalone) and carries its
    // own copies of next/react/sharp. Duplicating them in the asar added
    // ~310 MB to the installer for nothing — so they are excluded here.
    "!node_modules/next/**",
    "!node_modules/@next/**",
    "!node_modules/react/**",
    "!node_modules/react-dom/**",
    "!node_modules/@swc/**",
    "!node_modules/styled-jsx/**",
    "!node_modules/client-only/**",
    "!node_modules/detect-libc/**",
    // The renderer-only dependency tree (radix, lucide, effect, codesandbox,
    // rspack, …) is bundled INTO the Next build — the main process never
    // loads it. The keep-list is computed from the real installed tree by
    // scripts/compute-packaging-files.mjs, so it cannot drift.
    ...keepList,
  ],
  // Native modules and SPAWNABLE tools must be on the real disk, not inside
  // the asar: a child process cannot be executed from inside an asar, and
  // native addons cannot be loaded from one.
  asarUnpack: [
    // The Prisma query engine is a native addon — it cannot be loaded from
    // inside an asar.
    "prisma/generated/**/*.node",
    "prisma/generated/query_engine_bg.wasm",
    "**/node_modules/node-pty/**/*",
    "**/node_modules/@prisma/engines/**/*",
    "**/node_modules/.prisma/**/*",
    "**/node_modules/prisma/**/*",
    "**/node_modules/@remotion/**/*",
    "**/node_modules/remotion/**/*",
    "**/*.node",
  ],
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ],
    icon: ICON,
    // The RE's artifact naming: Autumn-<version>-x64.exe
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  nsis: {
    oneClick: false, // the RE ships a real wizard (Modern UI), not a one-click installer
    perMachine: false, // per-user install by default — no admin rights needed
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: APP_NAME,
    deleteAppDataOnUninstall: false,
    include: null,
  },
  mac: {
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
    icon: ICON,
    category: "public.app-category.productivity",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    hardenedRuntime: false, // no signing identity in this repo — honest, not a broken build
    identity: null,
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    icon: ICON,
    category: "Development",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    desktop: {
      entry: {
        Name: APP_NAME,
        Comment: "Autumn — your local-first AI desktop",
        Categories: "Development;Utility;",
      },
    },
  },
  deb: {
    depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"],
  },
  // electron-updater reads the GitHub releases of this repo.
  publish: [PUBLISH],
  // The packaged app runs the Next standalone server from resources/.
  extraMetadata: {
    main: "electron/main.js",
  },
  compression: "maximum",
  removePackageScripts: true,
  // The native modules we ship are N-API (node-pty) or prebuilt binaries
  // (Prisma's query engine, sharp) — they load as shipped. Rebuilding them
  // needs Visual Studio on Windows and distutils on macOS, and failed on CI
  // (and on any machine without a full C++ toolchain).
  npmRebuild: false,
  buildDependenciesFromSource: false,
};
