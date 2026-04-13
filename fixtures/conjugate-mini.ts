// Fixture: Conjugate-style type with partially covered branches.
// Expected: 3/6 directions covered, 0 unknown.

type HadaVerb = { stem: "하"; form: "하다" };
type IeoVerb = { stem: "있" } | { stem: "없" };

export type Conjugate<V, F> =
	V extends HadaVerb
		? F extends "해요"
			? "해요"
			: "하다"
		: V extends IeoVerb
			? "있어요"
			: "other";

export type _hada_haeyo = Conjugate<{ stem: "하"; form: "하다" }, "해요">;
export type _hada_other = Conjugate<{ stem: "하"; form: "하다" }, "기본">;
