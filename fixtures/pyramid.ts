// 4-level nested chain drilled through by a single test.
// Every level's TRUE is hit exactly once, FALSE never.

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

export type _pyramid = Deep<"a">;

// Expected:
//   target: Deep
//   tests: 1
//   branches: 4
//   coverage: 4/8
//   unknown: 0
