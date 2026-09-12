import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

interface Diagnostic {
  code: string;
  message: string;
  filename: string;
  labels: { span: { line: number; column: number } }[];
}
interface LintReport {
  diagnostics: Diagnostic[];
  number_of_files: number;
}

const directories: string[] = [];
const binary = resolve(import.meta.dir, "../node_modules/.bin/oxlint");
const config = resolve(import.meta.dir, "../src/config.ts");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function lint(files: Record<string, string>, flags: string[] = []): Promise<LintReport> {
  const directory = await mkdtemp(join(tmpdir(), "oxlint-slop-"));
  directories.push(directory);
  await Promise.all(Object.entries(files).map(([filename, code]) => Bun.write(join(directory, filename), code)));
  const process = Bun.spawn([binary, "-c", config, "--disable-nested-config", "--format", "json", ...flags, directory], {
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode, stdout).toBe(0);
  const report: LintReport = JSON.parse(stdout);
  return report;
}

const cases = [
  {
    rule: "no-silent-catch-fallback",
    invalid: "export function parse(s: string) { try { return JSON.parse(s); } catch { return {}; } }",
    valid: "export function parse(s: string) { try { return JSON.parse(s); } catch (error) { console.error(error); return {}; } }",
  },
  {
    rule: "no-boolean-return-branches",
    invalid: "export function ready(input: string) { if (input) { return true; } else { return false; } }",
    valid: "export function ready(input: string) { if (input) { record(); return true; } else { return false; } }",
  },
  {
    rule: "no-identical-ternary-branches",
    invalid: "export const value = input ? result /* first */ : result;",
    valid: "export const value = input ? first : second;",
  },
  {
    rule: "no-nested-only-if",
    invalid: "if (first) { if (second) { work(); } }",
    valid: "if (first) { if (second) { work(); } else { recover(); } }",
  },
  {
    rule: "no-double-assertion",
    invalid: "export const value = (input as unknown) as Result;",
    valid: "export const value = input satisfies Result;",
  },
  {
    rule: "no-duplicate-blocks",
    invalid: "export function a() { const value = work(); return value + 1; } export function b() { /* same */ const value=work();return value+1; }",
    valid: "export function a() { const value = work(); return value + 1; } export function b() { const value = work(); return value + 2; }",
  },
];

for (const extension of ["ts", "tsx"]) {
  describe(extension, () => {
    for (const { rule, invalid, valid } of cases) {
      test(`${rule} reports the pattern and preserves the valid case`, async () => {
        const report = await lint({ [`invalid.${extension}`]: invalid, [`valid.${extension}`]: valid });
        const findings = report.diagnostics.filter((item) => item.code === `slop(${rule})`);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.filename.endsWith(`invalid.${extension}`)).toBe(true);
        expect(findings[0]?.labels[0]?.span.line).toBe(1);
      });
    }
  });
}

test.each(["js", "jsx", "mjs", "cjs", "mts", "cts"])("supports %s sources", async (extension) => {
  const source = extension === "cjs" ? "module.exports = function ready(input) { if (input) return true; else return false; };" : "export function ready(input) { if (input) return true; else return false; }";
  const report = await lint({ [`case.${extension}`]: source });
  expect(report.number_of_files).toBe(1);
  expect(report.diagnostics.some((item) => item.code === "slop(no-boolean-return-branches)")).toBe(true);
});

test("reuses native Oxlint rules including opt-in type restrictions", async () => {
  const report = await lint({
    "native.ts": "export const anyValue: any = raw; export const value = anyValue!; export const ready = input ? true : false; try { work(); } catch {} try { work(); } catch (e) { throw e; }",
  }, ["-W", "typescript/no-explicit-any", "-W", "typescript/no-non-null-assertion"]);
  expect(new Set(report.diagnostics.map((item) => item.code))).toEqual(new Set([
    "typescript(no-explicit-any)", "typescript(no-non-null-assertion)",
    "eslint(no-unneeded-ternary)", "eslint(no-empty)", "eslint(no-useless-catch)",
  ]));
});

test("reports branch complexity through Oxlint", async () => {
  const report = await lint({ "complex.ts": `export function choose(n: number) {
    if (n === 1) return 1; if (n === 2) return 2; if (n === 3) return 3;
    if (n === 4) return 4; if (n === 5) return 5; if (n === 6) return 6;
    if (n === 7) return 7; if (n === 8) return 8; if (n === 9) return 9;
    if (n === 10) return 10; return 0;
  }` });
  expect(report.diagnostics.some((item) => item.code === "eslint(complexity)")).toBe(true);
});

test("parses raw ampersands in JSX attributes", async () => {
  const report = await lint({ "view.tsx": 'export const View = () => <link href="https://example.com/?a=1&family=Font:wght@400;500&display=swap" />;' });
  expect(report.number_of_files).toBe(1);
  expect(report.diagnostics).toEqual([]);
});

test("honors standard Oxlint suppression comments", async () => {
  const report = await lint({ "case.ts": `
    // oxlint-disable-next-line slop/no-silent-catch-fallback -- Expected absence at the adapter.
    export function load() { try { return work(); } catch { return null; } }
    export function other() { try { return work(); } catch { return []; } }
  ` });
  const findings = report.diagnostics.filter((item) => item.code === "slop(no-silent-catch-fallback)");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.labels[0]?.span.line).toBe(4);
});

test("resets duplicate state between files and worker runs", async () => {
  const source = "export function run() { const result = work(); return result + 1; }";
  const files = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`file-${index}.ts`, source]));
  for (const threads of ["1", "4"]) {
    const report = await lint(files, ["--threads", threads]);
    expect(report.diagnostics.filter((item) => item.code === "slop(no-duplicate-blocks)")).toEqual([]);
  }
});

test("does not flag a pair of type-only blocks or single-statement wrappers", async () => {
  const report = await lint({ "types.ts": `
    export function a() { type X = number; type Y = string; }
    export function b() { type X = number; type Y = string; }
    export function c() { return work(); }
    export function d() { return work(); }
  ` });
  expect(report.diagnostics.filter((item) => item.code.startsWith("slop("))).toEqual([]);
});

test("supports angle assertions in TypeScript", async () => {
  const report = await lint({ "assert.ts": "export const value = <Result><unknown>input;" });
  expect(report.diagnostics.some((item) => item.code === "slop(no-double-assertion)")).toBe(true);
});
