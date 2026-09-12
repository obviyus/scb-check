import { relative, resolve } from "node:path";
import { fileMetricsSchema, METRICS_CODE, oxlintReportSchema, VERBOSITY_RULES } from "./metrics-data.js";
import type { FileMetrics } from "./metrics-data.js";

type FileScore = {
  file: string;
  sloc: number;
  cloneLines: number;
  patternLines: number;
  flaggedLines: number;
  verbosity: number | null;
  erosion: number | null;
  totalMass: number;
  highComplexityMass: number;
};

function lineAtOffset(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sum(values: number[]): number {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = total + adjusted;
    compensation = (next - total) - adjusted;
    total = next;
  }
  return total;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function aggregateScore(input: unknown, cwd = process.cwd()) {
  const report = oxlintReportSchema.parse(input);
  const files = new Map<string, FileMetrics>();
  const problems: string[] = [];
  const diagnostics = report.diagnostics.filter((item) => item.code !== METRICS_CODE);
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.code !== METRICS_CODE) continue;
    const file = relative(cwd, resolve(cwd, diagnostic.filename));
    if (files.has(file)) throw new Error(`Duplicate file metrics for ${file}`);
    const metrics = fileMetricsSchema.parse(JSON.parse(diagnostic.message));
    if (metrics.lineStarts[0] !== 0 || metrics.lineStarts.some((start, index) =>
      start > metrics.sourceBytes || (index > 0 && start <= metrics.lineStarts[index - 1]!))) {
      throw new Error(`Invalid source line offsets for ${file}`);
    }
    if (metrics.codeLines.some((line, index) => line > metrics.lineStarts.length || (index > 0 && line <= metrics.codeLines[index - 1]!))) {
      throw new Error(`Invalid source code lines for ${file}`);
    }
    if ([...metrics.functions, ...metrics.blocks].some((span) => span.startLine > span.endLine || span.endLine > metrics.lineStarts.length)) {
      throw new Error(`Invalid source span for ${file}`);
    }
    files.set(file, metrics);
  }
  if (files.size !== report.number_of_files) {
    problems.push(`Oxlint scanned ${report.number_of_files} files but emitted metrics for ${files.size}. Check parse errors and suppressions of slop/file-metrics.`);
  }
  if (report.number_of_files === 0) problems.push("No source files were scanned.");

  const patternLines = new Map<string, Set<number>>();
  const cloneLines = new Map<string, Set<number>>();
  for (const file of files.keys()) {
    patternLines.set(file, new Set());
    cloneLines.set(file, new Set());
  }
  for (const diagnostic of diagnostics) {
    if (!diagnostic.code || !VERBOSITY_RULES.has(diagnostic.code)) continue;
    const file = relative(cwd, resolve(cwd, diagnostic.filename));
    const metrics = files.get(file);
    if (!metrics) continue;
    for (const label of diagnostic.labels) {
      const { offset, length } = label.span;
      if (offset + length > metrics.sourceBytes) throw new Error(`Finding extends past source snapshot for ${file}`);
      const startLine = lineAtOffset(metrics.lineStarts, offset);
      const endLine = lineAtOffset(metrics.lineStarts, length === 0 ? offset : offset + length - 1);
      for (const line of metrics.codeLines) {
        if (line >= startLine && line <= endLine) patternLines.get(file)!.add(line);
      }
    }
  }

  const groups = new Map<string, { file: string; startLine: number; endLine: number }[]>();
  for (const [file, metrics] of files) {
    for (const block of metrics.blocks) {
      const group = groups.get(block.signature);
      const instance = { file, startLine: block.startLine, endLine: block.endLine };
      if (group) group.push(instance);
      else groups.set(block.signature, [instance]);
    }
  }
  const clones = [...groups.values()].filter((instances) => instances.length > 1).map((instances) => {
    instances.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.endLine - b.endLine);
    for (const instance of instances) {
      for (const line of files.get(instance.file)!.codeLines) {
        if (line >= instance.startLine && line <= instance.endLine) cloneLines.get(instance.file)!.add(line);
      }
    }
    return instances;
  }).sort((a, b) => a[0]!.file.localeCompare(b[0]!.file) || a[0]!.startLine - b[0]!.startLine);

  const functions = [...files].sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, metrics]) =>
    metrics.functions.map((fn) => {
      const sloc = metrics.codeLines.filter((line) => line >= fn.startLine && line <= fn.endLine).length;
      return { file, ...fn, sloc, mass: fn.complexity * Math.sqrt(sloc) };
    }).sort((a, b) => a.startLine - b.startLine || a.column - b.column));
  const fileScores: FileScore[] = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, metrics]) => {
    const localFunctions = functions.filter((fn) => fn.file === file);
    const totalMass = sum(localFunctions.map((fn) => fn.mass));
    const highComplexityMass = sum(localFunctions.filter((fn) => fn.complexity > 10).map((fn) => fn.mass));
    const flaggedLines = new Set([...cloneLines.get(file)!, ...patternLines.get(file)!]).size;
    return {
      file, sloc: metrics.codeLines.length,
      cloneLines: cloneLines.get(file)!.size, patternLines: patternLines.get(file)!.size,
      flaggedLines, verbosity: ratio(flaggedLines, metrics.codeLines.length),
      erosion: ratio(highComplexityMass, totalMass), totalMass, highComplexityMass,
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
      erosion: complete ? ratio(highComplexityMass, totalMass) : null,
    },
    totals: {
      filesScanned: report.number_of_files, filesMeasured: files.size, sloc,
      cloneLines: sum(fileScores.map((file) => file.cloneLines)),
      patternLines: sum(fileScores.map((file) => file.patternLines)), flaggedLines,
      functions: functions.length, highComplexityFunctions: functions.filter((fn) => fn.complexity > 10).length,
      totalMass, highComplexityMass,
    },
    method: {
      complexityThreshold: 10,
      complexity: "Classic cyclomatic complexity; nested functions, static blocks and field initializers are separate scopes. Only functions enter erosion.",
      mass: "complexity * sqrt(function SLOC)",
      sourceLines: "Nonblank token lines excluding comments and delimiter-only lines. Function SLOC covers its full source span.",
      clones: "Exact token blocks with at least two statements after excluding empty statements, type aliases, interfaces and declare-function signatures. All copies count, including across files.",
      verbosityRules: [...VERBOSITY_RULES],
      comparison: "SCBench formulas with TypeScript/JavaScript rules and exact-token clones; not directly comparable to published Python benchmark scores.",
    },
    files: fileScores,
    functions,
    clones,
    diagnostics,
  };
}

export type ScoreReport = ReturnType<typeof aggregateScore>;
