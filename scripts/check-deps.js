import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const deps = pkg.dependencies ?? {};
const unexpected = Object.keys(deps).filter((name) => name !== "@optique/core");

if (unexpected.length > 0) {
	console.error(
		`Error: unexpected runtime dependencies found: ${unexpected.join(", ")}`,
	);
	process.exit(1);
}

console.log("✓ Runtime dependencies are limited to @optique/core");
