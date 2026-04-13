// Verifies hit counters increment exactly once per test.
// 3 tests hit TRUE, 1 hits FALSE on a single branch.

export type Is<X> = X extends string ? 1 : 0;

export type _t1 = Is<"a">;
export type _t2 = Is<"b">;
export type _t3 = Is<"c">;
export type _t4 = Is<42>;

// Expected:
//   target: Is
//   tests: 4
//   branches: 1
//   coverage: 2/2
//   unknown: 0
//   hits:
//     L4: T=3 F=1
//   traces:
//     [0]: T
//     [1]: T
//     [2]: T
//     [3]: F
