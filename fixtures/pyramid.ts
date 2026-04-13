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
//   hits:
//     L5: T=1 F=0
//     L6: T=1 F=0
//     L7: T=1 F=0
//     L8: T=1 F=0
//   traces:
//     [0]: TTTT
