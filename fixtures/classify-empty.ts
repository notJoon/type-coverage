// Fixture: same Classify type as classify.ts but with no test aliases.
// Expected: 0 tests, 0/4 covered, counts map empty.

export type Classify<X> =
	X extends string
		? "s"
		: X extends number
			? "n"
			: "other";
