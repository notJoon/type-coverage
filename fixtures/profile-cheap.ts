type IsString<T> = T extends string ? true : false;

type _cheap = IsString<"x">;

// Expected:
//   target: IsString
//   tests: 1
//   branches: 1
//   coverage: 1/2
//   unknown: 0
//   hits:
//     L1: T=1 F=0
//   traces:
//     [0]: T
