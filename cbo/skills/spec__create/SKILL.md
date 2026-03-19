---
name: spec:create
description: 仕様書を対話形式で作成
argument-hint: [元にするドキュメント/機能名]
---
$ARGUMENTS についてので仕様書を書くための情報を AskUserQuestion を利用して対話形式で収集します。
十分に情報が集まったら @spec-document-writer で仕様書を作成します。
ファイルの作成が完了したら `mcp__jetbrains__open_file_in_editor` で仕様書を開きます。
