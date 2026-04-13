// Tests that exercise pipeline correctness against on-disk fixture files.
// Each fixture is also runnable via the CLI for manual inspection:
//   node scripts/run.mjs --fixture fixtures/<name>.ts --target <TypeName>

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { runFixture } from "../src/fixture.js";

// Tests run from dist/ (rootDir=src, outDir=dist, so dist/ is one level up from project root)
const FIXTURES = path.resolve(import.meta.dirname, "..", "..", "fixtures");

describe("fixture: classify.ts", () => {
	it("reports 4/4 directions covered across 3 tests", () => {
		const { branches, assertions, counts } = runFixture(
			path.join(FIXTURES, "classify.ts"),
			"Classify",
		);

		assert.equal(branches.length, 2);
		assert.equal(assertions.length, 3);

		for (const b of branches) {
			const c = counts.get(b.id);
			assert.ok(c);
			assert.ok(c.trueHits > 0);
			assert.ok(c.falseHits > 0);
		}
	});
});

describe("fixture: nested-drill.ts", () => {
	it("walks all 4 levels TRUE for a single test", () => {
		const { branches, traces, counts } = runFixture(
			path.join(FIXTURES, "nested-drill.ts"),
			"Deep",
		);

		assert.equal(branches.length, 4);
		assert.equal(traces.length, 1);
		assert.equal(traces[0].length, 4);

		for (const b of branches) {
			const c = counts.get(b.id);
			assert.ok(c);
			assert.equal(c.trueHits, 1);
			assert.equal(c.falseHits, 0);
		}
	});
});

describe("fixture: conjugate-mini.ts", () => {
	it("reports 3/6 direction coverage (2 tests only cover Hada branch)", () => {
		const { branches, counts } = runFixture(
			path.join(FIXTURES, "conjugate-mini.ts"),
			"Conjugate",
		);

		assert.equal(branches.length, 3);

		let total = 0;
		let covered = 0;
		for (const b of branches) {
			total += 2;
			const c = counts.get(b.id);
			if (c?.trueHits) covered++;
			if (c?.falseHits) covered++;
		}
		assert.equal(total, 6);
		assert.equal(covered, 3);
	});
});
