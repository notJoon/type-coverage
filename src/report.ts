import path from "node:path";
import { hasProfileCosts, renderAnnotated } from "./annotate.js";
import { PROFILE_NOTE } from "./profile.js";
import type { ProjectRunResult } from "./project.js";

export interface RenderProjectReportOptions {
	color?: boolean;
	tabWidth?: number;
}

function renderProjectReportBody(
	result: ProjectRunResult,
	targetName: string,
	options: RenderProjectReportOptions,
	includeProfileNote: boolean,
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
	const profiled = hasProfileCosts(counts);

	const lines: string[] = [
		"",
		`File: ${path.relative(projectRoot, sourceFile.fileName)}`,
		`Target: ${targetName}<${paramNames.join(", ")}>`,
		`Instantiations analyzed: ${instantiations.length}`,
		"",
		slice.join("\n"),
	];
	if (profiled) {
		if (includeProfileNote) {
			lines.push("", PROFILE_NOTE);
		}
		return lines.join("\n");
	}
	lines.push(
		"",
		`Direction coverage: ${summary.covered}/${summary.total} (${summary.pct}%), unknown evaluations: ${summary.unknown}`,
	);
	const unknownReasons = Object.entries(summary.unknownByReason);
	if (unknownReasons.length > 0) {
		const parts = unknownReasons.map(([reason, count]) => `${reason}=${count}`);
		lines.push(`Unknown reasons: ${parts.join(", ")}`);
	}
	return lines.join("\n");
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
	return renderProjectReportBody(result, targetName, options, true);
}

export function renderProjectReports(
	results: ProjectRunResult[],
	options: RenderProjectReportOptions = {},
): string {
	const reports = results.map((result) =>
		renderProjectReportBody(
			result,
			result.targetAlias.name.text,
			options,
			false,
		),
	);
	if (results.some((result) => hasProfileCosts(result.counts))) {
		reports.push("", PROFILE_NOTE);
	}
	return reports.join("\n");
}
