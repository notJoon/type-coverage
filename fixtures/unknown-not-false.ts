// Fixture: computed check type (Box<X>) must produce unknown, never
// false-positive as true/false. Expected: unknownHits=2, trueHits=0, falseHits=0.

type Box<T> = { value: T };

export type Is<X> = Box<X> extends { value: string } ? 1 : 0;

export type _t1 = Is<"hi">;
export type _t2 = Is<"there">;
