#!/usr/bin/env bun

import { execSync } from "node:child_process";

// --- Types ---

interface ReviewComment {
  author: { login: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

interface ReviewThread {
  isResolved: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  comments: {
    nodes: ReviewComment[];
  };
}

interface PullRequestData {
  title: string;
  url: string;
  reviewThreads: {
    nodes: ReviewThread[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface GraphQLResponse {
  data?: {
    repository: {
      pullRequest: PullRequestData | null;
    };
  };
  errors?: Array<{ message: string }>;
}

interface RepoInfo {
  name: string;
  owner: {
    login: string;
  };
}

interface UnresolvedThread {
  path: string;
  line: number | null;
  startLine: number | null;
  body: string;
  url: string;
  createdAt: string;
}

interface Result {
  pr: {
    number: number;
    title: string;
    url: string;
  };
  unresolvedCount: number;
  threads: UnresolvedThread[];
}

// --- Helper functions ---

function isCopilotAuthor(login: string): boolean {
  return login.toLowerCase().includes("copilot");
}

function exitWithError(message: string): never {
  console.log(JSON.stringify({ error: message }));
  process.exit(0);
}

// --- Main ---

const prNumber = Number(process.argv[2]);
if (!prNumber || isNaN(prNumber) || prNumber <= 0) {
  exitWithError(
    "PR番号を指定してください。例: bun run fetch-copilot-comments.ts 123",
  );
}

let token: string;
let repo: RepoInfo;

try {
  token = execSync("gh auth token", { encoding: "utf-8" }).trim();
} catch {
  exitWithError(
    "GitHub認証トークンの取得に失敗しました。`gh auth login` を実行してください。",
  );
}

try {
  repo = JSON.parse(
    execSync("gh repo view --json owner,name", { encoding: "utf-8" }),
  );
} catch {
  exitWithError(
    "リポジトリ情報の取得に失敗しました。GitHubリポジトリ内で実行してください。",
  );
}

const query = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      url
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          isResolved
          path
          line
          startLine
          comments(first: 50) {
            nodes {
              author {
                login
              }
              body
              createdAt
              url
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

const allThreads: ReviewThread[] = [];
let cursor: string | null = null;
let prTitle = "";
let prUrl = "";

// Fetch all review threads with pagination
do {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        owner: repo.owner.login,
        repo: repo.name,
        number: prNumber,
        cursor,
      },
    }),
  });

  if (!response.ok) {
    exitWithError(`GitHub API リクエストに失敗しました (${response.status})`);
  }

  const data: GraphQLResponse = await response.json();

  if (data.errors) {
    exitWithError(data.errors.map((e) => e.message).join(", "));
  }

  const pr = data.data?.repository.pullRequest;
  if (!pr) {
    exitWithError(`PR #${prNumber} が見つかりません。`);
  }

  prTitle = pr.title;
  prUrl = pr.url;
  allThreads.push(...pr.reviewThreads.nodes);

  cursor = pr.reviewThreads.pageInfo.hasNextPage
    ? pr.reviewThreads.pageInfo.endCursor
    : null;
} while (cursor);

// Filter unresolved Copilot threads
const unresolvedThreads: UnresolvedThread[] = [];

for (const thread of allThreads) {
  if (thread.isResolved) continue;

  const copilotComment = thread.comments.nodes.find(
    (c) => c.author !== null && isCopilotAuthor(c.author.login),
  );

  if (!copilotComment) continue;

  unresolvedThreads.push({
    path: thread.path,
    line: thread.line,
    startLine: thread.startLine,
    body: copilotComment.body,
    url: copilotComment.url,
    createdAt: copilotComment.createdAt,
  });
}

const result: Result = {
  pr: {
    number: prNumber,
    title: prTitle,
    url: prUrl,
  },
  unresolvedCount: unresolvedThreads.length,
  threads: unresolvedThreads,
};

console.log(JSON.stringify(result, null, 2));
