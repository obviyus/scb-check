#!/usr/bin/env node
import { spawn } from "node:child_process";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { aggregateScore } from "./score.js";

async function main() {
  const { values, positionals } = parseArgs({
    options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" }, exclude: { type: "string", multiple: true }, threads: { type: "string" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log("Usage: oxlint-slop-score [paths...] [--json] [--exclude <glob>] [--threads <count>]");
    return;
  }
  const oxlintPackage = import.meta.resolve("oxlint/package.json");
  const packageSchema = z.object({ name: z.string(), version: z.string() });
  const [checker, oxlint] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then((source) => packageSchema.parse(JSON.parse(source))),
    readFile(new URL(oxlintPackage), "utf8").then((source) => packageSchema.parse(JSON.parse(source))),
  ]);
  const binary = fileURLToPath(new URL("./bin/oxlint", oxlintPackage));
  const args = ["-c", fileURLToPath(new URL("./score-config.js", import.meta.url)), "--disable-nested-config", "--format", "json"];
  for (const pattern of values.exclude ?? []) args.push("--ignore-pattern", pattern);
  if (values.threads) args.push("--threads", values.threads);
  args.push("--", ...(positionals.length ? positionals : ["."]));
  const child = spawn(process.execPath, [binary, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  const [stdout, stderr, exitCode] = await Promise.all([text(child.stdout), text(child.stderr), exited]);
  if (stderr) process.stderr.write(stderr);
  if (exitCode !== 0 && exitCode !== 1) throw new Error(`Oxlint did not complete (exit ${exitCode}): ${stdout || stderr}`);
  const report = {
    ...aggregateScore(JSON.parse(stdout)),
    checker,
    oxlint,
    scope: { paths: positionals.length ? positionals : ["."], exclude: values.exclude ?? [], preset: "oxlint-slop-score" },
  };
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    const percent = (value: number | null) => value === null ? "not available" : `${(value * 100).toFixed(2)}%`;
    console.log(`Verbosity: ${percent(report.scores.verbosity)} (${report.totals.flaggedLines}/${report.totals.sloc} source lines)`);
    console.log(`Erosion: ${percent(report.scores.erosion)} (${report.totals.highComplexityFunctions}/${report.totals.functions} functions exceed 10 paths)`);
    console.log(`Coverage: ${report.totals.filesMeasured}/${report.totals.filesScanned} files measured`);
    console.log(`Duplicate lines: ${report.totals.cloneLines}; pattern lines: ${report.totals.patternLines} (overlap counted once)`);
    for (const problem of report.problems) console.error(problem);
    console.log("TypeScript/JavaScript rule set; compare the same scope and checker revision. Use --json for all file, function, and finding details.");
  }
  process.exitCode = report.complete ? 0 : 2;
}

main().catch((error: Error) => { console.error(`Cannot compute scores: ${error.message}`); process.exitCode = 2; });
