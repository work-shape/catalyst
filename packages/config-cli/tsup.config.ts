import { defineConfig } from "tsup";

/**
 * The workspace packages this tool is built from. Their source is bundled into `dist`, so
 * the published package depends on third-party packages only. Anything else from the
 * workspace is private: `scripts/release/check-public-tarball.mjs` holds the same list and
 * fails the release when another package reaches the bundle.
 */
const BUNDLED_WORKSPACE_PACKAGES = [
  "@work-shape/catalyst-asset-schemas",
  "@work-shape/catalyst-api-contract",
  "@work-shape/catalyst-api-client"
];

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  noExternal: BUNDLED_WORKSPACE_PACKAGES,
  dts: { resolve: BUNDLED_WORKSPACE_PACKAGES },
  banner: {
    js: "#!/usr/bin/env node"
  }
});
