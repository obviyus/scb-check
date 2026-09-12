// src/plugin.ts
import { definePlugin, defineRule } from "@oxlint/plugins";
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
function tokenSignature(source, node) {
  return JSON.stringify(source.getTokens(node).map((token) => [token.type, token.value]));
}
var noSilentCatchFallback = defineRule({
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
var noBooleanReturnBranches = defineRule({
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
var noIdenticalTernaryBranches = defineRule({
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
var noNestedOnlyIf = defineRule({
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
var noDoubleAssertion = defineRule({
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
var noDuplicateBlocks = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Report repeated blocks in one file, ignoring whitespace and comments." },
    messages: { duplicate: "This block repeats the tokens of the block at line {{line}}. Review whether these operations should share an implementation." }
  },
  create(context) {
    const blocks = new Map;
    return {
      BlockStatement(node) {
        const statements = node.body.filter((statement) => statement.type !== "EmptyStatement" && statement.type !== "TSTypeAliasDeclaration" && statement.type !== "TSInterfaceDeclaration" && statement.type !== "TSDeclareFunction");
        if (statements.length < 2)
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
