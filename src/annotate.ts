import { styleText } from "node:util";
import type { BranchPoint } from "./scanner.js";

export interface BranchHitCounts {
	trueHits: number;
	falseHits: number;
	/** Hits where the branch outcome could not be determined (e.g. non-boolean expressions). */
	unknownHits: number;
}

export interface RenderOptions {
	color?: boolean;
	/** Visual width of a tab character in the rendered output. Default: 2. */
	tabWidth?: number;
	/**
	 * Whether to display hit counts next to T/F markers. Default: "auto".
	 * - "auto" — show counts only if any branch was hit more than once
	 *   (boolean-like coverage stays compact as ✓/✗)
	 * - "always" — always show `(N)` after T/F
	 * - "never" — never show numbers
	 */
	showCounts?: "auto" | "always" | "never";
}

type StyleFormat = Parameters<typeof styleText>[0];
type Colorize = (color: StyleFormat, text: string) => string;

function makeColorize(color: boolean): Colorize {
	if (!color) {
		return (_c, text) => text;
	}
	return (c, text) => styleText(c, text, { validateStream: false });
}

// Visual style policy:
//   covered branch  → de-emphasized (gray) so the eye skips past it
//   missed branch   → high-contrast (red + bold) so gaps stand out
//   unknown / unreached → muted gray
const COVERED_STYLE: StyleFormat = "gray";
const MISSED_STYLE: StyleFormat = ["red", "bold"];
const MUTED_STYLE: StyleFormat = "gray";

interface PlacedMarker {
	line: number;
	text: string;
}

/**
 * Compute the marker(s) for a branch and the line each should appear on.
 *
 * - For decided branches (some true/false hit) the TRUE and FALSE markers are
 *   placed on the lines where the `?`/`:` clauses begin so the visual mapping
 *   matches the branch direction in code.
 * - Unreached and unknown-only branches stay on the check line as a single
 *   consolidated badge — neither direction was actually evaluated.
 */
function placeMarkers(
	branch: BranchPoint,
	counts: BranchHitCounts | undefined,
	colorize: Colorize,
	showCounts: boolean,
): PlacedMarker[] {
	// TODO: suppress this `⦸ unreached` marker when the branch is nested
	// inside a parent direction that was already reported as missed (✗ MISS).
	// The unreached badge then duplicates information already conveyed by the
	// parent's MISS marker on the same line — see e.g. conjugate-mini.ts L12
	// where `✗ MISS F` and `⦸ unreached` collide.
	if (!counts) {
		return [{ line: branch.line, text: colorize(MUTED_STYLE, "⦸ unreached") }];
	}
	const { trueHits, falseHits, unknownHits } = counts;
	if (unknownHits > 0 && trueHits === 0 && falseHits === 0) {
		const text = showCounts ? `? unknown(${unknownHits})` : "? unknown";
		return [{ line: branch.line, text: colorize(MUTED_STYLE, text) }];
	}

	const tCount = showCounts ? `(${trueHits})` : "";
	const fCount = showCounts ? `(${falseHits})` : "";
	const t =
		trueHits > 0
			? colorize(COVERED_STYLE, `✓T${tCount}`)
			: colorize(MISSED_STYLE, "✗ MISS T");
	const f =
		falseHits > 0
			? colorize(COVERED_STYLE, `✓F${fCount}`)
			: colorize(MISSED_STYLE, "✗ MISS F");

	const placed: PlacedMarker[] = [
		{ line: branch.trueLine, text: t },
		{ line: branch.falseLine, text: f },
	];
	if (unknownHits > 0) {
		const uText = showCounts ? `?(${unknownHits})` : "?";
		placed.push({
			line: branch.line,
			text: colorize(MUTED_STYLE, uText),
		});
	}
	return placed;
}

function shouldShowCounts(
	mode: NonNullable<RenderOptions["showCounts"]>,
	hits: Map<string, BranchHitCounts>,
): boolean {
	if (mode === "always") return true;
	if (mode === "never") return false;
	for (const c of hits.values()) {
		if (c.trueHits > 1 || c.falseHits > 1 || c.unknownHits > 1) return true;
	}
	return false;
}

// Unicode East Asian Width — Wide (W) and Fullwidth (F) ranges
// Spec: https://www.unicode.org/reports/tr11/
const WIDE_RANGES: readonly [number, number][] = [
	[0x1100, 0x115f], // Hangul Jamo
	[0x2e80, 0x2eff], // CJK Radicals Supplement
	[0x2f00, 0x2fdf], // Kangxi Radicals
	[0x2ff0, 0x2fff], // Ideographic Description Characters
	[0x3000, 0x303f], // CJK Symbols and Punctuation
	[0x3040, 0x309f], // Hiragana
	[0x30a0, 0x30ff], // Katakana
	[0x3100, 0x312f], // Bopomofo
	[0x3130, 0x318f], // Hangul Compatibility Jamo
	[0x3190, 0x319f], // Kanbun
	[0x31a0, 0x31bf], // Bopomofo Extended
	[0x31c0, 0x31ef], // CJK Strokes
	[0x31f0, 0x31ff], // Katakana Phonetic Extensions
	[0x3200, 0x32ff], // Enclosed CJK Letters and Months
	[0x3300, 0x33ff], // CJK Compatibility
	[0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
	[0x4e00, 0x9fff], // CJK Unified Ideographs
	[0xa000, 0xa4cf], // Yi
	[0xa960, 0xa97f], // Hangul Jamo Extended-A
	[0xac00, 0xd7a3], // Hangul Syllables
	[0xd7b0, 0xd7ff], // Hangul Jamo Extended-B
	[0xf900, 0xfaff], // CJK Compatibility Ideographs
	[0xfe10, 0xfe1f], // Vertical Forms
	[0xfe30, 0xfe4f], // CJK Compatibility Forms
	[0xfe50, 0xfe6f], // Small Form Variants
	[0xff00, 0xff60], // Fullwidth Forms
	[0xffe0, 0xffe6], // Fullwidth Signs
	[0x1b000, 0x1b0ff], // Kana Supplement
	[0x1b100, 0x1b12f], // Kana Extended-A
	[0x1f004, 0x1f004], // Mahjong Tile
	[0x1f0cf, 0x1f0cf], // Playing Card
	[0x1f200, 0x1f2ff], // Enclosed Ideographic Supplement
	[0x20000, 0x2a6df], // CJK Extension B
	[0x2a700, 0x2ceaf], // CJK Extension C, D, E
	[0x2ceb0, 0x2ebef], // CJK Extension F
	[0x30000, 0x3134f], // CJK Extension G
];

// Binary search over sorted ranges — O(log n).
function isWide(cp: number): boolean {
	let lo = 0;
	let hi = WIDE_RANGES.length - 1;

	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		const [start, end] = WIDE_RANGES[mid];

		if (cp < start) {
			hi = mid - 1;
		} else if (cp > end) {
			lo = mid + 1;
		} else {
			return true;
		}
	}

	return false;
}

function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		w += isWide(cp) ? 2 : 1;
	}
	return w;
}

const DEFAULT_TAB_WIDTH = 2;
const MARKER_GAP = 4;

/**
 * Expand tab characters to spaces using tabstops so alignment is independent
 * of the terminal's tab-width setting. Accounts for East Asian Wide characters
 * when tracking the current column.
 */
function expandTabs(line: string, tabWidth: number): string {
	let out = "";
	let col = 0;
	for (const ch of line) {
		if (ch === "\t") {
			const spaces = tabWidth - (col % tabWidth);
			out += " ".repeat(spaces);
			col += spaces;
			continue;
		}
		out += ch;
		const cp = ch.codePointAt(0) ?? 0;
		col += isWide(cp) ? 2 : 1;
	}
	return out;
}

export function renderAnnotated(
	sourceText: string,
	branches: BranchPoint[],
	hits: Map<string, BranchHitCounts>,
	options: RenderOptions = {},
): string {
	const colorize = makeColorize(options.color ?? false);
	const tabWidth = options.tabWidth ?? DEFAULT_TAB_WIDTH;
	const showCounts = shouldShowCounts(options.showCounts ?? "auto", hits);
	const rawLines = sourceText.split("\n");
	// Expand tabs up front — every width calculation and output uses the
	// expanded form, so padding with spaces aligns correctly in any terminal.
	const sourceLines = rawLines.map((l) => expandTabs(l, tabWidth));
	const gutterWidth = String(sourceLines.length).length + 1;

	// Place each branch's markers on the appropriate line(s); group by line so
	// multiple markers landing on the same line get joined.
	const markersByLine = new Map<number, string[]>();
	for (const branch of branches) {
		const placed = placeMarkers(
			branch,
			hits.get(branch.id),
			colorize,
			showCounts,
		);
		for (const { line, text } of placed) {
			const existing = markersByLine.get(line);
			if (existing) {
				existing.push(text);
			} else {
				markersByLine.set(line, [text]);
			}
		}
	}

	// Compute marker column: align across all annotated lines
	let markerCol = 0;
	for (const lineNo of markersByLine.keys()) {
		const w = displayWidth(sourceLines[lineNo - 1]);
		if (w > markerCol) {
			markerCol = w;
		}
	}
	markerCol += MARKER_GAP;

	const out: string[] = [];
	for (let i = 0; i < sourceLines.length; i++) {
		const lineNo = i + 1;
		const gutter = `${String(lineNo).padStart(gutterWidth)} │ `;
		const markers = markersByLine.get(lineNo);
		let suffix = "";
		if (markers) {
			const padding = " ".repeat(
				Math.max(0, markerCol - displayWidth(sourceLines[i])),
			);
			suffix = `${padding}${markers.join("  ")}`;
		}
		out.push(`${gutter}${sourceLines[i]}${suffix}`);
	}
	return out.join("\n");
}
