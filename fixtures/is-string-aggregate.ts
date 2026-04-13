// 5 tests, 2 take TRUE, 3 take FALSE. Verifies per-test trace outcomes sum
// equals the aggregated branch counters.

export type Is<X> = X extends string ? 1 : 0;

export type _a = Is<"x">;
export type _b = Is<"y">;
export type _c = Is<1>;
export type _d = Is<2>;
export type _e = Is<3>;

// Expected:
//   target: Is
//   tests: 5
//   branches: 1
//   coverage: 2/2
//   unknown: 0
