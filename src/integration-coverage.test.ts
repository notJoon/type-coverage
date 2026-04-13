// Integration tests — coverage measurement correctness against on-disk fixtures.
// Each case loads a fixture from fixtures/ via runFixture so the same inputs
// are reproducible via the CLI:
//   node scripts/run.mjs --fixture fixtures/<name>.ts --target <TypeName>

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
	type BranchPoint,
	type FixtureRunResult,
	runFixture,
} from "./fixture.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures");

function load(name: string, target: string): FixtureRunResult {
	return runFixture(path.join(FIXTURES, name), target);
}

function summarize(
	branches: BranchPoint[],
	counts: FixtureRunResult["counts"],
): { total: number; covered: number; unknown: number } {
	let total = 0;
	let covered = 0;
	let unknown = 0;
	for (const b of branches) {
		total += 2;
		const c = counts.get(b.id);
		if (c?.trueHits) covered++;
		if (c?.falseHits) covered++;
		unknown += c?.unknownHits ?? 0;
	}
	return { total, covered, unknown };
}

describe("integration — coverage measurement correctness", () => {
	it("reports 100% coverage when every direction is exercised", () => {
		const { branches, counts } = load("classify.ts", "Classify");
		assert.equal(branches.length, 2);

		assert.deepEqual(summarize(branches, counts), {
			total: 4,
			covered: 4,
			unknown: 0,
		});

		for (const b of branches) {
			const c = counts.get(b.id);
			assert.ok(c, `branch ${b.id} must have hits`);
			assert.ok(c.trueHits > 0);
			assert.ok(c.falseHits > 0);
		}
	});

	it("increments hit counters exactly once per test that takes the branch", () => {
		const { branches, counts } = load("is-string-counter.ts", "Is");
		assert.equal(branches.length, 1);

		const c = counts.get(branches[0].id);
		assert.ok(c);
		assert.equal(c.trueHits, 3);
		assert.equal(c.falseHits, 1);
		assert.equal(c.unknownHits, 0);
	});

	it("reports 0% coverage and no hit entries when there are no tests", () => {
		const { branches, counts } = load("classify-empty.ts", "Classify");
		assert.equal(branches.length, 2);
		assert.equal(counts.size, 0);
		assert.deepEqual(summarize(branches, counts), {
			total: 4,
			covered: 0,
			unknown: 0,
		});
	});

	it("distinguishes unknown from false — computed check types never count as false", () => {
		const { branches, counts } = load("unknown-not-false.ts", "Is");
		assert.equal(branches.length, 1);

		const c = counts.get(branches[0].id);
		assert.ok(c);
		assert.equal(c.unknownHits, 2);
		assert.equal(c.trueHits, 0, "unknown must NOT be counted as true");
		assert.equal(c.falseHits, 0, "unknown must NOT be counted as false");
		assert.equal(summarize(branches, counts).covered, 0);
	});

	it("tests that take the true branch do not pollute false-branch coverage", () => {
		const { branches, counts } = load("branch-isolation.ts", "T");
		assert.equal(branches.length, 3);

		const [root, innerTrue, innerFalse] = branches;

		const rootC = counts.get(root.id);
		assert.ok(rootC);
		assert.equal(rootC.trueHits, 2);
		assert.equal(rootC.falseHits, 0);

		const innerTrueC = counts.get(innerTrue.id);
		assert.ok(innerTrueC);
		assert.equal(innerTrueC.trueHits, 2);
		assert.equal(innerTrueC.falseHits, 0);

		assert.equal(
			counts.get(innerFalse.id),
			undefined,
			"inner-FALSE subtree must not be counted",
		);
	});

	it("handles distributive conditional union argument as a single evaluation (documented limitation)", () => {
		const { branches, counts } = load("distributive-limitation.ts", "IsStr");
		assert.equal(branches.length, 1);

		const c = counts.get(branches[0].id);
		assert.ok(c);
		assert.equal(c.trueHits + c.falseHits, 1, "exactly one direction recorded");
		assert.equal(c.unknownHits, 0);
	});

	it("drills through a 4-level nested chain — trace length matches depth walked", () => {
		const { branches, traces, counts } = load("nested-drill.ts", "Deep");
		assert.equal(branches.length, 4);
		assert.equal(traces.length, 1);
		assert.equal(traces[0].length, 4);

		for (const step of traces[0]) {
			assert.equal(step.taken, "true");
		}
		for (const b of branches) {
			const c = counts.get(b.id);
			assert.ok(c);
			assert.equal(c.trueHits, 1);
			assert.equal(c.falseHits, 0);
		}
	});

	it("covers both directions of a nested branch under a shared parent true-path", () => {
		const { branches, counts } = load("nested-inner-both.ts", "T");
		assert.equal(branches.length, 2);

		const [outer, inner] = branches;

		const outerC = counts.get(outer.id);
		assert.ok(outerC);
		assert.equal(outerC.trueHits, 2);
		assert.equal(outerC.falseHits, 0);

		const innerC = counts.get(inner.id);
		assert.ok(innerC);
		assert.equal(innerC.trueHits, 1);
		assert.equal(innerC.falseHits, 1);
	});

	it("keeps nested-true and nested-false subtrees accounted separately", () => {
		const { branches, counts } = load("nested-subtree-split.ts", "T");
		assert.equal(branches.length, 3);

		const [outer, innerTrue, innerFalse] = branches;

		const outerC = counts.get(outer.id);
		assert.ok(outerC);
		assert.equal(outerC.trueHits, 1);
		assert.equal(outerC.falseHits, 2);

		const itC = counts.get(innerTrue.id);
		assert.ok(itC);
		assert.equal(itC.trueHits, 1);
		assert.equal(itC.falseHits, 0);

		const ifC = counts.get(innerFalse.id);
		assert.ok(ifC);
		assert.equal(ifC.trueHits, 1);
		assert.equal(ifC.falseHits, 1);

		assert.deepEqual(summarize(branches, counts), {
			total: 6,
			covered: 5,
			unknown: 0,
		});
	});

	it("unknown at a nested level stops the chain without touching deeper branches", () => {
		const { branches, traces, counts } = load("nested-unknown-stop.ts", "T");
		assert.equal(branches.length, 3);

		assert.equal(traces[0].length, 2);
		assert.equal(traces[0][0].taken, "true");
		assert.equal(traces[0][1].taken, "unknown");

		const [, , deepest] = branches;
		assert.equal(
			counts.get(deepest.id),
			undefined,
			"branch beyond unknown must stay unreached",
		);
	});

	it("aggregates hits across independent test aliases correctly", () => {
		const { traces, counts, branches } = load("is-string-aggregate.ts", "Is");
		assert.equal(traces.length, 5);

		let t = 0;
		let f = 0;
		for (const tr of traces) {
			for (const step of tr) {
				if (step.taken === "true") t++;
				else if (step.taken === "false") f++;
			}
		}
		const c = counts.get(branches[0].id);
		assert.ok(c);
		assert.equal(c.trueHits, t);
		assert.equal(c.falseHits, f);
		assert.equal(t, 2);
		assert.equal(f, 3);
	});
});
