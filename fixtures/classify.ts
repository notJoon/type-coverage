// A 2-branch classifier fully covered by 3 tests.

export type Classify<X> =
	X extends string
		? "s"
		: X extends number
			? "n"
			: "other";

export type _s = Classify<"hi">;
export type _n = Classify<42>;
export type _b = Classify<true>;

// Expected:
//   target: Classify
//   tests: 3
//   branches: 2
//   coverage: 4/4
//   unknown: 0
