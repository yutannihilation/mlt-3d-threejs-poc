import { defineConfig } from "vite-plus";

export default defineConfig({
  // A missing tile must be a 404, not the SPA's index.html.
  appType: "mpa",
  // Pre-bundling breaks the package's `import * as wasm from "./mlt_wasm_bg.wasm"`.
  optimizeDeps: { exclude: ["@maplibre/mlt-wasm"] },
  build: { target: "es2023" },
  test: {
    // Its dist/ imports siblings without file extensions, which Node's ESM loader rejects; let Vite resolve them.
    server: { deps: { inline: ["@maplibre/mlt-wasm"] } },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["public/tiles/**"],
  },
  lint: {
    ignorePatterns: ["public/tiles/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
