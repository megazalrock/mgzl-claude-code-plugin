---
name: serena-memory-update
description: 不要なメモリを削除し、CLAUDE.mdや.claude/rulesの内容を分析し、Serena MCPのメモリを更新する。「SerenaのMemoryを更新してください」「Update Serena Memory」など指示された場合、コードベースが大きく変わった場合、CLAUDE.local.mdが更新された場合、.claude/rulesが更新された場合に利用する。
allowed-tools: Read, Glob, Grep, Search, mcp__serena__write_memory, mcp__serena__read_memory, mcp__serena__list_memories, mcp__serena__delete_memory, mcp__serena__edit_memory
---

# Serena Memory Update

## ワークフロー

### フェーズ1: 不要メモリーの削除

不要なメモリーは混乱を招きます。積極的に削除します。
特にコードやリポジトリを見て分かる内容は積極的に削除します。

1. `mcp__serena__list_memories` で現在のメモリ一覧を取得
2. 不要なメモリーを判断基準を元に削除

### フェーズ2: メモリの更新

1. 以下のソースを分析し、メモリに保存すべき内容を特定:
   - `CLAUDE.local.md`
   - `CLAUDE.md`
   - `.claude/rules/` 配下のファイル
2. 差分に基づきメモリを更新:
   - 新規追加: `mcp__serena__write_memory`
   - 既存の部分更新: `mcp__serena__edit_memory`
   - 不要になった情報の削除: `mcp__serena__delete_memory`

## メモリに保存するかどうかの判断基準

### メモリに保存すべき

- プロジェクト構成・アーキテクチャの概要
- 開発ルール・制約事項
- 担当範囲
- コーディング規約
- 禁止事項
- プロジェクト全体に適用できる知見

### メモリに保存すべきではない
- 特定のタスクに関する知見
- 具体的なコードの実装についての知見
- 特定のドキュメントに関する知見
