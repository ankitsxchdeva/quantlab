#!/usr/bin/env node
// Static export build for GitHub Pages.
//
// `output: "export"` refuses to build a POST route handler, and both of ours
// are POST. They belong to the home-server build, not this one, so we move
// src/app/api out of the tree for the duration of the export and put it back
// afterwards. The finally block matters: a crash mid-build must not leave the
// working tree missing its API routes.

import { execFileSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiDir = join(root, "src", "app", "api");
const stash = join(root, ".api-stash");

if (existsSync(stash)) {
  // Left behind by a previous hard kill. The API routes in src/app/api win if
  // both exist, so drop the stale copy rather than guess.
  if (existsSync(apiDir)) rmSync(stash, { recursive: true, force: true });
  else renameSync(stash, apiDir);
}

let moved = false;
try {
  if (existsSync(apiDir)) {
    renameSync(apiDir, stash);
    moved = true;
  }

  execFileSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
} finally {
  if (moved) renameSync(stash, apiDir);
}

// GitHub Pages serves the site through Jekyll unless told not to, and Jekyll
// drops every directory starting with an underscore — including Next's _next.
execFileSync("touch", [join(root, "out", ".nojekyll")], { stdio: "inherit" });

console.log("\nStatic export ready in ./out");
