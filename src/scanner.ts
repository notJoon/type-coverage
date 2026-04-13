import path from "node:path";
import ts from "typescript";

export interface BranchPoint {
	id: string;
	file: string;
	/** Line of the conditional's `checkType` (where `X extends Y` begins). */
	line: number;
	/** Line where the TRUE branch (`?` clause) begins. May equal `line` for single-line conditionals. */
	trueLine: number;
	/** Line where the FALSE branch (`:` clause) begins. May equal `line` for single-line conditionals. */
	falseLine: number;
	typeName: string;
	checkText: string;
	extendsText: string;
	depth: number;
	node: ts.ConditionalTypeNode;
}

function getNamedNodeText(node: ts.Node): string | null {
	if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
		return node.name.text;
	}

	if (ts.isPropertySignature(node) && node.name && ts.isIdentifier(node.name)) {
		return node.name.text;
	}

	return null;
}

function getEnclosingTypeName(node: ts.Node): string {
	for (let current = node.parent; current; current = current.parent) {
		const name = getNamedNodeText(current);
		if (name) {
			return name;
		}
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
			const trueLine =
				sourceFile.getLineAndCharacterOfPosition(
					node.trueType.getStart(sourceFile),
				).line + 1;
			const falseLine =
				sourceFile.getLineAndCharacterOfPosition(
					node.falseType.getStart(sourceFile),
				).line + 1;

			branches.push({
				id,
				file: filePath,
				line,
				trueLine,
				falseLine,
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
