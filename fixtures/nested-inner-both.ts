// Fixture: inner conditional under a shared outer TRUE gets both directions
// exercised by varying the inner check input. The intersection type
// `"outer-yes" & "inner-yes"` drives inner TRUE; plain "outer-yes" drives
// inner FALSE.
// Expected: outer TRUE=2 FALSE=0, inner TRUE=1 FALSE=1.

export type T<X> =
	X extends "outer-yes"
		? X extends "inner-yes"
			? "both"
			: "only-outer"
		: "neither";

export type _both = T<"outer-yes" & "inner-yes">;
export type _only_outer = T<"outer-yes">;
