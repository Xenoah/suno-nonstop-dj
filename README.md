# Suno Nonstop DJ

Suno.com 上で再生中の曲を監視し、残り時間がしきい値を下回ったタイミングで次曲生成を支援する Chrome 拡張です。

この拡張は Manifest V3 ベースで、ビルドは不要です。現在は `dry-run`、`manual-create`、`auto-create` の 3 モードを持ち、実際の Suno DOM を見ながら少しずつ安定化を進めている段階です。

## できること

- 再生中の `audio` 要素を監視して残り時間を表示
- しきい値到達時に前曲の文脈を DOM から抽出
- 次曲用の prompt / styles / title を自動生成
- `manual-create` では入力欄の自動入力まで実行
- `auto-create` では Create のクリックまで実行
- 新曲が自動再生された場合は、そのまま次のループへ戻る処理を持つ
- Popup から状態、残り時間、ログ、Debug Dump を確認できる

## まだ不安定な点

- Suno 側の DOM 変更に強く依存します
- Create ボタン、Play ボタン、曲カード周辺のセレクタはまだ要検証です
- 生成完了判定は `audio.src` の変化を主軸にしており、一部フォールバックは経験則ベースです
- まずは `Dry Run` で挙動確認する前提です

## インストール

1. このリポジトリを取得します。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の「デベロッパーモード」を ON にします。
4. 「パッケージ化されていない拡張機能を読み込む」を選びます。
5. `manifest.json` があるこのフォルダを指定します。

## 使い方

1. Suno にログインした状態で対象ページを開きます。
2. 拡張の Popup を開きます。
3. まずは以下の設定を使います。
   - Mode: `Dry Run`
   - Threshold: `120`
   - Strategy: `Balanced`
4. `Start` を押します。
5. 曲を再生し、状態が `WAITING_AUDIO` から `PLAYING_CURRENT` に進むことを確認します。
6. 残り時間がしきい値を下回ったら、ログと Debug Dump を見て抽出内容を確認します。
7. 問題なければ `Manual Create`、その後に `Auto Create` へ進めます。

## モード

| Mode | 内容 |
|------|------|
| `dry-run` | DOM 操作なし。監視、抽出、計画ログのみ |
| `manual-create` | prompt / styles / title の入力まで自動 |
| `auto-create` | Create クリックまで自動 |

## 内部フロー

```text
IDLE
  -> WAITING_AUDIO
  -> PLAYING_CURRENT
  -> THRESHOLD_REACHED
  -> EXTRACTING_CONTEXT
  -> COMPOSING_NEXT_PROMPT
  -> TRIGGERING_GENERATION
  -> WAITING_NEXT_READY
  -> ARMED_FOR_SWITCH
  -> SWITCHING_PLAYBACK
  -> PLAYING_CURRENT
```

補足:

- `dry-run` では `THRESHOLD_REACHED` で止まり、抽出結果と prompt plan をログ出力します。
- Suno が新曲を自動再生した場合、`WAITING_NEXT_READY` あるいは `ARMED_FOR_SWITCH` から直接 `PLAYING_CURRENT` に戻る設計です。

## ファイル構成

- `manifest.json`: 拡張定義
- `constants.js`: 状態名、モード、既定値
- `state-machine.js`: 有限状態機械
- `selectors.js`: DOM セレクタ候補とスコアリング
- `dom-explorer.js`: DOM 抽出、安全チェック、`debugDump()`
- `prompt-builder.js`: 次曲 prompt 生成
- `content.js`: 本体ロジック
- `service_worker.js`: メッセージ中継とログ保持
- `popup.html`, `popup.js`, `popup.css`: Popup UI
- `devtools-snippets.js`: DevTools 用の探索スニペット

## デバッグ

### Console

DevTools Console で `SunoDJ` を含むログを確認できます。

### Debug Dump

Console で次を実行できます。

```js
window.__sunoDJ.debugDump()
```

確認できる主な内容:

- `audioElements`
- `trackContext`
- `safetyCheck`
- `createButton`
- `playButtons`
- `lyricsInput`
- `stylesInput`
- `promptInput`

### セレクタ調査

`devtools-snippets.js` を使うと、以下の候補探索を進めやすくなります。

- audio 要素
- 曲タイトル
- 曲カード
- Play ボタン
- Create ボタン
- prompt / lyrics 入力欄
- 生成中インジケータ

## 安全停止

以下を検知すると停止または停止寄りの挙動を取ります。

- credits 不足メッセージ
- CAPTCHA / 人間確認
- rate limit 系メッセージ
- 連続エラーの上限到達

## 注意

この拡張は Suno の画面構造に依存しています。UI 変更が入ると動かなくなる可能性があります。

安定化前提の実験ツールとして扱い、まずは `Dry Run` から確認してください。

## ライセンス

Private - 個人利用のみ
