// Same Classify type as classify.ts but with no test aliases.

export type Classify<X> =
	X extends string
		? "s"
		: X extends number
			? "n"
			: "other";

// Expected:
//   target: Classify
//   tests: 0
//   branches: 2
//   coverage: 0/4
//   unknown: 0
