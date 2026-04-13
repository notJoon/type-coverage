// Documents the distributive conditional limitation in v1.
// A naked type parameter + union argument should normally distribute, but v1
// evaluates the full union as a whole.
// For `"a" | 42` the whole union is NOT assignable to string → single FALSE.

export type IsStr<X> = X extends string ? 1 : 0;

export type _mixed = IsStr<"a" | 42>;

// Expected:
//   target: IsStr
//   tests: 1
//   branches: 1
//   coverage: 1/2
//   unknown: 0
//   hits:
//     L6: T=0 F=1
//   traces:
//     [0]: F
