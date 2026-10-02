# Cloudflare（workers.dev）でのホスティング

> 次期設計 §8（フェーズ 6）の手順書。OHAYO! を
> `https://midnight-proof-ohayo.<サブドメイン>.workers.dev` に置き、開発機を止めてもデモが動くようにする。
> [`deploy_preprod.md`](deploy_preprod.md) の preprod デプロイの後に実行する。そのときのウォレット、
> salt、コントラクトをそのまま使う。
>
> [English](../deploy_cloudflare.md)

## 作られるもの

以下はすべて 1 つの [Alchemy](https://alchemy.run) のスタック `apps/worker/alchemy.run.ts` で宣言している。
`deploy` はファイルの内容に合わせて作成・更新し、`destroy` はすべて削除する。

| リソース | 名前 | 役割 |
|---|---|---|
| Worker | `midnight-proof-ohayo` | ダッシュボード（静的アセット）、`/api/*`（ローカルの gateway と同じ `handleApi`）、送信キューを処理する 1 分ごとの Cron と、期限切れのゲストを消す 03:00 JST の Cron |
| D1 | `ohayo` | ロスター、読み取り値、送信記録、判断、ウォレット連携、ゲスト、`chain_jobs`。デプロイ時に `packages/db/migrations` を適用する |
| コンテナ | `ChainRunnerContainer`（`apps/chain-runner/Dockerfile`、デプロイ時にビルド） | 運用ウォレット。`condition-registry` のトランザクションを計画・証明・送信し、照合のためにエントリを読み戻す |
| コンテナ | `ProofServerContainer`（`midnightntwrk/proof-server:8.1.0`） | 証明の生成。`proof.internal` を通じてチェーン操作用コンテナからだけ呼ばれる |
| R2 | `ohayo-wallet-state` | 暗号化したウォレット同期のチェックポイント（`ohayo-wallet/preprod/checkpoint.enc` と 1 つ前のもの） |
| Worker + D1 | `midnight-proof-ohayo-partner` + D1 `ohayo-partner` | パートナーのモック。ブラウザからは直接、`midnight-proof-ohayo` からはサービスバインディング経由で呼ばれる。デプロイ時に `apps/partner-mock/migrations` を適用する |

## 費用

Cloudflare Containers には **Workers Paid プラン（月 5 米ドル）** が必要。それ以外はデモの規模なら
このプランの無料枠に収まる。

コンテナは動いている間だけ課金されるので、OHAYO! は **必要なときだけ** 起動する。

- Cron がチェーン操作用コンテナを起こすのは、キューに値があるとき（または処理中のジョブがあるとき）だけ。
  何もしていないデモではコンテナは一切起動しない。
- チェーン操作用コンテナは最後の要求から 5 分、証明サーバーは最後の証明から 3 分で停止する。
- 照合（`POST /api/reconcile`）はエントリを読むためにチェーン操作用コンテナを起動する。読むだけなので
  ウォレットの同期は要らない。

チェーン操作用コンテナはカスタムの 1 vCPU・3 GiB（メモリは約 600 MB しか使わないが、ウォレットの同期中は
CPU を使い切る）、証明サーバーは `standard-1`（1/2 vCPU、4 GiB）で、どちらもインスタンスは最大 1 つ。
メモリは確保したサイズで課金される。1 回の送信（起動、復元、差分の同期、証明、送信、5 分の待機）で 2 つ合わせて約 1〜2 GiB 時。
プランには月 25 GiB 時が含まれるので、審査期間に数十回送信しても月 5 ドルのまま。preprod の手数料は
faucet の tNIGHT から作る DUST で、お金はかからない。

必要なときだけ起動することの代償は、最初の送信が遅いこと。チェーン操作用コンテナの起動、ウォレットの
チェックポイントの復元、前回からのブロックの同期、証明サーバーによる `srs.midnight.network` からの
証明パラメータのダウンロードが入る。その回の最初のトランザクションまで数分かかると見込むこと。停止前の
待機時間内の送信は速い。待っている間は画面に段階が表示される。

`./run.sh cloudflare destroy` ですべて止められる（[すべて削除する](#すべて削除する)）。

## 始める前に

1. **preprod デプロイが済んでいること**（[`deploy_preprod.md`](deploy_preprod.md)）。`.env.preprod` に
   運用ウォレットのニーモニック、`DEVELOPMENT_PRIVATE_STATE_PASSWORD`、`INGESTER_SALT_HEX`、
   `CONDITION_REGISTRY_CONTRACT_ADDRESS` があり、`.state/midnight-chain/wallet-sync/preprod/` に
   同期済みのウォレットがある。`contracts/condition-registry/src/managed/` のコンパイル済みコントラクトは
   デプロイしたものと同じであること（コンテナイメージにそのままコピーされる）。
2. **Workers Paid の Cloudflare アカウント。** ダッシュボードで **Workers & Pages** を一度開き、
   アカウントに `workers.dev` のサブドメインを割り当てる。サブドメイン（`<サブドメイン>.workers.dev`）を控える。
3. **アカウントの API トークン。** **My Profile → API Tokens → Create Token** で
   **Edit Cloudflare Workers** のテンプレートから始め、**Account · D1 · Edit** と
   **Account · Containers · Edit** を追加する。対象は自分のアカウントに限る。後の手順が権限エラーで
   失敗したら、表示された権限を追加してやり直す。
4. **管理者ウォレットの鍵ハッシュ**。`.env.cloudflare` の `ADMIN_WALLET_KEY_HASHES` に書く。同じ Lace
   ウォレットを管理者にするなら `.env` と同じ値でよい。ホスティングは `.env` を読まないので、ローカルの管理者を
   変えてもホスティング側は変わらない。
5. **Docker Desktop が動いていること。** チェーン操作用コンテナのイメージは Alchemy がホストの Docker で
   ビルドする。ホストに他のものは入れない。

リポジトリのルートに `.env.cloudflare` を作る（`.env.*` として git の対象外）。

```
CLOUDFLARE_API_TOKEN=<トークン>
CLOUDFLARE_ACCOUNT_ID=<Workers & Pages → Account details → Account ID>
WORKERS_SUBDOMAIN=<.workers.dev の前の部分>
ADMIN_WALLET_KEY_HASHES=<鍵ハッシュ。複数ならカンマ区切り>
```

## 手順

どの手順も Docker の中で動く（Git Bash や WSL からは `run.sh`、PowerShell からは `run.ps1`。手順名は同じ）。
スタックのステージは `demo`。

1. **確認**（アカウント不要）: Worker とスタックの型チェック、Worker のテスト、チェーン操作用コンテナの
   イメージのビルドを行う。

   ```bash
   ./run.sh cloudflare check
   ```

2. **計画**: `deploy` で何が作成・変更・削除されるかを表示する。何も適用しない。

   ```bash
   ./run.sh cloudflare plan
   ```

3. **デプロイ**: スタックのすべてを作成・更新する。D1 とマイグレーション、R2 バケット、シークレット付きの
   2 つの Worker、2 つのコンテナ（チェーン操作用コンテナのイメージをビルドしてアップロードする。初回は数分かかる）。

   ```bash
   ./run.sh cloudflare deploy
   ```

   シークレットはファイルから読み、コマンドラインや画面には出さない。

   | Worker | シークレット | 出どころ |
   |---|---|---|
   | `midnight-proof-ohayo` | `OPERATING_WALLET_MNEMONIC` | `.env.preprod` の `DEVELOPMENT_WALLET_MNEMONIC` |
   | `midnight-proof-ohayo` | `DEVELOPMENT_PRIVATE_STATE_PASSWORD`、`INGESTER_SALT_HEX` | `.env.preprod` |
   | `midnight-proof-ohayo` | `SESSION_SECRET` | 初回に `.state/cloudflare/session-secret` に生成 |
   | `midnight-proof-ohayo` | `ADMIN_WALLET_KEY_HASHES` | `.env.cloudflare` |
   | `midnight-proof-ohayo` | `PARTNER_API_KEY`（と変数の `PARTNER_PUBLIC_KEY`） | 初回に `.state/cloudflare/partner.env` に生成 |
   | `midnight-proof-ohayo-partner` | `PARTNER_API_KEY`、`PARTNER_SIGNING_KEY` | 同じファイル |

   生成したものはコマンドが `.state/cloudflare/secrets.env` にまとめる。ニーモニックが届くのは
   チェーン操作用コンテナのプロセス環境だけ。Worker のコードは読まない。

4. **チェックポイント**: `.state/midnight-chain/wallet-sync/preprod/` の同期済みウォレット状態を、
   ウォレットのシードから導いた鍵の AES-GCM で封をして R2 に上げる。これがないと、コンテナの最初の同期で
   全履歴をやり直すことになる（2026-09-30 時点で約 1 時間）。

   ```bash
   ./run.sh cloudflare checkpoint
   ```

5. **状態**: `/api/config` とコンテナのアプリケーションを表示する。

   ```bash
   ./run.sh cloudflare status
   ```

`./run.sh cloudflare all` はデプロイ、チェックポイント、状態を順に実行する。`./run.sh cloudflare tail` は
Worker のログを流す（Cron は処理ごとに `chain_queue` を 1 行出す）。

**ここから先、運用ウォレットを使うのはコンテナだけ。** ホスティング中のデモが動いている間は、
`.env.preprod` で `deploy_preprod deploy`、`condition:submit`、ローカルからの送信をしないこと。
2 か所から同じ DUST を使うと衝突する。

**スタックの状態ファイルにはシークレットが入る。** Alchemy はデプロイした内容を
`.state/cloudflare/.alchemy/` に記録し、シークレットの値も平文で持つ。`.env.preprod` と同じように扱うこと。
git の対象外で、コンテナイメージにも入らない。`destroy` は何を消すかをここから知るので、デモを
デプロイしている間は消さないこと。

## 試す

1. `https://midnight-proof-ohayo.<サブドメイン>.workers.dev` を開き、**ゲストとして試す** を選ぶ。最初はゲストの作業員として
   入る。リング同期カードからスコアを送る（`midnight-proof-ohayo-partner` に直接届く）。
2. 管理者に切り替えて **データ管理 → 送信キュー** を開き、**パートナーから取得**、続いて **チェーンへ送信** を
   押す。行が **処理待ち** になる。画面は 15 秒ごとに更新され、チェーン操作用コンテナの段階が表示される。
3. 1 分以内に Cron がジョブを始める。コンテナが止まっていた場合は数分待つ。行が **記録済み** になって
   トランザクションが付き、一覧にバンドが出る。
4. 一覧で照合を押す。チェーン操作用コンテナを通じてチェーンからエントリを読み戻す（ウォレットの同期は要らない）。

管理者の Lace ログインもローカルと同じ。ウォレットのネットワークは preprod。

### ショーケースを投入する（審査の前に 1 回）

Lace で管理者としてログインし、**データ管理 → ショーケース** で **ショーケースを投入** を押す。見本の作業員 4 人の
過去 7 日分（計測値 27 件）を本物の preprod トランザクションとして記録する。Cron が最大 10 件のジョブ 3 回で処理する
ので、コンテナの稼働は 30〜60 分を見込み、先に運用ウォレットに DUST があることを確かめる（`run.sh deploy_preprod wallet`）。
後日もう一度押すと、新しい日の分だけ増える。これでゲストは、チェーンを待たずに判断や検索ができる履歴を見られる。
毎晩 03:00 JST に、Worker がセッションの切れたゲスト（その作業員、リング、計測値、ローカルの送信記録、監査の行、判断）を
消す。ショーケースとウォレットのユーザーが行ったことは残り、チェーンに載ったエントリもそのまま残る。

## メモリの計測（§9.10）

送信の後、**Workers & Pages → Containers** でチェーン操作用コンテナ（と証明サーバー）を開くと、
インスタンスのメトリクスでメモリと CPU の推移が見られる。ジョブがメモリ不足で落ちるなら、
`apps/worker/alchemy.run.ts` でチェーン操作用コンテナの `memoryMib` を上げて再デプロイする。2026-10-03 の実測では
メモリは約 600 MB で CPU が張り付いていたので、vCPU を 1 つ割り当てている。コンテナが止まるたびに、Worker の
ログに終了コード付きの `container_stopped` が出る（137 はメモリ不足）。

## 更新

- コード、ダッシュボード、スタックの変更: `./run.sh cloudflare deploy`（Alchemy は差分だけを変更する。
  `plan` で先に確認できる）。
- スキーマの変更: `packages/db/migrations` に番号付きのファイルを追加してデプロイする（スタックが新しい
  マイグレーションを適用する）。最初のホスティング以降、`0001_condition_schema.sql` は直接編集しない。
- セッションの秘密鍵の入れ替え: `.state/cloudflare/session-secret` を消してデプロイする（全セッションが切れる）。
  パートナーの鍵も `.state/cloudflare/partner.env` で同じようにする。

## すべて削除する

```bash
./run.sh cloudflare destroy
```

`ohayo` と入力して確認すると、2 つの Worker、2 つの D1（ホスティング側のデータすべて）、チェックポイントの
入った R2 バケット、2 つのコンテナアプリケーション、レジストリに残ったコンテナイメージを削除する。
ローカルのファイル（`.env.preprod`、ウォレットの状態、生成した鍵）と、Midnight preprod 上のコントラクトと
エントリは残る。他に使っていなければ、その後 Workers Paid を解約する。運用ウォレットは再び開発機から使える。

## うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop が動いていない |
| `Authentication error` / `Unauthorized` | トークンの権限が足りない。表示された権限を追加する（多いのは Containers · Edit と D1 · Edit） |
| `SchemaError(Expected string at ["..."])` | スタックが読むシークレットが足りない。`.env.preprod` と `.env.cloudflare` を確認する |
| 行が **処理待ち** のまま、段階が `unreachable` | チェーン操作用コンテナが起動中。`./run.sh cloudflare tail` で起動が見える。90 分たつとジョブは中断扱いになり、値は再送される |
| ジョブが **失敗**: `Wallet has no tNIGHT` や DUST のタイムアウト | preprod の faucet で運用ウォレットに入金する（`deploy_preprod.md` の手順 3）。次の送信で再試行される |
| ウォレット同期の段階が長く続く | チェックポイントがないか古い。コンテナはジョブのたびに新しいものを保存するので、遅いのは最初だけ。ホスティングしたコンテナが一度送信した後は `./run.sh cloudflare checkpoint` を再実行しないこと（開発機の状態は R2 より古い） |
| `/api/partner/pull` が 502 を返す | `midnight-proof-ohayo-partner` がないか失敗している。`./run.sh cloudflare plan` でスタックがそろっているか確認する |
