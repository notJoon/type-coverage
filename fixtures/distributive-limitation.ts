// Fixture: documents the distributive conditional limitation in v1.
// A naked type parameter + union argument should normally distribute, but v1
// evaluates the full union as a whole.
// For `"a" | 42` the whole union is NOT assignable to string → single FALSE.
// Expected: exactly one direction recorded (trueHits + falseHits === 1).

export type IsStr<X> = X extends string ? 1 : 0;

export type _mixed = IsStr<"a" | 42>;
