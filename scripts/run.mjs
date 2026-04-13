#!/usr/bin/env node

// Runner with two modes:
//
//   Project mode — trace branches in a real TS project:
//     node scripts/run.mjs \
//       --project <tsconfig.json> --target <TypeName> --tests <test-file.ts>
//
//   Fixture mode — run against a self-contained fixture file that defines
//   both the target type and its instantiation aliases:
//     node scripts/run.mjs --fixture fixtures/<name>.ts --target <TypeName>

import path from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";
import { renderAnnotated } from "../dist/annotate.js";
import { runFixture } from "../dist/fixture.js";
import { collectInstantiations } from "../dist/instantiation-parser.js";
import { collectBranches } from "../dist/scanner.js";
import { traceConditionalChain } from "../dist/tracer.js";

const { values } = parseArgs({
	options: {
		project: { type: "string", short: "p" },
		target: { type: "string", short: "t" },
		tests: { type: "string" },
		fixture: { type: "string", short: "f" },
		color: { type: "boolean", default: true },
		"tab-width": { type: "string" },
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

const tsconfigPath = path.resolve(values.project);
const projectRoot = path.dirname(tsconfigPath);
const testFilePath = path.resolve(values.tests);
const targetName = values.target;

const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (error) {
	console.error("Failed to read tsconfig:", error.messageText);
	process.exit(1);
}
const { options, fileNames } = ts.parseJsonConfigFileContent(
	config,
	ts.sys,
	projectRoot,
);

const program = ts.createProgram(fileNames, options);
const checker = program.getTypeChecker();

// 1. Find the target type alias definition
function findTargetAlias(prog, name) {
	for (const sf of prog.getSourceFiles()) {
		if (sf.isDeclarationFile) continue;
		for (const node of sf.statements) {
			if (
				ts.isTypeAliasDeclaration(node) &&
				node.name.text === name &&
				ts.isConditionalTypeNode(node.type)
			) {
				return { alias: node, sourceFile: sf };
			}
		}
	}
	return null;
}

const found = findTargetAlias(program, targetName);
if (!found) {
	console.error(
		`Target type "${targetName}" (conditional type alias) not found in project`,
	);
	process.exit(1);
}
const { alias: targetAlias, sourceFile: targetSourceFile } = found;

const rootCond = targetAlias.type;
const paramNames = (targetAlias.typeParameters ?? []).map((p) => p.name.text);

// 2. Collect branches within the target type alias only
const allBranches = collectBranches(targetSourceFile, projectRoot);
const branches = allBranches.filter((b) => b.typeName === targetName);

// 3. Collect target instantiations from the test file
const testSourceFile = program.getSourceFile(testFilePath);
if (!testSourceFile) {
	console.error(`Test file not found in program: ${testFilePath}`);
	console.error(
		"Hint: make sure the test file is included by the tsconfig's `include`.",
	);
	process.exit(1);
}
const instantiations = collectInstantiations(
	testSourceFile,
	targetName,
	checker,
);

// 4. Trace each instantiation
const hits = new Map();
for (const inst of instantiations) {
	const paramMap = new Map();
	for (const [i, name] of paramNames.entries()) {
		if (inst.typeArgs[i]) paramMap.set(name, inst.typeArgs[i]);
	}
	const traces = traceConditionalChain(
		rootCond,
		paramMap,
		targetSourceFile,
		checker,
		projectRoot,
	);
	for (const t of traces) {
		let entry = hits.get(t.branchId);
		if (!entry) {
			entry = { trueHits: 0, falseHits: 0, unknownHits: 0 };
			hits.set(t.branchId, entry);
		}
		if (t.taken === "true") {
			entry.trueHits++;
		} else if (t.taken === "false") {
			entry.falseHits++;
		} else {
			entry.unknownHits++;
		}
	}
}

function summarize(branchList, counts) {
	let total = 0;
	let covered = 0;
	let unknown = 0;
	for (const b of branchList) {
		total += 2;
		const h = counts.get(b.id);
		if (h?.trueHits) covered++;
		if (h?.falseHits) covered++;
		unknown += h?.unknownHits ?? 0;
	}
	const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
	return { total, covered, unknown, pct };
}

// 5. Render — slice source to the target alias region for readability
const { line: startLine } = targetSourceFile.getLineAndCharacterOfPosition(
	targetAlias.getStart(targetSourceFile),
);
const { line: endLine } = targetSourceFile.getLineAndCharacterOfPosition(
	targetAlias.getEnd(),
);
const fullText = targetSourceFile.text;
// Render only the region of the target alias, but keep absolute line numbers.
// renderAnnotated uses 1-based line numbers matching BranchPoint.line, so we
// pass the full text but slice the output lines after rendering.
const rendered = renderAnnotated(fullText, branches, hits, {
	color: values.color,
	tabWidth,
}).split("\n");
const slice = rendered.slice(startLine, endLine + 1);

console.log(`\nFile: ${path.relative(projectRoot, targetSourceFile.fileName)}`);
console.log(`Target: ${targetName}<${paramNames.join(", ")}>`);
console.log(`Instantiations analyzed: ${instantiations.length}\n`);
console.log(slice.join("\n"));

// 6. Summary
const summary = summarize(branches, hits);
console.log(
	`\nDirection coverage: ${summary.covered}/${summary.total} (${summary.pct}%), unknown evaluations: ${summary.unknown}`,
);

function runInFixtureMode() {
	const fixturePath = path.resolve(values.fixture);
	const result = runFixture(fixturePath, values.target);
	const { sourceFile, branches, instantiations, counts } = result;

	const fullText = sourceFile.text;
	const rendered = renderAnnotated(fullText, branches, counts, {
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
