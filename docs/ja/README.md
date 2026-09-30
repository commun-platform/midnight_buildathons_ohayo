# SADAKO

**作業員のコンディションをオンチェーンに記録する。1 人 1 日 1 値、公開はバンドのみ。**

Midnight Buildathon Track 1「Build Privacy-First Apps on Midnight」提出プロジェクト。

[English](../../README.md) · [設計・仕様](worksite_condition_system.md)（[English](../worksite_condition_system.md)）

---

## 課題

工事現場には作業員の健康管理義務があり、熱中症対策は推奨ではなく法的義務になった。
スマートリングは日々の体調スコアを供給できるが、そのスコアは**要配慮個人情報に近い
機微データ**である。ここで 2 つの要請が正面から衝突する。

- 行政や元請は、**事故の後から書き換えられない**記録を必要とする。署名付き DB では
  足りない。署名した会社自身が調査対象になった瞬間、その署名は何も証明しない。
- 一方で作業員は、日々の生体スコアを公開されたくないし、施工体制上のすべての管理者に
  見られたくもない。

記録を公開チェーンに置けば前者は解決するが、後者が完全に壊れる。

## SADAKO がやること

別会社が **1 人 1 日あたり 0〜100 のコンディション値**を算出する。SADAKO はそこから
先を担い、**3 状態のバンドだけ**を Midnight に記録する。

| 値 | バンド | 意味 |
|---|---|---|
| 60〜100 | `正常` | 就業可 |
| 40〜59 | `要注意` | 経過観察 |
| 0〜39 | `危険` | 介入が必要 |

生の値は運用者の手元から出ない。チェーンに載るのは、ソルト付きハッシュのキー、
バンド、値へのコミットメント、そして**「そのバンドはコミットされた値から正しく
導かれた」というゼロ知識証明**だけである。

**ここが Midnight でしか成立しない部分。** 回路は生スコアを private witness として
読み、公開されたコミットメントと突き合わせ、バンドを導出し、**バンドだけ**を公開
台帳に書く。誰でもバンドの正しさを検証できるが、誰もスコアを読めない。

```
private witness             public ledger
──────────────────          ───────────────────────────────────────
scoreCenti  (7800)  ──┐
nonce       (32B)   ──┼─▶ コミットメント照合 ─▶ band = 正常 ─▶ entries[entryKey]
                      │                                          { periodStartMs,
                      └─ prover の外に出ない                       recordedAt,
                                                                    scoreCommitment,
                                                                    band, verified }
```

キーは `sha256(ringId ‖ periodStartMs ‖ salt)` — **人ではなくリング**を材料にし、
さらにソルトを掛けている。ソルトを持たない観測者には、どのエントリが同一人物のもの
かすら分からない。

---

## クイックスタート

必要なのは **Docker だけ**。Node もアカウントもクラウドも要らない。

```bash
cp .env.example .env   # run.sh はファイルの存在だけを見る。中身は既定値で足りる
./run.sh e2e           # devnet → fund → deploy → dashboard（:8787）
```

1 コマンドで、本物のローカル Midnight devnet（`midnight-node` 1.0.0 /
`indexer-standalone` 4.3.3 / `proof-server` 8.1.0）を起動し、genesis seed から運用
ウォレットへ入金し、コントラクトをコンパイルしてデプロイし、devnet に接続した
ダッシュボードを配信する。ダッシュボードは常に実際にデプロイされたコントラクトに
対して動く — seed 済みデータだけのオフラインモードは無い。

<http://localhost:8787> を開き、**ID** 欄に次のいずれかを貼り付ける。

| ID | ロール | 見えるもの |
|---|---|---|
| `admin` | 管理者 | 全作業員、データ管理画面、チェーン照合 |
| `worker-1` | ユーザー | 自分の履歴のみ — **生の 0〜100 の値も含む** |

**ログイントークンは作業員IDそのもの**（`worker-1`、`worker-2`…）。`admin` だけが
固定の職員用トークン。ユーザーテーブルもパスワードも無い。現場は 1 か所を前提とし、
現場という概念は持たない。

ロスターは空の状態で始まる。`admin` としてデータ管理画面からリングと作業員
（id は `worker-1`）を作り、リングを割り当てる。`worker-1` でログインし、
**リング同期**カードからスコア（0〜100）を送る。送り先は partner mock で、SADAKO
ではない。`admin` に戻って**パートナーから取得**、続けて**チェーンへ送信**を押すと、
実際のトランザクションが送信される。UI の「照合」ボタンはデプロイ済み
コントラクトに対して実際に動く。

ヘッダーで日本語 / 英語を切り替えられる。停止は `./run.sh down`。
`RESUME=1 ./run.sh e2e` で fund/deploy を省略し既存のデプロイを再利用できる。

cmd.exe / PowerShell からは `run.bat <lane>` または `.\run.ps1 <lane>`。
Git Bash も WSL も不要な、Docker を直接叩くネイティブ移植版。

---

## テスト

```bash
./run.sh test_all     # 以下すべて
```

| レーン | 内容 |
|---|---|
| `./run.sh test` | SDK フリー 7 ワークスペースのユニットテスト 83 件 ＋ `tsc --noEmit` |
| `./run.sh test_sdk` | Midnight SDK ワークスペースの typecheck ＋ テスト |
| `./run.sh test_contract` | Compact 0.31.1 で `condition-registry` をコンパイルし、シミュレータで ZK 回路テスト 15 件 |
| `./run.sh db` | 実 libSQL サーバーコンテナに対する ingester の end-to-end |

回路テストは、3 バンドすべての正常系、境界値（60 / 59 / 40 / 39）、`entryKey` の
二重提出の拒否、`scoreCommitment` 改ざん（値・nonce 両方）の拒否、`recordedAt` が
当日窓の外にある場合の拒否をカバーする。読み取り側のテストは、各ロールのスコープを
**許可される方向と拒否される方向の両方**で検証している。

すべてのレーンは使い捨ての `node:22-bookworm` コンテナ内で走るので、Docker だけの
マシンで clone しても同じ結果が再現する。

---

## 構成

```
run.sh / run.ps1 / run.bat      Docker ワンコマンドハーネス
contracts/condition-registry/   Compact コントラクト: submitCondition ＋ witness ＋ 回路テスト
packages/shared/                commitment、バンド語彙、タイムゾーン計算、hex ユーティリティ
packages/db/                    SqlDatabase（libSQL、D1）、スキーマ、マイグレーション、サンプル fixture
packages/ingester-core/         純粋な取込ロジック: 型、タイムゾーン計算、plan、冪等性
packages/condition-read/        読み取り側: スコープ解決、band 履歴の組み立て
packages/midnight-chain/        Midnight SDK 層: ウォレット、provider、submit、deploy、チェーン読み取り
apps/ingester/                  ingester CLI ＋ 送信・照合の DB 側 — SDK フリー（boundary.test.ts が強制）
apps/gateway/                   認可付き read API ＋ ローカル Node サーバー（SPA も配信）
apps/development/condition-cli/ オンチェーン CLI: deploy / submit / reconcile / status / fund
apps/dashboard/public/          ビルド不要のフレームワークレス SPA
ops/local/                      libSQL / Midnight devnet の docker-compose
docs/ , docs/ja/                設計ドキュメント（英語・日本語）
```

**デュアル台帳の分離。** `privateScoreCenti` / `privateScoreNonce` は witness であり、
生スコアと nonce は Midnight の暗号化 private state に置かれ、DB には一切書かれない。
公開台帳が持つのは `entries: Map<Field, ConditionEntry>` とカウンタのみ。SDK に触れる
のは `packages/midnight-chain` だけで、`apps/ingester` と `apps/gateway` は SDK も
WASM も持たない。この境界はテストで強制している。

**ローカル複製と、正としてのチェーン。** 読み取り API は速度のために `submissions`
テーブルからバンドを返し、`reconcileSubmissions` が各エントリをチェーンから読み戻して
`chain_verified_at` を刻む。両者が食い違ったときは**チェーンを正**としてローカル行を
訂正する。データ管理画面の送信キューにある「ローカル記録を改ざんする」チェックボックスで
意図的に不一致を作れるので、検知の様子をその場で実演できる。

データモデル、回路仕様、信頼境界、プライバシー整理表などの詳細は
[worksite_condition_system.md](worksite_condition_system.md) に。

---

## 想定ユーザーと展開

**主な利用者:** 労働安全衛生法のもとで現場を運営する元請。健康情報はすでに集めて
いるが、**自社サーバーを監査させずに行政が受け入れる記録**を持っていない。

**導入経路。** 別会社の算出値は現在 DB テーブル、将来は HTTP ソース。差し替え点は
`ConditionSource` インターフェース 1 つに閉じている。現場はチェーン投入を確定する
前に取り込み・読み取り経路だけ先に導入し、後からチェーン提出を有効にできる —
どちらの経路も変更不要。（このハッカソン構成は常に実デプロイ済みコントラクトに
対して動く。上の「クイックスタート」の通り、ここで述べているのはアーキテクチャ上の
性質であって、この構成自体が持つモードではない。）スマートリングベンダーと
現場管理 SaaS が自然な流通経路で、
改ざん耐性のある記録は彼らが自前で作れない部分にあたる。

**建設以外への展開。** 「private なスコア、public なバンド、デバイス単位のソルト付き
キー」という形はそのまま、物流ドライバーの疲労管理、工場のシフト安全管理など、
**閾値の監査可能性は必要だが測定値そのものは公開できない**あらゆる領域に当てはまる。

## ロードマップ

| 段階 | 内容 |
|---|---|
| 現在 | コントラクト ＋ ZK テスト、ingester、ロール別読み取り API、ダッシュボード、ローカル devnet の E2E。コントラクトは Midnight preprod にデプロイ済み（[手順書](deploy_preprod.md)） |
| 次 | 手入力フィードを別会社 HTTP ソースに置換。DB に用意済みの `salt_epochs` を使った salt ローテーション |
| その次 | **別会社署名を回路内で検証** — 運用者を信頼ベースから外す。脅威モデルに残る唯一の穴を塞ぐ |
| 将来 | preprod のコントラクトを使ったホスト版デモ、作業員向けモバイルビュー、個人を開示せず現場単位の統計を ZK で証明 |

---

## 設定

[.env.example](../../.env.example) を `.env` にコピーする（git 管理外）。
`run.sh` はこのファイルが存在するかどうかしか見ず、`MIDNIGHT_NETWORK` /
`INGESTER_SALT_HEX` / `DEVELOPMENT_PRIVATE_STATE_PASSWORD` は開発用の既定値を
コンテナに渡すので、Docker ハーネスを使う限り編集は不要。`MIDNIGHT_GENESIS_SEED`
には既定値を渡す仕組みすら無く、未設定なら `packages/midnight-chain` 自体が
既知の devnet genesis seed にフォールバックする。`run.sh` を経由せず
`npm run condition:*` を Node ホストで直接実行する場合は `.env` の内容が実際に
読まれるので、`MIDNIGHT_NETWORK=local` を設定すること。

devnet レーンを使うと `.env` に運用ウォレットのニーモニックとデプロイ済み
コントラクトアドレスが書き足される。**バックアップを取り、絶対にコミットしない
こと。**

## ライセンス

Apache License 2.0 — [LICENSE](../../LICENSE) および [NOTICE](../../NOTICE) を参照。

[Midnight](https://midnight.network/) 上に構築。ローカル devnet の compose ファイルは
`midnightntwrk/midnight-local-dev` を元にしている。
