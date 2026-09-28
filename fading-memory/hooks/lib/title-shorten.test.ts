import { describe, expect, test } from "bun:test";
import { shortenTitle } from "./title-shorten.ts";

describe("shortenTitle", () => {
  test("B0: 「の際に参照する」を「時に」へ正規化してから後段で除く", () => {
    expect(shortenTitle("Xの修正の際に参照する手順")).toBe("Xの修正時の手順");
  });

  test("B1a: 末尾の「を確認したいときに使う情報」は丸ごと除く", () => {
    expect(shortenTitle("S-30の不具合を確認したいときに使う情報")).toBe("S-30の不具合");
    expect(shortenTitle("移行の経緯を知りたいときに参照する")).toBe("移行の経緯");
  });

  test("B1a: 「〜か確認したい」の「か」は疑問の意味を担うので残す", () => {
    expect(shortenTitle("置き換えられるか調査するときに使う情報")).toBe("置き換えられるか");
  });

  test("B1b: 途中の「を知りたいときに使う、」は → に置き換える", () => {
    expect(shortenTitle("記憶がいつ消えるか知りたいときに使う、有効期限の計算式")).toBe(
      "記憶がいつ消えるか→有効期限の計算式",
    );
    expect(shortenTitle("既知issueを確認したいときに使うissue情報")).toBe("既知issue→issue情報");
  });

  test("B2: 「ときに使う、Y」は「時→Y」にし、場面と中身の区切りを残す", () => {
    expect(
      shortenTitle("vitestが起動できない時に使う、サブエージェントへの環境復旧禁止という対処パターン"),
    ).toBe("vitestが起動できない時→サブエージェントへの環境復旧禁止という対処パターン");
  });

  test("B2: V 規則なしでも「を判断する際に参照する、X」は「を判断する時→X」になる", () => {
    expect(shortenTitle("運用方針を判断する際に参照する、固有ルール")).toBe("運用方針を判断する時→固有ルール");
  });

  test("B3: 読点なしで名詞が続く「ときに参照する挙動」は「時の挙動」にする", () => {
    expect(shortenTitle("git push がexit128で失敗したときに参照する挙動と対処")).toBe(
      "git push がexit128で失敗した時の挙動と対処",
    );
    expect(shortenTitle("仕様を対話で詰めるときに踏まえるべきユーザーの検討スタイル")).toBe(
      "仕様を対話で詰める時のユーザーの検討スタイル",
    );
  });

  test("B4: 末尾・括弧閉じ直前の「時に参照」は「時」にする", () => {
    expect(shortenTitle("未着手のアイディアを検討する際に参照する")).toBe("未着手のアイディアを検討する時");
    expect(shortenTitle("abort の実装事実（レビュー・修正時に使う）")).toBe("abort の実装事実（レビュー・修正時）");
  });

  test("「実際に使う」「同時に使う」は場面の区切りと誤認しない", () => {
    expect(shortenTitle("実際に使うコマンド一覧")).toBe("実際に使うコマンド一覧");
    expect(shortenTitle("同時に使う設定の組み合わせ")).toBe("同時に使う設定の組み合わせ");
  });

  test("「把握する」は定型句として扱わず、前段の動詞とのつながりを残す", () => {
    const title = "ログを分析して原因を把握するときに参照する手順";
    expect(shortenTitle(title)).toBe("ログを分析して原因を把握する時の手順");
  });

  test("定型句を含まないタイトルはそのまま返す", () => {
    const title = "サブエージェントは完了(idle)通知のみで報告本文を送らないことが多い";
    expect(shortenTitle(title)).toBe(title);
  });
});
