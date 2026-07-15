import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const CLI = path.resolve(import.meta.dirname, "..", "..", "dist", "cli.js");
const RUNNER = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"scripts",
	"run.mjs",
);
const FIXTURES = path.resolve(import.meta.dirname, "..", "..", "fixtures");
const PROFILE_ALL = path.join(FIXTURES, "profile-all.ts");
const PROFILE_EXPENSIVE = path.join(FIXTURES, "profile-expensive.ts");

function run(...args: string[]) {
	return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

describe("CLI", () => {
	it("profiles every instantiated fixture target in source order", () => {
		const result = spawnSync(
			process.execPath,
			[
				RUNNER,
				"--fixture",
				PROFILE_ALL,
				"--all",
				"--profile",
			],
			{ encoding: "utf8" },
		);

		assert.equal(result.status, 0, result.stderr);
		assert.ok(
			result.stdout.indexOf("Target: First") <
				result.stdout.indexOf("Target: Second"),
		);
		assert.doesNotMatch(result.stdout, /Target: Unused/);
		assert.match(result.stdout, /\+[\d,]+ types · \+[\d,]+ inst · ~[\d.]+ms/);
		assert.doesNotMatch(result.stdout, /✓|MISS|Direction coverage/);
		assert.equal(result.stdout.match(/first-touch marginal/g)?.length, 1);
	});

	it("preserves single-target output", () => {
		const result = run(
			"--project",
			path.join(FIXTURES, "tsconfig.json"),
			"--tests",
			"profile-all.ts",
			"--target",
			"First",
			"--target-file",
			PROFILE_ALL,
		);

		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			result.stdout,
			'\nFile: profile-all.ts\nTarget: First<T>\nInstantiations analyzed: 1\n\n  1 │ export type First<T> = T extends string ? true : false;    ✓T  ✗ MISS F\n\nDirection coverage: 1/2 (50%), unknown evaluations: 0\n',
		);
	});

	it("rejects using --target and --all together", () => {
		const result = run(
			"--project",
			"tsconfig.json",
			"--tests",
			"tests.ts",
			"--target",
			"T",
			"--all",
			"--profile",
			"--target-file",
			"types.ts",
		);

		assert.equal(result.status, 2);
		assert.match(result.stderr, /exactly one of --target and --all/i);
	});

	it("reports invalid options without a stack trace", () => {
		const result = run("--targte", "Example");

		assert.equal(result.status, 2);
		assert.match(result.stderr, /Unexpected option or argument: "--targte"/);
		assert.doesNotMatch(result.stderr, /TypeError|at parseCliArgs|Node\.js/);
	});

	it("preserves the missing --target diagnostic without --all", () => {
		const result = run(
			"--project",
			"tsconfig.json",
			"--tests",
			"tests.ts",
		);

		assert.equal(result.status, 2);
		assert.equal(
			result.stderr,
			"Usage: type-coverage --project <tsconfig.json> --target <TypeName> --tests <file-or-glob> [--tests <file-or-glob>] [--target-file <source-file.ts>] [--profile]\n",
		);
	});

	it("preserves the fixture runner missing --target diagnostic", () => {
		const result = spawnSync(
			process.execPath,
			[RUNNER, "--fixture", PROFILE_ALL],
			{ encoding: "utf8" },
		);

		assert.equal(result.status, 2);
		assert.equal(result.stderr, "Missing required --target <TypeName>\n");
	});

	it("preserves the fixture runner missing --tests diagnostic", () => {
		const result = spawnSync(
			process.execPath,
			[RUNNER, "--project", "tsconfig.json", "--target", "Example"],
			{ encoding: "utf8" },
		);

		assert.equal(result.status, 2);
		assert.match(result.stderr, /^Usage:/);
		assert.doesNotMatch(result.stderr, /at runProject|Node\.js/);
	});

	it("reports an invalid fixture target without a stack trace", () => {
		const result = spawnSync(
			process.execPath,
			[
				RUNNER,
				"--fixture",
				PROFILE_EXPENSIVE,
				"--target",
				"_expensive",
				"--profile",
			],
			{ encoding: "utf8" },
		);

		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/Target "_expensive" is not a top-level conditional type/,
		);
		assert.match(result.stderr, /Available targets: BuildTuple, IsBig/);
		assert.doesNotMatch(result.stderr, /at runFixture|Node\.js/);
	});

	it("requires --profile with --all", () => {
		const result = run(
			"--project",
			"tsconfig.json",
			"--tests",
			"tests.ts",
			"--all",
			"--target-file",
			"types.ts",
		);

		assert.equal(result.status, 2);
		assert.match(result.stderr, /--all requires --profile/i);
	});

	it("requires --target-file in project --all mode", () => {
		const result = run(
			"--project",
			"tsconfig.json",
			"--tests",
			"tests.ts",
			"--all",
			"--profile",
		);

		assert.equal(result.status, 2);
		assert.match(result.stderr, /--all requires --target-file/i);
	});
});
