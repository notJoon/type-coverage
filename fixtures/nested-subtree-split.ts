// Fixture: verifies TRUE and FALSE subtrees accrue hits independently.
// Three tests: one to outer.TRUE→inner-true.TRUE, one to outer.FALSE→
// inner-false.TRUE, one to outer.FALSE→inner-false.FALSE.
// Expected: 5/6 directions covered (inner-true FALSE never hit).

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
