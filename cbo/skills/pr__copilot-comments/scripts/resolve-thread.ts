#!/usr/bin/env bun

import { execSync } from "node:child_process";

// --- Types ---

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface ReplyData {
  addPullRequestReviewThreadReply: {
    comment: { url: string } | null;
  };
}

interface ResolveData {
  resolveReviewThread: {
    thread: { isResolved: boolean } | null;
  };
}

// --- Helper functions ---

function exitWithError(message: string): never {
  console.log(JSON.stringify({ error: message }));
  process.exit(0);
}

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, string>,
): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    exitWithError(`GitHub API リクエストに失敗しました (${response.status})`);
  }

  const data: GraphQLResponse<T> = await response.json();

  if (data.errors) {
    exitWithError(data.errors.map((e) => e.message).join(", "));
  }

  if (!data.data) {
    exitWithError("GitHub API のレスポンスが不正です。");
  }

  return data.data;
}

// --- Main ---

const threadId = process.argv[2];
const replyBody = process.argv[3];

if (!threadId || !replyBody) {
  exitWithError(
    'スレッドIDとリプライ本文を指定してください。例: bun run resolve-thread.ts PRRT_xxx "対応不要と判断した理由"',
  );
}

let token: string;

try {
  token = execSync("gh auth token", { encoding: "utf-8" }).trim();
} catch {
  exitWithError(
    "GitHub認証トークンの取得に失敗しました。`gh auth login` を実行してください。",
  );
}

const replyMutation = `
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment {
      url
    }
  }
}`;

const resolveMutation = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      isResolved
    }
  }
}`;

const replyData = await graphql<ReplyData>(token, replyMutation, {
  threadId,
  body: replyBody,
});
const replyUrl = replyData.addPullRequestReviewThreadReply.comment?.url ?? null;

const resolveData = await graphql<ResolveData>(token, resolveMutation, {
  threadId,
});
const isResolved = resolveData.resolveReviewThread.thread?.isResolved ?? false;

console.log(JSON.stringify({ threadId, replyUrl, isResolved }, null, 2));
