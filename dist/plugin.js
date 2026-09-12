// src/plugin.ts
import { definePlugin, defineRule as defineRule2 } from "@oxlint/plugins";

// src/blocks.ts
function tokenSignature(source, node) {
  return JSON.stringify(source.getTokens(node).map((token) => [token.type, token.value]));
}
function isDuplicateCandidate(node) {
  return node.body.filter((statement) => statement.type !== "EmptyStatement" && statement.type !== "TSTypeAliasDeclaration" && statement.type !== "TSInterfaceDeclaration" && statement.type !== "TSDeclareFunction").length >= 2;
}

// src/metrics.ts
import { createHash } from "node:crypto";
import { defineRule } from "@oxlint/plugins";
var DELIMITERS = new Set(["{", "}", "[", "]", "(", ")", ";", ",", ":"]);
function isFunction(node) {
  return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
}
function lineSpan(node) {
  return { startLine: node.loc.start.line, endLine: node.loc.end.line - (node.loc.end.column === 0 ? 1 : 0) };
}
function functionName(node, source) {
  if (node.id)
    return node.id.name;
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (parent.type === "MethodDefinition" || parent.type === "Property" || parent.type === "PropertyDefinition")
    return source.getText(parent.key);
  return "(anonymous)";
}
var fileMetricsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Emit file metrics for oxlint-slop-score; off during normal linting." },
    messages: { metrics: "{{data}}" }
  },
  create(context) {
    const functions = new Map;
    const blocks = [];
    function enterFunction(node) {
      if (node.body === null)
        return;
      functions.set(node, { ...lineSpan(node), name: functionName(node, context.sourceCode), column: node.loc.start.column + 1, complexity: 1 });
    }
    function increment(node) {
      let child = node;
      let parent = node.parent;
      while (parent !== null && parent.type !== "Program") {
        if (isFunction(parent)) {
          const metric = functions.get(parent);
          if (metric)
            metric.complexity += 1;
          return;
        }
        if (parent.type === "StaticBlock" || (parent.type === "PropertyDefinition" || parent.type === "AccessorProperty") && parent.value === child)
          return;
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
      SwitchCase(node) {
        if (node.test !== null)
          increment(node);
      },
      AssignmentExpression(node) {
        if (["&&=", "||=", "??="].includes(node.operator))
          increment(node);
      },
      MemberExpression(node) {
        if (node.optional)
          increment(node);
      },
      CallExpression(node) {
        if (node.optional)
          increment(node);
      },
      BlockStatement(node) {
        if (!isDuplicateCandidate(node))
          return;
        blocks.push({ ...lineSpan(node), signature: createHash("sha256").update(tokenSignature(context.sourceCode, node)).digest("hex") });
      },
      "Program:exit"(node) {
        const source = context.sourceCode;
        const codeLines = new Set;
        for (const token of source.getTokens(node)) {
          if (token.type === "Punctuator" && DELIMITERS.has(token.value))
            continue;
          for (const [index, text] of source.getText(token).split(/\r\n|[\n\r\u2028\u2029]/u).entries()) {
            if (text.trim())
              codeLines.add(token.loc.start.line + index);
          }
        }
        let previous = 0;
        let bytes = source.hasBOM ? 3 : 0;
        const lineStarts = source.lineStartIndices.map((index) => {
          bytes += Buffer.byteLength(source.text.slice(previous, index));
          previous = index;
          return index === 0 ? 0 : bytes;
        });
        const data = {
          version: 1,
          sourceBytes: Buffer.byteLength(source.text) + (source.hasBOM ? 3 : 0),
          lineStarts,
          codeLines: [...codeLines].sort((a, b) => a - b),
          functions: [...functions.values()],
          blocks
        };
        context.report({ node, messageId: "metrics", data: { data: JSON.stringify(data) } });
      }
    };
  }
});

// src/plugin.ts
function singleStatement(statement) {
  if (statement.type !== "BlockStatement")
    return statement;
  return statement.body.length === 1 ? statement.body[0] : undefined;
}
function booleanReturn(statement) {
  const single = singleStatement(statement);
  if (single?.type !== "ReturnStatement" || single.argument?.type !== "Literal")
    return;
  const value = single.argument.value;
  return value === true || value === false ? value : undefined;
}
var noSilentCatchFallback = defineRule2({
  meta: {
    type: "suggestion",
    docs: { description: "Report catches that replace every error with empty data." },
    messages: { fallback: "This catch returns only an empty fallback. Review whether callers can distinguish failure from valid empty data; handle a specific error, report it, or let it propagate." }
  },
  create(context) {
    return {
      CatchClause(node) {
        const statement = singleStatement(node.body);
        if (statement?.type !== "ReturnStatement")
          return;
        const value = statement.argument;
        if (value === null || value.type === "Literal" && (value.value === null || value.value === true || value.value === false || value.value === 0 || value.value === "") || value.type === "ArrayExpression" && value.elements.length === 0 || value.type === "ObjectExpression" && value.properties.length === 0) {
          context.report({ node: statement, messageId: "fallback" });
        }
      }
    };
  }
});
var noBooleanReturnBranches = defineRule2({
  meta: {
    type: "suggestion",
    docs: { description: "Report if/else branches that only convert a condition to a boolean." },
    messages: { branches: "Both branches return boolean literals. Use an explicit boolean conversion or negation of the condition to preserve truthiness semantics." }
  },
  create(context) {
    return {
      IfStatement(node) {
        if (node.alternate === null)
          return;
        const consequent = booleanReturn(node.consequent);
        const alternate = booleanReturn(node.alternate);
        if (consequent !== undefined && alternate !== undefined && consequent !== alternate) {
          context.report({ node, messageId: "branches" });
        }
      }
    };
  }
});
var noIdenticalTernaryBranches = defineRule2({
  meta: {
    type: "suggestion",
    docs: { description: "Report conditional expressions with identical branch tokens." },
    messages: { identical: "Both branches contain the same expression. Review the redundant conditional and preserve any side effects in its condition." }
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        if (tokenSignature(context.sourceCode, node.consequent) === tokenSignature(context.sourceCode, node.alternate)) {
          context.report({ node, messageId: "identical" });
        }
      }
    };
  }
});
var noNestedOnlyIf = defineRule2({
  meta: {
    type: "suggestion",
    docs: { description: "Report an if whose only statement is another if without else." },
    messages: { nested: "The outer if contains only another if. Consider combining their conditions with && to reduce nesting." }
  },
  create(context) {
    return {
      IfStatement(node) {
        const inner = singleStatement(node.consequent);
        if (node.alternate === null && inner?.type === "IfStatement" && inner.alternate === null) {
          context.report({ node, messageId: "nested" });
        }
      }
    };
  }
});
var noDoubleAssertion = defineRule2({
  meta: {
    type: "suggestion",
    docs: { description: "Report assertions through any or unknown that bypass assignability." },
    messages: { assertion: "A double assertion bypasses assignability checks. Review the producer and consumer types or validate the value at its input boundary." }
  },
  create(context) {
    function check(node) {
      let inner = node.expression;
      while (inner.type === "ParenthesizedExpression")
        inner = inner.expression;
      if ((inner.type === "TSAsExpression" || inner.type === "TSTypeAssertion") && (inner.typeAnnotation.type === "TSAnyKeyword" || inner.typeAnnotation.type === "TSUnknownKeyword")) {
        context.report({ node, messageId: "assertion" });
      }
    }
    return { TSAsExpression: check, TSTypeAssertion: check };
  }
});
var noDuplicateBlocks = defineRule2({
  meta: {
    type: "suggestion",
    docs: { description: "Report repeated blocks in one file, ignoring whitespace and comments." },
    messages: { duplicate: "This block repeats the tokens of the block at line {{line}}. Review whether these operations should share an implementation." }
  },
  create(context) {
    const blocks = new Map;
    return {
      BlockStatement(node) {
        if (!isDuplicateCandidate(node))
          return;
        const signature = tokenSignature(context.sourceCode, node);
        const group = blocks.get(signature);
        if (group === undefined)
          blocks.set(signature, [node]);
        else
          group.push(node);
      },
      "Program:exit"() {
        for (const group of blocks.values()) {
          const [first, ...duplicates] = group;
          if (first === undefined)
            continue;
          for (const node of duplicates) {
            context.report({ node, messageId: "duplicate", data: { line: first.loc.start.line } });
          }
        }
      }
    };
  }
});
var plugin_default = definePlugin({
  meta: { name: "slop" },
  rules: {
    "file-metrics": fileMetricsRule,
    "no-silent-catch-fallback": noSilentCatchFallback,
    "no-boolean-return-branches": noBooleanReturnBranches,
    "no-identical-ternary-branches": noIdenticalTernaryBranches,
    "no-nested-only-if": noNestedOnlyIf,
    "no-double-assertion": noDoubleAssertion,
    "no-duplicate-blocks": noDuplicateBlocks
  }
});
export {
  plugin_default as default
};
