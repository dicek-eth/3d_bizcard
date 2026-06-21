# 3D Bizcard Product Specification

## 1. Product Summary

`3d_bizcard` は、名刺裏面のQRコードからWebアプリを起動し、スマートフォンのカメラで同じ名刺を映すと、QRコード付近に3Dキャラクターが浮かび上がって追従するWeb ARプロダクト。

インストール不要で動作することを優先し、iOS Safari / Android Chrome のブラウザ上で利用できる構成にする。

## 2. Core User Flow

1. ユーザーが名刺裏面のQRコードをスマートフォンで読み取る。
2. QRコードのURLからWebアプリが開く。
3. Webアプリがカメラ利用許可を求める。
4. ユーザーが名刺裏面をカメラに映す。
5. アプリが名刺裏面またはQR周辺の画像ターゲットを認識する。
6. 認識位置に合わせて3Dキャラクターを表示する。
7. 名刺の移動・回転に追従してキャラクターも移動・回転する。
8. ピンチ操作でキャラクターの拡大・縮小ができる。

## 3. Target Platforms

### Supported

- iPhone: iOS Safari 最新2メジャーバージョン
- Android: Chrome 最新2メジャーバージョン
- Desktop: 開発・デバッグ用途のみ

### Requirements

- HTTPS配信必須
- カメラ権限必須
- WebGL対応端末

## 4. MVP Scope

### Must Have

- QRコードからWebアプリを起動できる
- カメラ映像をブラウザ上に表示できる
- 名刺裏面の画像ターゲットを認識できる
- ターゲット上に3Dキャラクターを表示できる
- ターゲット追従表示ができる
- ピンチ操作で3Dキャラクターをズームイン・ズームアウトできる
- GitHub public repository として公開できる
- Vercel / GitHub Pages などHTTPS対応ホスティングにデプロイできる

### Should Have

- ローディング画面
- カメラ権限が拒否された場合のエラー表示
- ターゲット未検出時の軽いガイド表示
- キャラクターの回転・上下ふわふわアニメーション
- 名刺ごとにキャラクターや表示情報を切り替える仕組み

### Out of Scope for MVP

- ネイティブアプリ化
- 複数名刺の同時トラッキング
- 顔認識・人物認識
- 決済・ログイン・ユーザー管理
- サーバー側CMS

## 5. Important Technical Decision

QRコードはURL起動には適しているが、3Dモデルを安定して追従させるためのARマーカーとしては単体だと弱い。

そのためMVPでは、次のいずれかを採用する。

### Preferred: 名刺裏面全体を画像ターゲットにする

名刺裏面のデザイン全体をAR認識対象にする。QRコードだけでなく、ロゴ、模様、罫線、文字、背景パターンを含めて特徴点を増やす。

メリット:

- 追従が安定しやすい
- QRコードの見た目を崩さずに済む
- 名刺デザインとして自然に見える

デメリット:

- 印刷後にデザインを変更すると画像ターゲットを再生成する必要がある

### Alternative: QR周辺に専用ARマーカーを置く

QRコードの周囲に認識しやすい枠・図形・パターンを配置し、その部分を画像ターゲットにする。

メリット:

- QRコード周辺だけで認識できる
- 名刺表面のデザイン自由度が高い

デメリット:

- デザイン上、マーカー感が出やすい

## 6. Business Card Back Design Requirements

名刺裏面には以下を配置する。

- Webアプリ起動用QRコード
- AR認識用の特徴点が多い背景またはフレーム
- キャラクター表示位置の基準になる余白
- 必要最小限の案内文

推奨レイアウト:

- 中央または下部にQRコード
- QRコード周辺に細かい幾何学パターン、ロゴ、ライン、ドットなどを配置
- QRコードの上方向に3Dキャラクターが出る想定で空間を確保
- 白一色・黒一色・単純なグラデーション背景は避ける

## 7. Web App Architecture

### Frontend

- Vite
- TypeScript
- Three.js
- Web AR image tracking library
- QR generation utility for card URL

### Runtime Modules

- `CameraView`: カメラ映像と権限管理
- `ARTracker`: 画像ターゲットの検出・追従
- `CharacterScene`: 3Dキャラクター表示、ライト、アニメーション
- `GestureController`: ピンチズーム、必要に応じてドラッグ回転
- `CardProfile`: QR URLのパラメータから名刺データを取得

### Data

MVPでは静的JSONで管理する。

```json
{
  "cardId": "default",
  "name": "Daisuke Matsuoka",
  "title": "Developer",
  "characterModel": "/models/character.glb",
  "targetImage": "/targets/default.mind"
}
```

## 8. URL Design

QRコードのURLは以下の形式を想定する。

```text
https://example.com/?card=default
```

将来的に複数名刺へ対応する場合:

```text
https://example.com/c/default
https://example.com/c/client-a
```

## 9. AR Behavior

### Target Detection

- 初回検出時にキャラクターをフェードインする
- ターゲットを見失ったらキャラクターをフェードアウトする
- 再検出したら同じスケールで復帰する

### Character Placement

- 原点: 名刺裏面ターゲットの中心
- 位置: QRコードの少し上
- 回転: 名刺平面に対して立ち上がる向き
- 初期スケール: スマートフォン画面で名刺幅の約30-50%に見えるサイズ

### Gestures

- ピンチイン: キャラクター縮小
- ピンチアウト: キャラクター拡大
- スケール範囲: 0.5x - 3.0x
- ターゲットを見失っても最後のスケールを保持する

## 10. Character Requirements

MVPでは軽量な `.glb` モデルを使用する。

推奨条件:

- ファイルサイズ: 5MB以下
- ポリゴン数: 低-中程度
- テクスチャ: 1024px以下を基本
- アニメーション: idleループ1つ以上

初期実装では仮モデルを使い、後から正式キャラクターに差し替えられる構造にする。

## 11. Non-Functional Requirements

- 初回表示までの目標: 5秒以内
- 60fps目標、低スペック端末では30fps許容
- カメラ映像と3D表示が画面からはみ出してもUIが破綻しない
- 端末を縦向きで使う前提
- 主要操作は片手で可能にする

## 12. Privacy and Security

- カメラ映像は端末内でのみ処理する
- MVPではカメラ映像をサーバーに送信しない
- アクセス解析を入れる場合は、カメラ映像や個人情報を収集しない
- HTTPSのみで公開する

## 13. Repository Plan

Repository name:

```text
3d_bizcard
```

Visibility:

```text
public
```

Initial structure:

```text
3d_bizcard/
  SPEC.md
  README.md
  package.json
  index.html
  src/
    main.ts
    app/
    ar/
    scene/
    gestures/
  public/
    models/
    targets/
    cards/
```

## 14. Deployment Plan

推奨はVercel。

理由:

- HTTPSが標準
- GitHub連携が簡単
- Viteとの相性がよい
- スマートフォン実機確認用URLをすぐ発行できる

代替:

- GitHub Pages
- Netlify
- Cloudflare Pages

## 15. Acceptance Criteria

MVP完了条件:

- public GitHub repository が作成されている
- WebアプリがHTTPSで公開されている
- QRコードを読み取ると公開URLが開く
- カメラ権限を許可するとカメラ映像が表示される
- 名刺裏面ターゲットを映すと3Dキャラクターが表示される
- 名刺を動かすとキャラクターが追従する
- ピンチ操作でキャラクターのサイズが変わる
- iPhone Safari と Android Chrome の少なくとも片方で実機動作確認済み

## 16. Risks

### Tracking Stability

QRコード単体ではトラッキングが不安定になる可能性が高い。名刺裏面全体、またはQR周辺の特徴点が多いデザインをターゲット化する。

### Mobile Browser Differences

iOS Safari と Android Chrome でカメラ・WebGL・タッチイベントの挙動が異なる。早い段階で実機確認する。

### Printed Card Quality

印刷の反射、紙質、QRサイズ、照明条件で認識率が変わる。マット紙、十分なコントラスト、特徴点の多いデザインを推奨する。

### Model Weight

3Dモデルが重いと初回ロードが遅くなる。MVPでは軽量モデルを使い、圧縮を前提にする。

## 17. Implementation Phases

### Phase 1: Prototype

- Vite + TypeScript 初期化
- カメラ起動
- AR画像ターゲット検出
- 仮3Dモデル表示
- ピンチズーム

### Phase 2: Business Card Integration

- 名刺裏面デザイン作成
- QRコード生成
- 画像ターゲット生成
- 印刷テスト

### Phase 3: Public Release

- README整備
- GitHub public repository 作成
- Vercelデプロイ
- 実機QA

### Phase 4: Polish

- 正式キャラクター差し替え
- ローディング・エラーUI改善
- 複数名刺対応
- アニメーション改善

