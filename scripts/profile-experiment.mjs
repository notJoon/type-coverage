import ts from "typescript";

const cheap = `
type IsString<T> = T extends string ? true : false;
type A = IsString<"x">;
`;

// Deliberately expensive: deep recursive tuple builder forces many instantiations.
const expensive = `
type BuildTuple<N extends number, Acc extends unknown[] = []> =
  Acc["length"] extends N ? Acc : BuildTuple<N, [...Acc, unknown]>;
type Big = BuildTuple<500>;
type IsBig<T> = T extends Big ? true : false;
type B = IsBig<BuildTuple<500>>;
`;

function makeProgram(code) {
	const fileName = "/main.ts";
	const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true);
	const host = ts.createCompilerHost({ strict: true });
	const origGet = host.getSourceFile.bind(host);
	host.getSourceFile = (name, ...rest) =>
		name === fileName ? sf : origGet(name, ...rest);
	host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
	host.readFile = (name) => (name === fileName ? code : ts.sys.readFile(name));
	return ts.createProgram([fileName], { strict: true }, host);
}

function snapshot(checker) {
	return {
		types: checker.getTypeCount(),
		inst: checker.getInstantiationCount(),
		rel: Object.values(checker.getRelationCacheSizes()).reduce(
			(a, b) => a + b,
			0,
		),
	};
}

function measure(label, code, aliasName) {
	const prog = makeProgram(code);
	const checker = prog.getTypeChecker();
	const sf = prog.getSourceFile("/main.ts");
	let aliasNode;
	sf.forEachChild((n) => {
		if (ts.isTypeAliasDeclaration(n) && n.name.text === aliasName) {
			aliasNode = n;
		}
	});

	for (const run of [1, 2]) {
		const before = snapshot(checker);
		const t0 = performance.now();
		// Force full evaluation of the alias (this is the "operation" being profiled)
		const type = checker.getTypeAtLocation(aliasNode.name);
		checker.typeToString(type); // force resolution
		const ms = performance.now() - t0;
		const after = snapshot(checker);
		console.log(
			`${label} run${run}: ${ms.toFixed(2)}ms | +types=${after.types - before.types} +instantiations=${after.inst - before.inst} +relationChecks=${after.rel - before.rel}`,
		);
	}
}

measure("cheap    ", cheap, "A");
measure("expensive", expensive, "B");
