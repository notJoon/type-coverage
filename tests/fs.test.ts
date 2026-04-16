import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import ts from "typescript";
import { collectTestSourceFiles } from "../src/fs.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempProject(files: Record<string, string>): {
	root: string;
	tsconfigPath: string;
	program: ts.Program;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "type-coverage-fs-"));
	tempDirs.push(root);

	for (const [relPath, content] of Object.entries(files)) {
		const absPath = path.join(root, relPath);
		fs.mkdirSync(path.dirname(absPath), { recursive: true });
		fs.writeFileSync(absPath, content);
	}

	const tsconfigPath = path.join(root, "tsconfig.json");
	const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (error) {
		throw new Error(
			ts.flattenDiagnosticMessageText(error.messageText, "\n"),
		);
	}
	const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
	const program = ts.createProgram(parsed.fileNames, parsed.options);
	return { root, tsconfigPath, program };
}

describe("collectTestSourceFiles", () => {
	it("collects matching files from a relative brace glob", () => {
		const { root, program } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/types.ts": `export type X = 1;`,
			"tests/a.test.ts": `type A = X;`,
			"tests/b.test.ts": `type B = X;`,
		});

		const result = collectTestSourceFiles(
			program,
			["./tests/{a,b}.test.ts"],
			root,
		);

		assert.equal(result.ok, true);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.sourceFiles.length, 2);
		const basenames = result.sourceFiles
			.map((sf) => path.basename(sf.fileName))
			.sort();
		assert.deepEqual(basenames, ["a.test.ts", "b.test.ts"]);
	});

	it("returns an immediate error for a missing direct file path", () => {
		const { root, program } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/types.ts": `export type X = 1;`,
			"tests/a.test.ts": `type A = X;`,
		});

		const missing = path.join(root, "tests", "missing.test.ts");
		const result = collectTestSourceFiles(program, [missing], root);

		assert.equal(result.ok, false);
		assert.equal(result.sourceFiles.length, 0);
		assert.equal(result.warnings.length, 0);
		assert.match(result.error.message, /Test file not found in program/);
		assert.match(result.error.message, /make sure the file is included/);
	});

	it("warns for unmatched glob and returns final no-match error", () => {
		const { root, program } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/types.ts": `export type X = 1;`,
			"tests/a.test.ts": `type A = X;`,
		});

		const result = collectTestSourceFiles(program, ["tests/nope*.ts"], root);

		assert.equal(result.ok, false);
		assert.equal(result.sourceFiles.length, 0);
		assert.deepEqual(result.warnings, [
			"test pattern matched no files on disk: tests/nope*.ts",
		]);
		assert.match(result.error.message, /No test files matched --tests patterns/);
	});

	it("does not include files that match glob on disk but are excluded from program", () => {
		const { root, program } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/a.test.ts"],
			}),
			"src/types.ts": `export type X = 1;`,
			"tests/a.test.ts": `type A = X;`,
			"tests/b.test.ts": `type B = X;`,
		});

		const result = collectTestSourceFiles(program, ["tests/*.test.ts"], root);

		assert.equal(result.ok, true);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.sourceFiles.length, 1);
		assert.equal(path.basename(result.sourceFiles[0].fileName), "a.test.ts");
	});
});
