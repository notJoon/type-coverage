import type ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import type { TargetInstantiation } from "./parser.js";
import type { ResolvedTargetAlias } from "./target.js";
import {
	type TraceResult,
	traceConditionalChain,
	type UnknownReason,
} from "./tracer.js";

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

function buildParamMap(
	paramNames: string[],
	typeArgs: ts.Type[],
): Map<string, ts.Type> {
	const paramMap = new Map<string, ts.Type>();
	for (const [i, name] of paramNames.entries()) {
		if (typeArgs[i]) {
			paramMap.set(name, typeArgs[i]);
		}
	}
	return paramMap;
}

export type TraceCoverageTargetContext = Pick<
	ResolvedTargetAlias,
	"conditional" | "paramNames" | "sourceFile"
>;

export interface TraceCoverageExecutionContext {
	target: TraceCoverageTargetContext;
	checker: ts.TypeChecker;
	projectRoot?: string;
}

export interface TraceCoverageHooks {
	onArityMismatch?: (
		instantiation: TargetInstantiation,
		expectedTypeArgs: number,
	) => void;
}

export interface CollectTraceCoverageOptions {
	instantiations: TargetInstantiation[];
	context: TraceCoverageExecutionContext;
	hooks?: TraceCoverageHooks;
}

export interface CollectTraceCoverageResult {
	traces: TraceResult[][];
	counts: Map<string, BranchHitCounts>;
	unknownByReason: Partial<Record<UnknownReason, number>>;
}

export function collectTraceCoverage(
	options: CollectTraceCoverageOptions,
): CollectTraceCoverageResult {
	const traces: TraceResult[][] = [];
	const counts = new Map<string, BranchHitCounts>();
	const unknownByReason: Partial<Record<UnknownReason, number>> = {};

	for (const inst of options.instantiations) {
		if (
			options.hooks?.onArityMismatch &&
			inst.typeArgs.length !== options.context.target.paramNames.length
		) {
			options.hooks.onArityMismatch(
				inst,
				options.context.target.paramNames.length,
			);
		}

		const trace = traceConditionalChain(
			options.context.target.conditional,
			buildParamMap(options.context.target.paramNames, inst.typeArgs),
			options.context.target.sourceFile,
			options.context.checker,
			options.context.projectRoot,
		);
		traces.push(trace);

		for (const step of trace) {
			let entry = counts.get(step.branchId);
			if (!entry) {
				entry = emptyCounts();
				counts.set(step.branchId, entry);
			}
			bumpCount(entry, step.taken);
			if (step.taken === "unknown") {
				unknownByReason[step.unknownReason] =
					(unknownByReason[step.unknownReason] ?? 0) + 1;
			}
		}
	}

	return { traces, counts, unknownByReason };
}
