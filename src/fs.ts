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
	return /[*?{}]/.test(pattern);
}

const canonicalizeFileName = (fileName: string): string =>
	ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();

function resolveFromProjectRoot(
	inputPath: string,
	projectRoot: string,
): string {
	return path.normalize(
		path.isAbsolute(inputPath)
			? inputPath
			: path.resolve(projectRoot, inputPath),
	);
}

function toCanonicalPath(filePath: string): string {
	const resolved = path.resolve(filePath);
	let realPath = resolved;
	if (ts.sys.realpath) {
		try {
			realPath = ts.sys.realpath(resolved);
		} catch {
			realPath = resolved;
		}
	}
	return canonicalizeFileName(path.normalize(realPath));
}

function normalizeIncludePattern(pattern: string, projectRoot: string): string {
	const relative = path.relative(
		projectRoot,
		resolveFromProjectRoot(pattern, projectRoot),
	);
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
	const projectRootAbs = path.resolve(projectRoot);
	const allSourceFiles = program
		.getSourceFiles()
		.filter((sf) => !sf.isDeclarationFile);
	const byAbsPath = new Map<string, ts.SourceFile>(
		allSourceFiles.map((sf) => [toCanonicalPath(sf.fileName), sf]),
	);
	const selected = new Map<string, ts.SourceFile>();
	const warnings: string[] = [];

	for (const rawPattern of testFilePaths) {
		const pattern = rawPattern.trim();
		if (!pattern) {
			continue;
		}

		if (!looksLikeGlob(pattern)) {
			const abs = resolveFromProjectRoot(pattern, projectRootAbs);
			const canonicalPath = toCanonicalPath(abs);
			const sf = byAbsPath.get(canonicalPath);
			if (!sf) {
				return {
					sourceFiles: [],
					warnings,
					error: {
						message: `Test file not found in program: ${abs}\nHint: make sure the file is included by the tsconfig's \`include\`.`,
					},
				};
			}
			selected.set(canonicalPath, sf);
			continue;
		}

		const diskMatches = matchProgramFilesByGlob(projectRootAbs, pattern);
		if (diskMatches.length === 0) {
			warnings.push(`test pattern matched no files on disk: ${pattern}`);
			continue;
		}

		let programMatched = 0;
		for (const matchedPath of diskMatches) {
			const canonicalPath = toCanonicalPath(matchedPath);
			const sf = byAbsPath.get(canonicalPath);
			if (!sf) {
				continue;
			}
			programMatched++;
			selected.set(canonicalPath, sf);
		}
		if (programMatched === 0) {
			warnings.push(
				`test pattern matched files on disk, but none were included in the TypeScript program: ${pattern}`,
			);
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
