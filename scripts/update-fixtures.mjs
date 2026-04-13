#!/usr/bin/env node

// Batch update Expected blocks for every fixture in fixtures/.
// Each fixture must already declare a `// Expected:` block with at least
// `target:` so we know which conditional type to trace.
//
// Usage: node scripts/update-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { runFixture } from "../dist/fixture.js";
import {
	parseExpected,
	replaceExpectedBlock,
	serializeExpected,
} from "../dist-tests/tests/fixture-spec.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");

let changed = 0;
let skipped = 0;
let unchanged = 0;

const files = fs
	.readdirSync(FIXTURES_DIR)
	.filter((f) => f.endsWith(".ts"))
	.sort();

for (const file of files) {
	const fixturePath = path.join(FIXTURES_DIR, file);
	const original = fs.readFileSync(fixturePath, "utf8");
	const spec = parseExpected(original);
	if (!spec) {
		console.log(
			`skip  ${file} (no Expected block — add one with at least \`target:\`)`,
		);
		skipped++;
		continue;
	}

	const result = runFixture(fixturePath, spec.target);
	const newBlock = serializeExpected(result, spec.target);
	const updated = replaceExpectedBlock(original, newBlock);

	if (updated === original) {
		console.log(`ok    ${file}`);
		unchanged++;
	} else {
		fs.writeFileSync(fixturePath, updated);
		console.log(`write ${file}`);
		changed++;
	}
}

console.log(`\n${changed} updated, ${unchanged} unchanged, ${skipped} skipped`);
