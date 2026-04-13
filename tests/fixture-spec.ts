// Parses a structured `// Expected:` header block from a fixture source.
//
// Format:
//   // Expected:
//   //   target: Classify
//   //   tests: 3
//   //   branches: 2
//   //   coverage: 4/4
//   //   unknown: 0
//
// Unrecognized keys are preserved in `extra` so specs can grow without
// breaking the parser.

export interface ExpectedSpec {
	target: string;
	tests?: number;
	branches?: number;
	coverage?: { covered: number; total: number };
	unknown?: number;
	extra: Map<string, string>;
}

const HEADER_RE = /^\s*\/\/\s*Expected:\s*$/;
const ENTRY_RE = /^\s*\/\/\s+(\w+):\s*(.+?)\s*$/;

export function parseExpected(sourceText: string): ExpectedSpec | null {
	const lines = sourceText.split("\n");
	let i = 0;
	while (i < lines.length && !HEADER_RE.test(lines[i])) {
		i++;
	}
	if (i === lines.length) {
		return null;
	}

	const entries = new Map<string, string>();
	i++;
	while (i < lines.length) {
		const m = lines[i].match(ENTRY_RE);
		if (!m) {
			break;
		}
		entries.set(m[1], m[2]);
		i++;
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
