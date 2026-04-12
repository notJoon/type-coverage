import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const deps = pkg.dependencies ?? {};

if (Object.keys(deps).length > 0) {
	console.error(
		`Error: runtime dependencies must be empty, found: ${JSON.stringify(deps)}`,
	);
	process.exit(1);
}

console.log("✓ Zero runtime dependencies");
