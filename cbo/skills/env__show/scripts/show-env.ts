#!/usr/bin/env bun

const VARS = [
  "MGZL_DIR",
  "APP_HOST",
  "API_REPO_PATH",
  "CDS_REPO_PATH",
  "OPENAPI_FILE",
] as const;

for (const name of VARS) {
  const value = process.env[name];
  const display = value && value.length > 0 ? value : "(未設定)";
  console.log(`${name}=${display}`);
}
