export type BuildTuple<N extends number, Acc extends unknown[] = []> =
	Acc["length"] extends N ? Acc : BuildTuple<N, [...Acc, unknown]>;

type First<T> = T extends unknown[] ? true : false;
type Second<T> = T extends unknown[] ? true : false;

type _first = First<BuildTuple<200>>;
type _second = Second<BuildTuple<200>>;

// Expected:
//   target: First
//   tests: 1
//   branches: 1
//   coverage: 1/2
//   unknown: 0
//   hits:
//     L4: T=1 F=0
//   traces:
//     [0]: T
