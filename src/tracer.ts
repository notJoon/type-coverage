import path from "node:path";
import ts from "typescript";

export type TraceResult =
	| {
			branchId: string;
			taken: "true" | "false";
	  }
	| {
			branchId: string;
			taken: "unknown";
			unknownReason: UnknownReason;
	  };

type IsTypeAssignableTo = (source: ts.Type, target: ts.Type) => boolean;
export type UnknownReason =
	| "checkTypeNotDirectParam"
	| "missingTypeArg"
	| "inferInExtends"
	| "extendsTypeResolutionFailed";

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
):
	| { type: ts.Type; unknownReason?: never }
	| { type: null; unknownReason: UnknownReason } {
	const checkNode = condNode.checkType;
	if (
		!ts.isTypeReferenceNode(checkNode) ||
		!ts.isIdentifier(checkNode.typeName) ||
		checkNode.typeArguments !== undefined
	) {
		return { type: null, unknownReason: "checkTypeNotDirectParam" };
	}
	const type = paramMap.get(checkNode.typeName.text);
	if (!type) {
		return { type: null, unknownReason: "missingTypeArg" };
	}
	return { type };
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
):
	| { type: ts.Type; unknownReason?: never }
	| { type: null; unknownReason: UnknownReason } {
	if (containsInfer(condNode.extendsType)) {
		return { type: null, unknownReason: "inferInExtends" };
	}

	try {
		return { type: checker.getTypeFromTypeNode(condNode.extendsType) };
	} catch {
		return { type: null, unknownReason: "extendsTypeResolutionFailed" };
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
		const checkResolved = resolveCheckType(node, paramMap);
		const extendsResolved = resolveExtendsType(node, checker);

		if (!checkResolved.type || !extendsResolved.type) {
			const reason = checkResolved.type
				? extendsResolved.unknownReason
				: checkResolved.unknownReason;
			if (!reason) {
				throw new Error("unknown branch outcome missing reason");
			}
			results.push({
				branchId,
				taken: "unknown",
				unknownReason: reason,
			});
			return;
		}

		const assignable = isTypeAssignableTo(
			checkResolved.type,
			extendsResolved.type,
		);
		results.push({ branchId, taken: assignable ? "true" : "false" });

		const next = assignable ? node.trueType : node.falseType;
		if (ts.isConditionalTypeNode(next)) {
			step(next);
		}
	}

	step(condNode);
	return results;
}
