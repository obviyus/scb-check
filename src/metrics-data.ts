import { z } from "zod";

const line = z.number().int().positive();
const offset = z.number().int().nonnegative();
const span = z.object({ startLine: line, endLine: line });

export const fileMetricsSchema = z.object({
  version: z.literal(1),
  sourceBytes: offset,
  lineStarts: z.array(offset).min(1),
  codeLines: z.array(line),
  functions: z.array(span.extend({ name: z.string(), column: offset, complexity: line })),
  blocks: z.array(span.extend({ signature: z.string().regex(/^[a-f0-9]{64}$/u) })),
});

export type FileMetrics = z.infer<typeof fileMetricsSchema>;
export type FunctionMetrics = FileMetrics["functions"][number];

export const oxlintReportSchema = z.object({
  number_of_files: offset,
  diagnostics: z.array(z.object({
    code: z.string().nullable().optional(),
    message: z.string(),
    filename: z.string(),
    severity: z.string(),
    labels: z.array(z.object({ span: z.object({ offset, length: offset, line, column: line }) })),
  })),
});

export const METRICS_CODE = "slop(file-metrics)";
export const VERBOSITY_RULES = new Set([
  "slop(no-silent-catch-fallback)",
  "slop(no-boolean-return-branches)",
  "slop(no-identical-ternary-branches)",
  "slop(no-nested-only-if)",
  "slop(no-double-assertion)",
  "eslint(no-empty)",
  "eslint(no-useless-catch)",
  "eslint(no-unneeded-ternary)",
]);
