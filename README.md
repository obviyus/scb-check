# Oxlint Slop

An [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) plugin that flags redundant code and error handling that hides failures: catches that return empty data, `if`/`else` that only returns `true` or `false`, ternaries with identical branches, needless nesting, `as unknown as T` casts, and copy-pasted blocks. Oxlint does the parsing, configuration, suppression comments, editor diagnostics, and output formats. An optional score command aggregates Oxlint's findings and plugin metrics.

## Install

Requires Oxlint 1.78 or later. The package is installed from GitHub:

```bash
bun add --dev oxlint github:obviyus/scb-check
```

## Quick start

Create `oxlint.config.ts` with the preset:

```typescript
import slop from "@obviyus/oxlint-slop/config";

export default slop;
```

Run Oxlint as usual:

```bash
bunx oxlint .                  # report warnings
bunx oxlint --deny-warnings .  # exit non-zero on any warning, for CI
bunx oxlint --format json .    # machine-readable output
```

The preset enables all six `slop/` rules as warnings and adds the four native Oxlint rules listed below, on top of Oxlint's own defaults. The `slop/` rules have no automatic fixes. Each warning marks a place to review, not a proven defect.

## Scores

Run the score command after installing the package:

```bash
bunx oxlint-slop-score .
bunx oxlint-slop-score . --json
bunx oxlint-slop-score src app --exclude '**/*.test.ts'
```

It runs Oxlint once with the packaged scoring preset. Oxlint remains the only parser and file walker. The preset enables `slop/file-metrics` for that run; normal linting does not emit metrics. Scores use this fixed preset rather than your project's custom rules or nested configs. Oxlint's default file ignores apply, and `--exclude` adds ignore patterns.

- **Verbosity** is the union of duplicate-block lines and lines marked by the five custom pattern rules plus native `no-empty`, `no-useless-catch`, and `no-unneeded-ternary`, divided by source lines of code. Complexity warnings do not enter verbosity.
- **Erosion** is the fraction of function mass in functions with more than 10 independent paths. Function mass is `complexity * sqrt(source lines)`.

Source lines contain nonblank tokens; comments and delimiter-only lines do not count. Function source lines cover the full function span. Complexity uses the classic branch count, including defaults, short-circuit operations, and optional chains. Nested functions are counted separately; static blocks and field initializers do not enter function erosion.

Scoring compares duplicate block signatures across all scanned files and counts every copy, including the first. Overlapping duplicate and pattern spans count once. Normal duplicate lint warnings remain within each file. Pattern suppressions apply to verbosity; duplicate line coverage is an independent measurement.

The JSON report includes both ratios on a 0–1 scale, absolute counts, every measured file and function, duplicate groups, original diagnostics, versions, and scope. The text output shows percentages. These use the SCBench formulas with this plugin's JavaScript/TypeScript rules and exact-token duplicate detection; they are not directly comparable to published Python benchmark scores.

A scan with missing file metrics exits `2` and returns `null` scores. This includes parse failures and blanket suppression of `slop/file-metrics`. A valid file with no source lines or functions has an undefined ratio, shown as `null` rather than a zero. A complete scan exits `0` regardless of its scores.

## Rules

### `slop/no-silent-catch-fallback`

Reports a `catch` whose only statement returns nothing, `null`, `true`, `false`, `0`, `""`, `[]`, or `{}`.

```typescript
try { return JSON.parse(text); } catch { return {}; }
```

Callers may not be able to tell failure from a valid empty result. Handle a specific error, report it, or let it propagate. A catch that logs before returning, or returns a non-empty default, is not reported.

### `slop/no-boolean-return-branches`

Reports an `if`/`else` where each branch only returns the opposite boolean literal.

```typescript
if (input) { return true; } else { return false; }
```

Return the converted condition instead, such as `Boolean(input)`. If the branches are reversed, return the negated condition.

### `slop/no-identical-ternary-branches`

Reports a conditional expression whose two branches have the same tokens, ignoring whitespace and comments.

```typescript
const value = flag ? result : result;
```

### `slop/no-nested-only-if`

Reports an `if` whose only statement is another `if`, when neither has an `else`.

```typescript
if (first) { if (second) { work(); } }
```

Review whether the conditions can be combined with `&&`.

### `slop/no-double-assertion`

Reports an assertion that goes through `any` or `unknown`, in either `as` or angle-bracket form.

```typescript
const value = input as unknown as Result;
const other = <Result><unknown>input;
```

Review the producer and consumer types, or validate the value where it enters the program.

### `slop/no-duplicate-blocks`

Reports a block that repeats the tokens of an earlier block in the same file, and names the line of the first copy.

```typescript
export function a() { const value = work(); return value + 1; }
export function b() { const value = work(); return value + 1; } // repeats line 1
```

Whitespace and comments are ignored. Identifiers, literals, and operators must match exactly. A block counts only if it keeps at least two statements after dropping empty statements, type aliases, interfaces, and declared function signatures, so single-statement wrappers and blocks made only of those declarations are not reported.

### Native Oxlint rules in the preset

- `no-empty`, with empty catches disallowed
- `no-useless-catch`
- `no-unneeded-ternary`
- `complexity`, with a maximum of 10 paths per function

`typescript/no-explicit-any` and `typescript/no-non-null-assertion` are not part of the preset. Add them in your config, or on the command line with `-W typescript/no-explicit-any`.

## Use with an existing config

Add the plugin and pick the rules you want. In `oxlint.config.ts`:

```typescript
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: ["@obviyus/oxlint-slop"],
  rules: {
    "slop/no-silent-catch-fallback": "warn",
    "slop/no-duplicate-blocks": "warn",
  },
});
```

Or in `.oxlintrc.json`:

```json
{
  "jsPlugins": ["@obviyus/oxlint-slop"],
  "rules": {
    "slop/no-silent-catch-fallback": "warn",
    "slop/no-duplicate-blocks": "warn"
  }
}
```

Oxlint marks JavaScript plugins and TypeScript config files as experimental.

## Suppress an accepted case

Use standard Oxlint comments:

```typescript
// oxlint-disable-next-line slop/no-silent-catch-fallback -- Absence is a valid empty result for this adapter.
function load() { try { return readExternal(); } catch { return null; } }
```

## Limits

- Rules match syntax only. They do not use type information and cannot judge whether a fallback, duplicate, or cast is intentional. Treat warnings as review prompts, not as a quality score or a sign of who wrote the code.
- `no-silent-catch-fallback` only sees catches whose single statement is a return. Other ways of swallowing errors are not reported.
- `no-duplicate-blocks` works within one file. It does not compare files, and it does not treat renamed variables or changed literals as duplicates.
- Supported file extensions: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`. Your Oxlint ignore settings and rule selection still apply.
- Tested with Oxlint 1.78.0.

For the thinking behind these checks, see [Measuring code sloppiness](https://earendil.com/posts/measuring-code-sloppiness/).

## Development

```bash
bun install --frozen-lockfile
bun run check
```

`bun run check` typechecks, builds `dist/`, lints, and runs the tests. Tests run the real Oxlint CLI on temporary files, cover every rule and file extension, suppression comments, and multi-worker isolation, and install the packed package to load its exported config from `node_modules`.

`dist/` is committed so consumers need no build step. Run `bun run build` after changing `src/`. CI fails if `dist/` differs from the source.
