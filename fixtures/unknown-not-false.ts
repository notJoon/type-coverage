// Computed check type (Box<X>) must produce unknown, never
// false-positive as true/false.

type Box<T> = { value: T };

export type Is<X> = Box<X> extends { value: string } ? 1 : 0;

export type _t1 = Is<"hi">;
export type _t2 = Is<"there">;

// Expected:
//   target: Is
//   tests: 2
//   branches: 1
//   coverage: 0/2
//   unknown: 2
