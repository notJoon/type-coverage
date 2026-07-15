import ts from "typescript";
import type { MarginalCost, TypeCheckerProfiler } from "./profile.js";
import { canonicalSymbol, getTypeReferenceSymbol } from "./symbol.js";

export interface TargetInstantiation {
	name: string;
	targetTypeName: string;
	typeArgs: ts.Type[];
	line: number;
	/** Marginal cost of resolving this instantiation's type arguments. */
	cost?: MarginalCost;
}

function collectTargetRefs(
	node: ts.Node,
	targetTypeName: string,
	targetSymbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
	out: ts.TypeReferenceNode[],
): void {
	if (ts.isTypeReferenceNode(node) && node.typeArguments?.length) {
		const refSymbol = canonicalSymbol(
			getTypeReferenceSymbol(node, checker),
			checker,
		);
		if (targetSymbol) {
			if (refSymbol === targetSymbol) {
				out.push(node);
			}
		} else if (
			ts.isIdentifier(node.typeName) &&
			node.typeName.text === targetTypeName
		) {
			out.push(node);
		}
	}
	ts.forEachChild(node, (child) =>
		collectTargetRefs(child, targetTypeName, targetSymbol, checker, out),
	);
}

export function collectInstantiations(
	sourceFile: ts.SourceFile,
	targetTypeName: string,
	checker: ts.TypeChecker,
	targetSymbol?: ts.Symbol,
	profiler?: TypeCheckerProfiler,
): TargetInstantiation[] {
	const instantiations: TargetInstantiation[] = [];
	const canonicalTarget = canonicalSymbol(targetSymbol, checker);

	for (const node of sourceFile.statements) {
		if (!ts.isTypeAliasDeclaration(node)) {
			continue;
		}
		const refs: ts.TypeReferenceNode[] = [];
		collectTargetRefs(
			node.type,
			targetTypeName,
			canonicalTarget,
			checker,
			refs,
		);
		if (refs.length === 0) {
			continue;
		}

		for (const ref of refs) {
			if (!ref.typeArguments) {
				continue;
			}
			const resolveTypeArgs = () =>
				ref.typeArguments?.map((arg) => checker.getTypeFromTypeNode(arg)) ?? [];
			const measured = profiler?.(resolveTypeArgs);
			const typeArgs = measured?.value ?? resolveTypeArgs();
			const line =
				sourceFile.getLineAndCharacterOfPosition(ref.getStart(sourceFile))
					.line + 1;

			instantiations.push({
				name: node.name.text,
				targetTypeName,
				typeArgs,
				line,
				...(measured ? { cost: measured.cost } : {}),
			});
		}
	}

	return instantiations;
}
