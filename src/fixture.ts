import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import { collectInstantiations, type TargetInstantiation } from "./parser.js";
import { type BranchPoint, collectBranches } from "./scanner.js";
import { type TraceResult, traceConditionalChain } from "./tracer.js";

export type { BranchPoint, TargetInstantiation, TraceResult };

export interface FixtureRunResult {
	sourceFile: ts.SourceFile;
	branches: BranchPoint[];
	instantiations: TargetInstantiation[];
	traces: TraceResult[][];
	counts: Map<string, BranchHitCounts>;
}

interface TargetAlias {
	cond: ts.ConditionalTypeNode;
	paramNames: string[];
}

function findTargetAlias(
	sourceFile: ts.SourceFile,
	targetTypeName: string,
): TargetAlias | undefined {
	for (const node of sourceFile.statements) {
		if (
			ts.isTypeAliasDeclaration(node) &&
			node.name.text === targetTypeName &&
			ts.isConditionalTypeNode(node.type)
		) {
			return {
				cond: node.type,
				paramNames: (node.typeParameters ?? []).map((p) => p.name.text),
			};
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

	const branches = collectBranches(sourceFile).filter(
		(b) => b.typeName === targetTypeName,
	);

	const target = findTargetAlias(sourceFile, targetTypeName);
	if (!target) {
		throw new Error(
			`target conditional type "${targetTypeName}" not found in ${fixturePath}`,
		);
	}

	const instantiations = collectInstantiations(
		sourceFile,
		targetTypeName,
		checker,
	);
	const traces: TraceResult[][] = [];
	const counts = new Map<string, BranchHitCounts>();

	for (const inst of instantiations) {
		const paramMap = new Map<string, ts.Type>(
			target.paramNames.map((name, i) => [name, inst.typeArgs[i]]),
		);
		const trace = traceConditionalChain(
			target.cond,
			paramMap,
			sourceFile,
			checker,
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

	return { sourceFile, branches, instantiations, traces, counts };
}
