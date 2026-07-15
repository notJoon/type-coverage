type IsString<T> = T extends string ? true : false;

type _first = IsString<"x">;
type _second = IsString<"x">;

// Expected:
//   target: IsString
//   tests: 2
//   branches: 1
//   coverage: 1/2
//   unknown: 0
//   hits:
//     L1: T=2 F=0
//   traces:
//     [0]: T
//     [1]: T
