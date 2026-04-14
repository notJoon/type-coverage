import path from "node:path";
import ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import { collectInstantiations, type TargetInstantiation } from "./parser.js";
import { type BranchPoint, collectBranches } from "./scanner.js";
import { type TraceResult, traceConditionalChain } from "./tracer.js";

export type { BranchPoint, TargetInstantiation, TraceResult };

export interface ProjectRunOptions {
	tsconfigPath: string;
	targetTypeName: string;
	testFilePath: string;
	/** Called with a short human-readable message when a recoverable issue occurs. */
	onWarn?: (message: string) => void;
}

export interface CoverageSummary {
	total: number;
	covered: number;
	unknown: number;
	pct: number;
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
	return { total, covered, unknown, pct };
}

export class ProjectRunError extends Error {}

interface TargetAlias {
	alias: ts.TypeAliasDeclaration;
	sourceFile: ts.SourceFile;
	conditional: ts.ConditionalTypeNode;
	paramNames: string[];
}

function findTargetAlias(
	program: ts.Program,
	name: string,
): TargetAlias | undefined {
	for (const sf of program.getSourceFiles()) {
		if (sf.isDeclarationFile) {
			continue;
		}
		for (const node of sf.statements) {
			if (
				ts.isTypeAliasDeclaration(node) &&
				node.name.text === name &&
				ts.isConditionalTypeNode(node.type)
			) {
				return {
					alias: node,
					sourceFile: sf,
					conditional: node.type,
					paramNames: (node.typeParameters ?? []).map((p) => p.name.text),
				};
			}
		}
	}
	return undefined;
}

function emptyCounts(): BranchHitCounts {
	return { trueHits: 0, falseHits: 0, unknownHits: 0 };
}

function bumpCount(counts: BranchHitCounts, taken: TraceResult["taken"]): void {
	if (taken === "true") {
		counts.trueHits++;
	} else if (taken === "false") {
		counts.falseHits++;
	} else {
		counts.unknownHits++;
	}
}

/**
 * Run the scanner + instantiation-parser + tracer pipeline against a real
 * TypeScript project. The target conditional type is located across all
 * non-declaration source files in the program; instantiations are collected
 * from the named test file.
 */
export function runProject(options: ProjectRunOptions): ProjectRunResult {
	const tsconfigPath = path.resolve(options.tsconfigPath);
	const projectRoot = path.dirname(tsconfigPath);
	const testFilePath = path.resolve(options.testFilePath);
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

	const target = findTargetAlias(program, options.targetTypeName);
	if (!target) {
		throw new ProjectRunError(
			`Target type "${options.targetTypeName}" (conditional type alias) not found in project`,
		);
	}

	const testSourceFile = program.getSourceFile(testFilePath);
	if (!testSourceFile) {
		throw new ProjectRunError(
			`Test file not found in program: ${testFilePath}\nHint: make sure the test file is included by the tsconfig's \`include\`.`,
		);
	}

	const branches = collectBranches(target.sourceFile, projectRoot).filter(
		(b) => b.typeName === options.targetTypeName,
	);

	const instantiations = collectInstantiations(
		testSourceFile,
		options.targetTypeName,
		checker,
	);

	const traces: TraceResult[][] = [];
	const counts = new Map<string, BranchHitCounts>();

	for (const inst of instantiations) {
		if (inst.typeArgs.length !== target.paramNames.length) {
			warn(
				`instantiation \`${inst.name}\` at L${inst.line} expects ${target.paramNames.length} type argument(s), got ${inst.typeArgs.length}`,
			);
		}
		const paramMap = new Map<string, ts.Type>();
		for (const [i, name] of target.paramNames.entries()) {
			if (inst.typeArgs[i]) {
				paramMap.set(name, inst.typeArgs[i]);
			}
		}
		const trace = traceConditionalChain(
			target.conditional,
			paramMap,
			target.sourceFile,
			checker,
			projectRoot,
		);
		traces.push(trace);
		for (const step of trace) {
			let entry = counts.get(step.branchId);
			if (!entry) {
				entry = emptyCounts();
				counts.set(step.branchId, entry);
			}
			bumpCount(entry, step.taken);
		}
	}

	return {
		sourceFile: target.sourceFile,
		targetAlias: target.alias,
		conditional: target.conditional,
		paramNames: target.paramNames,
		branches,
		instantiations,
		traces,
		counts,
		summary: summarize(branches, counts),
		projectRoot,
	};
}
