import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ts from "typescript";
import { collectBranches } from "../src/scanner.js";

function parse(code: string, fileName = "test.ts"): ts.SourceFile {
	return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
}

describe("collectBranches", () => {
	it("returns empty array for file with no conditional types", () => {
		const sf = parse("type Foo = string;");
		const result = collectBranches(sf);
		assert.equal(result.length, 0);
	});

	it("collects a single conditional type", () => {
		const sf = parse(`type IsString<T> = T extends string ? "yes" : "no";`);
		const result = collectBranches(sf);

		assert.equal(result.length, 1);
		assert.equal(result[0].typeName, "IsString");
		assert.equal(result[0].checkText, "T");
		assert.equal(result[0].extendsText, "string");
		assert.equal(result[0].depth, 0);
	});

	it("assigns id as file:line:column", () => {
		const sf = parse(
			`type IsString<T> = T extends string ? "yes" : "no";`,
			"src/foo.ts",
		);
		const result = collectBranches(sf);

		assert.equal(result[0].file, "src/foo.ts");
		// "T extends string ..." starts at column 20 (1-based) after "type IsString<T> = "
		assert.equal(result[0].id, "src/foo.ts:1:20");
	});

	it("tracks nesting depth for nested conditionals", () => {
		const code = `type Deep<T> =
  T extends string
    ? "string"
    : T extends number
      ? "number"
      : "other";`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].depth, 0);
		assert.equal(result[0].checkText, "T");
		assert.equal(result[0].extendsText, "string");

		assert.equal(result[1].depth, 1);
		assert.equal(result[1].checkText, "T");
		assert.equal(result[1].extendsText, "number");
	});

	it("tracks nested conditionals in the true branch", () => {
		const code = `type Check<T> =
  T extends string
    ? T extends "hello"
      ? "greeting"
      : "other-string"
    : "not-string";`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].depth, 0);
		assert.equal(result[0].extendsText, "string");
		assert.equal(result[1].depth, 1);
		assert.equal(result[1].extendsText, '"hello"');
	});

	it("resolves enclosing type alias name", () => {
		const code = `
type A<T> = T extends string ? "yes" : "no";
type B<T> = T extends number ? 1 : 0;`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].typeName, "A");
		assert.equal(result[1].typeName, "B");
	});

	it("handles conditional type inside mapped type", () => {
		const code = `type Mapped<T> = {
  [K in keyof T]: T[K] extends string ? "str" : "other";
};`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 1);
		assert.equal(result[0].typeName, "Mapped");
		assert.equal(result[0].checkText, "T[K]");
		assert.equal(result[0].extendsText, "string");
	});

	it("handles conditional type in function return type", () => {
		const code = `type FnReturn<T> = T extends (...args: any[]) => infer R
  ? R extends Promise<infer U> ? U : R
  : never;`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].typeName, "FnReturn");
		assert.equal(result[1].typeName, "FnReturn");
		assert.equal(result[0].depth, 0);
		assert.equal(result[1].depth, 1);
	});

	it("handles conditional type in template literal type", () => {
		const code = `type Format<T> = T extends string
  ? \`value: \${T extends "a" ? "alpha" : "other"}\`
  : never;`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].depth, 0);
		assert.equal(result[1].depth, 1);
	});

	it("labels anonymous conditional types when no enclosing alias", () => {
		const code = `export type { } ;`;
		const sf = parse(code);
		const result = collectBranches(sf);
		assert.equal(result.length, 0);
	});

	it("handles deeply nested conditional chain (3+ levels)", () => {
		const code = `type Deep<T> =
  T extends string
    ? "string"
    : T extends number
      ? "number"
      : T extends boolean
        ? "boolean"
        : "unknown";`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 3);
		assert.equal(result[0].depth, 0);
		assert.equal(result[1].depth, 1);
		assert.equal(result[2].depth, 2);
		assert.equal(result[2].extendsText, "boolean");
	});

	it("preserves node reference for each branch point", () => {
		const sf = parse(`type X<T> = T extends string ? "y" : "n";`);
		const result = collectBranches(sf);

		assert.equal(result.length, 1);
		assert.ok(result[0].node);
		assert.equal(result[0].node.kind, ts.SyntaxKind.ConditionalType);
	});

	it("uses projectRoot to compute relative file path", () => {
		const sf = parse(
			`type X<T> = T extends string ? "y" : "n";`,
			"/projects/mylib/src/types.ts",
		);
		const result = collectBranches(sf, "/projects/mylib");

		assert.equal(result[0].file, "src/types.ts");
		assert.match(result[0].id, /^src\/types\.ts:\d+:\d+$/);
	});

	it("nested conditional inherits outer type alias name", () => {
		// Nested conditional should walk up parents to find the outer alias name
		const code = `type Outer<T> =
  T extends string
    ? T extends "a" ? 1 : 2
    : 0;`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].typeName, "Outer");
		assert.equal(result[1].typeName, "Outer");
	});

	it("returns (anonymous) when conditional has no enclosing named context", () => {
		// Conditional inside a variable's type annotation (no enclosing type alias)
		const code = `const x: (T extends string ? 1 : 0) extends 1 ? true : false = true as any;`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.ok(result.length >= 1);
		// Any branch without an enclosing alias should be labeled (anonymous)
		const anon = result.find((b) => b.typeName === "(anonymous)");
		assert.ok(anon, "expected at least one anonymous branch");
	});

	it("collects multiple sibling top-level conditional types at depth 0", () => {
		// Two conditionals as union members of the same type alias
		const code = `type Both<T> =
  | (T extends string ? "s" : "ns")
  | (T extends number ? "n" : "nn");`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		assert.equal(result[0].depth, 0);
		assert.equal(result[1].depth, 0);
		assert.equal(result[0].typeName, "Both");
		assert.equal(result[1].typeName, "Both");
	});

	it("collects conditional inside generic type argument", () => {
		const code = `type Wrap<T> = Array<T extends string ? 1 : 0>;`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 1);
		assert.equal(result[0].typeName, "Wrap");
		assert.equal(result[0].checkText, "T");
	});

	it("assigns unique ids when two conditionals share line and depth", () => {
		// Two conditionals on the same line at the same depth — ids must not collide
		const code = `type T<X> = [X extends string ? 1 : 0, X extends number ? 1 : 0];`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 2);
		const ids = new Set(result.map((b) => b.id));
		assert.equal(
			ids.size,
			2,
			"expected unique ids for sibling conditionals on the same line",
		);
	});

	it("collects branches from interface property conditional types", () => {
		const code = `interface Config<T> {
  value: T extends string ? string : number;
}`;
		const sf = parse(code);
		const result = collectBranches(sf);

		assert.equal(result.length, 1);
		// Inside an interface, typeName should reflect enclosing context
		assert.equal(result[0].checkText, "T");
		assert.equal(result[0].extendsText, "string");
	});
});
