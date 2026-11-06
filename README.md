# k9s-web

Kubernetes APIを直接GETする、日本語のローカル閲覧専用Webアプリです。Node.js 22以上を使用します。k9sやkubectlの実行・端末の埋め込みは行いません。

## 起動

```sh
npm ci
npm test
npm run demo
# http://127.0.0.1:3009
```

初回は `npm install` で依存関係とlockfileを作成します。指示書指定の `@kubernetes/client-node ^2.0.2` と `js-yaml 5.5.0` を直接依存にしています。

通常モードは `npm start`。既存サーバーと並行する場合は `PORT=3010 npm run demo` のように指定します。バックエンド変更後は自分が起動したサーバーをCtrl+Cで止めて再起動してください。

「接続設定を読み込む」→ Context選択 →「接続する」の順に操作します。通常モードでは `KUBECONFIG` または通常のkubeconfigを公式クライアントで読み込み、証明書・トークン・exec認証を適用します。Contextの選択はリクエストごとに独立させ、元のcurrent-contextやkubeconfigファイルを書き換えません。認証用の外部コマンドが必要な場合は、そのコマンドをサーバーのPATH上に用意してください。

## 機能

- Pods / Deployments / Services / Ingressesの一覧・検索・詳細。Ingressはnetworking.k8s.io/v1。
- 通常のselectによるNamespace選択、全Namespace表示、別欄での名前直接入力（適用またはEnter）。Namespace一覧権限がなくても直接入力が可能です。
- 一覧は500件ごとのページング。「続きを読み込む」で追加します。手動更新と任意の10秒自動更新、切断を備えています。
- Podのコンテナ選択・現在／前回起動時ログ。最新300行・最大1 MiB。ログのAcceptは `application/json, */*;q=0.8`、本文はHTMLとして解釈しません。
- Deployment / Service / Ingress名をクリックすると設定をGET。YAML／JSON切替、取得時刻、手動再取得、失敗表示。設定欄は一覧の自動更新から独立しています。
- metadata（name / namespace / labels / annotations）とspecを表示。未知のspec項目も保持してjs-yamlで直接YAML化します。
- 通常／init／ephemeralコンテナのenv.valueを `[REDACTED]` に置換。Secretの参照名・キーは保持しますが、Secret本体の取得APIはありません。
- status / managedFields / resourceVersion / last-applied-configuration注釈はネストしたテンプレート内も含めて除去します。
- 古い一覧・設定・ログのリクエストは中断し、選択先との一致も確認して表示します。Namespace候補の取得はリソース種別の変更では中断しません。

## ローカルAPI

すべてGET。ブラウザは `X-Kube-Local: 1` を送ります。Hostは実際の待受ポートの127.0.0.1／localhostのみ、Originは同一ローカルOrigin、Fetch Metadataはsame-origin／noneのみ許可します。専用ヘッダーがないAPI要求、外部サイト、変更メソッドを拒否します。待受は127.0.0.1に限定しています。

| API | パラメータ |
| --- | --- |
| `/api/info` | なし。demo / live |
| `/api/contexts` | なし。Context名・既定Namespace・currentContextのみ |
| `/api/namespaces` | context |
| `/api/resources` | context, kind, namespace（省略で全体）, continuation |
| `/api/logs` | context, namespace, pod, container, previous |
| `/api/config` | context, namespace, kind, name。`{config, yaml, fetchedAt}` |

設定のkindはdeployments／services／ingressesのみ。一覧はこれにpodsを加えた4種のみです。名前・Namespaceはパス用に検証します。API権限は一覧にlist、設定とpods/logにgetが必要です。APIは15秒でタイムアウトし、ブラウザが通信を切断すると上流リクエストも中断します。上流エラーの本文・認証エラー詳細はブラウザに送信しません。

## 制約と検証

Ingressの接続先が存在しても、到達性・正常性を保証する表示ではありません。設定のマスクは指定されたenv.valueとlast-applied注釈が対象で、任意の注釈やspec中の文字列を自動判定する仕組みではありません。

デモは架空データのみ使用し、実クラスタへアクセスしません。模擬HTTP APIテストはContext分離、全種別一覧・ページング、ログAcceptの406回帰、設定パス、YAML/JSON一致、マスク、403/404、タイムアウト、中断、ローカルアクセス制限を検証します。

実クラスタはユーザーが指定したContext・Namespace・Podでのみ確認します。今回の実行状況と未確認範囲は [docs/verification.md](docs/verification.md) を参照してください。

## 今回のkubectl proxyへの接続

`192.168.0.110:8001` 向けの専用設定を `.local/proxy.kubeconfig.yaml` に作成しています。認証はproxy側で行い、既存kubeconfigは変更しません。

```sh
KUBECONFIG="$PWD/.local/proxy.kubeconfig.yaml" npm start
```

画面で「接続設定を読み込む」を押し、Context `local-proxy` を選んで接続します。Namespaceは画面から指定してください。設定内の `insecure-skip-tls-verify: true` は、公式クライアントがHTTP接続を許可するための指定です。
# k9s-web
