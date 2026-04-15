import path from "node:path";
import ts from "typescript";

interface TestSourceFileCollectionError {
	message: string;
}

export interface TestSourceFileCollectionResult {
	sourceFiles: ts.SourceFile[];
	warnings: string[];
	error?: TestSourceFileCollectionError;
}

function looksLikeGlob(pattern: string): boolean {
	return /[*?[\]{}()!+@]/.test(pattern);
}

function normalizeIncludePattern(pattern: string, projectRoot: string): string {
	const relative = path.isAbsolute(pattern)
		? path.relative(projectRoot, pattern)
		: pattern;
	const normalized = relative.replaceAll("\\", "/");
	return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function expandBraces(pattern: string): string[] {
	const start = pattern.indexOf("{");
	if (start < 0) {
		return [pattern];
	}
	let depth = 0;
	let end = -1;
	for (let i = start; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) {
		return [pattern];
	}

	const before = pattern.slice(0, start);
	const inside = pattern.slice(start + 1, end);
	const after = pattern.slice(end + 1);
	const parts: string[] = [];
	let chunk = "";
	depth = 0;
	for (const ch of inside) {
		if (ch === "," && depth === 0) {
			parts.push(chunk);
			chunk = "";
			continue;
		}
		if (ch === "{") depth++;
		if (ch === "}") depth--;
		chunk += ch;
	}
	parts.push(chunk);

	return parts.flatMap((part) => expandBraces(`${before}${part}${after}`));
}

function matchProgramFilesByGlob(
	projectRoot: string,
	pattern: string,
): string[] {
	const includePatterns = expandBraces(
		normalizeIncludePattern(pattern, projectRoot),
	);
	if (includePatterns.length === 0) {
		return [];
	}
	return ts.sys.readDirectory(
		projectRoot,
		undefined,
		undefined,
		includePatterns,
	);
}

export function collectTestSourceFiles(
	program: ts.Program,
	testFilePaths: string[],
	projectRoot: string,
): TestSourceFileCollectionResult {
	const allSourceFiles = program
		.getSourceFiles()
		.filter((sf) => !sf.isDeclarationFile);
	const byAbsPath = new Map<string, ts.SourceFile>(
		allSourceFiles.map((sf) => [path.resolve(sf.fileName), sf]),
	);
	const selected = new Map<string, ts.SourceFile>();
	const warnings: string[] = [];

	for (const rawPattern of testFilePaths) {
		const pattern = rawPattern.trim();
		if (!pattern) {
			continue;
		}

		if (!looksLikeGlob(pattern)) {
			const abs = path.resolve(pattern);
			const sf = byAbsPath.get(abs);
			if (!sf) {
				return {
					sourceFiles: [],
					warnings,
					error: {
						message: `Test file not found in program: ${abs}\nHint: make sure the file is included by the tsconfig's \`include\`.`,
					},
				};
			}
			selected.set(abs, sf);
			continue;
		}

		let matched = 0;
		for (const matchedPath of matchProgramFilesByGlob(projectRoot, pattern)) {
			const sf = byAbsPath.get(path.resolve(matchedPath));
			if (!sf) {
				continue;
			}
			matched++;
			selected.set(path.resolve(matchedPath), sf);
		}
		if (matched === 0) {
			warnings.push(`test pattern matched no files: ${pattern}`);
		}
	}

	const result = [...selected.values()];
	if (result.length === 0) {
		return {
			sourceFiles: [],
			warnings,
			error: {
				message: `No test files matched --tests patterns: ${testFilePaths.join(", ")}`,
			},
		};
	}
	return { sourceFiles: result, warnings };
}
