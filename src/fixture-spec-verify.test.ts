// Generic verifier: scans `fixtures/` and validates each fixture that
// declares an `// Expected:` block against the pipeline's output.
//
// Fixtures without an Expected block are skipped silently — they are verified
// by bespoke tests elsewhere (fixture.test.ts, integration-coverage.test.ts).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runFixture } from "./fixture.js";
import { parseExpected } from "./fixture-spec.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures");

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
					result.assertions.length,
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
		});
	}
});
