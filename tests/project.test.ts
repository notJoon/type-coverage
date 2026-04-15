import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ProjectRunError, runProject } from "../src/project.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempProject(files: Record<string, string>): {
	root: string;
	tsconfigPath: string;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "type-coverage-"));
	tempDirs.push(root);
	for (const [relPath, content] of Object.entries(files)) {
		const absPath = path.join(root, relPath);
		fs.mkdirSync(path.dirname(absPath), { recursive: true });
		fs.writeFileSync(absPath, content);
	}
	return { root, tsconfigPath: path.join(root, "tsconfig.json") };
}

describe("runProject", () => {
	it("collects instantiations across multiple test files matched by glob", () => {
		const { root, tsconfigPath } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/types.ts": `export type IsString<T> = T extends string ? 1 : 0;`,
			"tests/a.test.ts": `type _a = IsString<"x">;`,
			"tests/b.test.ts": `type _b = IsString<42>;`,
		});

		const result = runProject({
			tsconfigPath,
			targetTypeName: "IsString",
			testFilePaths: [path.join(root, "tests", "*.test.ts")],
		});

		assert.equal(result.instantiations.length, 2);
		assert.equal(result.summary.total, 2);
		assert.equal(result.summary.covered, 2);
	});

	it("supports relative glob patterns with braces", () => {
		const { tsconfigPath } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/types.ts": `export type IsString<T> = T extends string ? 1 : 0;`,
			"tests/a.test.ts": `type _a = IsString<"x">;`,
			"tests/b.test.ts": `type _b = IsString<42>;`,
		});

		const result = runProject({
			tsconfigPath,
			targetTypeName: "IsString",
			testFilePaths: ["./tests/{a,b}.test.ts"],
		});

		assert.equal(result.instantiations.length, 2);
	});

	it("throws when target type name is ambiguous without targetFilePath", () => {
		const { root, tsconfigPath } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/a.ts": `export type Dup<T> = T extends string ? 1 : 0;`,
			"src/b.ts": `export type Dup<T> = T extends number ? 1 : 0;`,
			"tests/t.test.ts": `type _t = Dup<"x">;`,
		});

		assert.throws(
			() =>
				runProject({
					tsconfigPath,
					targetTypeName: "Dup",
					testFilePaths: [path.join(root, "tests", "t.test.ts")],
				}),
			(err: unknown) =>
				err instanceof ProjectRunError &&
				/ambiguous/.test(err.message) &&
				/--target-file/.test(err.message),
		);
	});

	it("disambiguates target type by targetFilePath", () => {
		const { root, tsconfigPath } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/a.ts": `export type Dup<T> = T extends string ? 1 : 0;`,
			"src/b.ts": `export type Dup<T> = T extends number ? 1 : 0;`,
			"tests/t.test.ts": `type _t = Dup<"x">;`,
		});

		const result = runProject({
			tsconfigPath,
			targetTypeName: "Dup",
			targetFilePath: path.join(root, "src", "a.ts"),
			testFilePaths: [path.join(root, "tests", "t.test.ts")],
		});

		assert.equal(path.basename(result.sourceFile.fileName), "a.ts");
		assert.equal(result.summary.covered, 1);
	});

	it("throws when test patterns match no files", () => {
		const { root, tsconfigPath } = makeTempProject({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { strict: true, noLib: true },
				include: ["src/**/*.ts", "tests/**/*.ts"],
			}),
			"src/types.ts": `export type IsString<T> = T extends string ? 1 : 0;`,
			"tests/a.test.ts": `type _a = IsString<"x">;`,
		});

		assert.throws(
			() =>
				runProject({
					tsconfigPath,
					targetTypeName: "IsString",
					testFilePaths: [path.join(root, "tests", "missing*.ts")],
				}),
			(err: unknown) =>
				err instanceof ProjectRunError &&
				/no test files matched/i.test(err.message),
		);
	});
});
