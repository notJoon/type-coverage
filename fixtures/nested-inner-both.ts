// Inner conditional under a shared outer TRUE gets both directions exercised
// by varying the inner check input. `"outer-yes" & "inner-yes"` drives inner
// TRUE; plain `"outer-yes"` drives inner FALSE.

export type T<X> =
	X extends "outer-yes"
		? X extends "inner-yes"
			? "both"
			: "only-outer"
		: "neither";

export type _both = T<"outer-yes" & "inner-yes">;
export type _only_outer = T<"outer-yes">;

// Expected:
//   target: T
//   tests: 2
//   branches: 2
//   coverage: 3/4
//   unknown: 0
