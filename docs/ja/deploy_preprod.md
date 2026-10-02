# condition-registry を Midnight preprod にデプロイする

> [English](../deploy_preprod.md)

Docker しかない開発ホストから、`condition-registry` コントラクトを **Midnight preprod** に
デプロイする手順書。すべての手順は `run.sh deploy_preprod`（Git Bash がない Windows では
`.\run.ps1 deploy_preprod`）を通して行う。このレーンは、使い捨ての `node:22-bookworm`
コンテナで `condition-cli` を動かし、その横でローカルの証明サーバを動かす。設計の背景は
[`next_phase_design.md`](next_phase_design.md) §7。

証明はこのホスト（ローカルの証明サーバ）で作り、preprod には証明済みの tx だけを送る。
この手順は Cloudflare には触れない。ホスト版のチェーン実行への引き継ぎは最後の節に書く。

## 現在のデプロイ

| | |
|---|---|
| ネットワーク | Midnight preprod |
| コントラクトのアドレス | `1fca6b4cec100a425db72d769d1ef19f673de7552b4c9196611797f6b565e7ed` |
| 運用ウォレット | `mn_addr_preprod1xcr2lqjjvh5c2twxtzjref5rmkt4haaclxprkxfdywvhu00c5ljsl09553` |
| DUST 登録の tx | `00e7c5f28875253a0f2034846ad9e1a4beb356e9e6df16c201213d03a740192563` |
| デプロイ日時 | 2026-09-29T18:50:45Z |

同じ値が、デプロイしたホストの `.state/midnight-chain/deployment-preprod.json` と
`.env.preprod` にある。

## レーンがすること

```
bash ./run.sh deploy_preprod [wallet | funding | deploy | status]
```

| ステップ | 内容 | 前提 |
|---|---|---|
| `wallet` | 初回は運用ウォレットを作り、同期して、アドレスと残高を表示する | `.env.preprod` |
| `funding` | ウォレットに tNIGHT が届くまで待つ | faucet への請求 |
| `deploy` | 必要ならコントラクトをコンパイルし、DUST ウォレットを同期し、NIGHT を DUST 生成用に登録し、使える DUST を待ち、証明してデプロイする。最後に `status` を実行する | tNIGHT |
| `status` | preprod の indexer からコントラクトの台帳を読む | デプロイ済み |
| （省略） | `funding` → `deploy` → `status` | |

どのステップでも次のように動く。

- `mn-condition-preprod-proof`（`midnightntwrk/proof-server:8.1.0`）が動いていなければ、
  `mn-condition-preprod-net` ネットワーク上で起動し、終了後も動かしたままにする。
- `.env` ではなく **`.env.preprod`** を読む（`DEVELOPMENT_ENV_FILE=.env.preprod`）。
  `run.sh e2e` が `.env` に書く devnet 用のウォレットと混ざらない。
- ファイルの内容に関係なく、`MIDNIGHT_NETWORK=preprod` と証明サーバの URL を指定する。
- 出力に出るリカバリーフレーズを、`.env.preprod` を指す案内に置き換える。

ウォレットの同期状態は `.state/midnight-chain/wallet-sync/preprod/` に 1 分ごとと終了時に
保存されるので、途中で止めても続きから再開する。

## 1. `.env.preprod` を作る

`.env.preprod` は git の管理対象外（`.env.*`）。salt と private state のパスワードは、
ホストに Node がなくても作れるよう Docker で生成する。

```bash
docker run --rm node:22-bookworm node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

```bash
docker run --rm node:22-bookworm node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```

```
MIDNIGHT_NETWORK=preprod
CONDITION_REGISTRY_CONTRACT_ADDRESS=
DEVELOPMENT_WALLET_MNEMONIC=
DEVELOPMENT_WALLET_SEED=
DEVELOPMENT_PRIVATE_STATE_PASSWORD=<base64 の値>
INGESTER_SALT_HEX=<hex の値>
MIDNIGHT_SYNC_TIMEOUT_MS=3600000
MIDNIGHT_DUST_TIMEOUT_MS=43200000
MIDNIGHT_DUST_BATCH_SIZE=100
PUBLIC_MIDNIGHT_NETWORK=Midnight Preprod
```

- ウォレットの 2 項目は空のままにする。最初のステップが 24 語のニーモニックを作り、このファイルに書き込む。
- `INGESTER_SALT_HEX` はレジストリを使う間ずっと固定する。変えると entryKey がすべて変わる。
- **このファイルをバックアップする**（パスワードマネージャなど。リポジトリやチャットには置かない）。
  ウォレットと tNIGHT を復元する手段はニーモニックだけ。

## 2. ウォレットを作る

```bash
bash ./run.sh deploy_preprod wallet
```

```
New operating wallet recovery phrase:
  (written to .env.preprod - back that file up)
Wallet: mn_addr_preprod1...
raw tNIGHT: 0  raw DUST: 0
PREPROD OK
```

2026-09-30 の実測では約 1 分。

## 3. faucet から tNIGHT を請求する

<https://midnight-tmnight-preprod.nethermind.dev> を開き、`mn_addr_preprod1…` のアドレスを
貼り付けて tNIGHT を請求する。faucet には CAPTCHA があるので、この手順は手作業になる。

## 4. 着金を待つ

```bash
bash ./run.sh deploy_preprod funding
```

`Watching for tNIGHT...` と表示し、faucet からの送金が届くと
`tNIGHT received: raw 5000000000` を出して終わる（2026-09-30 は約 1 分）。faucet に
請求する前に起動しておいてもよい。

## 5. デプロイする

```bash
bash ./run.sh deploy_preprod deploy
```

いちばん時間がかかる手順。2026-09-30 に新しいウォレットで実測したところ、全体で約 70 分、
そのうち約 65 分が DUST ウォレットの同期だった。

1. **DUST ウォレットの同期。** 新しいウォレットは preprod の DUST のイベントを最初から
   すべて取り込む（当時で約 157 万件）。30 秒ごとに進み具合を表示する。例:
   `DUST wallet sync: 812345 of 1575226 (51%)`。待ち時間の上限は 1 時間の
   `MIDNIGHT_SYNC_TIMEOUT_MS` ではなく、12 時間の `MIDNIGHT_DUST_TIMEOUT_MS`。
2. **登録。** `Waiting for 1 NIGHT UTXO(s) to generate the ~… DUST registration fee...`
   の後に `DUST registration submitted: <tx id>`。
3. **使える DUST。** `Waiting for spendable DUST (>= 5000000000000000)...` →
   `Spendable DUST is available.`。数分。
4. **証明とデプロイ。** ローカルの証明サーバで数分かけて証明を作り、
   `conditionRegistry deployed: <address>` を表示する。
5. **確認。** `submissionCount: "0"` の台帳を表示する。

最後にアドレスを `.env.preprod` に書く。

```
CONDITION_REGISTRY_CONTRACT_ADDRESS=<address>
```

`status` や以降の送信は `.state/midnight-chain/deployment-preprod.json` からもアドレスを
見つけられるが、Cloudflare への引き継ぎではこのファイルから読む。

## 6. 確認する

```bash
bash ./run.sh deploy_preprod status
```

## 驚くが問題ない表示

| 表示 | 意味 |
|---|---|
| `deploy` の序盤にスタックトレース付きで 1 回出る `Wallet.Sync: [object Object]` | ウォレット SDK 内部の、shielded ウォレットの indexer 購読のエラー。2026-09-30 はそのまま処理が続き、正常にデプロイできた |
| `deployed` の直後の `RPC-CORE: submitAndWatchExtrinsic ... disconnected ... 1000:: Normal Closure` | tx が受け付けられた後に送信用の接続を閉じただけ |
| `proof server URL uses unencrypted http:// for non-loopback host` | 証明サーバには Docker の内部ネットワーク経由でつないでいる |
| DUST の進み具合が出る前に数分間何も表示されない | SDK がウォレットを追いつかせている最中。コンテナの CPU は約 100% のまま |

## 停止と片付け

- `bash ./run.sh down` は preprod 用の証明サーバとネットワークを消す。**ローカル devnet が
  動いていれば、それも止める。**
- `.state/midnight-chain/wallet-sync/preprod/` は消さない。消すと、次のステップで DUST の
  履歴をまた最初から取り込むことになる。

## Cloudflare へのウォレットの引き継ぎ（フェーズ 6）

[`deploy_cloudflare.md`](deploy_cloudflare.md) に従う。

1. `./run.sh cloudflare deploy` が `.env.preprod` からニーモニック、`INGESTER_SALT_HEX`、
   `DEVELOPMENT_PRIVATE_STATE_PASSWORD`、`CONDITION_REGISTRY_CONTRACT_ADDRESS` を Alchemy のスタック
   （`apps/worker/alchemy.run.ts`）に読み込む。画面に出したり手で入力したりしない。ニーモニックは Worker の
   シークレット `OPERATING_WALLET_MNEMONIC` になり、受け取るのはチェーン操作用コンテナだけ。続いて
   `./run.sh cloudflare checkpoint` で、この開発機の同期済みウォレット状態を上げる。
2. **これ以降、このウォレットは Container だけが使う。** submitter の鍵は seed から作られる
   （`packages/midnight-chain/src/state.ts` の `submitterSecretKeyHex`）ので、2 つのホストが
   同じ DUST を使うと競合する。引き継ぎ後は、開発ホストから `deploy_preprod deploy` や送信を
   実行しない。

## コントラクトの差し替え

新しくデプロイすると、台帳が空の新しいレジストリになる。既存の `submissions` の行は元の
`deployment_id` を保持し、salt は変えない。同じ `.env.preprod` で `deploy_preprod deploy` を
もう一度実行する。ウォレットは同期と登録が済んでいるので、DUST を待って証明するだけになる。
