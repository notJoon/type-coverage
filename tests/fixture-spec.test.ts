import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExpected } from "./fixture-spec.js";

describe("parseExpected", () => {
	it("returns null when no Expected block is present", () => {
		const src = `// some comment
export type X = 1;`;
		assert.equal(parseExpected(src), null);
	});

	it("parses all supported fields", () => {
		const src = `// Expected:
//   target: Classify
//   tests: 3
//   branches: 2
//   coverage: 4/4
//   unknown: 0

export type Classify<X> = X extends string ? 1 : 0;`;
		const spec = parseExpected(src);
		assert.ok(spec);
		assert.equal(spec.target, "Classify");
		assert.equal(spec.tests, 3);
		assert.equal(spec.branches, 2);
		assert.deepEqual(spec.coverage, { covered: 4, total: 4 });
		assert.equal(spec.unknown, 0);
	});

	it("stops at the first non-entry line", () => {
		const src = `// Expected:
//   target: Classify
//   tests: 3

// some other comment
//   ignored: true`;
		const spec = parseExpected(src);
		assert.ok(spec);
		assert.equal(spec.tests, 3);
		assert.equal(spec.extra.size, 0);
	});

	it("preserves unknown keys in `extra`", () => {
		const src = `// Expected:
//   target: T
//   customMetric: abc`;
		const spec = parseExpected(src);
		assert.ok(spec);
		assert.equal(spec.extra.get("customMetric"), "abc");
	});

	it("throws when required target is missing", () => {
		const src = `// Expected:
//   tests: 3`;
		assert.throws(() => parseExpected(src), /missing required `target:`/);
	});

	it("throws when coverage format is invalid", () => {
		const src = `// Expected:
//   target: T
//   coverage: bad`;
		assert.throws(() => parseExpected(src), /coverage.*must be in the form/);
	});

	it("throws when numeric field is not a number", () => {
		const src = `// Expected:
//   target: T
//   tests: abc`;
		assert.throws(
			() => parseExpected(src),
			/tests.*must be a non-negative integer/,
		);
	});
});
