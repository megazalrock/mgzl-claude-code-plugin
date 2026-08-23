#!/usr/bin/env bun

const VARS = [
  "MGZL_DIR",
  "API_REPO_PATH",
  "CDS_REPO_PATH",
] as const;

for (const name of VARS) {
  const value = process.env[name];
  const display = value && value.length > 0 ? value : "(未設定)";
  console.log(`${name}=${display}`);
}
