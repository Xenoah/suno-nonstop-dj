# Suno Nonstop DJ — Chrome Extension

> 🎵 Suno.com 上で動作するノンストップ生成アシスタント

## 概要

再生中の楽曲の残り時間を監視し、残り120秒以下になったら次曲の生成を開始するChrome拡張 (Manifest V3)。  
前曲のDOM情報（タイトル・タグ・プロンプト・歌詞）から文脈を読み取り、自然につながる新しいプロンプトを自動構築します。

## インストール方法

1. このリポジトリをクローンまたはダウンロード
2. Chrome で `chrome://extensions` を開く
3. 右上の「**デベロッパーモード**」をONにする
4. 「**パッケージ化されていない拡張機能を読み込む**」をクリック
5. このリポジトリのフォルダ（`manifest.json` があるディレクトリ）を選択
6. 拡張がロードされ、ツールバーにアイコンが表示される

## 使い方

### 基本操作
1. Suno.com にアクセスしてログイン
2. ライブラリページまたは楽曲再生ページを開く
3. ツールバーの Suno Nonstop DJ アイコンをクリック（Popup が開く）
4. 設定を確認:
   - **Mode**: `Dry Run`（推奨初期設定）— ログのみ、DOM操作なし
   - **Threshold**: `120` 秒（しきい値）
   - **Strategy**: `Balanced`
5. 「**▶ Start**」をクリック
6. 曲を再生 → Popup にリアルタイム情報が表示される
7. 停止するには「**⏹ Stop**」をクリック

### モードの説明

| モード | 動作 |
|--------|------|
| 🔍 **Dry Run** | ログのみ。DOM操作なし。安全に動作確認できる |
| 🖐️ **Manual Create** | プロンプト入力欄への自動入力まで。Createボタンは手動 |
| 🤖 **Auto Create** | 全自動。Createボタンも押す（⚠️ 要注意） |

### プロンプト戦略

| 戦略 | 説明 |
|------|------|
| 🎯 **Conservative** | 前曲にかなり近いプロンプト |
| ⚖️ **Balanced** | 継承と変化を両立 |
| 🚀 **Adventurous** | 大胆に発展させる |

## ファイル構成

```
suno-nonstop-dj/
├── manifest.json          # Manifest V3 定義
├── constants.js           # 共有定数・デフォルト設定
├── state-machine.js       # 有限状態機械（12状態）
├── selectors.js           # DOM セレクタ候補 + スコアリング
├── dom-explorer.js        # live DOM 探索・debugDump()
├── prompt-builder.js      # 次曲プロンプト生成（3戦略）
├── content.js             # Content Script 本体
├── service_worker.js      # Background Service Worker
├── popup.html             # Popup UI
├── popup.js               # Popup ロジック
├── popup.css              # Popup スタイル
├── devtools-snippets.js   # DevTools 用探索スクリプト
└── README.md              # このファイル
```

---

## 状態遷移図

```
IDLE
 └→ WAITING_AUDIO (audio要素を探索中)
     └→ PLAYING_CURRENT (再生中)
         └→ THRESHOLD_REACHED (残り120秒以下)
             └→ EXTRACTING_CONTEXT (DOM情報抽出)
                 └→ COMPOSING_NEXT_PROMPT (プロンプト生成)
                     ├→ TRIGGERING_GENERATION (auto-create)
                     │   └→ WAITING_NEXT_READY (生成待ち)
                     │       └→ ARMED_FOR_SWITCH (次曲準備完了)
                     │           └→ SWITCHING_PLAYBACK (再生切替)
                     │               └→ PLAYING_CURRENT (ループ)
                     └→ ARMED_FOR_SWITCH (manual-create)
                         └→ ...
↳ ERROR (エラー時) → IDLE or STOPPED
↳ STOPPED (停止) → IDLE
```

## 安全停止条件

以下を検知すると自動停止します:

- Credits 不足メッセージ
- CAPTCHA / 人間確認画面
- レート制限メッセージ
- 連続エラー 5回
- audio 要素の消失（3回まで再試行後停止）

---

## デバッグ方法

### 1. DevTools Console でのログ確認
1. Suno ページで F12 を押す
2. Console タブに `[SunoDJ]` プレフィックスのログが表示される
3. フィルタに `SunoDJ` を入力すると見やすくなる

### 2. debugDump() の実行
Console で以下を実行:
```js
window.__sunoDJ.debugDump()
```

出力されるJSON:
- `audioElements`: すべての audio 要素の状態
- `trackContext`: 抽出されたトラック情報
- `safetyCheck`: 安全性チェック結果
- `selectorCandidates`: 各セレクタの候補一覧

### 3. Popup の Debug パネル
Popup 下部の「🐛 Debug」をクリックして展開 → 「Run Debug Dump」ボタン

### 4. Breakpoint 推奨箇所
- `content.js`: `processTimeUpdate()` — 残り時間の計算ロジック
- `content.js`: `onAudioPlay()` — 再生開始検知
- `state-machine.js`: `transition()` — 状態遷移
- `dom-explorer.js`: `extractTrackContext()` — DOM情報抽出

### 5. DevTools 探索スクリプト
`devtools-snippets.js` の各スニペットを Console に貼って実行:
- SNIPPET 1: Audio要素の確認
- SNIPPET 2: 曲タイトル候補
- SNIPPET 3: 曲カード候補
- SNIPPET 4: 再生ボタン候補
- SNIPPET 5: Create/Generateボタン候補
- SNIPPET 6: プロンプト入力欄/歌詞欄候補
- SNIPPET 7: 生成状態インジケータ

### 6. セレクタが壊れた場合
**修正対象ファイル: `selectors.js` のみ**

1. DevTools スニペットで新しいセレクタ候補を見つける
2. `selectors.js` の該当する候補配列に追加/修正
3. `verified: true` に変更してスコアを上げる
4. 拡張を再読み込み（`chrome://extensions` → 🔄）

---

## 既知の不確実要素

| 要素 | 状態 | 備考 |
|------|------|------|
| `#active-audio-play` | ✅ 確認済み | Phase 1 で使用 |
| 曲タイトルのセレクタ | ⚠️ 仮実装 | DevTools で確認必要 |
| 曲カードのセレクタ | ⚠️ 仮実装 | DevTools で確認必要 |
| Createボタンのセレクタ | ⚠️ 仮実装 | DevTools で確認必要 |
| プロンプト入力欄 | ⚠️ 仮実装 | DevTools で確認必要 |
| 歌詞/説明文 | ⚠️ 仮実装 | DevTools で確認必要 |
| 生成完了の検知 | ⚠️ 未実装 | DOM変化 or 新 audio src |
| credits残量表示 | ⚠️ 仮実装 | テキスト検索のみ |

## ライセンス

Private — 個人利用のみ
