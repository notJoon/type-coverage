// Fixture: a 2-branch classifier fully covered by 3 tests.
// Expected coverage: 4/4 directions, 0 unknown.

export type Classify<X> =
	X extends string
		? "s"
		: X extends number
			? "n"
			: "other";

export type _s = Classify<"hi">;
export type _n = Classify<42>;
export type _b = Classify<true>;
