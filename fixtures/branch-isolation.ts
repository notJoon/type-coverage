// Fixture: both tests take the root TRUE branch. The root FALSE subtree's
// inner conditional must stay unreached (no entry in counts map).
// Expected: root TRUE=2, inner-true TRUE=2, inner-false subtree unreached.

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
