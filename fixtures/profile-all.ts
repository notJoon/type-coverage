export type First<T> = T extends string ? true : false;

type Unused<T> = T extends boolean ? true : false;

type Second<T> = T extends number ? true : false;

type _first = First<"x">;
type _second = Second<42>;

// Expected:
//   target: First
//   tests: 1
//   branches: 1
//   coverage: 1/2
//   unknown: 0
//   hits:
//     L1: T=1 F=0
//   traces:
//     [0]: T
