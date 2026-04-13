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

	it("marks the uncovered direction with ✗", () => {
		const code = `type Is<X> = X extends string ? 1 : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(2, 0)]]);

		const out = renderAnnotated(code, branches, map);
		assert.match(out, /✓T\(2\)/);
		assert.match(out, /✗F\(0\)/);
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

	it("places annotation on the line where the conditional starts", () => {
		const code = `type Outer<X> =
  X extends string
    ? "yes"
    : "no";`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		const map = new Map([[branches[0].id, hits(1, 1)]]);

		const out = renderAnnotated(code, branches, map);
		const lines = out.split("\n");
		// Conditional starts at line 2 (checkType "X" on line 2)
		assert.match(lines[1], /✓T\(1\)/);
		assert.match(lines[1], /✓F\(1\)/);
		assert.doesNotMatch(lines[0], /✓T/);
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

	it("aligns markers when source mixes tabs, CJK, and ASCII", () => {
		// Tabs expand to tabstops (8 columns); must not mis-align markers.
		const code =
			"type Conjugate<V, F> =\n" +
			"\tV extends HadaVerb\n" +
			'\t\t? F extends "해요" ? 1 : 0\n' +
			"\t\t: 0;";
		const sf = parse(code);
		const branches = collectBranches(sf);
		assert.equal(branches.length, 2);

		const map = new Map([
			[branches[0].id, hits(1, 0)],
			[branches[1].id, hits(1, 0)],
		]);

		const out = renderAnnotated(code, branches, map);
		const lines = out.split("\n").filter((l) => l.includes("✓T"));
		assert.equal(lines.length, 2);

		// Markers must align at the same DISPLAY column. String index differs
		// when lines contain CJK chars (1 char but width 2), so measure width.
		function dispWidth(s: string): number {
			let w = 0;
			for (const ch of s) {
				const cp = ch.codePointAt(0) ?? 0;
				const wide =
					(cp >= 0x1100 && cp <= 0x115f) ||
					(cp >= 0x2e80 && cp <= 0x9fff) ||
					(cp >= 0xac00 && cp <= 0xd7a3);
				w += wide ? 2 : 1;
			}
			return w;
		}
		const cols = lines.map((l) => dispWidth(l.slice(0, l.indexOf("✓T"))));
		assert.equal(
			cols[0],
			cols[1],
			`markers must align at the same display column: ${cols.join(", ")}`,
		);

		// Output must not contain literal tab characters (expanded away)
		for (const l of lines) {
			assert.ok(!l.includes("\t"), "tabs must be expanded in rendered output");
		}
	});

	it("aligns markers to the same column even with CJK characters", () => {
		// "V extends HadaVerb" is ASCII; "F extends \"해요\"" contains CJK (width 2 each).
		// Both marker blocks must start at the same display column.
		const code = `type Conjugate<V, F> =
  V extends HadaVerb
    ? F extends "해요" ? 1 : 0
    : 0;`;
		const sf = parse(code);
		const branches = collectBranches(sf);
		assert.equal(branches.length, 2);

		const map = new Map([
			[branches[0].id, hits(1, 0)],
			[branches[1].id, hits(1, 0)],
		]);

		const out = renderAnnotated(code, branches, map);
		const lines = out.split("\n");

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

		const markerCols = lines
			.filter((l) => l.includes("✓T"))
			.map((l) => displayWidth(l.slice(0, l.indexOf("✓T"))));

		assert.equal(markerCols.length, 2);
		assert.equal(
			markerCols[0],
			markerCols[1],
			`markers must align: got columns ${markerCols.join(", ")}`,
		);
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
