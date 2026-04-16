import path from "node:path";
import ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import { collectTestSourceFiles } from "./fs.js";
import { collectInstantiations, type TargetInstantiation } from "./parser.js";
import type { BranchPoint } from "./scanner.js";
import {
	collectTargetBranches,
	findConditionalTargetsInProgram,
} from "./target.js";
import { collectTraceCoverage } from "./trace-coverage.js";
import type { TraceResult, UnknownReason } from "./tracer.js";

export type { BranchPoint, TargetInstantiation, TraceResult, UnknownReason };

export interface ProjectRunOptions {
	tsconfigPath: string;
	targetTypeName: string;
	testFilePaths: string[];
	targetFilePath?: string;
	/** Called with a short human-readable message when a recoverable issue occurs. */
	onWarn?: (message: string) => void;
}

export interface CoverageSummary {
	total: number;
	covered: number;
	unknown: number;
	pct: number;
	unknownByReason: Partial<Record<UnknownReason, number>>;
}

export interface ProjectRunResult {
	sourceFile: ts.SourceFile;
	targetAlias: ts.TypeAliasDeclaration;
	conditional: ts.ConditionalTypeNode;
	paramNames: string[];
	branches: BranchPoint[];
	instantiations: TargetInstantiation[];
	traces: TraceResult[][];
	counts: Map<string, BranchHitCounts>;
	summary: CoverageSummary;
	projectRoot: string;
}

export function summarize(
	branches: BranchPoint[],
	counts: Map<string, BranchHitCounts>,
	unknownByReason: Partial<Record<UnknownReason, number>> = {},
): CoverageSummary {
	let total = 0;
	let covered = 0;
	let unknown = 0;
	for (const b of branches) {
		total += 2;
		const h = counts.get(b.id);
		if (h?.trueHits) {
			covered++;
		}
		if (h?.falseHits) {
			covered++;
		}
		unknown += h?.unknownHits ?? 0;
	}
	const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
	return { total, covered, unknown, pct, unknownByReason };
}

export class ProjectRunError extends Error {}

/**
 * Run the scanner + instantiation-parser + tracer pipeline against a real
 * TypeScript project. The target conditional type is located across all
 * non-declaration source files in the program; instantiations are collected
 * from the named test file.
 */
export function runProject(options: ProjectRunOptions): ProjectRunResult {
	const tsconfigPath = path.resolve(options.tsconfigPath);
	const projectRoot = path.dirname(tsconfigPath);
	const warn = options.onWarn ?? (() => {});

	const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (error) {
		throw new ProjectRunError(
			`Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
		);
	}
	const { options: compilerOptions, fileNames } = ts.parseJsonConfigFileContent(
		config,
		ts.sys,
		projectRoot,
	);

	const program = ts.createProgram(fileNames, compilerOptions);
	const checker = program.getTypeChecker();

	const targets = findConditionalTargetsInProgram(
		program,
		options.targetTypeName,
		checker,
		options.targetFilePath,
	);
	if (targets.length === 0) {
		throw new ProjectRunError(
			`Target type "${options.targetTypeName}" (conditional type alias) not found in project`,
		);
	}
	if (targets.length > 1) {
		const files = [
			...new Set(
				targets.map((t) => path.relative(projectRoot, t.sourceFile.fileName)),
			),
		].join(", ");
		throw new ProjectRunError(
			`Target type "${options.targetTypeName}" is ambiguous across files: ${files}\nHint: provide --target-file to disambiguate.`,
		);
	}
	const target = targets[0];

	const testSourceCollection = collectTestSourceFiles(
		program,
		options.testFilePaths,
		projectRoot,
	);
	for (const message of testSourceCollection.warnings) {
		warn(message);
	}
	if (!testSourceCollection.ok) {
		throw new ProjectRunError(testSourceCollection.error.message);
	}
	const testSourceFiles = testSourceCollection.sourceFiles;

	const branches = collectTargetBranches(target, projectRoot);

	const instantiations: TargetInstantiation[] = [];
	for (const testSourceFile of testSourceFiles) {
		instantiations.push(
			...collectInstantiations(
				testSourceFile,
				options.targetTypeName,
				checker,
				target.symbol,
			),
		);
	}

	const { traces, counts, unknownByReason } = collectTraceCoverage({
		instantiations,
		context: {
			target,
			checker,
			projectRoot,
		},
		hooks: {
			onArityMismatch: (inst, expectedTypeArgs) => {
				warn(
					`instantiation \`${inst.name}\` at L${inst.line} expects ${expectedTypeArgs} type argument(s), got ${inst.typeArgs.length}`,
				);
			},
		},
	});

	return {
		sourceFile: target.sourceFile,
		targetAlias: target.alias,
		conditional: target.conditional,
		paramNames: target.paramNames,
		branches,
		instantiations,
		traces,
		counts,
		summary: summarize(branches, counts, unknownByReason),
		projectRoot,
	};
}
