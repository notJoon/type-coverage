import path from "node:path";
import { renderAnnotated } from "./annotate.js";
import type { ProjectRunResult } from "./project.js";

export interface RenderProjectReportOptions {
	color?: boolean;
	tabWidth?: number;
}

/**
 * Render a human-readable text report for a ProjectRunResult — a header,
 * the target alias source sliced and annotated with per-branch hit markers,
 * and a coverage summary line.
 */
export function renderProjectReport(
	result: ProjectRunResult,
	targetName: string,
	options: RenderProjectReportOptions = {},
): string {
	const {
		sourceFile,
		targetAlias,
		paramNames,
		branches,
		instantiations,
		counts,
		summary,
		projectRoot,
	} = result;

	const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(
		targetAlias.getStart(sourceFile),
	);
	const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(
		targetAlias.getEnd(),
	);
	const rendered = renderAnnotated(sourceFile.text, branches, counts, {
		color: options.color ?? false,
		tabWidth: options.tabWidth,
	}).split("\n");
	const slice = rendered.slice(startLine, endLine + 1);

	const lines: string[] = [
		"",
		`File: ${path.relative(projectRoot, sourceFile.fileName)}`,
		`Target: ${targetName}<${paramNames.join(", ")}>`,
		`Instantiations analyzed: ${instantiations.length}`,
		"",
		slice.join("\n"),
		"",
		`Direction coverage: ${summary.covered}/${summary.total} (${summary.pct}%), unknown evaluations: ${summary.unknown}`,
	];
	return lines.join("\n");
}
