// Both tests take the root TRUE branch. The root FALSE subtree's inner
// conditional must stay unreached (no entry in counts map).

export type T<X> =
	X extends "yes"
		? X extends "yes"
			? "hit-inner-true"
			: "hit-inner-false"
		: X extends "no"
			? "neg-inner-true"
			: "neg-inner-false";

export type _t1 = T<"yes">;
export type _t2 = T<"yes">;

// Expected:
//   target: T
//   tests: 2
//   branches: 3
//   coverage: 2/6
//   unknown: 0
//   hits:
//     L5: T=2 F=0
//     L6: T=2 F=0
//     L9: unreached
//   traces:
//     [0]: TT
//     [1]: TT
