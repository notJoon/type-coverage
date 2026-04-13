import path from "node:path";
import ts from "typescript";

export interface TraceResult {
	branchId: string;
	taken: "true" | "false" | "unknown";
}

type IsTypeAssignableTo = (source: ts.Type, target: ts.Type) => boolean;

function getIsTypeAssignableTo(checker: ts.TypeChecker): IsTypeAssignableTo {
	const fn = (checker as unknown as { isTypeAssignableTo?: IsTypeAssignableTo })
		.isTypeAssignableTo;

	if (typeof fn !== "function") {
		throw new Error(
			"checker.isTypeAssignableTo is unavailable in this TypeScript version",
		);
	}

	return fn.bind(checker);
}

function computeBranchId(
	condNode: ts.ConditionalTypeNode,
	sourceFile: ts.SourceFile,
	projectRoot?: string,
): string {
	const filePath = projectRoot
		? path.relative(projectRoot, sourceFile.fileName)
		: sourceFile.fileName;

	const { line, character } = sourceFile.getLineAndCharacterOfPosition(
		condNode.getStart(sourceFile),
	);

	return `${filePath}:${line + 1}:${character + 1}`;
}

/**
 * Resolve the checkType of a conditional to a concrete ts.Type by substituting
 * type parameters. Only direct identifier references (e.g. V, F) are supported.
 * Anything more complex (e.g. Box<V>) is treated as unknown.
 */
function resolveCheckType(
	condNode: ts.ConditionalTypeNode,
	paramMap: Map<string, ts.Type>,
): ts.Type | null {
	const checkNode = condNode.checkType;
	if (
		!ts.isTypeReferenceNode(checkNode) ||
		!ts.isIdentifier(checkNode.typeName) ||
		checkNode.typeArguments !== undefined
	) {
		return null;
	}

	return paramMap.get(checkNode.typeName.text) ?? null;
}

function containsInfer(node: ts.Node): boolean {
	if (node.kind === ts.SyntaxKind.InferType) {
		return true;
	}

	return ts.forEachChild(node, containsInfer) ?? false;
}

function resolveExtendsType(
	condNode: ts.ConditionalTypeNode,
	checker: ts.TypeChecker,
): ts.Type | null {
	if (containsInfer(condNode.extendsType)) {
		return null;
	}

	try {
		return checker.getTypeFromTypeNode(condNode.extendsType);
	} catch {
		return null;
	}
}

export function traceConditionalChain(
	condNode: ts.ConditionalTypeNode,
	paramMap: Map<string, ts.Type>,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	projectRoot?: string,
): TraceResult[] {
	const results: TraceResult[] = [];
	const isTypeAssignableTo = getIsTypeAssignableTo(checker);

	function step(node: ts.ConditionalTypeNode): void {
		const branchId = computeBranchId(node, sourceFile, projectRoot);
		const checkType = resolveCheckType(node, paramMap);
		const extendsType = resolveExtendsType(node, checker);

		if (!checkType || !extendsType) {
			results.push({ branchId, taken: "unknown" });
			return;
		}

		const assignable = isTypeAssignableTo(checkType, extendsType);
		results.push({ branchId, taken: assignable ? "true" : "false" });

		const next = assignable ? node.trueType : node.falseType;
		if (ts.isConditionalTypeNode(next)) {
			step(next);
		}
	}

	step(condNode);
	return results;
}
