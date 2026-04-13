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
//   hits:
//     L6: T=1 F=2
//     L7: T=1 F=0
//     L10: T=1 F=1
//   traces:
//     [0]: TT
//     [1]: FT
//     [2]: FF
