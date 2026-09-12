// src/score.ts
import { relative, resolve } from "node:path";

// src/metrics-data.ts
import { z } from "zod";
var line = z.number().int().positive();
var offset = z.number().int().nonnegative();
var span = z.object({ startLine: line, endLine: line });
var fileMetricsSchema = z.object({
  version: z.literal(1),
  sourceBytes: offset,
  lineStarts: z.array(offset).min(1),
  codeLines: z.array(line),
  functions: z.array(span.extend({ name: z.string(), column: offset, complexity: line })),
  blocks: z.array(span.extend({ signature: z.string().regex(/^[a-f0-9]{64}$/u) }))
});
var oxlintReportSchema = z.object({
  number_of_files: offset,
  diagnostics: z.array(z.object({
    code: z.string().nullable().optional(),
    message: z.string(),
    filename: z.string(),
    severity: z.string(),
    labels: z.array(z.object({ span: z.object({ offset, length: offset, line, column: line }) }))
  }))
});
var METRICS_CODE = "slop(file-metrics)";
var VERBOSITY_RULES = new Set([
  "slop(no-silent-catch-fallback)",
  "slop(no-boolean-return-branches)",
  "slop(no-identical-ternary-branches)",
  "slop(no-nested-only-if)",
  "slop(no-double-assertion)",
  "eslint(no-empty)",
  "eslint(no-useless-catch)",
  "eslint(no-unneeded-ternary)"
]);

// src/score.ts
function lineAtOffset(starts, offset2) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset2)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}
function sum(values) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = total + adjusted;
    compensation = next - total - adjusted;
    total = next;
  }
  return total;
}
function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}
function aggregateScore(input, cwd = process.cwd()) {
  const report = oxlintReportSchema.parse(input);
  const files = new Map;
  const problems = [];
  const diagnostics = report.diagnostics.filter((item) => item.code !== METRICS_CODE);
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.code !== METRICS_CODE)
      continue;
    const file = relative(cwd, resolve(cwd, diagnostic.filename));
    if (files.has(file))
      throw new Error(`Duplicate file metrics for ${file}`);
    const metrics = fileMetricsSchema.parse(JSON.parse(diagnostic.message));
    if (metrics.lineStarts[0] !== 0 || metrics.lineStarts.some((start, index) => start > metrics.sourceBytes || index > 0 && start <= metrics.lineStarts[index - 1])) {
      throw new Error(`Invalid source line offsets for ${file}`);
    }
    if (metrics.codeLines.some((line2, index) => line2 > metrics.lineStarts.length || index > 0 && line2 <= metrics.codeLines[index - 1])) {
      throw new Error(`Invalid source code lines for ${file}`);
    }
    if ([...metrics.functions, ...metrics.blocks].some((span2) => span2.startLine > span2.endLine || span2.endLine > metrics.lineStarts.length)) {
      throw new Error(`Invalid source span for ${file}`);
    }
    files.set(file, metrics);
  }
  if (files.size !== report.number_of_files) {
    problems.push(`Oxlint scanned ${report.number_of_files} files but emitted metrics for ${files.size}. Check parse errors and suppressions of slop/file-metrics.`);
  }
  if (report.number_of_files === 0)
    problems.push("No source files were scanned.");
  const patternLines = new Map;
  const cloneLines = new Map;
  for (const file of files.keys()) {
    patternLines.set(file, new Set);
    cloneLines.set(file, new Set);
  }
  for (const diagnostic of diagnostics) {
    if (!diagnostic.code || !VERBOSITY_RULES.has(diagnostic.code))
      continue;
    const file = relative(cwd, resolve(cwd, diagnostic.filename));
    const metrics = files.get(file);
    if (!metrics)
      continue;
    for (const label of diagnostic.labels) {
      const { offset: offset2, length } = label.span;
      if (offset2 + length > metrics.sourceBytes)
        throw new Error(`Finding extends past source snapshot for ${file}`);
      const startLine = lineAtOffset(metrics.lineStarts, offset2);
      const endLine = lineAtOffset(metrics.lineStarts, length === 0 ? offset2 : offset2 + length - 1);
      for (const line2 of metrics.codeLines) {
        if (line2 >= startLine && line2 <= endLine)
          patternLines.get(file).add(line2);
      }
    }
  }
  const groups = new Map;
  for (const [file, metrics] of files) {
    for (const block of metrics.blocks) {
      const group = groups.get(block.signature);
      const instance = { file, startLine: block.startLine, endLine: block.endLine };
      if (group)
        group.push(instance);
      else
        groups.set(block.signature, [instance]);
    }
  }
  const clones = [...groups.values()].filter((instances) => instances.length > 1).map((instances) => {
    instances.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.endLine - b.endLine);
    for (const instance of instances) {
      for (const line2 of files.get(instance.file).codeLines) {
        if (line2 >= instance.startLine && line2 <= instance.endLine)
          cloneLines.get(instance.file).add(line2);
      }
    }
    return instances;
  }).sort((a, b) => a[0].file.localeCompare(b[0].file) || a[0].startLine - b[0].startLine);
  const functions = [...files].sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, metrics]) => metrics.functions.map((fn) => {
    const sloc2 = metrics.codeLines.filter((line2) => line2 >= fn.startLine && line2 <= fn.endLine).length;
    return { file, ...fn, sloc: sloc2, mass: fn.complexity * Math.sqrt(sloc2) };
  }).sort((a, b) => a.startLine - b.startLine || a.column - b.column));
  const fileScores = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, metrics]) => {
    const localFunctions = functions.filter((fn) => fn.file === file);
    const totalMass2 = sum(localFunctions.map((fn) => fn.mass));
    const highComplexityMass2 = sum(localFunctions.filter((fn) => fn.complexity > 10).map((fn) => fn.mass));
    const flaggedLines2 = new Set([...cloneLines.get(file), ...patternLines.get(file)]).size;
    return {
      file,
      sloc: metrics.codeLines.length,
      cloneLines: cloneLines.get(file).size,
      patternLines: patternLines.get(file).size,
      flaggedLines: flaggedLines2,
      verbosity: ratio(flaggedLines2, metrics.codeLines.length),
      erosion: ratio(highComplexityMass2, totalMass2),
      totalMass: totalMass2,
      highComplexityMass: highComplexityMass2
    };
  });
  const sloc = sum(fileScores.map((file) => file.sloc));
  const flaggedLines = sum(fileScores.map((file) => file.flaggedLines));
  const totalMass = sum(functions.map((fn) => fn.mass));
  const highComplexityMass = sum(functions.filter((fn) => fn.complexity > 10).map((fn) => fn.mass));
  const complete = problems.length === 0;
  return {
    schemaVersion: 1,
    complete,
    problems,
    scores: {
      verbosity: complete ? ratio(flaggedLines, sloc) : null,
      erosion: complete ? ratio(highComplexityMass, totalMass) : null
    },
    totals: {
      filesScanned: report.number_of_files,
      filesMeasured: files.size,
      sloc,
      cloneLines: sum(fileScores.map((file) => file.cloneLines)),
      patternLines: sum(fileScores.map((file) => file.patternLines)),
      flaggedLines,
      functions: functions.length,
      highComplexityFunctions: functions.filter((fn) => fn.complexity > 10).length,
      totalMass,
      highComplexityMass
    },
    method: {
      complexityThreshold: 10,
      complexity: "Classic cyclomatic complexity; nested functions, static blocks and field initializers are separate scopes. Only functions enter erosion.",
      mass: "complexity * sqrt(function SLOC)",
      sourceLines: "Nonblank token lines excluding comments and delimiter-only lines. Function SLOC covers its full source span.",
      clones: "Exact token blocks with at least two statements after excluding empty statements, type aliases, interfaces and declare-function signatures. All copies count, including across files.",
      verbosityRules: [...VERBOSITY_RULES],
      comparison: "SCBench formulas with TypeScript/JavaScript rules and exact-token clones; not directly comparable to published Python benchmark scores."
    },
    files: fileScores,
    functions,
    clones,
    diagnostics
  };
}
export {
  aggregateScore
};
