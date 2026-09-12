import { createHash } from "node:crypto";
import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";
import { isDuplicateCandidate, tokenSignature } from "./blocks.js";
import type { FileMetrics, FunctionMetrics } from "./metrics-data.js";

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;
const DELIMITERS = new Set(["{", "}", "[", "]", "(", ")", ";", ",", ":"]);

function isFunction(node: ESTree.Node): node is FunctionNode {
  return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
}

function lineSpan(node: ESTree.Node) {
  return { startLine: node.loc.start.line, endLine: node.loc.end.line - (node.loc.end.column === 0 ? 1 : 0) };
}

function functionName(node: FunctionNode, source: SourceCode): string {
  if (node.id) return node.id.name;
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
  if (parent.type === "MethodDefinition" || parent.type === "Property" || parent.type === "PropertyDefinition") return source.getText(parent.key);
  return "(anonymous)";
}

export const fileMetricsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Emit file metrics for oxlint-slop-score; off during normal linting." },
    messages: { metrics: "{{data}}" },
  },
  create(context) {
    const functions = new Map<FunctionNode, FunctionMetrics>();
    const blocks: FileMetrics["blocks"] = [];

    function enterFunction(node: FunctionNode) {
      if (node.body === null) return;
      functions.set(node, { ...lineSpan(node), name: functionName(node, context.sourceCode), column: node.loc.start.column + 1, complexity: 1 });
    }

    function increment(node: ESTree.Node) {
      let child = node;
      let parent = node.parent;
      while (parent !== null && parent.type !== "Program") {
        if (isFunction(parent)) {
          const metric = functions.get(parent);
          if (metric) metric.complexity += 1;
          return;
        }
        // Oxlint treats static blocks and field initializers as separate scopes.
        // They are not functions and do not contribute to function erosion.
        if (parent.type === "StaticBlock" ||
          ((parent.type === "PropertyDefinition" || parent.type === "AccessorProperty") && parent.value === child)) return;
        child = parent;
        parent = parent.parent;
      }
    }

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
      IfStatement: increment,
      ConditionalExpression: increment,
      LogicalExpression: increment,
      ForStatement: increment,
      ForInStatement: increment,
      ForOfStatement: increment,
      WhileStatement: increment,
      DoWhileStatement: increment,
      CatchClause: increment,
      AssignmentPattern: increment,
      SwitchCase(node) { if (node.test !== null) increment(node); },
      AssignmentExpression(node) { if (["&&=", "||=", "??="].includes(node.operator)) increment(node); },
      MemberExpression(node) { if (node.optional) increment(node); },
      CallExpression(node) { if (node.optional) increment(node); },
      BlockStatement(node) {
        if (!isDuplicateCandidate(node)) return;
        blocks.push({ ...lineSpan(node), signature: createHash("sha256").update(tokenSignature(context.sourceCode, node)).digest("hex") });
      },
      "Program:exit"(node) {
        const source = context.sourceCode;
        const codeLines = new Set<number>();
        for (const token of source.getTokens(node)) {
          if (token.type === "Punctuator" && DELIMITERS.has(token.value)) continue;
          for (const [index, text] of source.getText(token).split(/\r\n|[\n\r\u2028\u2029]/u).entries()) {
            if (text.trim()) codeLines.add(token.loc.start.line + index);
          }
        }
        let previous = 0;
        let bytes = source.hasBOM ? 3 : 0;
        const lineStarts = source.lineStartIndices.map((index) => {
          bytes += Buffer.byteLength(source.text.slice(previous, index));
          previous = index;
          return index === 0 ? 0 : bytes;
        });
        const data: FileMetrics = {
          version: 1,
          sourceBytes: Buffer.byteLength(source.text) + (source.hasBOM ? 3 : 0),
          lineStarts,
          codeLines: [...codeLines].sort((a, b) => a - b),
          functions: [...functions.values()],
          blocks,
        };
        context.report({ node, messageId: "metrics", data: { data: JSON.stringify(data) } });
      },
    };
  },
});
