// Fixture: 4-level nested chain drilled through by a single test.
// Expected: every level's TRUE is hit exactly once, FALSE never.

export type Deep<X> =
	X extends string
		? X extends "a"
			? X extends "a"
				? X extends "a"
					? "L3T"
					: "L3F"
				: "L2F"
			: "L1F"
		: "L0F";

export type _drill = Deep<"a">;
