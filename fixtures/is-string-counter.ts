// Fixture: verifies hit counters increment exactly once per test.
// Expected: trueHits=3, falseHits=1, unknownHits=0 for the single branch.

export type Is<X> = X extends string ? 1 : 0;

export type _t1 = Is<"a">;
export type _t2 = Is<"b">;
export type _t3 = Is<"c">;
export type _t4 = Is<42>;
