import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import type ts from "typescript";
import { runFixture, runFixtureAll } from "../src/fixture.js";
import { createTypeCheckerProfiler } from "../src/profile.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "..", "fixtures");

function fixture(name: string, target: string) {
	return runFixture(path.join(FIXTURES, name), target, { profile: true });
}

function totalCounters(cost: {
	types: number;
	instantiations: number;
	relationChecks: number;
}): number {
	return cost.types + cost.instantiations + cost.relationChecks;
}

describe("type-operation profiling", () => {
	it("profiles instantiated conditional aliases in source order", () => {
		const results = runFixtureAll(path.join(FIXTURES, "profile-all.ts"));

		assert.deepEqual(
			results.map((result) => result.targetAlias.name.text),
			["First", "Second"],
		);
		assert.deepEqual(
			results.map((result) => result.instantiations.length),
			[1, 1],
		);
	});

	it("shares first-touch checker caches across targets", () => {
		const results = runFixtureAll(path.join(FIXTURES, "profile-all-cache.ts"));
		const first = results.find(
			(result) => result.targetAlias.name.text === "First",
		);
		const second = results.find(
			(result) => result.targetAlias.name.text === "Second",
		);
		const firstCost = first?.instantiations[0]?.cost;
		const secondCost = second?.instantiations[0]?.cost;

		assert.ok(firstCost);
		assert.ok(secondCost);
		assert.ok(totalCounters(firstCost) > 0);
		assert.equal(totalCounters(secondCost), 0);
	});

	it("disables profiling when the TypeScript internal counters are unavailable", () => {
		assert.equal(
			createTypeCheckerProfiler({} as ts.TypeChecker, true),
			undefined,
		);
	});

	it("is opt-in and returns non-negative marginal costs", () => {
		const fixturePath = path.join(FIXTURES, "profile-cheap.ts");
		const ordinary = runFixture(fixturePath, "IsString");
		const profiled = runFixture(fixturePath, "IsString", { profile: true });

		assert.equal(ordinary.traces[0][0].cost, undefined);
		const cost = profiled.traces[0][0].cost;
		assert.ok(cost);
		assert.ok(cost.types >= 0);
		assert.ok(cost.instantiations >= 0);
		assert.ok(cost.relationChecks >= 0);
		assert.ok(cost.ms >= 0);
	});

	it("reports a higher counter cost for an expensive type argument", () => {
		const cheapResult = fixture("profile-cheap.ts", "IsString");
		const expensiveResult = fixture("profile-expensive.ts", "IsBig");
		const cheap = cheapResult.traces[0][0].cost;
		const expensive = expensiveResult.traces[0][0].cost;
		const cheapTypeArgs = cheapResult.instantiations[0].cost;
		const expensiveTypeArgs = expensiveResult.instantiations[0].cost;

		assert.ok(cheap);
		assert.ok(expensive);
		assert.ok(cheapTypeArgs);
		assert.ok(expensiveTypeArgs);
		assert.ok(totalCounters(expensive) > totalCounters(cheap));
		assert.ok(totalCounters(expensiveTypeArgs) > totalCounters(cheapTypeArgs));
	});

	it("reports zero counter delta when the same type is evaluated again", () => {
		const result = fixture("profile-cache.ts", "IsString");
		const second = result.traces[1][0].cost;

		assert.ok(second);
		assert.equal(second.types, 0);
		assert.equal(second.instantiations, 0);
		assert.equal(second.relationChecks, 0);
	});
});
