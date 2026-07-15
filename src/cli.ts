#!/usr/bin/env node

// Project-mode CLI. Accepts a tsconfig, a conditional-type target name, and a
// test file; delegates to runProject() and renders an annotated source slice.
// Fixture mode is intentionally excluded — use scripts/run.mjs for that.

import { object } from "@optique/core/constructs";
import { formatMessage } from "@optique/core/message";
import { multiple, optional } from "@optique/core/modifiers";
import { parse } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { ProjectRunError, runProject, runProjectAll } from "./project.js";
import { renderProjectReport, renderProjectReports } from "./report.js";

const USAGE =
	"Usage: type-coverage --project <tsconfig.json> --target <TypeName> --tests <file-or-glob> [--tests <file-or-glob>] [--target-file <source-file.ts>] [--profile]";

class UsageError extends Error {}

const cliParser = object({
	project: optional(option("-p", "--project", string())),
	target: optional(option("-t", "--target", string())),
	all: option("--all"),
	tests: multiple(option("--tests", string())),
	targetFile: optional(option("--target-file", string())),
	profile: option("--profile"),
});

interface CommonCliArgs {
	project: string;
	tests: string[];
}

type CliArgs = CommonCliArgs &
	(
		| { mode: "all"; targetFile: string }
		| {
				mode: "target";
				profile: boolean;
				target: string;
				targetFile?: string;
		  }
	);

function parseCliArgs(): CliArgs {
	const parsed = parse(cliParser, process.argv.slice(2));
	if (!parsed.success) {
		throw new UsageError(formatMessage(parsed.error));
	}
	const values = parsed.value;
	if (values.target && values.all) {
		throw new UsageError("Provide exactly one of --target and --all");
	}
	if (values.all && !values.profile) {
		throw new UsageError("--all requires --profile");
	}
	if (!values.project || values.tests.length === 0) {
		throw new UsageError(USAGE);
	}
	if (values.all) {
		if (!values.targetFile) {
			throw new UsageError("Project --all requires --target-file");
		}
		return {
			mode: "all",
			project: values.project,
			tests: [...values.tests],
			targetFile: values.targetFile,
		};
	}
	if (!values.target) {
		throw new UsageError(USAGE);
	}
	return {
		mode: "target",
		project: values.project,
		target: values.target,
		tests: [...values.tests],
		...(values.targetFile ? { targetFile: values.targetFile } : {}),
		profile: values.profile,
	};
}

function main(): void {
	const args = parseCliArgs();
	if (args.mode === "all") {
		const results = runProjectAll({
			tsconfigPath: args.project,
			testFilePaths: args.tests,
			targetFilePath: args.targetFile,
			onWarn: (msg) => console.warn(`warning: ${msg}`),
		});
		console.log(
			renderProjectReports(results, {
				color: process.stdout.isTTY ?? false,
			}),
		);
		return;
	}
	const result = runProject({
		tsconfigPath: args.project,
		targetTypeName: args.target,
		testFilePaths: args.tests,
		...(args.targetFile ? { targetFilePath: args.targetFile } : {}),
		profile: args.profile,
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
