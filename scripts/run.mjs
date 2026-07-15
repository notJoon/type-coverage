#!/usr/bin/env node

// Dev runner with two modes:
//
//   Project mode — trace branches in a real TS project:
//     node scripts/run.mjs \
//       --project <tsconfig.json> --target <TypeName> --tests <file-or-glob>
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
import { hasProfileCosts, renderAnnotated } from "../dist/annotate.js";
import { runFixture, runFixtureAll } from "../dist/fixture.js";
import { PROFILE_NOTE } from "../dist/profile.js";
import { runProject, runProjectAll, summarize } from "../dist/project.js";
import { renderProjectReport, renderProjectReports } from "../dist/report.js";
import {
	replaceExpectedBlock,
	serializeExpected,
} from "../dist-tests/tests/fixture-spec.js";

const { values } = parseArgs({
	options: {
		project: { type: "string", short: "p" },
		target: { type: "string", short: "t" },
		all: { type: "boolean", default: false },
		tests: { type: "string", multiple: true },
		"target-file": { type: "string" },
		fixture: { type: "string", short: "f" },
		color: { type: "boolean", default: true },
		"tab-width": { type: "string" },
		"update-test": { type: "boolean", default: false },
		profile: { type: "boolean", default: false },
	},
});

const tabWidth = values["tab-width"]
	? Number.parseInt(values["tab-width"], 10)
	: undefined;

if (values.target && values.all) {
	console.error("Provide exactly one of --target and --all");
	process.exit(2);
}

if (!values.target && !values.all) {
	console.error("Missing required --target <TypeName>");
	process.exit(2);
}

if (values.all && !values.profile) {
	console.error("--all requires --profile");
	process.exit(2);
}

if (values.all && values["update-test"]) {
	console.error("--all cannot be combined with --update-test");
	process.exit(2);
}

if (values.fixture) {
	runInFixtureMode();
	process.exit(0);
}

if (!values.project || !values.tests) {
	console.error(
		"Usage:\n" +
			"  Project: --project <tsconfig.json> --target <TypeName> --tests <file-or-glob> [--tests <file-or-glob>] [--target-file <source-file.ts>] [--profile]\n" +
			"  Fixture: --fixture <path.ts> --target <TypeName> [--profile]",
	);
	process.exit(2);
}

if (values.all && !values["target-file"]) {
	console.error("Project --all requires --target-file");
	process.exit(2);
}

runInProjectMode();

function runInProjectMode() {
	if (values.all) {
		const results = runProjectAll({
			tsconfigPath: values.project,
			testFilePaths: values.tests,
			targetFilePath: values["target-file"],
			onWarn: (msg) => console.warn(`warning: ${msg}`),
		});
		console.log(
			renderProjectReports(results, { color: values.color, tabWidth }),
		);
		return;
	}
	const result = runProject({
		tsconfigPath: values.project,
		targetTypeName: values.target,
		testFilePaths: values.tests,
		targetFilePath: values["target-file"],
		profile: values.profile,
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
	if (values.all) {
		const results = runFixtureAll(fixturePath);
		for (const result of results) {
			const target = result.targetAlias.name.text;
			const rendered = renderAnnotated(
				result.sourceFile.text,
				result.branches,
				result.counts,
				{ color: values.color, tabWidth },
			);
			console.log(`\nFixture: ${path.relative(process.cwd(), fixturePath)}`);
			console.log(`Target: ${target}`);
			console.log(`Instantiations analyzed: ${result.instantiations.length}\n`);
			console.log(rendered);
			if (!hasProfileCosts(result.counts)) {
				const s = summarize(result.branches, result.counts);
				console.log(
					`\nDirection coverage: ${s.covered}/${s.total} (${s.pct}%), unknown evaluations: ${s.unknown}`,
				);
			}
		}
		if (results.some((result) => hasProfileCosts(result.counts))) {
			console.log(`\n${PROFILE_NOTE}`);
		}
		return;
	}
	const result = runFixture(fixturePath, values.target, {
		profile: values.profile,
	});

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

	if (hasProfileCosts(counts)) {
		console.log(`\n${PROFILE_NOTE}`);
	} else {
		const s = summarize(branches, counts);
		console.log(
			`\nDirection coverage: ${s.covered}/${s.total} (${s.pct}%), unknown evaluations: ${s.unknown}`,
		);
	}
}
