import type ts from "typescript";

export const PROFILE_NOTE =
	"Profile costs are first-touch marginal deltas; checker caches make them order dependent, not absolute costs.";

/** First-touch deltas at one evaluation point; checker caches make them order-dependent. */
export interface MarginalCost {
	types: number;
	instantiations: number;
	relationChecks: number;
	ms: number;
}

interface Snapshot {
	types: number;
	instantiations: number;
	relationChecks: number;
}

interface ProfilingChecker {
	getTypeCount?: () => number;
	getInstantiationCount?: () => number;
	getRelationCacheSizes?: () => Record<string, number>;
}

export type TypeCheckerProfiler = <T>(operation: () => T) => {
	value: T;
	cost: MarginalCost;
};

export function createTypeCheckerProfiler(
	checker: ts.TypeChecker,
	enabled: boolean,
): TypeCheckerProfiler | undefined {
	if (!enabled) {
		return undefined;
	}

	const internal = checker as unknown as ProfilingChecker;
	if (
		typeof internal.getTypeCount !== "function" ||
		typeof internal.getInstantiationCount !== "function" ||
		typeof internal.getRelationCacheSizes !== "function"
	) {
		return undefined;
	}

	function snapshot(): Snapshot {
		return {
			types: internal.getTypeCount?.call(checker) ?? 0,
			instantiations: internal.getInstantiationCount?.call(checker) ?? 0,
			relationChecks: Object.values(
				internal.getRelationCacheSizes?.call(checker) ?? {},
			).reduce((sum, size) => sum + size, 0),
		};
	}

	return <T>(operation: () => T) => {
		const before = snapshot();
		const start = performance.now();
		const value = operation();
		const ms = performance.now() - start;
		const after = snapshot();
		return {
			value,
			cost: {
				types: after.types - before.types,
				instantiations: after.instantiations - before.instantiations,
				relationChecks: after.relationChecks - before.relationChecks,
				ms,
			},
		};
	};
}

export function addMarginalCosts(
	left: MarginalCost,
	right: MarginalCost,
): MarginalCost {
	return {
		types: left.types + right.types,
		instantiations: left.instantiations + right.instantiations,
		relationChecks: left.relationChecks + right.relationChecks,
		ms: left.ms + right.ms,
	};
}
