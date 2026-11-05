"use strict";
// autumn — TypeScript require hook for the Electron main process (Wave-0 migration).
//
// The backend logic lives in `src/lib/autumn/*.ts` (written for the Next server).
// To host that same code in Electron main WITHOUT a bundler or build step, this
// hook transpiles `.ts`/`.tsx` on require using the repo's installed `typescript`
// (devDependency — see PRODUCTION NOTE below) and resolves the `@/*` tsconfig
// alias to `src/*`.
//
// Production note (Wave 2+): packaged builds won't ship `typescript`, so either
// move `typescript` to dependencies or prebundle `electron/backend` (esbuild) at
// `electron:build` time. For dev + tests this hook is enough (AGENTS.md quirk
// compliance: no custom webpack, Next untouched).
//
// Usage: require("./ts-register") once, before requiring any src/ TS module.
// Headless-safe: works under plain `node` (tests) and in Electron main.

const path = require("path");
const fs = require("fs");
const Module = require("module");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  // Lazy so merely loading this file doesn't pull typescript in test procs that
  // don't need it (callers that transpile will get it on first .ts require).
  const ts = require("typescript");

  const SRC = path.resolve(__dirname, "..", "src");

  const compile = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        sourceMap: false,
        inlineSourceMap: false,
        inlineSources: false,
        // transpile-only: types are checked by `npm run lint`/tsc, not here
        noCheck: true,
      },
    });
    module._compile(outputText, filename);
  };

  for (const ext of [".ts", ".tsx"]) {
    require.extensions[ext] = compile;
  }

  // `@/*` alias -> src/* (mirrors tsconfig.json paths).
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (typeof request === "string" && request.startsWith("@/")) {
      request = path.join(SRC, request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };

  // Mark ESM-style `.ts` specifiers as handled for CJS require.
  if (!Module._extensions[".ts"]) Module._extensions[".ts"] = require.extensions[".ts"];
}

register();

module.exports = { register };
