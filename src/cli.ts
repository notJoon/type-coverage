#!/usr/bin/env node

// Project-mode CLI. Accepts a tsconfig, a conditional-type target name, and a
// test file; delegates to runProject() and renders an annotated source slice.
// Fixture mode is intentionally excluded — use scripts/run.mjs for that.

import { parseArgs } from "node:util";
import { ProjectRunError, runProject } from "./project.js";
import { renderProjectReport } from "./report.js";

const USAGE =
	"Usage: type-coverage --project <tsconfig.json> --target <TypeName> --tests <file-or-glob> [--tests <file-or-glob>] [--target-file <source-file.ts>]";

class UsageError extends Error {}

function parseCliArgs() {
	const { values } = parseArgs({
		options: {
			project: { type: "string", short: "p" },
			target: { type: "string", short: "t" },
			tests: { type: "string", multiple: true },
			"target-file": { type: "string" },
		},
	});
	if (!values.project || !values.target || !values.tests) {
		throw new UsageError(USAGE);
	}
	return {
		project: values.project,
		target: values.target,
		tests: values.tests,
		targetFile: values["target-file"],
	};
}

function main(): void {
	const args = parseCliArgs();
	const result = runProject({
		tsconfigPath: args.project,
		targetTypeName: args.target,
		testFilePaths: args.tests,
		targetFilePath: args.targetFile,
		onWarn: (msg) => console.warn(`warning: ${msg}`),
	});
	console.log(
		renderProjectReport(result, args.target, {
			color: process.stdout.isTTY ?? false,
		}),
	);
}

try {
	main();
} catch (err) {
	if (err instanceof UsageError) {
		console.error(err.message);
		process.exit(2);
	}
	if (err instanceof ProjectRunError) {
		console.error(err.message);
		process.exit(1);
	}
	throw err;
}
