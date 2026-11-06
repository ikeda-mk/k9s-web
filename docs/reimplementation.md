# 再実装手順

原資料: IMG_9396.HEIC〜IMG_9404.HEIC（2026-11-06撮影）。原画像は変更していません。

1. Node.js 22以上とGitを用意し、空の作成先で `git init -b main` を実行します。既存k9sのリポジトリは複製しません。
2. ES Modulesプロジェクトを作成し、公式Kubernetesクライアントとjs-yamlを直接依存に追加します。初回 `npm install`、lockfile作成後は `npm ci` を使用します。
3. `kubernetes.mjs` にContext単位の認証とGET、リソース整形、設定マスク・YAML化を実装します。`demo.mjs` は同じメソッドで架空データを返します。
4. `server.mjs` は127.0.0.1で静的ファイルと限定APIを配信します。Host・Origin・Fetch Metadata・専用ヘッダーを検証し、通信中断を上流に伝えます。
5. `public/` に日本語ダークテーマ、Context接続、Namespace選択・直接入力、一覧、検索、ページング、Podログ、3種の設定パネルを作成します。候補・一覧・設定・ログの中断を分離し、選択とリクエストの一致を確認します。
6. `npm test` でローカル模擬HTTP APIを検証します。`npm run demo` を起動し、ブラウザでNamespace・検索・ログ・設定形式切替・再取得・失敗からの再試行・選択変更時の遅い応答・狭い画面を確認します。
7. 実接続は `npm start`（必要ならPORT変更）で、指定されたContext・Namespace・Podを使います。デモ検証と実接続検証を区別して報告します。

この作業先は `/Users/mak/repos/github/k9s-web`。GitHubへの公開・pushは行いません。依存パッケージとローカル状態はGit管理対象外です。
