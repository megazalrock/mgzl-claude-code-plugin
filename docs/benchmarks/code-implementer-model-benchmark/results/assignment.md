# A/B 割当（審査員には渡さない）

- T1: A=sonnet, B=opus
- T2: A=opus,   B=sonnet
- T3: A=sonnet, B=opus

審査員（fable 汎用サブエージェント）へはモデル名を含まない匿名コピー
（scratchpad/judge/<task>/A.patch, B.patch）のパスのみを渡す。
