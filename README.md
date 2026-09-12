# scb-check

Python CLI that reports SCBench verbosity and erosion composites for supported source codebases.

This fork adds TypeScript slop patterns and TSX, MTS, and CTS scanning. Run this fork with:

```bash
uvx --from git+https://github.com/obviyus/scb-check scb-check check PATH
```

- [Paper](https://arxiv.org/abs/2603.24755)
- [Source](https://github.com/gabeorlanski/scb-check)
- [SlopCodeBench (main repo)](https://github.com/SprocketLab/slop-code-bench)

- **Verbosity**: fraction of SLOC flagged by clone detection, ast-grep slop rules, or structural rules. Python and TypeScript contribute slop-pattern lines; other languages contribute clone lines only.
- **Erosion**: share of function "mass" (`complexity * sqrt(sloc)`) concentrated in high-complexity functions (cyclomatic complexity > 10).
- **Cognitive erosion**: same mass-share calculation using cognitive complexity > 10.

## Install

Requires Python 3.12+.

Run without installing (recommended):

```bash
uvx scb-check check PATH
uvx --from git+https://github.com/gabeorlanski/scb-check scb-check check PATH
```

Or install into the current project:

```bash
uv sync              # for development in this repo
uv add scb-check     # as a dependency elsewhere
```

For hash-checked dependency installs from this repository, use the exported lock files:

```bash
python -m pip install --require-hashes -r requirements.lock
python -m pip install --require-hashes -r requirements-dev.lock
```

Regenerate them after dependency changes with:

```bash
uv export --format requirements.txt --no-dev --no-emit-project --frozen --output-file requirements.lock
uv export --format requirements.txt --all-groups --no-emit-project --frozen --output-file requirements-dev.lock
```

`scb-check` runs bundled ast-grep rules by trying a global `sg` executable first. If global `sg` is missing or fails, it falls back to the `ast-grep-cli` executable installed with `scb-check`.

## Usage

```bash
scb-check check PATH                    # human-readable flags
scb-check check PATH --output-format json  # JSON report with verbosity/erosion scores
scb-check check PATH --report           # shortcut for --output-format json
scb-check check PATH -v / --verbosity   # add info logging
scb-check check PATH -vv                # add debug logging
scb-check check PATH --config FILE      # explicit config path
scb-check check PATH --include-all      # include gitignored files plus ignored, lower-severity, and boundary-suppressed findings
scb-check check PATH --disable-sg  # skip ast-grep subprocess findings
scb-check check PATH --min-duplicate-lines N  # show duplicate groups with at least N SLOC lines
scb-check rule RULE_ID                  # print YAML or metadata for a specific rule
```

`PATH` may be a file or directory. Directories are walked for supported source files: Python (`.py`, `.pyw`), Rust (`.rs`), JavaScript (`.js`, `.mjs`, `.cjs`), TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`), Zig (`.zig`), Haskell (`.hs`), and C++ (`.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`). Directory discovery respects `.gitignore` globs by default; use `--include-all` to scan gitignored supported files too.

### TypeScript checks

TSX uses the JSX grammar. Other TypeScript files retain the TypeScript grammar, including angle-bracket assertions. All variants contribute to the `typescript` report entry. TS and TSX use the same rule definitions and IDs:

| Rule | Default severity | Candidate |
| --- | --- | --- |
| `ts-catch-static-fallback` | warning | Catch returns only an empty fallback |
| `ts-empty-catch` | warning | Catch discards all errors |
| `ts-rethrow-only-catch` | warning | Catch only rethrows its input |
| `ts-boolean-ternary` | warning | Conditional returns boolean literals |
| `ts-boolean-return` | warning | If/else returns boolean literals |
| `ts-identical-ternary-branches` | warning | Both branches contain the same expression |
| `ts-double-assertion` | warning | Assertion through `unknown` or `any` |
| `ts-nested-if` | info | Nested if without another statement or else |
| `ts-explicit-any` | info | Explicit `any` type |
| `ts-non-null-assertion` | info | Non-null assertion |

Informational findings appear with `--include-all`. These checks inspect syntax, not compiler types or runtime intent. Structural wrapper and low-use-helper rules remain Python-only. The TypeScript rule set is smaller than the Python set; their verbosity scores are not directly comparable.

Suppress an accepted case with a line comment or block comment:

```typescript
// scbc ignore[ts-double-assertion] Adapter for the external library's documented contract.
const result = raw as unknown as Result;

function parseExternal(raw: string) {
  // scbc boundary: normalize external input
  return JSON.parse(raw);
}
```

Strings, template text, regex literals, and JSX text cannot create directives. A boundary directive suppresses slop patterns in its containing function. Clone and complexity findings remain visible.

The pinned Tree-sitter grammar can reject valid TSX attributes containing raw ampersands before semicolons, such as a font URL. Affected files are warned about and skipped. Check stderr and `files_scanned` before treating a report as complete; this tool does not replace the TypeScript compiler.

### Reading the scores

Use scores to select code for review and to track a fixed source scope over time. Keep the checker revision, rules, and exclusions fixed when comparing runs. Added source can lower a ratio even when the count of flagged lines rises. Review the absolute counts and named functions alongside the ratios.

A low score does not establish good design or correctness. These metrics do not measure coupling, cohesion, or whether an abstraction fits the domain. Do not remove needed checks, split functions, or add code merely to improve a score. See [Measuring code sloppiness](https://earendil.com/posts/measuring-code-sloppiness/) for the limits of these measures.

### JSON report fields

`verbosity`, `erosion`, `cog_erosion`, `files_scanned`, `total_loc`, `verbosity_flagged_loc`, `clone_loc`, `ast_grep_flagged_loc`, `structural_rule_loc`, `structural_rule_findings`, `total_functions`, `high_cc_functions`, `high_cog_functions`, `total_mass`, `high_cc_mass`, `total_cog_mass`, `high_cog_mass`, `syntax_tree_count`, `syntax_node_count`, and `syntax_by_language`.

`syntax_by_language` is keyed by language value and reports `tree_count` plus total Tree-sitter `node_count` for parsed files in that language.

### Exit codes

`scb-check check` exits `0` when no findings are reported, `1` when any finding is present (clones, ast-grep hits, structural findings, or high-complexity functions), and `2` for usage errors (bad path, missing config, invalid directives).

Clone detection only emits duplicated syntax blocks with at least two executable body statements. Function signatures, comments, blanks, and Python docstrings do not satisfy that threshold; displayed clone line counts and `--min-duplicate-lines` still use duplicated `SLOC` in the clone span.

## Configuration

scb-check looks for `scb-check.toml` or a `pyproject.toml` containing `[tool.scb-check]`, `[tool.ruff]`, or `[tool.ty.src]`, walking upward from the current directory until it hits a `.git` root.

```toml
# scb-check.toml
exclude = ["tests/fixtures/*", "vendor/**"]
context = 1

[low-use-short-function]
enabled = true
max-call-sites = 2
max-function-sloc = 5
max-inline-caller-sloc = 50
max-inline-caller-complexity = 10
max-inline-caller-cognitive-complexity = 10
max-inline-call-nesting = 3
```

```toml
# pyproject.toml
[tool.scb-check]
exclude = ["tests/fixtures/*"]
context = 2

[tool.scb-check.low-use-short-function]
enabled = true
```

- `exclude`: list of glob patterns to skip while discovering supported source files.
- `context`: number of surrounding source lines to show around human-readable ast-grep, structural rule, and erosion findings.
- `low-use-short-function`: opt-in budgets for the short low-use helper rule. Set `enabled = true` to enable it, then tune `max-call-sites`, `max-function-sloc`, `max-inline-caller-sloc`, `max-inline-caller-complexity`, `max-inline-caller-cognitive-complexity`, and `max-inline-call-nesting`.

Configured `exclude` patterns still apply when `--include-all` is used; only `.gitignore` file discovery is extended.

Ast-grep slop rules and source directives support Python and TypeScript. Structural rules remain Python-only. All supported languages participate in SLOC totals, clone detection, cyclomatic erosion, and cognitive erosion.

When using `pyproject.toml`, scb-check also includes excludes from:

- `[tool.ruff].exclude`
- `[tool.ruff].extend-exclude`
- `[tool.ty.src].exclude`

## Source directives

In Python files, you can suppress specific ast-grep or structural rule findings at the source line level with:

```python
# scbc ignore[rule-id]
# scbc ignore[trivial-wrapper]
```

Same-line form:

```python
value = cfg.get("a", {}).get("b", {})  # scbc ignore[chained-dict-get] Boundary normalization for legacy webhook payloads.
```

Standalone block form:

```python
# scbc ignore[chained-dict-get]
# Boundary normalization for legacy webhook payloads.
value = cfg.get("a", {}).get("b", {})
```

Multiple rule IDs:

```python
# scbc ignore[chained-dict-get,dict-get-empty-dict-default]
# Legacy webhook payloads are partially populated and normalized downstream.
value = cfg.get("a", {}).get("b", {})
```

Function-level boundary suppression is available for code that intentionally validates or normalizes external input:

```python
def _load_toml(path: Path) -> dict[str, Any]:
    # scbc boundary: reads and validates user config
    ...
```

Boundary directives must be inside the function body, after the `def` line. By default, ast-grep findings inside that function are hidden, and informational ast-grep rules are omitted. Use `--include-all` to show ignored, informational, and boundary-suppressed ast-grep findings.

Rules:

- Rule IDs inside `ignore[...]` are required.
- Reason text is optional.
- Same-line ignore directives apply to that same physical line.
- Standalone ignore directives apply to the next non-blank, non-comment code line.
- Boundary directives apply to the containing function body.
- Ast-grep and structural rule findings are suppressible; clone and erosion findings are not.
- Invalid directives fail the run with exit code `2` unless `--include-all` is used.

## How it works

- **Tree walking**: language dispatch backed by tree-sitter grammars emits language-agnostic `ModuleIR` and semantic project context.
- **Clone detection**: hashed AST blocks across the scanned set; two or more matching instances become a `CloneBlock`.
- **Slop patterns**: Python and TypeScript ast-grep rules in `src/scb_check/resources/slop_rules/`. The resource loader emits a TSX version of the TypeScript rules with the same IDs.
- **Structural rules**: typed Python classes in `src/scb_check/rules/` run over tree-walking IR. `trivial-wrapper` flags removable single-return pass-through functions (identity returns and calls that only forward parameters to another scanned function), while semantic keep reasons skip constant returns, default-backed value providers, external calls, decorated functions, dunder methods, and inherited API implementations. `low-use-short-function` flags short helpers with few resolved call sites only when inlining them would stay within configured caller SLOC, complexity, cognitive complexity, and nesting budgets.
- **Extra local slop patterns**: set `SCB_CHECK_EXTRA_SLOP_RULES` to a `:`-separated list of YAML paths to layer additional rules on top of the bundled set.
- **Complexity**: per-function cyclomatic and cognitive complexity plus SLOC, combined into mass scores for erosion metrics.

## Documentation

- [Docs index](docs/index.md)
- [Architecture and concepts](docs/architecture.md)
- [Current status and development approach](docs/development.md)

## Development

```bash
uv run pytest
uv run ruff check
uv run ty check src/
```
