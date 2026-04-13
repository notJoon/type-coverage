// Parses a structured `// Expected:` block from a fixture source.
//
// Format:
//   // Expected:
//   //   target: Classify          ← required: which conditional type to trace
//   //   tests: 3                   ← number of instantiation aliases parsed
//   //   branches: 2                ← number of branch points in target
//   //   coverage: 4/4              ← covered / total directions
//   //   unknown: 0                 ← total unknown evaluations
//   //   hits:                      ← per-branch hit counts, keyed by source line
//   //     L4: T=1 F=2
//   //     L7: unreached
//   //   traces:                    ← per-instantiation outcomes, in source order
//   //     [0]: TT                  ← T=true, F=false, U=unknown
//   //     [1]: FU
//
// Only `target` is required; everything else is optional. Unknown top-level
// keys land in `extra` so specs can grow without breaking older parsers.

export interface BranchHitsExpected {
	trueHits: number;
	falseHits: number;
	unknownHits: number;
	unreached?: boolean;
}

export interface ExpectedSpec {
	target: string;
	tests?: number;
	branches?: number;
	coverage?: { covered: number; total: number };
	unknown?: number;
	hits?: Map<number, BranchHitsExpected>;
	traces?: string[];
	extra: Map<string, string>;
}

const HEADER_RE = /^\s*\/\/\s*Expected:\s*$/;
// Top-level entry: `//   key: value` (3+ leading spaces inside the comment)
const ENTRY_RE = /^\s*\/\/(\s{1,4})(\w+):\s*(.*?)\s*$/;
// Block child: `//     subkey: value` (5+ leading spaces inside the comment)
const CHILD_RE = /^\s*\/\/\s{5,}(\S+):\s*(.+?)\s*$/;
const BLANK_COMMENT_RE = /^\s*\/\/\s*$/;

/** Shape of a pipeline result that the serializer understands. */
export interface SerializableResult {
	branches: Array<{ id: string; line: number }>;
	instantiations: Array<unknown>;
	traces: Array<Array<{ taken: "true" | "false" | "unknown" }>>;
	counts: Map<
		string,
		{ trueHits: number; falseHits: number; unknownHits: number }
	>;
}

const BLOCK_KEYS = new Set(["hits", "traces"]);

export function parseExpected(sourceText: string): ExpectedSpec | null {
	const lines = sourceText.split("\n");
	let i = lines.findIndex((l) => HEADER_RE.test(l));
	if (i < 0) {
		return null;
	}
	i++;

	const entries = new Map<string, string>();
	const blocks = new Map<string, Array<{ key: string; value: string }>>();

	while (i < lines.length) {
		if (BLANK_COMMENT_RE.test(lines[i])) {
			i++;
			continue;
		}
		const m = lines[i].match(ENTRY_RE);
		if (!m) {
			break;
		}
		const key = m[2];
		const value = m[3];

		if (BLOCK_KEYS.has(key) && value === "") {
			i++;
			const children: Array<{ key: string; value: string }> = [];
			while (i < lines.length) {
				const cm = lines[i].match(CHILD_RE);
				if (!cm) {
					break;
				}
				children.push({ key: cm[1], value: cm[2] });
				i++;
			}
			blocks.set(key, children);
		} else {
			entries.set(key, value);
			i++;
		}
	}

	const target = entries.get("target");
	if (!target) {
		throw new Error(
			"fixture Expected block is missing required `target:` entry",
		);
	}

	const spec: ExpectedSpec = { target, extra: new Map() };

	for (const [k, v] of entries) {
		switch (k) {
			case "target":
				break;
			case "tests":
				spec.tests = parseIntStrict(k, v);
				break;
			case "branches":
				spec.branches = parseIntStrict(k, v);
				break;
			case "unknown":
				spec.unknown = parseIntStrict(k, v);
				break;
			case "coverage":
				spec.coverage = parseCoverage(v);
				break;
			default:
				spec.extra.set(k, v);
		}
	}

	const hitsBlock = blocks.get("hits");
	if (hitsBlock) {
		spec.hits = parseHitsBlock(hitsBlock);
	}
	const tracesBlock = blocks.get("traces");
	if (tracesBlock) {
		spec.traces = parseTracesBlock(tracesBlock);
	}

	return spec;
}

function parseIntStrict(key: string, raw: string): number {
	if (!/^\d+$/.test(raw)) {
		throw new Error(
			`Expected block: \`${key}\` must be a non-negative integer, got \`${raw}\``,
		);
	}
	return Number.parseInt(raw, 10);
}

function parseCoverage(raw: string): { covered: number; total: number } {
	const m = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
	if (!m) {
		throw new Error(
			`Expected block: \`coverage\` must be in the form \`N/M\`, got \`${raw}\``,
		);
	}
	return {
		covered: Number.parseInt(m[1], 10),
		total: Number.parseInt(m[2], 10),
	};
}

function parseHitsBlock(
	children: Array<{ key: string; value: string }>,
): Map<number, BranchHitsExpected> {
	const map = new Map<number, BranchHitsExpected>();
	for (const { key, value } of children) {
		const lineMatch = key.match(/^L(\d+)$/);
		if (!lineMatch) {
			throw new Error(
				`hits block: child key must be \`L<line>\`, got \`${key}\``,
			);
		}
		const line = Number.parseInt(lineMatch[1], 10);
		map.set(line, parseBranchHits(value));
	}
	return map;
}

function parseBranchHits(value: string): BranchHitsExpected {
	if (value === "unreached") {
		return { trueHits: 0, falseHits: 0, unknownHits: 0, unreached: true };
	}
	const result: BranchHitsExpected = {
		trueHits: 0,
		falseHits: 0,
		unknownHits: 0,
	};
	for (const tok of value.split(/\s+/)) {
		const m = tok.match(/^([TFU])=(\d+)$/);
		if (!m) {
			throw new Error(
				`hits block: invalid token \`${tok}\` (expected T=N, F=N, or U=N)`,
			);
		}
		const n = Number.parseInt(m[2], 10);
		if (m[1] === "T") result.trueHits = n;
		else if (m[1] === "F") result.falseHits = n;
		else result.unknownHits = n;
	}
	return result;
}

function parseTracesBlock(
	children: Array<{ key: string; value: string }>,
): string[] {
	const arr: string[] = [];
	for (const { key, value } of children) {
		const idxMatch = key.match(/^\[(\d+)\]$/);
		if (!idxMatch) {
			throw new Error(
				`traces block: child key must be \`[<index>]\`, got \`${key}\``,
			);
		}
		const idx = Number.parseInt(idxMatch[1], 10);
		if (!/^[TFU]+$/.test(value)) {
			throw new Error(
				`traces block: value must be a string of T/F/U letters, got \`${value}\``,
			);
		}
		arr[idx] = value;
	}
	return arr;
}

/** Serialize a pipeline result into an `// Expected:` block. */
export function serializeExpected(
	result: SerializableResult,
	target: string,
): string {
	const lines: string[] = ["// Expected:"];
	lines.push(`//   target: ${target}`);
	lines.push(`//   tests: ${result.instantiations.length}`);
	lines.push(`//   branches: ${result.branches.length}`);

	let total = 0;
	let covered = 0;
	let unknown = 0;
	for (const b of result.branches) {
		total += 2;
		const c = result.counts.get(b.id);
		if (c?.trueHits) covered++;
		if (c?.falseHits) covered++;
		unknown += c?.unknownHits ?? 0;
	}
	lines.push(`//   coverage: ${covered}/${total}`);
	lines.push(`//   unknown: ${unknown}`);

	if (result.branches.length > 0) {
		lines.push("//   hits:");
		for (const b of result.branches) {
			const c = result.counts.get(b.id);
			if (!c) {
				lines.push(`//     L${b.line}: unreached`);
			} else {
				const parts = [`T=${c.trueHits}`, `F=${c.falseHits}`];
				if (c.unknownHits > 0) {
					parts.push(`U=${c.unknownHits}`);
				}
				lines.push(`//     L${b.line}: ${parts.join(" ")}`);
			}
		}
	}

	if (result.traces.length > 0) {
		lines.push("//   traces:");
		for (let i = 0; i < result.traces.length; i++) {
			const encoded = result.traces[i]
				.map((s) =>
					s.taken === "true" ? "T" : s.taken === "false" ? "F" : "U",
				)
				.join("");
			lines.push(`//     [${i}]: ${encoded}`);
		}
	}

	return lines.join("\n");
}

/**
 * Replace an existing `// Expected:` block in `fileText` with `newBlock`.
 * Appends the block at end of file if none exists.
 */
export function replaceExpectedBlock(
	fileText: string,
	newBlock: string,
): string {
	const lines = fileText.split("\n");
	const startIdx = lines.findIndex((l) => HEADER_RE.test(l));

	if (startIdx < 0) {
		const trimmed = fileText.replace(/\s+$/, "");
		return `${trimmed}\n\n${newBlock}\n`;
	}

	let endIdx = startIdx + 1;
	while (endIdx < lines.length) {
		const l = lines[endIdx];
		if (
			ENTRY_RE.test(l) ||
			CHILD_RE.test(l) ||
			BLANK_COMMENT_RE.test(l)
		) {
			endIdx++;
		} else {
			break;
		}
	}

	const before = lines.slice(0, startIdx);
	const after = lines.slice(endIdx);
	return [...before, ...newBlock.split("\n"), ...after].join("\n");
}
