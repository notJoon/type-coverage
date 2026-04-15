import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ts from "typescript";
import { traceConditionalChain } from "../src/tracer.js";

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

/** Find the root ConditionalTypeNode of a named type alias. */
function findConditional(
	sourceFile: ts.SourceFile,
	aliasName: string,
): ts.ConditionalTypeNode {
	let found: ts.ConditionalTypeNode | undefined;
	ts.forEachChild(sourceFile, (node) => {
		if (
			ts.isTypeAliasDeclaration(node) &&
			node.name.text === aliasName &&
			ts.isConditionalTypeNode(node.type)
		) {
			found = node.type;
		}
	});
	if (!found) {
		throw new Error(`conditional alias ${aliasName} not found`);
	}
	return found;
}

function lookupTestArg(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	aliasName: string,
): ts.Type {
	let found: ts.Type | undefined;
	ts.forEachChild(sourceFile, (node) => {
		if (ts.isTypeAliasDeclaration(node) && node.name.text === aliasName) {
			found = checker.getTypeFromTypeNode(node.type);
		}
	});
	if (!found) {
		throw new Error(`test alias ${aliasName} not found`);
	}
	return found;
}

describe("traceConditionalChain", () => {
	it("evaluates a simple true branch", () => {
		const code = `
type Is<X> = X extends string ? 1 : 0;
type _arg = "hello";
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Is");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 1);
		assert.equal(result[0].taken, "true");
	});

	it("evaluates a simple false branch", () => {
		const code = `
type Is<X> = X extends string ? 1 : 0;
type _arg = 42;
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Is");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 1);
		assert.equal(result[0].taken, "false");
	});

	it("recurses into the false branch when needed", () => {
		const code = `
type Classify<X> =
  X extends string ? "s"
    : X extends number ? "n"
    : "other";
type _arg = 42;
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Classify");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 2);
		assert.equal(result[0].taken, "false");
		assert.equal(result[1].taken, "true");
	});

	it("recurses into the true branch when needed", () => {
		const code = `
type Deep<X> =
  X extends string
    ? X extends "hi" ? "greeting" : "other-str"
    : "not-str";
type _arg = "hi";
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Deep");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 2);
		assert.equal(result[0].taken, "true");
		assert.equal(result[1].taken, "true");
	});

	it("does not recurse into the branch not taken", () => {
		const code = `
type T<X> =
  X extends string
    ? X extends "a" ? 1 : 2
    : X extends 42 ? 3 : 4;
type _arg = "hello";
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "T");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		// Outer true (hello extends string) + inner true (hello extends "a"? false)
		// Should NOT visit the false-branch nested conditional
		assert.equal(result.length, 2);
		assert.equal(result[0].taken, "true");
		assert.equal(result[1].taken, "false");
	});

	it("substitutes multiple type parameters", () => {
		const code = `
type Pair<V, F> = V extends string ? F extends number ? "both" : "only-v" : "none";
type _v = "hi";
type _f = 7;
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Pair");
		const paramMap = new Map<string, ts.Type>([
			["V", lookupTestArg(sourceFile, checker, "_v")],
			["F", lookupTestArg(sourceFile, checker, "_f")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 2);
		assert.equal(result[0].taken, "true");
		assert.equal(result[1].taken, "true");
	});

	it("returns unknown for infer patterns and stops recursion", () => {
		const code = `
type Unwrap<X> =
  X extends Promise<infer U>
    ? U extends string ? "s" : "o"
    : "not-promise";
type _arg = Promise<string>;
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Unwrap");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 1);
		assert.equal(result[0].taken, "unknown");
		assert.equal(result[0].unknownReason, "inferInExtends");
	});

	it("returns unknown for computed check type with substituted params", () => {
		const code = `
type Box<T> = { v: T };
type T<X> = Box<X> extends { v: string } ? 1 : 0;
type _arg = "hi";
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "T");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 1);
		assert.equal(result[0].taken, "unknown");
		assert.equal(result[0].unknownReason, "checkTypeNotDirectParam");
	});

	it("returns unknown when a referenced type parameter has no mapped argument", () => {
		const code = `
type Pair<X, Y> = Y extends string ? 1 : 0;
type _x = 42;
`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Pair");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_x")],
		]);

		const result = traceConditionalChain(cond, paramMap, sourceFile, checker);
		assert.equal(result.length, 1);
		assert.equal(result[0].taken, "unknown");
		assert.equal(result[0].unknownReason, "missingTypeArg");
	});

	it("branchId matches scanner id format (file:line:column)", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;
type _arg = "hi";`;
		const { sourceFile, checker } = makeProgram(code);
		const cond = findConditional(sourceFile, "Is");
		const paramMap = new Map<string, ts.Type>([
			["X", lookupTestArg(sourceFile, checker, "_arg")],
		]);

		const result = traceConditionalChain(
			cond,
			paramMap,
			sourceFile,
			checker,
			"/",
		);
		assert.match(result[0].branchId, /^virtual\/test\.ts:1:\d+$/);
	});
});
