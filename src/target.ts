import path from "node:path";
import ts from "typescript";
import { type BranchPoint, collectBranches } from "./scanner.js";
import { canonicalSymbol } from "./symbol.js";

export interface ResolvedTargetAlias {
	alias: ts.TypeAliasDeclaration;
	sourceFile: ts.SourceFile;
	conditional: ts.ConditionalTypeNode;
	paramNames: string[];
	symbol: ts.Symbol;
}

function resolveTargetAlias(
	alias: ts.TypeAliasDeclaration,
	conditional: ts.ConditionalTypeNode,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): ResolvedTargetAlias | undefined {
	const symbol = canonicalSymbol(
		checker.getSymbolAtLocation(alias.name),
		checker,
	);
	if (!symbol) {
		return undefined;
	}

	return {
		alias,
		sourceFile,
		conditional,
		paramNames: (alias.typeParameters ?? []).map((p) => p.name.text),
		symbol,
	};
}

function collectTargetsInSourceFile(
	sourceFile: ts.SourceFile,
	name: string,
	checker: ts.TypeChecker,
): ResolvedTargetAlias[] {
	const targets: ResolvedTargetAlias[] = [];
	for (const node of sourceFile.statements) {
		if (
			ts.isTypeAliasDeclaration(node) &&
			node.name.text === name &&
			ts.isConditionalTypeNode(node.type)
		) {
			const resolved = resolveTargetAlias(node, node.type, sourceFile, checker);
			if (resolved) {
				targets.push(resolved);
			}
		}
	}
	return targets;
}

export function findConditionalTargetsInProgram(
	program: ts.Program,
	name: string,
	checker: ts.TypeChecker,
	targetFilePath?: string,
): ResolvedTargetAlias[] {
	const normalizedTargetFile = targetFilePath
		? path.resolve(targetFilePath)
		: undefined;
	const matches: ResolvedTargetAlias[] = [];

	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) {
			continue;
		}
		if (
			normalizedTargetFile &&
			path.resolve(sourceFile.fileName) !== normalizedTargetFile
		) {
			continue;
		}
		matches.push(...collectTargetsInSourceFile(sourceFile, name, checker));
	}

	return matches;
}

export function findConditionalTargetInSource(
	sourceFile: ts.SourceFile,
	name: string,
	checker: ts.TypeChecker,
): ResolvedTargetAlias | undefined {
	const matches = collectTargetsInSourceFile(sourceFile, name, checker);
	return matches[0];
}

export function collectTargetBranches(
	target: ResolvedTargetAlias,
	projectRoot?: string,
): BranchPoint[] {
	const start = target.alias.type.getStart(target.sourceFile);
	const end = target.alias.type.getEnd();
	return collectBranches(target.sourceFile, projectRoot).filter(
		(b) =>
			b.node.getStart(target.sourceFile) >= start && b.node.getEnd() <= end,
	);
}
