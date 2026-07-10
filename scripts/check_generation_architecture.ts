import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildArchitectureGraph,
  isV2ArchitecturePath,
} from "./generate_architecture_graph";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

const readRepoFile = async (path: string): Promise<string> =>
  await readFile(resolve(repoRoot, path), "utf8");

const fail = (message: string): void => {
  console.error(`[arch:check] ${message}`);
  process.exitCode = 1;
};

const requireText = (content: string, needle: string, file: string): void => {
  if (!content.includes(needle)) {
    fail(`${file} is missing required marker: ${needle}`);
  }
};

const V2_SOURCE_ROOTS = [
  "apps/api/src/services/generation-v2",
  "packages/core/src/generation/v2",
  "packages/providers/src/generation-v2",
  "packages/types/src/generation-v2",
];

const V2_SINGLE_FILES = ["packages/types/src/generation-v2.ts"];

const FORBIDDEN_V2_IMPORT_FRAGMENTS = [
  "generation-orchestrator",
  "presentation-intent",
  "research-policy",
  "grounding-selection",
  "slide-arc-policy",
  "presentation-plan-normalization",
];

const FORBIDDEN_V2_TYPE_NAMES = [
  "GenerateDeckInput",
  "PresentationIntent",
  "PresentationPlan",
  "SlideBrief",
];

const walkTypeScriptFiles = async (relativeDirectory: string): Promise<string[]> => {
  const absoluteDirectory = resolve(repoRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        return walkTypeScriptFiles(child);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [child] : [];
    }),
  );
  return nested.flat();
};

const readExistingSingleFile = async (relativePath: string): Promise<string[]> => {
  try {
    await readRepoFile(relativePath);
    return [relativePath];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const checkV2SourceBoundaries = async (): Promise<void> => {
  const files = [
    ...(await Promise.all(V2_SOURCE_ROOTS.map(walkTypeScriptFiles))).flat(),
    ...(await Promise.all(V2_SINGLE_FILES.map(readExistingSingleFile))).flat(),
  ];

  for (const file of files) {
    if (!isV2ArchitecturePath(file)) {
      fail(`V2 source is outside a canonical V2 path: ${file}`);
    }

    const source = await readRepoFile(file);
    for (const fragment of FORBIDDEN_V2_IMPORT_FRAGMENTS) {
      if (source.includes(fragment)) {
        fail(`${file} references legacy generation path fragment: ${fragment}`);
      }
    }
    for (const typeName of FORBIDDEN_V2_TYPE_NAMES) {
      if (source.includes(typeName)) {
        fail(`${file} references legacy generation contract: ${typeName}`);
      }
    }
  }
};

const run = async (): Promise<void> => {
  const [map, generated, tasks] = await Promise.all([
    readRepoFile("docs/generation-architecture-map.md"),
    readRepoFile("docs/generated/generation-imports.mmd"),
    readRepoFile("tasks.md"),
  ]);

  [
    "Maintenance Contract",
    "Current Architecture Map",
    "Target V2 Shape",
    "Legacy Removal Queue",
    "Active Rule",
  ].forEach((marker) =>
    requireText(map, marker, "docs/generation-architecture-map.md"),
  );

  requireText(
    tasks,
    "docs/generation-architecture-map.md",
    "tasks.md",
  );

  await checkV2SourceBoundaries();

  const freshGraph = await buildArchitectureGraph();
  if (generated !== freshGraph.content) {
    fail(
      "docs/generated/generation-imports.mmd is stale. Run `npm run arch:graph` and review the architecture map.",
    );
  }

  for (const node of freshGraph.nodes) {
    if (node.nodeClass === "v2" && !isV2ArchitecturePath(node.repoPath)) {
      fail(`Import graph misclassified a non-V2 file as V2: ${node.repoPath}`);
    }
    if (
      node.repoPath.endsWith("generation/generation-orchestrator.ts") &&
      node.nodeClass !== "legacy"
    ) {
      fail("The removed-path generation orchestrator must be classified as legacy.");
    }
  }

  if (process.exitCode) {
    return;
  }

  console.log(
    `[arch:check] OK. Architecture map, V2 dependency policy, and import graph are current (${freshGraph.nodeCount} nodes, ${freshGraph.edgeCount} edges).`,
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
