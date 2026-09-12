# Oxlint Slop

An Oxlint plugin for redundant code and error handling that hides failures. Written in TypeScript. Oxlint owns parsing, configuration, suppressions, editor diagnostics, and JSON output.

## Install

Requires Oxlint 1.78 or later. Install from this repository:

```bash
bun add --dev oxlint github:obviyus/scb-check
```

Use the recommended configuration in `oxlint.config.ts`:

```typescript
import slop from "@obviyus/oxlint-slop/config";

export default slop;
```

Run normal Oxlint commands:

```bash
bunx oxlint .
bunx oxlint --format json .
bunx oxlint --deny-warnings .
```

The preset emits warnings. `--deny-warnings` makes warnings fail a check. Nothing is automatically fixed by the custom rules.

## Custom rules

| Rule | Reports |
| --- | --- |
| `slop/no-silent-catch-fallback` | Catch returns only empty data without handling or reporting the error |
| `slop/no-boolean-return-branches` | If/else branches only return opposite boolean literals |
| `slop/no-identical-ternary-branches` | Conditional expression has identical branch tokens |
| `slop/no-nested-only-if` | If contains only another if and neither has an else |
| `slop/no-double-assertion` | Assertion through `any` or `unknown` bypasses assignability |
| `slop/no-duplicate-blocks` | Later copy of a block with at least two executable statements in the same file |

Duplicate checks ignore whitespace and comments but preserve identifiers, operators, and literal values. They do not compare files or infer that different code means the same thing. Type-only blocks and single-statement wrappers are excluded.

The preset also enables native Oxlint rules:

- `no-empty` with empty catches disallowed.
- `no-useless-catch`.
- `no-unneeded-ternary`.
- `complexity` with a maximum of 10 independent paths per function.

Type restrictions such as `typescript/no-explicit-any` and `typescript/no-non-null-assertion` are available from Oxlint. Enable those separately when they fit your project.

## Existing configurations

To select individual custom rules, add the plugin to your existing configuration:

```typescript
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [{ name: "slop", specifier: "@obviyus/oxlint-slop" }],
  rules: {
    "slop/no-silent-catch-fallback": "warn",
    "slop/no-duplicate-blocks": "warn",
  },
});
```

Use standard Oxlint suppressions for accepted cases:

```typescript
// oxlint-disable-next-line slop/no-silent-catch-fallback -- This adapter treats absence as an empty result.
function load() { try { return readExternal(); } catch { return null; } }
```

JavaScript, JSX, TypeScript, TSX, MJS, CJS, MTS, and CTS use Oxlint's native parsers. The plugin has no Python, Tree-sitter, or ast-grep dependency.

## Interpreting findings

Findings are review candidates, not quality grades. A duplicate block can be intentional; a wrapper or validation check can carry a useful contract. Preserve behavior and domain meaning when deciding what to change.

This plugin does not calculate SlopCodeBench's aggregate verbosity or erosion scores. Use rule counts, source locations, and function complexity to locate code worth reviewing. Compare a consistent source scope and configuration over time. See [Measuring code sloppiness](https://earendil.com/posts/measuring-code-sloppiness/) for why optimizing a score alone can make it less useful.

## Development

```bash
bun install --frozen-lockfile
bun run check
```

Tests run the real Oxlint CLI and cover valid cases, reported cases, all supported extensions, suppression comments, and file isolation across workers.

`bun run build` generates the committed JavaScript in `dist/` so consumers need no install scripts or TypeScript loader. Tests also install the packed package and load its exported configuration from `node_modules`. CI checks that `dist/` matches the TypeScript source.
