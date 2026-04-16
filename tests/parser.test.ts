import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ts from "typescript";
import { collectInstantiations } from "../src/parser.js";

const VIRTUAL_PATH = "/virtual/test.ts";

function makeProgram(code: string): {
	sourceFile: ts.SourceFile;
	checker: ts.TypeChecker;
} {
	const host = ts.createCompilerHost({}, true);
	const originalGetSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (name, lang, onError, shouldCreate) => {
		if (name === VIRTUAL_PATH) {
			return ts.createSourceFile(name, code, lang, true);
		}
		return originalGetSourceFile(name, lang, onError, shouldCreate);
	};
	const originalFileExists = host.fileExists.bind(host);
	host.fileExists = (name) => name === VIRTUAL_PATH || originalFileExists(name);
	const originalReadFile = host.readFile.bind(host);
	host.readFile = (name) =>
		name === VIRTUAL_PATH ? code : originalReadFile(name);

	const program = ts.createProgram(
		[VIRTUAL_PATH],
		{ target: ts.ScriptTarget.Latest, strict: true, noLib: true },
		host,
	);
	const sourceFile = program.getSourceFile(VIRTUAL_PATH);
	if (!sourceFile) {
		throw new Error("virtual source file not found");
	}
	return { sourceFile, checker: program.getTypeChecker() };
}

function findTypeAliasSymbol(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	name: string,
): ts.Symbol {
	for (const node of sourceFile.statements) {
		if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
			const symbol = checker.getSymbolAtLocation(node.name);
			if (symbol) {
				return symbol;
			}
		}
	}
	throw new Error(`type alias symbol not found: ${name}`);
}

describe("collectInstantiations", () => {
	it("returns empty array for file with no target references", () => {
		const { sourceFile, checker } = makeProgram(`type X = string;`);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);
		assert.equal(result.length, 0);
	});

	it("extracts direct Target<A, B> usage in a type alias", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type Test = Conjugate<"hello", "past">;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 1);
		assert.equal(result[0].name, "Test");
		assert.equal(result[0].targetTypeName, "Conjugate");
		assert.equal(result[0].typeArgs.length, 2);
		assert.equal(checker.typeToString(result[0].typeArgs[0]), `"hello"`);
		assert.equal(checker.typeToString(result[0].typeArgs[1]), `"past"`);
	});

	it("extracts Target usage inside Expect<Equal<...>> pattern", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type _test = Expect<Equal<Conjugate<"a", "b">, ["a", "b"]>>;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 1);
		assert.equal(result[0].name, "_test");
		assert.equal(result[0].typeArgs.length, 2);
		assert.equal(checker.typeToString(result[0].typeArgs[0]), `"a"`);
		assert.equal(checker.typeToString(result[0].typeArgs[1]), `"b"`);
	});

	it("extracts multiple instantiations from the same file", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type _t1 = Conjugate<"x", "y">;
type _t2 = Conjugate<"p", "q">;
type _t3 = Conjugate<"m", "n">;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 3);
		const names = result.map((a) => a.name);
		assert.deepEqual(names, ["_t1", "_t2", "_t3"]);
	});

	it("ignores references to other type names", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type Decline<N> = [N];
type _t1 = Conjugate<"a", "b">;
type _t2 = Decline<"c">;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 1);
		assert.equal(result[0].name, "_t1");
	});

	it("records 1-based line number of the target reference", () => {
		const code = `type Conjugate<V, F> = [V, F];
type _t1 = Conjugate<"a", "b">;`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 1);
		assert.equal(result[0].line, 2);
	});

	it("skips target references without type arguments", () => {
		const code = `
type Conjugate<V = "default", F = "def"> = [V, F];
type _t1 = Conjugate;
type _t2 = Conjugate<"x", "y">;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 1);
		assert.equal(result[0].name, "_t2");
	});

	it("collects all target references per test alias", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type _t1 = [Conjugate<"a", "b">, Conjugate<"c", "d">];
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 2);
		assert.equal(result[0].name, "_t1");
		assert.equal(result[1].name, "_t1");
		assert.equal(checker.typeToString(result[0].typeArgs[0]), `"a"`);
		assert.equal(checker.typeToString(result[0].typeArgs[1]), `"b"`);
		assert.equal(checker.typeToString(result[1].typeArgs[0]), `"c"`);
		assert.equal(checker.typeToString(result[1].typeArgs[1]), `"d"`);
	});

	it("supports target reference nested deeply in generic arguments", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type Box<T> = { value: T };
type _t1 = Box<Array<Conjugate<"deep", "nested">>>;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "Conjugate", checker);

		assert.equal(result.length, 1);
		assert.equal(checker.typeToString(result[0].typeArgs[0]), `"deep"`);
		assert.equal(checker.typeToString(result[0].typeArgs[1]), `"nested"`);
	});

	it("returns empty when targetTypeName does not match anything", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type _t1 = Conjugate<"a", "b">;
`;
		const { sourceFile, checker } = makeProgram(code);
		const result = collectInstantiations(sourceFile, "NonExistent", checker);
		assert.equal(result.length, 0);
	});

	it("uses symbol identity to ignore same-name references to a different type", () => {
		const code = `
type Conjugate<V, F> = [V, F];
type _t1 = Conjugate<"a", "b">;
namespace Shadow {
	type Conjugate<X, Y> = { x: X; y: Y };
	type _t2 = Conjugate<1, 2>;
}
`;
		const { sourceFile, checker } = makeProgram(code);
		const targetSymbol = findTypeAliasSymbol(sourceFile, checker, "Conjugate");
		const result = collectInstantiations(
			sourceFile,
			"Conjugate",
			checker,
			targetSymbol,
		);

		assert.equal(result.length, 1);
		assert.equal(result[0].name, "_t1");
		assert.equal(checker.typeToString(result[0].typeArgs[0]), `"a"`);
		assert.equal(checker.typeToString(result[0].typeArgs[1]), `"b"`);
	});
});
