# Oxlint Slop

TypeScript Oxlint plugin. `src/plugin.ts` owns custom rules; `src/config.ts` combines them with native Oxlint rules. There is no standalone scanner or scoring engine.

- Use the Oxlint parser, diagnostics, configuration, and suppression comments.
- Rules flag syntax for review. Do not infer domain correctness or add automatic fixes to design checks.
- Duplicate detection is per file and compares exact tokens after removing whitespace and comments. Preserve identifier and literal values.
- `create` owns file-local state. Never aggregate files in plugin globals: Oxlint runs multiple workers.
- Run `bun run check`. Tests exercise the real Oxlint CLI on isolated temporary files.
- Test positive cases, valid lookalikes, TSX, standard suppressions, and worker isolation.
- Keep README examples synchronized with package exports and the recommended configuration.
