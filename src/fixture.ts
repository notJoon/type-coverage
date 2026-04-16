import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import { collectInstantiations, type TargetInstantiation } from "./parser.js";
import type { BranchPoint } from "./scanner.js";
import {
	collectTargetBranches,
	findConditionalTargetInSource,
} from "./target.js";
import { collectTraceCoverage } from "./trace-coverage.js";
import type { TraceResult } from "./tracer.js";

export type { BranchPoint, TargetInstantiation, TraceResult };

export interface FixtureRunResult {
	sourceFile: ts.SourceFile;
	branches: BranchPoint[];
	instantiations: TargetInstantiation[];
	traces: TraceResult[][];
	counts: Map<string, BranchHitCounts>;
}

function makeFixtureProgram(
	fixturePath: string,
	code: string,
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
	const host = ts.createCompilerHost({}, true);
	const orig = host.getSourceFile.bind(host);
	host.getSourceFile = (name, lang, onError, shouldCreate) => {
		if (name === fixturePath) {
			return ts.createSourceFile(name, code, lang, true);
		}
		return orig(name, lang, onError, shouldCreate);
	};

	const origExists = host.fileExists.bind(host);
	host.fileExists = (name) => name === fixturePath || origExists(name);

	const origRead = host.readFile.bind(host);
	host.readFile = (name) => (name === fixturePath ? code : origRead(name));

	const program = ts.createProgram(
		[fixturePath],
		{ target: ts.ScriptTarget.Latest, strict: true, noLib: true },
		host,
	);

	const sourceFile = program.getSourceFile(fixturePath);
	if (!sourceFile) {
		throw new Error(`fixture source file not found: ${fixturePath}`);
	}

	return { sourceFile, checker: program.getTypeChecker() };
}

/**
 * Load a fixture file and run the scanner + instantiation-parser + tracer
 * pipeline against a named target conditional type. Returns the source file,
 * branch points, per-instantiation traces, and aggregated per-branch hit counts.
 *
 * The fixture is expected to define both the target type and one or more
 * `type _name = Target<...>` instantiation aliases in the same file.
 */
export function runFixture(
	fixturePath: string,
	targetTypeName: string,
): FixtureRunResult {
	const absolute = path.resolve(fixturePath);
	const code = fs.readFileSync(absolute, "utf8");
	const { sourceFile, checker } = makeFixtureProgram(absolute, code);

	const target = findConditionalTargetInSource(
		sourceFile,
		targetTypeName,
		checker,
	);
	if (!target) {
		throw new Error(
			`target conditional type "${targetTypeName}" not found in ${fixturePath}`,
		);
	}
	const branches = collectTargetBranches(target);

	const instantiations = collectInstantiations(
		sourceFile,
		targetTypeName,
		checker,
		target.symbol,
	);
	const { traces, counts } = collectTraceCoverage({
		instantiations,
		context: {
			target,
			checker,
		},
	});

	return { sourceFile, branches, instantiations, traces, counts };
}
