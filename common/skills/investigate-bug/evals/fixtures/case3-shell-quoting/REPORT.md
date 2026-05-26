# バグ報告: バックアップスクリプトが一部のファイルだけ取りこぼす

## 症状
夜間バッチで `backup.sh` を回しているが、バックアップ先に届かないファイルが時々ある。
取りこぼされるのは決まって名前にスペースが入っているファイル（例: `Annual Report 2024.pdf`）。
スクリプトはエラーにはならず、正常終了する。

## 再現
```
$ ls /data/source/
"Annual Report 2024.pdf"  invoice.pdf  notes.txt

$ ./backup.sh
$ ls /data/backup/
invoice.pdf  notes.txt
Annual  Report  2024.pdf  ← なんか3ファイルに分かれて壊れた
```

## 関連ファイル
- `backup.sh`

## ほしいもの
原因と修正方針。
