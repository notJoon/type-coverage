import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runFixture } from "../src/fixture.js";
import {
	parseExpected,
	replaceExpectedBlock,
	serializeExpected,
	type SerializableResult,
} from "./fixture-spec.js";

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

	it("parses a `hits:` block with per-line counts", () => {
		const src = `// Expected:
//   target: T
//   hits:
//     L4: T=1 F=2
//     L7: T=0 F=0 U=3
//     L9: unreached`;
		const spec = parseExpected(src);
		assert.ok(spec?.hits);
		assert.deepEqual(spec.hits.get(4), {
			trueHits: 1,
			falseHits: 2,
			unknownHits: 0,
		});
		assert.deepEqual(spec.hits.get(7), {
			trueHits: 0,
			falseHits: 0,
			unknownHits: 3,
		});
		assert.deepEqual(spec.hits.get(9), {
			trueHits: 0,
			falseHits: 0,
			unknownHits: 0,
			unreached: true,
		});
	});

	it("parses a `traces:` block with per-instantiation outcomes", () => {
		const src = `// Expected:
//   target: T
//   traces:
//     [0]: TTTT
//     [1]: FU
//     [2]: F`;
		const spec = parseExpected(src);
		assert.deepEqual(spec?.traces, ["TTTT", "FU", "F"]);
	});

	it("throws when hits child key is malformed", () => {
		const src = `// Expected:
//   target: T
//   hits:
//     bad: T=1 F=0`;
		assert.throws(() => parseExpected(src), /child key must be `L<line>`/);
	});

	it("throws when traces value contains invalid letters", () => {
		const src = `// Expected:
//   target: T
//   traces:
//     [0]: TXF`;
		assert.throws(() => parseExpected(src), /string of T\/F\/U letters/);
	});
});

describe("serializeExpected / replaceExpectedBlock", () => {
	function fakeResult(
		branches: Array<{ line: number; trueHits: number; falseHits: number; unknownHits?: number }>,
		traces: string[],
		tests: number,
	): SerializableResult {
		const counts = new Map<
			string,
			{ trueHits: number; falseHits: number; unknownHits: number }
		>();
		const branchPoints: Array<{ id: string; line: number }> = [];
		for (const b of branches) {
			const id = `L${b.line}`;
			branchPoints.push({ id, line: b.line });
			if (b.trueHits > 0 || b.falseHits > 0 || (b.unknownHits ?? 0) > 0) {
				counts.set(id, {
					trueHits: b.trueHits,
					falseHits: b.falseHits,
					unknownHits: b.unknownHits ?? 0,
				});
			}
		}
		const traceList = traces.map((s) =>
			[...s].map((ch) => ({
				taken: (ch === "T" ? "true" : ch === "F" ? "false" : "unknown") as
					| "true"
					| "false"
					| "unknown",
			})),
		);
		return {
			branches: branchPoints,
			instantiations: Array.from({ length: tests }, () => ({})),
			traces: traceList,
			counts,
		};
	}

	it("serializes aggregate stats", () => {
		const result = fakeResult(
			[
				{ line: 5, trueHits: 1, falseHits: 1 },
				{ line: 7, trueHits: 1, falseHits: 0 },
			],
			["TT", "TF"],
			2,
		);
		const block = serializeExpected(result, "T");
		assert.match(block, /target: T/);
		assert.match(block, /tests: 2/);
		assert.match(block, /branches: 2/);
		assert.match(block, /coverage: 3\/4/);
	});

	it("serializes unreached branches correctly", () => {
		const result = fakeResult(
			[
				{ line: 5, trueHits: 2, falseHits: 0 },
				{ line: 8, trueHits: 0, falseHits: 0 }, // unreached (no entry in counts)
			],
			["T"],
			1,
		);
		const block = serializeExpected(result, "T");
		assert.match(block, /L5: T=2 F=0/);
		assert.match(block, /L8: unreached/);
	});

	it("serializes unknown hits only when > 0", () => {
		const result = fakeResult(
			[{ line: 4, trueHits: 0, falseHits: 0, unknownHits: 2 }],
			["UU"],
			2,
		);
		const block = serializeExpected(result, "T");
		assert.match(block, /L4: T=0 F=0 U=2/);
	});

	it("round-trips via parseExpected", () => {
		const result = fakeResult(
			[{ line: 5, trueHits: 1, falseHits: 1 }],
			["TF"],
			2,
		);
		const block = serializeExpected(result, "T");
		const spec = parseExpected(block);
		assert.ok(spec);
		assert.equal(spec.target, "T");
		assert.equal(spec.tests, 2);
		assert.deepEqual(spec.coverage, { covered: 2, total: 2 });
		assert.equal(spec.hits?.get(5)?.trueHits, 1);
		assert.equal(spec.traces?.[0], "TF");
	});

	it("replaces an existing block in place", () => {
		const file = `export type T = 1;

// Expected:
//   target: T
//   tests: 0
`;
		const newBlock = `// Expected:
//   target: T
//   tests: 3`;
		const out = replaceExpectedBlock(file, newBlock);
		assert.match(out, /tests: 3/);
		assert.doesNotMatch(out, /tests: 0/);
	});

	it("appends a new block when none exists", () => {
		const file = `export type T = 1;\n`;
		const newBlock = "// Expected:\n//   target: T\n//   tests: 1";
		const out = replaceExpectedBlock(file, newBlock);
		assert.match(out, /tests: 1/);
		assert.match(out, /export type T = 1/);
	});

	it("preserves content after the existing block", () => {
		const file = `// Expected:
//   target: T
//   tests: 0

export const trailing = true;
`;
		const newBlock = "// Expected:\n//   target: T\n//   tests: 5";
		const out = replaceExpectedBlock(file, newBlock);
		assert.match(out, /tests: 5/);
		assert.match(out, /export const trailing = true/);
	});
});

// Generic verifier: scans `fixtures/` and validates each fixture that declares
// an `// Expected:` block against the pipeline's output. The Expected block is
// the single source of truth for a fixture's expected behavior — both the
// CLI summary and these tests compare against it directly. Fixtures without
// an Expected block are skipped silently.

const FIXTURES = path.resolve(import.meta.dirname, "..", "..", "fixtures");

function listFixtures(): string[] {
	return fs
		.readdirSync(FIXTURES)
		.filter((f) => f.endsWith(".ts"))
		.sort();
}

describe("fixture Expected block verification", () => {
	for (const file of listFixtures()) {
		it(`${file}`, () => {
			const fixturePath = path.join(FIXTURES, file);
			const text = fs.readFileSync(fixturePath, "utf8");
			const spec = parseExpected(text);
			if (!spec) {
				return;
			}

			const result = runFixture(fixturePath, spec.target);

			if (spec.branches !== undefined) {
				assert.equal(
					result.branches.length,
					spec.branches,
					`branches mismatch in ${file}`,
				);
			}
			if (spec.tests !== undefined) {
				assert.equal(
					result.instantiations.length,
					spec.tests,
					`tests mismatch in ${file}`,
				);
			}

			let total = 0;
			let covered = 0;
			let unknown = 0;
			for (const b of result.branches) {
				total += 2;
				const c = result.counts.get(b.id);
				if (c?.trueHits) covered++;
				if (c?.falseHits) covered++;
				unknown += c?.unknownHits ?? 0;
			}

			if (spec.coverage !== undefined) {
				assert.deepEqual(
					{ covered, total },
					spec.coverage,
					`coverage mismatch in ${file}`,
				);
			}
			if (spec.unknown !== undefined) {
				assert.equal(unknown, spec.unknown, `unknown mismatch in ${file}`);
			}

			if (spec.hits) {
				for (const [line, expected] of spec.hits) {
					const branch = result.branches.find((b) => b.line === line);
					assert.ok(
						branch,
						`${file}: no branch found on line ${line} (hits block)`,
					);
					const c = result.counts.get(branch.id);
					if (expected.unreached) {
						assert.equal(
							c,
							undefined,
							`${file}: L${line} expected unreached, got hits ${JSON.stringify(c)}`,
						);
					} else {
						assert.ok(c, `${file}: L${line} expected hits, got unreached`);
						assert.equal(
							c.trueHits,
							expected.trueHits,
							`${file}: L${line} trueHits`,
						);
						assert.equal(
							c.falseHits,
							expected.falseHits,
							`${file}: L${line} falseHits`,
						);
						assert.equal(
							c.unknownHits,
							expected.unknownHits,
							`${file}: L${line} unknownHits`,
						);
					}
				}
			}

			if (spec.traces) {
				const traces: string[] = spec.traces;
				for (let idx = 0; idx < traces.length; idx++) {
					const expected = traces[idx];
					if (expected === undefined) continue;
					const trace = result.traces[idx];
					assert.ok(trace, `${file}: no trace at index ${idx}`);
					const encoded = trace
						.map((s) =>
							s.taken === "true" ? "T" : s.taken === "false" ? "F" : "U",
						)
						.join("");
					assert.equal(
						encoded,
						expected,
						`${file}: trace[${idx}] mismatch`,
					);
				}
			}
		});
	}
});
