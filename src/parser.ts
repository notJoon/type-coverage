import ts from "typescript";

export interface TargetInstantiation {
	name: string;
	targetTypeName: string;
	typeArgs: ts.Type[];
	line: number;
}

function findFirstTargetRef(
	node: ts.Node,
	targetTypeName: string,
): ts.TypeReferenceNode | undefined {
	if (
		ts.isTypeReferenceNode(node) &&
		ts.isIdentifier(node.typeName) &&
		node.typeName.text === targetTypeName &&
		node.typeArguments &&
		node.typeArguments.length > 0
	) {
		return node;
	}
	return ts.forEachChild(node, (child) =>
		findFirstTargetRef(child, targetTypeName),
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
		const ref = findFirstTargetRef(node.type, targetTypeName);
		if (!ref?.typeArguments) {
			continue;
		}

		const typeArgs = ref.typeArguments.map((arg) =>
			checker.getTypeFromTypeNode(arg),
		);
		const line =
			sourceFile.getLineAndCharacterOfPosition(ref.getStart(sourceFile)).line +
			1;

		instantiations.push({
			name: node.name.text,
			targetTypeName,
			typeArgs,
			line,
		});
	}

	return instantiations;
}
