---
name: web-search-with-codex
description: Search the internet for information using OpenAI Codex. Use this skill when you need to find current information, documentation, or answers from the web. The skill uses Codex to perform searches and returns formatted results.
allowed-tools:
  - Bash(.claude/skills/web-search-with-codex/scripts/codex_search.sh:*)
context: fork
disable-model-invocation: true
---

# Web Search with Codex

This skill enables internet searches using OpenAI Codex to gather up-to-date information.

## Usage

Execute the search script with your query:

```bash
.claude/skills/web-search-with-codex/scripts/codex_search.sh "your search query here"
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-m MODEL` | Specify the model to use | codex default |

Example with custom model:

```bash
.claude/skills/web-search-with-codex/scripts/codex_search.sh -m gpt-5.2-codex "your search query"
```

## How It Works

1. The script executes `codex exec` with the provided search query
2. Codex searches the internet and gathers relevant information
3. The script filters out thinking/reasoning steps and returns only the final response
4. Results are formatted as clean text output

## Examples

### Search for documentation

```bash
.claude/skills/web-search-with-codex/scripts/codex_search.sh "Vue 3 Composition API best practices"
```

### Search for current events

```bash
.claude/skills/web-search-with-codex/scripts/codex_search.sh "latest TypeScript 5.x features"
```

### Search for technical solutions

```bash
.claude/skills/web-search-with-codex/scripts/codex_search.sh "how to handle async errors in JavaScript"
```

## Notes

- The script requires `codex` CLI and `jq` to be installed
- Results exclude the thinking/reasoning process to provide clean output
- For complex queries, be specific and descriptive for better results
