type BuildTuple<N extends number, Acc extends unknown[] = []> =
	Acc["length"] extends N ? Acc : BuildTuple<N, [...Acc, unknown]>;

type IsBig<T> = T extends BuildTuple<300> ? true : false;

type _expensive = IsBig<BuildTuple<300>>;

// Expected:
//   target: IsBig
//   tests: 1
//   branches: 1
//   coverage: 1/2
//   unknown: 0
//   hits:
//     L4: T=1 F=0
//   traces:
//     [0]: T
