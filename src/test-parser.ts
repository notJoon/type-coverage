import ts from "typescript";

export interface TestAssertion {
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
	let found: ts.TypeReferenceNode | undefined;
	node.forEachChild((child) => {
		if (!found) {
			found = findFirstTargetRef(child, targetTypeName);
		}
	});
	return found;
}

export function parseTestAssertions(
	sourceFile: ts.SourceFile,
	targetTypeName: string,
	checker: ts.TypeChecker,
): TestAssertion[] {
	const assertions: TestAssertion[] = [];

	ts.forEachChild(sourceFile, (node) => {
		if (!ts.isTypeAliasDeclaration(node)) {
			return;
		}
		const ref = findFirstTargetRef(node.type, targetTypeName);
		if (!ref?.typeArguments) {
			return;
		}

		const typeArgs = ref.typeArguments.map((arg) =>
			checker.getTypeFromTypeNode(arg),
		);
		const line =
			sourceFile.getLineAndCharacterOfPosition(ref.getStart(sourceFile)).line +
			1;

		assertions.push({
			name: node.name.text,
			targetTypeName,
			typeArgs,
			line,
		});
	});

	return assertions;
}
