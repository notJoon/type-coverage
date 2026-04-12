/**
 * Type-level branch coverage prototype (v2)
 *
 * 전략:
 *  1. src/ AST에서 ConditionalTypeNode를 수집
 *  2. 테스트 파일에서 Conjugate<V, F> 인스턴스화를 추출, V/F 타입 획득
 *  3. Conjugate 정의의 ConditionalTypeNode 트리를 재귀 순회하면서
 *     checker.isTypeAssignableTo()로 각 extends 조건을 직접 재평가
 *  4. 어떤 분기를 탔는지 기록 → 커버리지 리포트
 *
 * Usage: npx tsx scripts/type-coverage-proto.ts
 */

import * as ts from "typescript";
import * as path from "path";

const projectRoot = path.resolve(import.meta.dirname, "..");

// ─── Program 생성 ────────────────────────────────────────────────

const configPath = ts.findConfigFile(
  projectRoot,
  ts.sys.fileExists,
  "tsconfig.json",
)!;
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const { options, fileNames } = ts.parseJsonConfigFileContent(
  config,
  ts.sys,
  projectRoot,
);

const program = ts.createProgram(fileNames, options);
const checker = program.getTypeChecker();

// internal API
const isTypeAssignableTo: (source: ts.Type, target: ts.Type) => boolean = (
  checker as any
).isTypeAssignableTo.bind(checker);

// ─── AST에서 ConditionalTypeNode 수집 ────────────────────────────

interface BranchPoint {
  file: string;
  line: number;
  typeName: string;
  checkText: string;
  extendsText: string;
  depth: number;
  node: ts.ConditionalTypeNode;
  hitByTrue: Set<string>; // tests that took the TRUE branch
  hitByFalse: Set<string>; // tests that took the FALSE branch
}

function getEnclosingTypeName(node: ts.Node): string {
  let current = node.parent;
  while (current) {
    if (ts.isTypeAliasDeclaration(current)) return current.name.text;
    if (
      ts.isPropertySignature(current) &&
      current.name &&
      ts.isIdentifier(current.name)
    )
      return current.name.text;
    current = current.parent;
  }
  return "(anonymous)";
}

function collectBranches(sourceFile: ts.SourceFile): BranchPoint[] {
  const branches: BranchPoint[] = [];
  const relPath = path.relative(projectRoot, sourceFile.fileName);

  function visit(node: ts.Node, depth: number) {
    if (ts.isConditionalTypeNode(node)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      branches.push({
        file: relPath,
        line,
        typeName: getEnclosingTypeName(node),
        checkText: node.checkType.getText(sourceFile),
        extendsText: node.extendsType.getText(sourceFile),
        depth,
        node,
        hitByTrue: new Set(),
        hitByFalse: new Set(),
      });
      visit(node.trueType, depth + 1);
      visit(node.falseType, depth + 1);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, depth));
  }

  visit(sourceFile, 0);
  return branches;
}

// ─── Conjugate 타입 정의 찾기 ─────────────────────────────────────

function findConjugateDefinition(): {
  typeAlias: ts.TypeAliasDeclaration;
  sourceFile: ts.SourceFile;
  branches: BranchPoint[];
} | null {
  for (const sf of program.getSourceFiles()) {
    const rel = path.relative(projectRoot, sf.fileName);
    if (!rel.startsWith("src/")) continue;

    let found: ts.TypeAliasDeclaration | null = null;
    ts.forEachChild(sf, (node) => {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === "Conjugate" &&
        node.typeParameters?.length === 2
      ) {
        found = node;
      }
    });

    if (found) {
      const branches = collectBranches(sf);
      // Conjugate 내부 분기만 필터링
      const conjugateBranches = branches.filter(
        (b) => b.typeName === "Conjugate",
      );
      return { typeAlias: found, sourceFile: sf, branches: conjugateBranches };
    }
  }
  return null;
}

// ─── 조건부 타입 분기 재평가 ──────────────────────────────────────

/**
 * 타입 파라미터 이름 → 실제 타입 매핑을 사용하여
 * ConditionalTypeNode의 checkType을 평가한다.
 *
 * 단순 참조(V, F)만 치환 가능. 복합 타입(EffectiveStem<V, F>)은
 * checker.getTypeFromTypeNode 결과를 사용한다.
 */
function resolveCheckType(
  condNode: ts.ConditionalTypeNode,
  paramMap: Map<string, ts.Type>,
): ts.Type | null {
  const checkNode = condNode.checkType;

  // 1. 단순 식별자 (V, F)
  if (
    ts.isTypeReferenceNode(checkNode) &&
    ts.isIdentifier(checkNode.typeName)
  ) {
    const name = checkNode.typeName.text;
    if (paramMap.has(name)) return paramMap.get(name)!;
  }

  // 2. 단순 식별자 직접 참조
  if (ts.isIdentifier(checkNode)) {
    const name = checkNode.text;
    if (paramMap.has(name)) return paramMap.get(name)!;
  }

  // 3. 복합 타입 — 타입 파라미터가 포함된 경우 정확한 평가 불가
  //    프로토타입에서는 skip
  return null;
}

function resolveExtendsType(condNode: ts.ConditionalTypeNode): ts.Type | null {
  try {
    // extendsType가 infer를 포함하면 평가 불가
    const text = condNode.extendsType.getText();
    if (text.includes("infer")) return null;

    return checker.getTypeFromTypeNode(condNode.extendsType);
  } catch {
    return null;
  }
}

interface TraceResult {
  branchLine: number;
  taken: "true" | "false";
}

function traceConditionalChain(
  condNode: ts.ConditionalTypeNode,
  paramMap: Map<string, ts.Type>,
  sourceFile: ts.SourceFile,
): TraceResult[] {
  const results: TraceResult[] = [];

  const line =
    sourceFile.getLineAndCharacterOfPosition(condNode.getStart()).line + 1;
  const checkType = resolveCheckType(condNode, paramMap);
  const extendsType = resolveExtendsType(condNode);

  if (!checkType || !extendsType) {
    // 평가 불가 — 이 조건 이후의 분기는 추적하지 않음
    return results;
  }

  const assignable = isTypeAssignableTo(checkType, extendsType);
  results.push({ branchLine: line, taken: assignable ? "true" : "false" });

  // 선택된 분기로 재귀
  const nextNode = assignable ? condNode.trueType : condNode.falseType;
  if (ts.isConditionalTypeNode(nextNode)) {
    results.push(...traceConditionalChain(nextNode, paramMap, sourceFile));
  }

  return results;
}

// ─── 테스트 파일 파싱 ─────────────────────────────────────────────

const testFilePath = path.resolve(projectRoot, "tests/conjugation.test-d.ts");
const testFile = program.getSourceFile(testFilePath);

if (!testFile) {
  console.error("Test file not found");
  process.exit(1);
}

function findConjugateRef(node: ts.Node): ts.TypeReferenceNode | undefined {
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Conjugate"
  ) {
    return node;
  }
  let found: ts.TypeReferenceNode | undefined;
  node.forEachChild((child) => {
    if (!found) found = findConjugateRef(child);
  });
  return found;
}

// ─── 실행 ─────────────────────────────────────────────────────────

console.log("=== Type-Level Branch Coverage Prototype (v2) ===\n");

const conjugateDef = findConjugateDefinition();
if (!conjugateDef) {
  console.error("Conjugate type definition not found");
  process.exit(1);
}

const { typeAlias, sourceFile, branches } = conjugateDef;

console.log(`Target: ${path.relative(projectRoot, sourceFile.fileName)}`);
console.log(`Conjugate branches: ${branches.length}\n`);

// Conjugate<V, F>의 조건부 타입 루트 노드
const rootConditional = typeAlias.type;
if (!rootConditional || !ts.isConditionalTypeNode(rootConditional)) {
  console.error("Conjugate type is not a conditional type");
  process.exit(1);
}

// 파라미터 이름 추출
const paramNames = typeAlias.typeParameters!.map((p) => p.name.text); // ["V", "F"]

// 각 테스트에서 Conjugate<V, F>의 타입 인수 추출 및 분기 추적
let testCount = 0;

ts.forEachChild(testFile, (node) => {
  if (!ts.isTypeAliasDeclaration(node)) return;
  const testName = node.name.text;
  const ref = findConjugateRef(node.type!);
  if (!ref || !ref.typeArguments || ref.typeArguments.length < 2) return;

  testCount++;

  // V와 F의 실제 Type 획득
  const vType = checker.getTypeFromTypeNode(ref.typeArguments[0]);
  const fType = checker.getTypeFromTypeNode(ref.typeArguments[1]);

  const paramMap = new Map<string, ts.Type>();
  paramMap.set(paramNames[0], vType); // V
  paramMap.set(paramNames[1], fType); // F

  const traces = traceConditionalChain(rootConditional, paramMap, sourceFile);

  // 분기 히트 기록
  for (const trace of traces) {
    const branch = branches.find((b) => b.line === trace.branchLine);
    if (branch) {
      if (trace.taken === "true") {
        branch.hitByTrue.add(testName);
      } else {
        branch.hitByFalse.add(testName);
      }
    }
  }
});

// ─── 리포트 ──────────────────────────────────────────────────────

console.log(`Tests analyzed: ${testCount}\n`);
console.log(
  `${path.relative(projectRoot, sourceFile.fileName)} — Conjugate<V, F>:\n`,
);

let totalDirections = 0; // 각 분기의 true/false 방향 = 2개씩
let coveredDirections = 0;

for (const b of branches) {
  const indent = "  ".repeat(b.depth + 1);
  const trueHits = b.hitByTrue.size;
  const falseHits = b.hitByFalse.size;

  totalDirections += 2;
  if (trueHits > 0) coveredDirections++;
  if (falseHits > 0) coveredDirections++;

  const trueMarker = trueHits > 0 ? `✓ T(${trueHits})` : "✗ T(0)";
  const falseMarker = falseHits > 0 ? `✓ F(${falseHits})` : "✗ F(0)";

  console.log(`${indent}L${b.line} ${b.checkText} extends ${b.extendsText}`);
  console.log(`${indent}  ${trueMarker}  ${falseMarker}`);
}

console.log(`\n${"─".repeat(50)}`);
console.log(
  `Direction coverage: ${coveredDirections}/${totalDirections} (${totalDirections > 0 ? Math.round((coveredDirections / totalDirections) * 100) : 0}%)`,
);

// 히트되지 않은 방향 상세
const uncovered: string[] = [];
for (const b of branches) {
  if (b.hitByTrue.size === 0)
    uncovered.push(
      `  L${b.line} TRUE:  ${b.checkText} extends ${b.extendsText}`,
    );
  if (b.hitByFalse.size === 0)
    uncovered.push(
      `  L${b.line} FALSE: ${b.checkText} extends ${b.extendsText}`,
    );
}
if (uncovered.length > 0) {
  console.log(`\nUncovered directions:`);
  for (const u of uncovered) console.log(u);
}
