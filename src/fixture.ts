import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import { collectInstantiations, type TargetInstantiation } from "./parser.js";
import { createTypeCheckerProfiler } from "./profile.js";
import type { BranchPoint } from "./scanner.js";
import {
	collectTargetBranches,
	findConditionalTargetInSource,
	findConditionalTargetsInSource,
	type ResolvedTargetAlias,
} from "./target.js";
import { collectTraceCoverage } from "./trace-coverage.js";
import type { TraceResult } from "./tracer.js";

export type { BranchPoint, TargetInstantiation, TraceResult };

export class FixtureRunError extends Error {}

export interface FixtureRunResult {
	sourceFile: ts.SourceFile;
	targetAlias: ts.TypeAliasDeclaration;
	paramNames: string[];
	branches: BranchPoint[];
	instantiations: TargetInstantiation[];
	traces: TraceResult[][];
	counts: Map<string, BranchHitCounts>;
}

export interface FixtureRunOptions {
	profile?: boolean;
}

function runFixtureTarget(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	target: ResolvedTargetAlias,
	profiler: ReturnType<typeof createTypeCheckerProfiler>,
): FixtureRunResult {
	const branches = collectTargetBranches(target);
	const instantiations = collectInstantiations(
		sourceFile,
		target.alias.name.text,
		checker,
		target.symbol,
		profiler,
	);
	const { traces, counts } = collectTraceCoverage({
		instantiations,
		context: {
			target,
			checker,
			profiler,
		},
	});

	return {
		sourceFile,
		targetAlias: target.alias,
		paramNames: target.paramNames,
		branches,
		instantiations,
		traces,
		counts,
	};
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
	options: FixtureRunOptions = {},
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
		const available = findConditionalTargetsInSource(sourceFile, checker)
			.map((candidate) => candidate.alias.name.text)
			.join(", ");
		throw new FixtureRunError(
			`Target "${targetTypeName}" is not a top-level conditional type in ${fixturePath}.\n${available ? `Available targets: ${available}` : "No top-level conditional types found."}`,
		);
	}
	const profiler = createTypeCheckerProfiler(checker, options.profile ?? false);
	return runFixtureTarget(sourceFile, checker, target, profiler);
}

export function runFixtureAll(fixturePath: string): FixtureRunResult[] {
	const absolute = path.resolve(fixturePath);
	const code = fs.readFileSync(absolute, "utf8");
	const { sourceFile, checker } = makeFixtureProgram(absolute, code);
	const profiler = createTypeCheckerProfiler(checker, true);

	return findConditionalTargetsInSource(sourceFile, checker)
		.map((target) => runFixtureTarget(sourceFile, checker, target, profiler))
		.filter((result) => result.instantiations.length > 0);
}
