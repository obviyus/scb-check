// src/config.ts
import { defineConfig } from "oxlint";
import { fileURLToPath } from "node:url";
var config_default = defineConfig({
  jsPlugins: [{ name: "slop", specifier: fileURLToPath(new URL("./plugin.js", import.meta.url)) }],
  rules: {
    "slop/no-silent-catch-fallback": "warn",
    "slop/no-boolean-return-branches": "warn",
    "slop/no-identical-ternary-branches": "warn",
    "slop/no-nested-only-if": "warn",
    "slop/no-double-assertion": "warn",
    "slop/no-duplicate-blocks": "warn",
    "no-empty": ["warn", { allowEmptyCatch: false }],
    "no-useless-catch": "warn",
    "no-unneeded-ternary": "warn",
    complexity: ["warn", { max: 10 }]
  }
});

// src/score-config.ts
var score_config_default = { ...config_default, rules: { ...config_default.rules, "slop/file-metrics": "warn" } };
export {
  score_config_default as default
};
