import ts from "typescript";

export interface TargetInstantiation {
	name: string;
	targetTypeName: string;
	typeArgs: ts.Type[];
	line: number;
}

function collectTargetRefs(
	node: ts.Node,
	targetTypeName: string,
	out: ts.TypeReferenceNode[],
): void {
	if (
		ts.isTypeReferenceNode(node) &&
		ts.isIdentifier(node.typeName) &&
		node.typeName.text === targetTypeName &&
		node.typeArguments &&
		node.typeArguments.length > 0
	) {
		out.push(node);
	}
	ts.forEachChild(node, (child) =>
		collectTargetRefs(child, targetTypeName, out),
	);
}

export function collectInstantiations(
	sourceFile: ts.SourceFile,
	targetTypeName: string,
	checker: ts.TypeChecker,
): TargetInstantiation[] {
	const instantiations: TargetInstantiation[] = [];

	for (const node of sourceFile.statements) {
		if (!ts.isTypeAliasDeclaration(node)) {
			continue;
		}
		const refs: ts.TypeReferenceNode[] = [];
		collectTargetRefs(node.type, targetTypeName, refs);
		if (refs.length === 0) {
			continue;
		}

		for (const ref of refs) {
			if (!ref.typeArguments) {
				continue;
			}
			const typeArgs = ref.typeArguments.map((arg) =>
				checker.getTypeFromTypeNode(arg),
			);
			const line =
				sourceFile.getLineAndCharacterOfPosition(ref.getStart(sourceFile))
					.line + 1;

			instantiations.push({
				name: node.name.text,
				targetTypeName,
				typeArgs,
				line,
			});
		}
	}

	return instantiations;
}
