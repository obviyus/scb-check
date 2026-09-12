# Oxlint Slop

Oxlint rules and verbosity/erosion scores for JavaScript and TypeScript, including JSX and TSX. Findings point to code worth reviewing; they do not prove bad design.

## Install

Requires Oxlint 1.78+.

```bash
bun add --dev oxlint github:obviyus/scb-check
```

In `oxlint.config.ts`:

```typescript
import slop from "@obviyus/oxlint-slop/config";
export default slop;
```

```bash
bunx oxlint .
bunx oxlint --format json .
bunx oxlint --deny-warnings .
```

The preset emits warnings. Custom rules have no automatic fixes.

## Rules

All custom rules use the `slop/` prefix.

| Rule | Flags |
| --- | --- |
| `no-silent-catch-fallback` | Catch only returns empty data or a sentinel |
| `no-boolean-return-branches` | If/else only returns opposite booleans |
| `no-identical-ternary-branches` | Both branches contain the same tokens |
| `no-nested-only-if` | If contains only another if, neither with an else |
| `no-double-assertion` | Cast through `any` or `unknown` |
| `no-duplicate-blocks` | Repeated block tokens within a file |

The preset also enables native `no-empty`, `no-useless-catch`, `no-unneeded-ternary`, and `complexity` above 10 paths. Oxlint's defaults remain active.

For an existing config, register `"@obviyus/oxlint-slop"` in `jsPlugins` and enable individual rules. Standard Oxlint suppression comments apply.

## Scores

```bash
bunx oxlint-slop-score .
bunx oxlint-slop-score . --json
bunx oxlint-slop-score src app --exclude '**/*.test.ts'
```

- **Verbosity:** flagged source lines ÷ total source lines. Comments and delimiter-only lines are excluded; overlapping findings count once.
- **Erosion:** share of function mass in functions with more than 10 independent paths. Mass = `complexity × sqrt(source lines)`.

Scoring runs Oxlint with a fixed preset, independent of project rule configuration. It counts every duplicate copy across files; names and literals must match. JSON includes file/function details, diagnostics, versions, and scope.

Incomplete scans return `null` scores and exit `2`. Undefined ratios are also `null`. Compare the same scope and version; these scores are not directly comparable to SCBench's Python results. [Why scores need judgment](https://earendil.com/posts/measuring-code-sloppiness/).

## Development

```bash
bun install --frozen-lockfile
bun run check
```

`check` typechecks, builds, lints, and tests. Commit the generated `dist/` files; CI checks they match the source.
