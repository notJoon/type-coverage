import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ts from "typescript";
import { type BranchHitCounts, renderAnnotated } from "../src/annotate.js";
import { collectBranches } from "../src/scanner.js";

function parse(code: string): ts.SourceFile {
	return ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
}

function hits(
	trueHits: number,
	falseHits: number,
	unknownHits = 0,
): BranchHitCounts {
	return { trueHits, falseHits, unknownHits };
}

function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		const wide =
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0x9fff) ||
			(cp >= 0xa000 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xff00 && cp <= 0xff60);
		w += wide ? 2 : 1;
	}
	return w;
}

describe("renderAnnotated", () => {
	it("preserves source lines with gutter line numbers", () => {
		const code = `type A = 1;
type B = 2;`;
		const sf = parse(code);
		const out = renderAnnotated(code, collectBranches(sf), new Map());

		const lines = out.split("\n");
		assert.match(lines[0], /^\s*1 │ type A = 1;$/);
		assert.match(lines[1], /^\s*2 │ type B = 2;$/);
	});

	it("annotates a fully covered branch with both markers", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(2, 3)]]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /✓T\(2\)/);
		assert.match(out, /✓F\(3\)/);
	});

	it("marks the uncovered direction with a high-emphasis MISS badge", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(2, 0)]]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /✓T\(2\)/);
		assert.match(out, /✗ MISS F/);
		assert.doesNotMatch(out, /✗F\(0\)/, "should not show count for missed direction");
	});

	it("auto mode hides counts when no branch is hit more than once", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 1)]]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /✓T(?!\()/, "T should not have count when hits == 1");
		assert.match(out, /✓F(?!\()/, "F should not have count when hits == 1");
		assert.doesNotMatch(out, /✓T\(/);
		assert.doesNotMatch(out, /✓F\(/);
	});

	it("auto mode shows counts when any branch hit > 1", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(3, 1)]]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /✓T\(3\)/);
		assert.match(out, /✓F\(1\)/);
	});

	it("showCounts: 'always' forces counts even for boolean coverage", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 1)]]);

		const out = renderAnnotated(code, branches, map, { showCounts: "always" });
		assert.match(out, /✓T\(1\)/);
		assert.match(out, /✓F\(1\)/);
	});

	it("showCounts: 'never' suppresses counts even for high hit counts", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(5, 7)]]);

		const out = renderAnnotated(code, branches, map, { showCounts: "never" });
		assert.doesNotMatch(out, /\(\d+\)/);
	});

	it("uses different visual emphasis for covered (gray) vs missed (red+bold)", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 0)]]);

		const out = renderAnnotated(code, branches, map, { color: true });
		const ESC = String.fromCharCode(0x1b);
		// covered T uses gray (90); missed F uses red (31) + bold (1)
		assert.ok(out.includes(`${ESC}[90m`), "expected gray for covered T");
		assert.ok(
			out.includes(`${ESC}[31m`) || out.includes(`${ESC}[1m`),
			"expected red and/or bold for missed F",
		);
	});

	it("marks a branch never reached by any test as unreached", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);

		const out = renderAnnotated(code, branches, new Map());
		assert.match(out, /unreached/);
	});

	it("marks branches with only unknown hits as unknown", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(0, 0, 2)]]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /\?\s*unknown\(2\)/);
	});

	it("splits T marker onto the `?` line and F marker onto the `:` line", () => {
		const code = `type Outer<X> =
  X extends string
    ? "yes"
    : "no";`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 1)]]);

		const out = renderAnnotated(code, branches, map, { showCounts: "always" });
		const lines = out.split("\n");
		// trueType "yes" on line 3 → T marker on line 3 (index 2)
		assert.match(lines[2], /✓T\(1\)/);
		assert.doesNotMatch(lines[2], /F\(/);
		// falseType "no" on line 4 → F marker on line 4 (index 3)
		assert.match(lines[3], /✓F\(1\)/);
		assert.doesNotMatch(lines[3], /T\(/);
		// Check line itself has no T/F marker
		assert.doesNotMatch(lines[1], /[✓✗][TF]/);
	});

	it("keeps T and F markers on the same line for single-line conditionals", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(2, 1)]]);

		const out = renderAnnotated(code, branches, map);
		const lines = out.split("\n");
		assert.match(lines[0], /✓T\(2\)/);
		assert.match(lines[0], /✓F\(1\)/);
	});

	it("consolidates unreached branches on the check line, not split", () => {
		const code = `type Outer<X> =
  X extends string
    ? "yes"
    : "no";`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const out = renderAnnotated(code, branches, new Map());
		const lines = out.split("\n");
		// Check line has the unreached badge; ?/: lines have no marker
		assert.match(lines[1], /unreached/);
		assert.doesNotMatch(lines[2], /unreached/);
		assert.doesNotMatch(lines[3], /unreached/);
	});

	it("annotates multiple branches independently", () => {
		const code = `type Classify<X> =
  X extends string ? "s"
    : X extends number ? "n"
    : "other";`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		assert.equal(branches.length, 2);

		const map = new Map([
			[branches[0].id, hits(2, 1)],
			[branches[1].id, hits(0, 0, 1)],
		]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /✓T\(2\)/);
		assert.match(out, /\?\s*unknown\(1\)/);
	});

	it("honors tabWidth option (default 2)", () => {
		const code = "type T<X> =\n\tX extends string ? 1 : 0;";
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 0)]]);

		const out = renderAnnotated(code, branches, map);
		// With default tabWidth=2, the conditional line should start with 2 spaces
		const lines = out.split("\n");
		const condLine = lines.find((l) => l.includes("X extends string"));
		assert.ok(condLine);
		// After gutter "  2 │ " there should be exactly 2 spaces (from tab)
		assert.match(condLine, /^\s*2 │ {3}X extends/);
	});

	it("respects custom tabWidth option", () => {
		const code = "type T<X> =\n\tX extends string ? 1 : 0;";
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 0)]]);

		const out = renderAnnotated(code, branches, map, { tabWidth: 4 });
		const lines = out.split("\n");
		const condLine = lines.find((l) => l.includes("X extends string"));
		assert.ok(condLine);
		assert.match(condLine, /^\s*2 │ {5}X extends/);
	});

	it("aligns markers across lines with mixed tabs, CJK, and ASCII", () => {
		// Two conditionals on different lines; one has CJK in trueType.
		// All markers (T or F) must land at the same display column even when
		// the source mixes tabs and wide chars.
		const code =
			"type T1<X> =\n" +
			"\tX extends string\n" +
			'\t\t? "한국어"\n' +
			'\t\t: "no";\n' +
			"type T2<Y> =\n" +
			"\tY extends number\n" +
			'\t\t? "yes"\n' +
			'\t\t: "no";';
		const sf = parse(code);
		const branches = collectBranches(sf);
		assert.equal(branches.length, 2);

		const map = new Map([
			[branches[0].id, hits(1, 1)],
			[branches[1].id, hits(1, 1)],
		]);

		const out = renderAnnotated(code, branches, map);
		const MARKER_RE = /[✓✗] ?(MISS )?[TF]/;
		const markerLines = out.split("\n").filter((l) => MARKER_RE.test(l));
		assert.ok(markerLines.length >= 4, "expected at least 4 marker lines");

		const cols = markerLines.map((l) => {
			const m = l.match(MARKER_RE);
			return m ? displayWidth(l.slice(0, l.indexOf(m[0]))) : -1;
		});
		assert.ok(
			cols.every((c) => c === cols[0]),
			`markers must align at the same column: ${cols.join(", ")}`,
		);

		for (const l of markerLines) {
			assert.ok(!l.includes("\t"), "tabs must be expanded in rendered output");
		}
	});

	it("wraps markers in ANSI when color option is true", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(2, 0)]]);

		const out = renderAnnotated(code, branches, map, { color: true });
		// Contains ANSI escape sequences (ESC = \x1b)
		const ESC = String.fromCharCode(0x1b);
		assert.ok(out.includes(`${ESC}[`), "expected ANSI escape in output");
	});

	it("omits ANSI sequences when color option is false or missing", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(2, 0)]]);

		const out = renderAnnotated(code, branches, map);
		const ESC = String.fromCharCode(0x1b);
		assert.ok(!out.includes(`${ESC}[`), "expected no ANSI escape in output");
	});
});
