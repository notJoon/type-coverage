// Verifies TRUE and FALSE subtrees accrue hits independently.
// Three tests: outer.TRUE → inner-true.TRUE, outer.FALSE → inner-false.TRUE,
// outer.FALSE → inner-false.FALSE.

export type T<X> =
	X extends "a"
		? X extends "a"
			? "A-hit"
			: "A-miss"
		: X extends "b"
			? "B-hit"
			: "B-miss";

export type _a = T<"a">;
export type _b = T<"b">;
export type _c = T<"c">;

// Expected:
//   target: T
//   tests: 3
//   branches: 3
//   coverage: 5/6
//   unknown: 0
