import path from "node:path";
import ts from "typescript";

export interface BranchPoint {
	id: string;
	file: string;
	line: number;
	typeName: string;
	checkText: string;
	extendsText: string;
	depth: number;
	node: ts.ConditionalTypeNode;
}

function getNamedNodeText(node: ts.Node): string | null {
	if (ts.isTypeAliasDeclaration(node)) {
		return node.name.text;
	}
	if (ts.isInterfaceDeclaration(node)) {
		return node.name.text;
	}
	if (ts.isPropertySignature(node) && node.name && ts.isIdentifier(node.name)) {
		return node.name.text;
	}
	return null;
}

function getEnclosingTypeName(node: ts.Node): string {
	let current = node.parent;
	while (current) {
		const name = getNamedNodeText(current);
		if (name) {
			return name;
		}
		current = current.parent;
	}
	return "(anonymous)";
}

export function collectBranches(
	sourceFile: ts.SourceFile,
	projectRoot?: string,
): BranchPoint[] {
	const branches: BranchPoint[] = [];
	const filePath = projectRoot
		? path.relative(projectRoot, sourceFile.fileName)
		: sourceFile.fileName;

	function visit(node: ts.Node, depth: number): void {
		if (ts.isConditionalTypeNode(node)) {
			const { line: line0, character } =
				sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			const line = line0 + 1;
			const column = character + 1;
			const id = `${filePath}:${line}:${column}`;

			branches.push({
				id,
				file: filePath,
				line,
				typeName: getEnclosingTypeName(node),
				checkText: node.checkType.getText(sourceFile),
				extendsText: node.extendsType.getText(sourceFile),
				depth,
				node,
			});

			visit(node.trueType, depth + 1);
			visit(node.falseType, depth + 1);
			return;
		}
		ts.forEachChild(node, (child) => visit(child, depth));
	}

	visit(sourceFile, 0);
	return branches;
}
