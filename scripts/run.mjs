#!/usr/bin/env node

// Dev runner with two modes:
//
//   Project mode — trace branches in a real TS project:
//     node scripts/run.mjs \
//       --project <tsconfig.json> --target <TypeName> --tests <test-file.ts>
//
//   Fixture mode — run against a self-contained fixture file that defines
//   both the target type and its instantiation aliases:
//     node scripts/run.mjs --fixture fixtures/<name>.ts --target <TypeName>
//
// The published CLI (dist/cli.js) is project-mode only. Fixture mode and
// --update-test live here because they are dev-only.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderAnnotated } from "../dist/annotate.js";
import { runFixture } from "../dist/fixture.js";
import { runProject, summarize } from "../dist/project.js";
import { renderProjectReport } from "../dist/report.js";
import {
	replaceExpectedBlock,
	serializeExpected,
} from "../dist-tests/tests/fixture-spec.js";

const { values } = parseArgs({
	options: {
		project: { type: "string", short: "p" },
		target: { type: "string", short: "t" },
		tests: { type: "string" },
		fixture: { type: "string", short: "f" },
		color: { type: "boolean", default: true },
		"tab-width": { type: "string" },
		"update-test": { type: "boolean", default: false },
	},
});

const tabWidth = values["tab-width"]
	? Number.parseInt(values["tab-width"], 10)
	: undefined;

if (!values.target) {
	console.error("Missing required --target <TypeName>");
	process.exit(2);
}

if (values.fixture) {
	runInFixtureMode();
	process.exit(0);
}

if (!values.project || !values.tests) {
	console.error(
		"Usage:\n" +
			"  Project: --project <tsconfig.json> --target <TypeName> --tests <test-file.ts>\n" +
			"  Fixture: --fixture <path.ts> --target <TypeName>",
	);
	process.exit(2);
}

runInProjectMode();

function runInProjectMode() {
	const result = runProject({
		tsconfigPath: values.project,
		targetTypeName: values.target,
		testFilePath: values.tests,
		onWarn: (msg) => console.warn(`warning: ${msg}`),
	});
	console.log(
		renderProjectReport(result, values.target, {
			color: values.color,
			tabWidth,
		}),
	);
}

function runInFixtureMode() {
	const fixturePath = path.resolve(values.fixture);
	const result = runFixture(fixturePath, values.target);

	if (values["update-test"]) {
		const original = fs.readFileSync(fixturePath, "utf8");
		const newBlock = serializeExpected(result, values.target);
		const updated = replaceExpectedBlock(original, newBlock);
		if (updated !== original) {
			fs.writeFileSync(fixturePath, updated);
			console.log(
				`Updated Expected block in ${path.relative(process.cwd(), fixturePath)}`,
			);
		} else {
			console.log(
				`No change — Expected block already matches actual output for ${path.relative(process.cwd(), fixturePath)}`,
			);
		}
		return;
	}

	const { sourceFile, branches, instantiations, counts } = result;
	const rendered = renderAnnotated(sourceFile.text, branches, counts, {
		color: values.color,
		tabWidth,
	});

	console.log(`\nFixture: ${path.relative(process.cwd(), fixturePath)}`);
	console.log(`Target: ${values.target}`);
	console.log(`Instantiations analyzed: ${instantiations.length}\n`);
	console.log(rendered);

	const s = summarize(branches, counts);
	console.log(
		`\nDirection coverage: ${s.covered}/${s.total} (${s.pct}%), unknown evaluations: ${s.unknown}`,
	);
}
