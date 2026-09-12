# Oxlint Slop

TypeScript Oxlint plugin. `src/plugin.ts` owns custom rules; `src/config.ts` combines them with native Oxlint rules. `src/metrics.ts` emits file metrics from Oxlint's AST. `src/score.ts` aggregates those metrics and diagnostics; the score command launches Oxlint with `src/score-config.ts`.

- Use the Oxlint parser, diagnostics, configuration, and suppression comments.
- Rules flag syntax for review. Do not infer domain correctness or add automatic fixes to design checks.
- Duplicate detection is per file and compares exact tokens after removing whitespace and comments. Preserve identifier and literal values.
- `create` owns file-local state. Never aggregate files in plugin globals: Oxlint runs multiple workers.
- Scores use the union of flagged source lines and complexity-weighted function mass. Preserve the >10 threshold and count every duplicate copy, including across files.
- Scoring has one parser: Oxlint. Keep file discovery and ignores there. Missing metrics make aggregate scores unavailable; never silently drop failed or suppressed files.
- Keep metrics version, score formulas, counted rule IDs, source-line policy, and scope visible in the JSON report. Test hand-calculated scores, overlapping spans, nested functions, Unicode offsets, and incomplete scans.
- Run `bun run check`. Tests exercise the real Oxlint CLI on isolated temporary files.
- Test positive cases, valid lookalikes, TSX, standard suppressions, and worker isolation.
- Keep README examples synchronized with package exports and the recommended configuration.
