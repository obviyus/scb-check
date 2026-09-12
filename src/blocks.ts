import type { ESTree, SourceCode } from "@oxlint/plugins";

export function tokenSignature(source: SourceCode, node: ESTree.Node): string {
  return JSON.stringify(source.getTokens(node).map((token) => [token.type, token.value]));
}

export function isDuplicateCandidate(node: ESTree.BlockStatement): boolean {
  return node.body.filter((statement) =>
    statement.type !== "EmptyStatement" && statement.type !== "TSTypeAliasDeclaration" &&
    statement.type !== "TSInterfaceDeclaration" && statement.type !== "TSDeclareFunction").length >= 2;
}
