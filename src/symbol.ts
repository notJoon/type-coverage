import ts from "typescript";

export function canonicalSymbol(
	symbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ts.Symbol | undefined {
	if (!symbol) {
		return undefined;
	}
	if (symbol.flags & ts.SymbolFlags.Alias) {
		return checker.getAliasedSymbol(symbol);
	}
	return symbol;
}

export function getTypeReferenceSymbol(
	ref: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
): ts.Symbol | undefined {
	if (ts.isQualifiedName(ref.typeName)) {
		return checker.getSymbolAtLocation(ref.typeName.right);
	}
	return checker.getSymbolAtLocation(ref.typeName);
}
