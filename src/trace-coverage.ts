import type ts from "typescript";
import type { BranchHitCounts } from "./annotate.js";
import type { TargetInstantiation } from "./parser.js";
import { addMarginalCosts, type TypeCheckerProfiler } from "./profile.js";
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
	switch (taken) {
		case "true":
			counts.trueHits++;
			break;
		case "false":
			counts.falseHits++;
			break;
		case "unknown":
			counts.unknownHits++;
			break;
		default: {
			const exhaustive: never = taken;
			throw new Error(`Unexpected branch outcome: ${exhaustive}`);
		}
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
	profiler: TypeCheckerProfiler | undefined;
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
			options.context.profiler,
			inst.cost,
		);
		traces.push(trace);

		for (const step of trace) {
			let entry = counts.get(step.branchId);
			if (!entry) {
				entry = emptyCounts();
				counts.set(step.branchId, entry);
			}
			bumpCount(entry, step.taken);
			if (step.cost) {
				entry.cost = entry.cost
					? addMarginalCosts(entry.cost, step.cost)
					: step.cost;
			}
			if (step.taken === "unknown") {
				unknownByReason[step.unknownReason] =
					(unknownByReason[step.unknownReason] ?? 0) + 1;
			}
		}
	}

	return { traces, counts, unknownByReason };
}
