import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { aggregateScore } from "../src/score.ts";
import type { ScoreReport } from "../src/score.ts";

const directories: string[] = [];
const root = resolve(import.meta.dir, "..");
const binary = join(root, "node_modules/.bin/oxlint");
const config = join(root, "dist/score-config.js");

afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))); });

async function fixture(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "slop-score-"));
  directories.push(directory);
  await Promise.all(Object.entries(files).map(([name, source]) => Bun.write(join(directory, name), source)));
  return directory;
}

async function scan(files: Record<string, string>, flags: string[] = []) {
  const directory = await fixture(files);
  const child = Bun.spawn([binary, "-c", config, "--disable-nested-config", "--format", "json", ...flags, directory], { stdout: "pipe", stderr: "pipe" });
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(error).toBe("");
  expect([0, 1]).toContain(exit);
  return aggregateScore(JSON.parse(output), directory);
}

test("verbosity is flagged source lines, excluding comments and delimiter-only lines", async () => {
  const report = await scan({ "example.ts": `// comment
export function plain() {
  return 1;
}
export function branch(value = 0) {
  // another comment
  try { return value ? true : false; }
  catch { return null; }
}
` });
  expect(report.complete).toBe(true);
  expect(report.totals.sloc).toBe(5);
  expect(report.totals.patternLines).toBe(2);
  expect(report.scores.verbosity).toBe(0.4);
  expect(report.scores.erosion).toBe(0);
  expect(report.functions.map((fn) => [fn.name, fn.complexity, fn.sloc])).toEqual([["plain", 1, 2], ["branch", 4, 3]]);
});

test("all copies of cross-file blocks count and overlapping patterns count once", async () => {
  const report = await scan({
    "first.ts": `export function first() {
try { work(); }
catch { return null; }
return 1;
}`,
    "second.ts": `export function second() {
try { work(); }
catch { return null; }
return 1;
}`,
  });
  expect(report.clones).toHaveLength(1);
  expect(report.clones[0]?.map((instance) => instance.file)).toEqual(["first.ts", "second.ts"]);
  expect(report.totals.sloc).toBe(8);
  expect(report.totals.cloneLines).toBe(8);
  expect(report.totals.patternLines).toBe(2);
  expect(report.totals.flaggedLines).toBe(8);
  expect(report.scores.verbosity).toBe(1);
});

test("nested duplicate spans are unioned rather than added", async () => {
  const source = (name: string) => `export function ${name}() {
if (ready) {
work();
finish();
}
return 1;
}`;
  const report = await scan({ "a.ts": source("a"), "b.ts": source("b") });
  expect(report.clones).toHaveLength(2);
  expect(report.totals.cloneLines).toBe(10);
  expect(report.totals.flaggedLines).toBe(10);
  expect(report.scores.verbosity).toBe(1);
});

test("erosion weights complexity by square root of source lines", async () => {
  const report = await scan({ "functions.ts": `export function complex(n: number) {
if (n === 1) return 1;
if (n === 2) return 2;
if (n === 3) return 3;
if (n === 4) return 4;
if (n === 5) return 5;
if (n === 6) return 6;
if (n === 7) return 7;
if (n === 8) return 8;
if (n === 9) return 9;
if (n === 10) return 10;
return 0;
}
export function simple() { return 1; }
` });
  expect(report.totals.highComplexityFunctions).toBe(1);
  expect(report.totals.functions).toBe(2);
  expect(report.totals.highComplexityMass).toBeCloseTo(38.1051177665);
  expect(report.totals.totalMass).toBeCloseTo(39.1051177665);
  expect(report.scores.erosion).toBeCloseTo(38.1051177665 / 39.1051177665);
});

test("exactly ten paths stays below the erosion threshold", async () => {
  const report = await scan({ "threshold.ts": `export function choose(n: number) {
if (n === 1) return 1; if (n === 2) return 2; if (n === 3) return 3;
if (n === 4) return 4; if (n === 5) return 5; if (n === 6) return 6;
if (n === 7) return 7; if (n === 8) return 8; if (n === 9) return 9;
return 0;
}` });
  expect(report.functions[0]?.complexity).toBe(10);
  expect(report.scores.erosion).toBe(0);
});

test("function counters separate nested functions and class initialization scopes", async () => {
  const report = await scan({ "nested.ts": `export function outer(value = 0) {
const inner = () => value ? 1 : 2;
class Container {
field = value?.name ?? "none";
static { if (ready) work(); }
method() { return value && ready; }
}
if (value) return inner();
return Container;
}` });
  expect(report.functions.map((fn) => [fn.name, fn.complexity])).toEqual([["outer", 3], ["inner", 2], ["method", 2]]);
});

test("complexity includes switch cases, loops, short circuits, defaults and optional chains", async () => {
  const report = await scan({ "decisions.ts": `export function run(value = 0) {
for (let i = 0; i < value; i++) work();
for (const item of items) work(item);
for (const key in object) work(key);
while (ready) work();
do { work(); } while (ready);
switch (value) { case 1: work(); break; case 2: work(); break; default: break; }
value &&= other; value ||= other; value ??= other;
return value?.item?.() ?? (other && fallback);
}` });
  expect(report.functions[0]?.complexity).toBe(16);
});

test.each(["\n", "\r\n", "\u2028"])("finding offsets survive Unicode and line separator %j", async (separator) => {
  const source = [
    '// 😀 before any code',
    'export function render() {',
    'const face = "😀"; try { work(face); } catch {',
    'return null;',
    '}',
    'return <a href="?x=1&font=Name;500"/>;',
    '}',
  ].join(separator);
  const report = await scan({ "unicode.tsx": source });
  expect(report.totals.sloc).toBe(4);
  expect(report.totals.patternLines).toBe(1);
  expect(report.scores.verbosity).toBe(0.25);
});

test("BOM offsets preserve the marked line", async () => {
  const report = await scan({ "bom.ts": '\ufeff// lead\r\nexport const value = flag ? true : false;\r\n' });
  expect(report.totals.sloc).toBe(1);
  expect(report.totals.patternLines).toBe(1);
  expect(report.scores.verbosity).toBe(1);
});

test.each(["", "// comment only\n\n"])("empty code %j has undefined ratios, not a zero quality score", async (source) => {
  const report = await scan({ "empty.ts": source });
  expect(report.complete).toBe(true);
  expect(report.totals.sloc).toBe(0);
  expect(report.scores).toEqual({ verbosity: null, erosion: null });
});

test("an empty scan does not produce scores", () => {
  const report = aggregateScore({ number_of_files: 0, diagnostics: [] });
  expect(report.complete).toBe(false);
  expect(report.scores).toEqual({ verbosity: null, erosion: null });
});

test("suppressed findings do not count toward verbosity", async () => {
  const report = await scan({ "accepted.ts": `// oxlint-disable-next-line slop/no-silent-catch-fallback
export function parse() { try { return work(); } catch { return null; } }` });
  expect(report.scores.verbosity).toBe(0);
});

test("syntax errors make scores unavailable instead of shrinking the denominator", async () => {
  const report = await scan({ "valid.ts": "export const value = 1;", "broken.ts": "const = ;" });
  expect(report.complete).toBe(false);
  expect(report.totals.filesMeasured).toBe(1);
  expect(report.totals.filesScanned).toBe(2);
  expect(report.scores).toEqual({ verbosity: null, erosion: null });
  expect(report.diagnostics.length).toBeGreaterThan(0);
});

test("blanket suppression cannot silently remove a file from metrics", async () => {
  const report = await scan({ "ignored.ts": "/* oxlint-disable */\nexport const value = 1;" });
  expect(report.complete).toBe(false);
  expect(report.scores.verbosity).toBeNull();
});

test("worker count and file order do not change scores or clone grouping", async () => {
  const files = { "b.ts": "export function b() { work(); return 2; }", "a.ts": "export function a() { work(); return 2; }" };
  const single = await scan(files, ["--threads", "1"]);
  const multiple = await scan(files, ["--threads", "4"]);
  expect(single.scores).toEqual(multiple.scores);
  expect(single.totals).toEqual(multiple.totals);
  expect(single.functions).toEqual(multiple.functions);
  expect(single.clones).toEqual(multiple.clones);
});

test("the score command returns both ratios in JSON and honors exclusions", async () => {
  const directory = await fixture({ "clean.ts": "export function clean() { return 1; }", "bad.test.ts": "export const value = flag ? true : false;" });
  const process = Bun.spawn(["node", join(root, "dist/score-cli.js"), "--json", "--exclude", "*.test.ts", directory], { stdout: "pipe", stderr: "pipe" });
  const [output, error, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  expect(error).toBe("");
  expect(exit).toBe(0);
  const report: ScoreReport = JSON.parse(output);
  expect(report.totals.filesScanned).toBe(1);
  expect(report.scores).toEqual({ verbosity: 0, erosion: 0 });
});

test("the score command fails on incomplete scans", async () => {
  const directory = await fixture({ "broken.ts": "const = ;" });
  const process = Bun.spawn(["node", join(root, "dist/score-cli.js"), "--json", directory], { stdout: "pipe", stderr: "pipe" });
  const [output, exit] = await Promise.all([new Response(process.stdout).text(), process.exited]);
  expect(exit).toBe(2);
  const report: ScoreReport = JSON.parse(output);
  expect(report.complete).toBe(false);
  expect(report.scores).toEqual({ verbosity: null, erosion: null });
});
