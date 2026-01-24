# Cropping 機能 設計書

## 1. 概要

### 目的

- 予め範囲を指定して録画することで、映像の後処理や編集コストを削減
- 録画ファイルサイズを削減し管理を効率化

### 実現方法

- Video 要素で再生 → Canvas に描画 → `captureStream()` で cropping された映像を取得
- `MediaStream` → `HTMLVideoElement` → `drawImage()` → `Canvas` → `captureStream()` → `MediaRecorder` の流れ

---

## 2. データ構造

### Configuration への追加

```typescript
// src/configuration.ts

export interface CropRegion {
    x: number;      // 左上X座標（px）
    y: number;      // 左上Y座標（px）
    width: number;  // 幅（px）
    height: number; // 高さ（px）
}

export interface CroppingConfig {
    enabled: boolean;           // Cropping 機能の ON/OFF
    region: CropRegion;         // Cropping 領域
}

// Configuration クラスに追加
export class Configuration {
    // ... 既存プロパティ ...
    cropping: CroppingConfig;

    constructor() {
        // ... 既存の初期化 ...
        this.cropping = {
            enabled: false,
            region: {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        };
    }
}
```

---

## 3. UI 設計

### 3.1 タブ構成

```text
┌─────────────┬──────────────┬─────────────┐
│  Records    │  Settings    │  Cropping   │  ← 新規タブ追加
└─────────────┴──────────────┴─────────────┘
```

### 3.2 Cropping タブ レイアウト

以下は**録画中**の表示状態を示す。非録画中はプレビュー映像・Screen Recording Size 枠・Cropping 領域枠は表示されず、メッセージのみが表示される。

```text
┌──────────────────────────────────────────────────────────┐
│ Cropping                                                 │
│ ┌──────────────────────────────────────────────────────┐│
│ │ Enable Cropping  [====○] (Switch)                    ││
│ └──────────────────────────────────────────────────────┘│
│                                                          │
│ ※ Audio only mode では無効化 + メッセージ表示           │
│   "Cropping is not available in Audio only mode."       │
│ ※ 録画中は無効化 + メッセージ表示                       │
│   "Cannot change cropping settings during recording."   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Preview                                                  │
│ ┌──────────────────────────────────────────────────────┐│
│ │  ┌─────────────────────────────────────┐             ││
│ │  │ Screen Recording Size 枠            │             ││
│ │  │  ┌─────────────────────────┐        │             ││
│ │  │  │ Cropping 領域           │ ← 操作可能           ││
│ │  │  │ (ドラッグで移動・リサイズ)       │             ││
│ │  │  └─────────────────────────┘        │             ││
│ │  └─────────────────────────────────────┘             ││
│ │                                                       ││
│ │ 録画中でない場合:                                     ││
│ │ "Start recording to preview the cropping area."      ││
│ └──────────────────────────────────────────────────────┘│
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Region (数値入力) ※ 録画中の変更は即時反映              │
│ ┌────────────┐ ┌────────────┐                           │
│ │ X: [    0] │ │ Y: [    0] │                           │
│ └────────────┘ └────────────┘                           │
│ ┌────────────┐ ┌────────────┐                           │
│ │ Width:[1920]│ │Height:[1080]│                         │
│ └────────────┘ └────────────┘                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

プレビューの上に Cropping 領域がオーバーレイされているため、プレビューの映像は Cropping 前の映像となる。

---

## 4. コンポーネント設計

### 4.1 ファイル構成

```text
src/
├── element/
│   ├── cropping.ts          # 新規: Cropping タブ全体
│   ├── croppingPreview.ts   # 新規: プレビュー Canvas
│   └── tab.ts               # 修正: タブ追加
├── configuration.ts         # 修正: CroppingConfig 追加
├── offscreen.ts             # 修正: Canvas cropping 処理
└── message.ts               # 修正: Cropping 関連メッセージ追加
```

### 4.2 コンポーネント詳細

#### `<extension-cropping>` (cropping.ts)

- Cropping 設定全体を管理するコンポーネント
- 責務:
  - ON/OFF スイッチ
  - 数値入力フィールド
  - Audio only モード判定・メッセージ表示

#### `<cropping-preview>` (croppingPreview.ts)

- プレビュー領域を管理するコンポーネント
- 責務:
  - Canvas 描画
  - 録画状態の監視・リアルタイム更新
  - Screen Recording Size 枠の描画（録画中のみ）
  - Cropping 領域枠の描画・操作（録画中のみ、ドラッグで移動・リサイズ可能）
- **タブ切り替え時の動作**:
  - Cropping タブがアクティブな時のみプレビューを描画（パフォーマンス最適化）
  - 他のタブ（Records, Settings）がアクティブな時はプレビュー転送を停止
- **録画状態変更時の動作**:
  - Cropping タブを開いている状態で録画が開始/停止した場合、ページ再読み込みなしで表示を更新
  - 録画開始時: プレビュー映像の表示を開始、メッセージを非表示
  - 録画停止時: プレビュー映像を停止、メッセージを表示

---

## 5. 処理フロー

### 5.1 録画時の Cropping 処理 (offscreen.ts)

#### Cropping ON の場合

```text
┌─────────────────┐
│ getUserMedia()  │
│ (Tab Capture)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Video Element   │ ← 非表示で映像を受け取る
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Canvas          │ ← drawImage() で crop 領域を描画
│ (crop size)     │   ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ captureStream() │ ← Canvas から映像トラックを取得
│ (frameRate)     │   canvas.captureStream(videoFormat.frameRate)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 音声トラック    │ ← 元の MediaStream から音声トラックをパススルー
│ 結合            │   originalStream.getAudioTracks()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MediaRecorder   │ ← Cropping された映像 + 元の音声を録画
└─────────────────┘
```

#### Cropping OFF の場合（従来の処理フロー）

```text
┌─────────────────┐
│ getUserMedia()  │
│ (Tab Capture)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MediaRecorder   │ ← MediaStream を直接録画（Canvas を経由しない）
└─────────────────┘
```

**ポイント**: Cropping OFF の場合は Canvas を経由せず、従来通り MediaStream を直接 MediaRecorder に渡す。これにより、既存ユースケースでのパフォーマンス劣化を防ぐ。

#### 音声トラックの扱い

音声トラックは Cropping 処理の対象外であり、元の MediaStream からそのままパススルーする。

```typescript
// Canvas から映像トラックを取得（frameRate を指定）
const canvasStream = canvas.captureStream(videoFormat.frameRate);

// 元の MediaStream から音声トラックを取得
const audioTracks = originalStream.getAudioTracks();

// 映像トラック（Canvas）+ 音声トラック（元の Stream）を結合
const finalStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks,
]);

// MediaRecorder で録画
const recorder = new MediaRecorder(finalStream, { ... });
```

### 5.2 プレビュー映像の転送処理 (offscreen.ts)

プレビュー用の Canvas は録画用 Canvas とは別に用意し、元の映像トラックからフレームをキャプチャして転送する。

```text
┌─────────────────┐
│ getUserMedia()  │
│ (Tab Capture)   │
└────────┬────────┘
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
┌─────────────────┐                   ┌─────────────────┐
│ Video Track     │                   │ Audio Tracks    │
└────────┬────────┘                   └────────┬────────┘
         │                                      │
         ├──────────────────┐                   │
         │                  │                   │
         ▼                  ▼                   │
┌─────────────────┐  ┌─────────────────┐        │
│ ImageCapture    │  │ Video Element   │        │
│ (プレビュー用)  │  │ (録画用)        │        │
└────────┬────────┘  └────────┬────────┘        │
         │                    │                 │
         ▼                    ▼                 │
┌─────────────────┐  ┌─────────────────┐        │
│ grabFrame()     │  │ Canvas (録画用) │        │
│ (1秒間隔)       │  │ drawImage()     │        │
└────────┬────────┘  │ (Cropping)      │        │
         │           └────────┬────────┘        │
         ▼                    │                 │
┌─────────────────┐           ▼                 │
│ Canvas          │  ┌─────────────────┐        │
│ (プレビュー用)  │  │ captureStream() │        │
│ 縮小・JPEG変換  │  └────────┬────────┘        │
└────────┬────────┘           │                 │
         │                    │                 │
         ▼                    ▼                 ▼
┌─────────────────┐  ┌─────────────────────────────┐
│ sendMessage()   │  │ MediaRecorder               │
│ → Option Page   │  │ (Cropping映像 + 音声)       │
└─────────────────┘  └─────────────────────────────┘
```

**ポイント**:

- **録画用 Canvas**: Cropping 領域を描画し、`captureStream()` で MediaRecorder に渡す
- **プレビュー用 Canvas**: `ImageCapture.grabFrame()` で取得したフレームを縮小・JPEG 変換して転送
- 両者は独立して動作し、録画用は `requestAnimationFrame`、プレビュー用は `setInterval`（1秒間隔）で実行

---

### 5.3 Cropping 領域の制約

#### バリデーションルール

| 項目 | 制約 |
| ---- | ---- |
| `x` | 0 以上、`screenSize.width` 未満 |
| `y` | 0 以上、`screenSize.height` 未満 |
| `width` | 1 以上、`screenSize.width - x` 以下 |
| `height` | 1 以上、`screenSize.height - y` 以下 |

**UI での制御**: Cropping 領域は Screen Recording Size を上限とし、それ以上は設定できないように制御する。

**設定値の引き継ぎ**: 前回の Cropping 領域の設定値を引き継ぐ際、Screen Recording Size が変更されて制約を超過する場合がある。その場合は、超過した範囲を無視して描画する（録画映像が切り取られる）。

```typescript
// Cropping 領域のバリデーション（UI 入力時）
function validateCropRegion(crop: CropRegion, screenSize: Resolution): CropRegion {
    return {
        x: Math.max(0, Math.min(crop.x, screenSize.width - 1)),
        y: Math.max(0, Math.min(crop.y, screenSize.height - 1)),
        width: Math.max(1, Math.min(crop.width, screenSize.width - crop.x)),
        height: Math.max(1, Math.min(crop.height, screenSize.height - crop.y)),
    };
}

// 実際の描画時に有効な領域を計算（設定値が Screen Recording Size を超過している場合）
function getEffectiveCropRegion(crop: CropRegion, screenSize: Resolution): {
    source: { x: number, y: number, width: number, height: number },
    dest: { x: number, y: number, width: number, height: number }
} {
    const effectiveX = Math.max(0, Math.min(crop.x, screenSize.width - 1));
    const effectiveY = Math.max(0, Math.min(crop.y, screenSize.height - 1));
    const effectiveWidth = Math.max(1, Math.min(crop.width, screenSize.width - effectiveX));
    const effectiveHeight = Math.max(1, Math.min(crop.height, screenSize.height - effectiveY));

    return {
        source: { x: effectiveX, y: effectiveY, width: effectiveWidth, height: effectiveHeight },
        dest: { x: 0, y: 0, width: effectiveWidth, height: effectiveHeight }
    };
}
```

---

## 6. メッセージング

### 6.1 追加するメッセージ型 (message.ts)

```typescript
// 既存の Message 型に追加
export type Message =
    | ExceptionMessage
    | StartRecordingMessage
    | UpdateRecordingIconMessage
    | StopRecordingMessage
    | CompleteRecordingMessage
    | ResizeWindowMessage
    | FetchConfigMessage
    | SaveConfigLocalMessage
    | SaveConfigSyncMessage
    | RecordingStateMessage        // 追加
    | RequestRecordingStateMessage // 追加
    | PreviewFrameMessage          // 追加
    | PreviewControlMessage        // 追加
    | UpdateCropRegionMessage      // 追加
    ;

// 録画状態の通知
export interface RecordingStateMessage {
    type: 'recording-state';
    isRecording: boolean;
    screenSize?: Resolution;
}

// 録画状態のリクエスト
export interface RequestRecordingStateMessage {
    type: 'request-recording-state';
}

// プレビューフレームの転送 (offscreen → service_worker → option)
export interface PreviewFrameMessage {
    type: 'preview-frame';
    imageBuffer: ArrayBuffer;  // JPEG image data (ImageBitmap → Canvas → toBlob)
    width: number;
    height: number;
}

// プレビューの開始/停止リクエスト (option → service_worker → offscreen)
export interface PreviewControlMessage {
    type: 'preview-control';
    action: 'start' | 'stop';
}

// Cropping 領域の更新 (option → service_worker → offscreen)
export interface UpdateCropRegionMessage {
    type: 'update-crop-region';
    region: CropRegion;
}
```

### 6.2 各メッセージの役割

#### `RecordingStateMessage`

| 項目 | 内容 |
| ---- | ---- |
| 役割 | 録画状態の変更を通知する |
| 送信元 → 送信先 | `service_worker` → `option page` |
| 使用場面 | 録画が開始/停止されたときに option page へ通知。Cropping タブが録画状態に応じて UI を更新するために使用。`screenSize` は録画中の画面サイズ（Cropping 領域の制約に使用） |

#### `RequestRecordingStateMessage`

| 項目 | 内容 |
| ---- | ---- |
| 役割 | 現在の録画状態をリクエストする |
| 送信元 → 送信先 | `option page` → `service_worker` |
| 使用場面 | option page が開かれたとき、または Cropping タブがアクティブになったとき。現在録画中かどうかを確認し、UI の初期状態を決定するために使用。service_worker は `RecordingStateMessage` で応答 |

#### `PreviewFrameMessage`

| 項目 | 内容 |
| ---- | ---- |
| 役割 | プレビュー映像の1フレームを転送する |
| 送信元 → 送信先 | `offscreen` → `service_worker` → `option page` |
| 使用場面 | 録画中に1秒間隔でフレームをキャプチャして転送。option page の Cropping タブでプレビュー映像を表示するために使用。`imageBuffer` は JPEG 形式の画像データ（長辺最大 600px に縮小） |

#### `PreviewControlMessage`

| 項目 | 内容 |
| ---- | ---- |
| 役割 | プレビュー映像の転送を開始/停止する |
| 送信元 → 送信先 | `option page` → `service_worker` → `offscreen` |
| 使用場面 | `action: 'start'`: Cropping タブがアクティブになり、かつ録画中のとき。`action: 'stop'`: Cropping タブから他のタブに切り替えたとき、または録画が停止したとき。パフォーマンス最適化のため、プレビューが不要なときは転送を停止 |

#### `UpdateCropRegionMessage`

| 項目 | 内容 |
| ---- | ---- |
| 役割 | Cropping 領域を即時更新する |
| 送信元 → 送信先 | `option page` → `service_worker` → `offscreen` |
| 使用場面 | 録画中に Cropping 領域（枠の位置・サイズ）が変更されたとき。数値入力フィールドの変更、またはプレビュー上での枠のドラッグ操作時に送信。offscreen は受信後、次のフレームから新しい Cropping 領域で描画 |

### 6.3 メッセージフロー図

```text
┌─────────────┐         ┌─────────────────┐         ┌──────────────┐
│ Option Page │         │ Service Worker  │         │   Offscreen  │
└──────┬──────┘         └────────┬────────┘         └──────┬───────┘
       │                         │                         │
       │ RequestRecordingState   │                         │
       │────────────────────────>│                         │
       │                         │                         │
       │     RecordingState      │                         │
       │<────────────────────────│                         │
       │                         │                         │
       │   PreviewControl(start) │                         │
       │────────────────────────>│ PreviewControl(start)   │
       │                         │────────────────────────>│
       │                         │                         │
       │                         │     PreviewFrame        │
       │      PreviewFrame       │<────────────────────────│
       │<────────────────────────│      (1秒ごと)          │
       │                         │                         │
       │   UpdateCropRegion      │                         │
       │────────────────────────>│   UpdateCropRegion      │
       │                         │────────────────────────>│
       │                         │       (即時反映)        │
       │                         │                         │
       │   PreviewControl(stop)  │                         │
       │────────────────────────>│  PreviewControl(stop)   │
       │                         │────────────────────────>│
       │                         │                         │
```

**補足**:

- **service_worker の役割**: メッセージの中継役として機能。offscreen document と option page は直接通信できないため、service_worker を経由する必要がある
- **既存メッセージとの関係**: `StartRecordingMessage` や `StopRecordingMessage` は録画の開始/停止を指示するメッセージで、今回追加するメッセージとは別の用途

---

### 6.4 プレビュー映像転送の仕組み

#### 転送方式

- offscreen document で `ImageCapture.grabFrame()` を使用してフレームをキャプチャ
- `grabFrame()` は `ImageBitmap` を返すため、Canvas に描画して `toBlob()` で JPEG に変換
- `Blob.arrayBuffer()` で ArrayBuffer に変換（Base64 より効率的）
- ArrayBuffer を `chrome.runtime.sendMessage()` で service_worker 経由で option page へ転送
- option page で `new Blob([arrayBuffer])` → `URL.createObjectURL()` で画像表示
- **更新間隔: 1秒** (`setInterval` で実行、録画用の `requestAnimationFrame` ループとは独立)
- フルサイズで転送すると転送量が無視できないため、長辺が最大 `600px` になるようアスペクト比を保って縮小する。長辺が `600px` に満たない場合は拡大せずそのまま転送する。

#### 処理フロー

```text
┌─────────────────────────────────────────────────────────────────┐
│ Option Page (croppingPreview.ts)                                │
│                                                                 │
│  1. Cropping タブがアクティブになる                              │
│  2. PreviewControlMessage { action: 'start' } を送信            │
│  3. PreviewFrameMessage を受信                                   │
│     - ArrayBuffer → Blob → URL.createObjectURL() で <img> に表示│
│  4. タブが非アクティブになったら { action: 'stop' } を送信       │
│  5. 古い Object URL は URL.revokeObjectURL() で解放             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Service Worker (service_worker.ts)                              │
│                                                                 │
│  - PreviewControlMessage を offscreen へ中継                    │
│  - PreviewFrameMessage を option page へ中継                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Offscreen Document (offscreen.ts)                               │
│                                                                 │
│  1. PreviewControlMessage { action: 'start' } を受信            │
│  2. setInterval で 1秒ごとにフレームをキャプチャ                │
│     - ImageCapture.grabFrame() で ImageBitmap 取得              │
│     - プレビュー用 Canvas に描画                                │
│     - toBlob() で JPEG Blob 生成                                │
│     - Blob.arrayBuffer() で ArrayBuffer 変換                    │
│  3. PreviewFrameMessage で送信                                  │
│  4. { action: 'stop' } を受信したら clearInterval で停止        │
└─────────────────────────────────────────────────────────────────┘
```

#### パフォーマンス考慮事項

- **録画用描画**: `requestAnimationFrame` で Canvas 描画を実行
- **プレビュー転送**: `setInterval` で 1秒間隔、録画用ループとは独立
- **JPEG 圧縮**: Canvas `toBlob()` で JPEG (品質 0.8) に変換、ファイルサイズ削減
- **ArrayBuffer 転送**: Base64 より約 33% 小さく、エンコード/デコード不要
- **解像度**: プレビュー映像は録画解像度の比率を保って縮小して転送
- **メモリ**: 古い Object URL は `URL.revokeObjectURL()` で即座に解放
- **ImageBitmap 解放**: `imageBitmap.close()` でリソース解放

---

## 7. 状態管理

### 7.1 状態遷移図

#### プレビュー・録画の状態遷移

```text
                              ┌─────────────────────────────────────────┐
                              │           Recording Mode                │
                              │  ┌─────────────────────────────────┐    │
                              │  │        audio-only               │    │
                              │  │  (Cropping 強制 OFF・設定不可)  │    │
                              │  └─────────────────────────────────┘    │
                              │              │                          │
                              │    Mode 変更 │ video-and-audio          │
                              │              │ or video-only            │
                              │              ▼                          │
┌─────────────────────────────┴──────────────────────────────────────────┴─────┐
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         非録画中 (Idle)                                 │  │
│  │  ┌─────────────────────────┐       ┌─────────────────────────┐         │  │
│  │  │  Cropping OFF           │       │  Cropping ON            │         │  │
│  │  │  ・プレビューなし       │ ─────▶│  ・プレビューなし       │         │  │
│  │  │  ・メッセージ表示       │ Enable │  ・メッセージ表示       │         │  │
│  │  │                         │◀───── │                         │         │  │
│  │  └─────────────────────────┘Disable └─────────────────────────┘         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                    │                              │                          │
│          録画開始  │                              │ 録画開始                 │
│                    ▼                              ▼                          │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                           録画中 (Recording)                            │  │
│  │  ※ 録画中は Cropping ON/OFF の切り替え不可                              │  │
│  │  ┌─────────────────────────┐       ┌─────────────────────────┐         │  │
│  │  │  Cropping OFF           │       │  Cropping ON            │         │  │
│  │  │  ・全画面録画           │       │  ・指定領域のみ録画     │         │  │
│  │  │  ・プレビュー映像表示   │       │  ・プレビュー映像表示   │         │  │
│  │  │  ・スイッチ無効化       │       │  ・Cropping 枠操作可能  │         │  │
│  │  │                         │       │  ・スイッチ無効化       │         │  │
│  │  └─────────────────────────┘       └─────────────────────────┘         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                    │                              │                          │
│          録画停止  │                              │ 録画停止                 │
│                    ▼                              ▼                          │
│            (非録画中に戻る)               (非録画中に戻る)                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### プレビュー転送の状態遷移

```text
┌──────────────────┐                    ┌──────────────────┐
│  Preview Stopped │                    │  Preview Active  │
│                  │                    │                  │
│  ・フレーム転送  │   Cropping タブ    │  ・1秒間隔で     │
│    停止中        │   アクティブ化     │    フレーム転送  │
│                  │  ─────────────────▶│                  │
│  ・他タブ表示中  │   & 録画中         │  ・録画中のみ    │
│    または        │                    │    有効          │
│    非録画中      │   Cropping タブ    │                  │
│                  │◀───────────────── │  ・Cropping タブ │
│                  │   非アクティブ化   │    表示中        │
└──────────────────┘   or 録画停止      └──────────────────┘
```

**タブ切り替え時の動作:**

- Cropping タブ → 他タブ: プレビュー転送を停止（パフォーマンス最適化）
- 他タブ → Cropping タブ: 録画中であればプレビュー転送を開始

**録画状態変更時の動作（Cropping タブ表示中）:**

- 録画開始: プレビュー転送を開始、UI をリアルタイム更新（ページ再読み込み不要）
- 録画停止: プレビュー転送を停止、UI をリアルタイム更新（ページ再読み込み不要）

### 7.2 プレビュー状態

| 録画状態 | Cropping 有効 | 表示内容 |
| --------- | -------------- | --------- |
| 録画中 | ON | 元の映像 + Cropping 枠（操作可能） |
| 録画中 | OFF | 元の映像のみ |
| 非録画中 | ON | メッセージのみ |
| 非録画中 | OFF | メッセージのみ |

**非録画中の表示**: 録画中でない場合はプレビュー映像・Screen Recording Size 枠・Cropping 領域枠を表示せず、「Start recording to preview the cropping area.」のメッセージのみを表示する。

**数値入力フィールド**: Region の数値入力フィールド（X, Y, Width, Height）は**非録画中かつ video モード時のみ操作可能**。録画中に変更した場合、**変更は即時に録画へ反映される**。Audio only モード時は数値入力フィールドも無効化する。

### 7.3 Recording Mode による制御

| Recording Mode | Cropping | 動作 |
| ---------------- | ---------- | ------ |
| video-and-audio | 設定可能 | 通常動作 |
| video-only | 設定可能 | 通常動作 |
| audio-only | 強制OFF | スイッチ無効化 + 数値入力フィールド無効化 + メッセージ表示 |

### 7.4 録画中の設定変更

録画中に Cropping 設定を変更した場合の動作は以下の通り。

**注意**: Canvas 経由の処理は Cropping 有効時のみ使用するため、既存ユースケースでのパフォーマンス劣化を防ぐ。また、録画中に解像度が変わると再生時に問題が発生する可能性があるため、**録画中は Cropping ON/OFF の切り替えを不可**とする。ただし、**Cropping 領域（枠の位置・サイズ）は録画中でも変更可能**とし、**変更は即時に録画へ反映される**。

**Canvas サイズの決定**: Canvas サイズは設定された Cropping 領域の width/height で初期化する。録画中に Cropping 領域が変更された場合は、Canvas の width/height にも動的に反映する。

| 操作 | 動作 |
| ---- | ---- |
| Cropping ON → OFF | **録画中は変更不可**（スイッチ無効化） |
| Cropping OFF → ON | **録画中は変更不可**（スイッチ無効化） |
| Cropping 領域の変更 | **録画中でも変更可能**（即時反映） |

#### 実装方式

- Canvas の `drawImage()` は `requestAnimationFrame` で呼び出される関数内で実行（録画用）
- プレビューフレームの転送は `setInterval` で 1秒間隔で実行（録画用ループとは独立）
- Cropping 領域の変更は即時に録画処理へ反映

```typescript
// offscreen.ts - 録画用 Canvas 描画（requestAnimationFrame）
// エラーハンドリングを含む実装は 7.5 節を参照
function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, getCropRegion: () => CropRegion): void;

// プレビュー転送（setInterval で 1秒間隔、録画用ループとは独立）
// エラーハンドリングを含む実装は 7.5 節を参照
function startPreview(videoTrack: MediaStreamTrack): void;
function stopPreview(): void;
```

### 7.5 エラーハンドリング

Cropping 処理中にエラーが発生した場合の動作：

| エラー種別 | 対処 |
| ---------- | ---- |
| `grabFrame()` 失敗（プレビュー） | `console.error` でログ出力、次のフレームで再試行 |
| Canvas 描画エラー（録画） | `console.error` でログ出力、次のフレームで再試行 |
| その他の例外 | `console.error` でログ出力、処理を継続 |

**基本方針**: エラー発生時は録画を停止せず、エラーログを出力して処理を継続する。一時的なエラーで録画が停止するとユーザーへの影響が大きいため、可能な限り録画を維持する。

```typescript
// エラーハンドリングの実装例（録画用）
function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, getCropRegion: () => CropRegion): void {
    try {
        const ctx = canvas.getContext('2d')!;
        const { x, y, width, height } = getCropRegion();
        
        // Canvas サイズを Cropping 領域に合わせて動的に更新
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        
        ctx.drawImage(video, x, y, width, height, 0, 0, width, height);
    } catch (e) {
        console.error('Cropping draw error:', e);
        // エラーが発生しても録画は継続（次のフレームで再試行）
    }
    
    requestAnimationFrame(() => drawFrame(video, canvas, getCropRegion));
}

// プレビュー転送のエラーハンドリング
previewIntervalId = setInterval(async () => {
    try {
        const imageBitmap = await imageCapture.grabFrame();
        // ... 処理 ...
    } catch (e) {
        console.error('Preview frame error:', e);
        // エラーが発生してもプレビューは継続（次のインターバルで再試行）
    }
}, 1000);
```

---

## 8. プレビュー表示の仕様

### 8.1 視覚的フィードバック

- Cropping 領域: 半透明の枠線（青系）
- 領域外: 半透明のオーバーレイ（暗く）

---

## 9. 実装の優先順位

1. **Phase 1**: データ構造・設定保存
   - `Configuration` への `CroppingConfig` 追加
   - Storage への保存・読み込み

2. **Phase 2**: UI 基盤
   - タブ追加
   - `<extension-cropping>` 基本実装
   - 数値入力による設定

3. **Phase 3**: プレビュー（録画時）
   - `<cropping-preview>` 実装
   - 録画中のプレビュー映像表示
   - Screen Recording Size 枠 + Cropping 枠の描画

4. **Phase 4**: 録画処理
   - Canvas cropping 処理 (offscreen.ts)
   - 録画時のプレビュー連携

---

## 10. 後方互換性

### 10.1 既存ユーザーへの影響

既存ユーザーがアップデートした場合、**Cropping 機能はデフォルトで無効**となる。
これにより、従来と同じ動作（全画面録画）が維持される。

### 10.2 Storage マイグレーション

Storage に `cropping` 設定が存在しない場合、`Configuration` クラスの constructor で定義されたデフォルト値が適用される。

**同期対象外の設定**: `cropping` 設定はデバイス固有の画面サイズに依存するため、`Configuration.filterForSync()` で同期対象外とする。

```typescript
// src/configuration.ts

// Configuration クラスの constructor でデフォルト値を定義
export class Configuration {
    // ... 既存プロパティ ...
    cropping: CroppingConfig;

    constructor() {
        // ... 既存の初期化 ...
        this.cropping = {
            enabled: false,  // デフォルトで無効
            region: {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        };
    }

    // cropping 設定を同期対象外にする
    static filterForSync(config: Configuration): SyncConfiguration {
        const { cropping, ...rest } = config;
        return {
            ...rest,
            microphone: {
                ...config.microphone,
                enabled: null,
            },
        };
    }
}

// 同期用の型定義（cropping を除外）
type SyncConfiguration = Omit<Configuration, 'cropping'> & {
    microphone: { enabled: null; deviceId: string | null };
};

// Storage から読み込む際、存在しないプロパティは new Configuration() のデフォルト値で補完
// 既存の実装パターンに従う
```

### 10.3 バージョン管理

現状の実装では Configuration にバージョン番号を持たないため、新しいプロパティの追加時は constructor のデフォルト値で対応する。将来的に破壊的変更が必要になった場合は、バージョン番号の導入を検討する。
