// Unknown at a middle level must stop the chain. The deepest conditional
// below the unknown must remain unreached in counts.

type Box<T> = { v: T };

export type T<X> =
	X extends "go"
		? Box<X> extends { v: string }
			? X extends "go"
				? "deep-true"
				: "deep-false"
			: "not-box"
		: "skip";

export type _t1 = T<"go">;

// Expected:
//   target: T
//   tests: 1
//   branches: 3
//   coverage: 1/6
//   unknown: 1
