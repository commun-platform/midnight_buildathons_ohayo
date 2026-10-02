# OHAYO! — 次フェーズ設計

> 2026-09-30 に合意した設計。**フェーズごとに実装中（進捗は §11）。** フェーズ 6 が入った時点で、
> [`worksite_condition_system.md`](worksite_condition_system.md) と `AGENTS.md` の
> 「すべてローカルで動作する」という前提を置き換える。Cloudflare 側、ウォレットログイン、
> 審査用資料は **BACCHIRI** —
> <https://github.com/commun-platform/midnight_buildathons_bacchili> のコミット
> `562ad131767db99bcf0d2485d7d7edc3f0bd07bb` から移植する（§0.2）。
>
> [English](../next_phase_design.md)

---

## 0. 決定事項

| # | 機能 | 決定 |
|---|---|---|
| 1 | 相手側のダミーサーバー | `apps/partner-mock/` を新設。ストレージは独立、fetch 形のハンドラ（ローカルは Node、ホスト時は別 Worker） |
| 2 | ユーザー画面 → ダミーサーバー | ブラウザから partner へ**直接** POST する。OHAYO! はこの経路に入らない |
| 3 | 管理画面の「データ取得」ボタン | `POST /api/partner/pull` → 署名検証・冪等性を保って `condition_readings` に `pending` で投入 |
| 4 | コントラクトのデプロイと手順書 | Midnight **preprod** に開発ホストからデプロイ。手順書は `docs/deploy_preprod.md` |
| 5 | ウォレットログイン | Lace（DApp Connector 4.x の `signData`）。トークンログインは廃止 |
| 6 | workers.dev へのホスティング | Worker + **D1** + **Cloudflare Containers**（チェーン実行 + 証明サーバ）+ R2 + Cron |
| 7 | 管理者がその日働かせた理由 | `work_decisions` テーブル、**DB のみ**（追記のみ）。コントラクトは変更しない |
| 8 | 評価者の入場 | ホスト版に**ゲスト入場**（ウォレット不要のサンドボックス上の役）を追加。本物のログインはウォレットのまま |
| 9 | 公開検証ページ | `/verify`。ログイン不要で、エントリは DB ではなく必ずチェーンから読む |
| 10 | 選択的開示 | 作業員が自分の値の開示レシートを発行し、`/verify` でチェーン上のコミットメントと照合できる |
| 11 | 画面内のデモガイド | 自動でチェックが付く 5 ステップのチェックリスト |
| 12 | 審査期間中の運用 | Container は必要なときだけ起動し、使わないときは止める。請求を Workers Paid の月 5 ドルに収めるため（§9.10。2026-09-30 に常時稼働から変更） |

このフェーズでは `condition-registry` コントラクトを変更しない。

検討のうえ決着した事項（後のセッションで蒸し返さないために記録する）:

- **チェーンへの書き込みは Cloudflare Containers で行う。** ローカルのエージェント方式は
  採らない。開発ホストを止めてもデモが動く必要があるため。
- **DB は D1。** Turso は採らない。BACCHIRI と同じく 1 つの Cloudflare アカウント内で完結させる。
- **就業判断は DB のみに置く。** 改ざんを検知できないことは了承済み。
- **プロダクト名は OHAYO!**（2026-10-02 に SADAKO から変更）。コード、画面、ドキュメント、Cloudflare の
  リソース名は `ohayo` にした（Worker は `midnight-proof-ohayo` と `midnight-proof-ohayo-partner` で、
  URL は `midnight-proof-ohayo.commun-official.workers.dev`）。submitter 鍵の導出に使う 2 つの文字列だけは旧名のまま残す
  （`condition-registry.compact` の `"sadako:submitter:pk:"` と、`packages/midnight-chain/src/state.ts` の
  `'sadako:submitter:sk:v1'`）。変えるとコントラクトと導出される submitter 鍵が変わり、preprod の
  コントラクト（`1fca6b4c…`）はこの文字列でデプロイしているため。
- **トークンログインはウォレットログインに置き換える。** ゲスト入場（機能 8）は、
  Lace を持たない評価者がデモを一通り体験できるようにするためだけに設ける。

### 0.1 この設計書を起点に作業する

この設計書はセッション間の引き継ぎ資料を兼ねる。§11 の各フェーズは 1 セッションで終わる大きさにしてある。

1. 次の順に読む: この設計書 → [`worksite_condition_system.md`](worksite_condition_system.md)
   （現行仕様）→ `AGENTS.md` → `.claude/skills/ohayo-demo/SKILL.md`。
2. §11 で状態が `done` でない最初のフェーズを選び、§0.2 のうち必要な行だけを読む。
3. フェーズが終わったら §11 の状態を更新し、実装の結果この設計書と違った点を直す。

この設計が上書きする現行の規約と、上書きする時期:

| 規約（記載場所） | 変わる時期 |
|---|---|
| 「すべてローカルで動作し、クラウドのデプロイ先はない」（`AGENTS.md`、仕様書、`SKILL.md`） | フェーズ 6 — 完了 |
| 「libSQL のみ。D1 も Cloudflare も使わない」（`SKILL.md`） | フェーズ 0（D1 アダプタ — 完了、`SKILL.md` 更新済み）、フェーズ 6（ホスティング） |
| 「認証はトークンそのもの」（`AGENTS.md`、仕様書 §3、`SKILL.md`） | フェーズ 5 — 完了 |
| 「スキーマ変更は `0001_condition_schema.sql` に直接入れる」（`SKILL.md`） | フェーズ 6 — 完了: 最初のホスティング以降 `0001` は変更せず、以降の変更は番号付き migration（§4.3） |
| 2 回押しの照合（`SKILL.md`、仕様書 §7.4） | フェーズ 7（§9.8）。改ざんのチェックボックスはそのまま残す |

### 0.2 参照実装 — BACCHIRI

- リポジトリ: <https://github.com/commun-platform/midnight_buildathons_bacchili>
  （公開、Apache-2.0、「BACCHIRI!━━Verifiable Measurement Layer」、同じ組織）。
- 固定コミット: `562ad131767db99bcf0d2485d7d7edc3f0bd07bb`（2026-09-24）。下の表のパスは
  すべてこのコミットに存在する。
- このリポジトリの外に取得する（取り込まない）:

  ```bash
  git clone https://github.com/commun-platform/midnight_buildathons_bacchili.git ../midnight_buildathons_bacchili
  git -C ../midnight_buildathons_bacchili checkout 562ad131767db99bcf0d2485d7d7edc3f0bd07bb
  ```

  1 ファイルだけ読む場合:

  ```bash
  gh api "repos/commun-platform/midnight_buildathons_bacchili/contents/<path>?ref=562ad131767db99bcf0d2485d7d7edc3f0bd07bb" --jq .content | base64 -d
  ```

  ブラウザで見る場合: `https://github.com/commun-platform/midnight_buildathons_bacchili/blob/562ad131767db99bcf0d2485d7d7edc3f0bd07bb/<path>`。
- 移植したコードは Apache-2.0 の条件を引き継ぐ。OHAYO! の `NOTICE` に、BACCHIRI が
  出典であることを 1 行加える。
- BACCHIRI のコードにはコメントがあるが、OHAYO! はコメントを書かない（`AGENTS.md`）。移植時に削る。

| OHAYO! 側 | BACCHIRI のパス（固定コミット） | 取り込むもの | OHAYO! 向けの変更 |
|---|---|---|---|
| Worker の設定（§8.1） | `backend/cloudflare/deployment/wrangler.jsonc` | `containers`、`durable_objects.bindings`、`exports`、`d1_databases`（`migrations_dir` 含む）、`r2_buckets`、`triggers.crons`、`ratelimits`、`assets`（`binding`、`not_found_handling`、`run_worker_first`）、`compatibility_flags` | `queues`、managed source と MCP 関連のバインディングは削除。名前は `ohayo` / `ohayo-partner`。Container は `ChainRunnerContainer` と `ProofServerContainer` |
| secret のひな形 | `backend/cloudflare/deployment/.dev.vars.example` | 書き方 | OHAYO! の secret 名（§8.1） |
| 証明サーバの Container（§8.1） | `backend/cloudflare/proof-gateway-worker/src/index.ts` の `class ProofServerContainer`（86 行目） | 長い `portReadyTimeoutMS` を付けた `startAndWaitForPorts`、`allowedHosts: ['srs.midnight.network']`、`interceptHttps`、`SSL_CERT_FILE`、`entrypoint` | 名前以外は変更なし |
| チェーン実行の Container（§8.1、§8.2） | 同じファイルの `class ServerWalletContainer`（180 行目）と `walletRuntimeOutboundByHost`（500 行目: `proof.internal` → 証明サーバ、`state.internal` → R2 のチェックポイント） | `enableInternet` と `allowedHosts`（preprod の indexer / rpc）、`pingEndpoint`、安全な停止、2 つの内部向け通信先 | エンドポイントは sponsor 用ではなく `/health`、`/submit`、`/read`、`/open` |
| secret の受け渡し | `backend/cloudflare/proof-gateway-worker/src/wallet-runtime-secrets.ts` | seed を Container のプロセス環境変数にだけ渡す | `OPERATING_WALLET_SEED`、`INGESTER_SALT_HEX`、`DEVELOPMENT_PRIVATE_STATE_PASSWORD` |
| ウォレットのチェックポイント（§8.4） | Container 側: `backend/cloudflare/sponsor-wallet-container/src/checkpoint.ts`（seed を鍵にした `encryptCheckpoint` / `decryptCheckpoint`）、`checkpoint-restore.ts`、`checkpoint-upload.ts`、`checkpoint-cache.ts`。Worker 側: `backend/cloudflare/proof-gateway-worker/src/sponsor-checkpoint.ts`（R2 のキー、128 MiB の上限、復旧用コピー） | 仕組み全体 | R2 のキーは `ohayo-wallet/preprod/checkpoint.enc`。`packages/midnight-chain/src/wallet.ts` の `persistWalletState` につなぐ |
| ヘルスと同期の進捗（§8.2 `/health`） | `backend/cloudflare/sponsor-wallet-container/src/supervisor.ts`、`supervisor-health.ts`（`WalletPhase`、キャッシュしたヘルス）、`sync-progress.ts` | ウォレット SDK の子プロセスが同期している間も、キャッシュからヘルスを返す PID 1 のスーパーバイザ | 状態を `starting` / `syncing` / `ready` / `degraded` に対応させる |
| Container のプライベートステート（§8.4） | `backend/cloudflare/sponsor-wallet-container/src/in-memory-private-state-provider.ts` | そのまま | nonce は `/submit` の応答として外に出し、`opening_ciphertext` に保存する |
| Container イメージ | `backend/cloudflare/sponsor-wallet-container/Dockerfile` | `node:22.15.0-bookworm-slim`、ワークスペース単位の `npm ci`、prover key の存在チェック | `packages/{midnight-chain,shared,ingester-core,db,condition-read}` と、コンパイル済みの `src/managed/` を含む `contracts/condition-registry` をコピー |
| 1 回の Cron だけが Container を動かす | `backend/cloudflare/proof-gateway-worker/src/server-wallet-work.ts`（`acquireServerWalletWarmupLease`、`nextServerWalletWork`） | リースの仕組み | 処理対象は `condition_readings` の `queued` の行 |
| 運用プロファイル（§9.10） | `backend/cloudflare/proof-gateway-worker/src/sponsor-operating-window.ts`、`backend/cloudflare/d1-schema/migrations/0037_sponsor_wallet_on_demand.sql`、`docs/operations/sponsor_wallet_operating_hours.md` | Cron が読む D1 の 1 行、再起動のクールダウン | `always-on` / `on-demand` の 2 つだけ |
| D1 アダプタ（§8.4） | `backend/cloudflare/proof-gateway-worker/src/storage/d1.ts`（`D1SqlDatabase`）、`storage/sql.ts` | クラスの中身 | `packages/db/src/sql.ts` にある OHAYO! の `SqlDatabase` を実装する |
| ウォレットログイン、サーバ側（§6） | `backend/cloudflare/proof-gateway-worker/src/browser-wallet-signature.ts` | `data === canonical` を確認してから、`@noble/curves/secp256k1` と `@noble/hashes/sha256` で `schnorr.verify(signature, sha256(utf8(canonical)), verifyingKey)` | OHAYO! の署名メッセージ（§6） |
| ウォレットログイン、ブラウザ側（§6） | `frontend/verification-portal/src/midnight-device.ts` の `connectBrowserWallet`（173 行目）: `window.midnight` からの検出、`apiVersion` `4.x`、`connect(networkId)`、`getConnectionStatus`、`getConfiguration` でのネットワーク確認、`signData(message, { encoding: 'text', keyType: 'unshielded' })`。`wallet-compatibility.ts`（切断・エラーの分類） | 処理の流れ | `apps/dashboard/public/` にビルド不要の素の ES モジュールとして書き直す。shielded アドレスは不要 |
| partner の CORS（§2） | `backend/cloudflare/proof-gateway-worker/src/cors.ts` | プリフライト処理 | `PARTNER_ALLOWED_ORIGIN` だけを許可 |
| セキュリティヘッダ | `frontend/verification-portal/public/_headers` | CSP の書き方 | OHAYO! には `apps/dashboard/public/_headers` が既にある |
| partner mock の API（§2） | `docs/implementation/mock_measurement_source_api.md` | Bearer のテスト用トークン、決定的な応答、`GET /health` | カーソル方式の `daily-scores`、Ed25519 署名 |
| デプロイ手順書（§7） | `docs/operations/demo_runbook.md` | 順序: ウォレット → 入金 → デプロイ → `wrangler secret put` を標準入力で渡して secret を登録 | OHAYO! の `condition:*` スクリプト |
| 提出用資料（§9.11） | `docs/submission/README.md`、`evidence_matrix.md`、`judge_qa.md`、`one_page_brief.md`、`deliverables_plan.md`（評価基準） | 構成と書き方 | OHAYO! の主張 |
| 背景の理解用 | `docs/architecture/system_architecture.md`、`docs/implementation/fee_sponsorship.md`、`frontend/verification-portal/public/demo-mode.js` | — | OHAYO! には手数料スポンサーも `?demo=1` モードもない |

---

## 1. 目標構成

```
ブラウザ（フレームワークなしの SPA、Lace でログイン、またはゲスト入場）
   │  /api/*                                   │  POST /v1/measurements（ユーザー画面）
   ▼                                           ▼
Worker ohayo                                Worker ohayo-partner
 ├─ Static Assets  apps/dashboard/public      ├─ D1 ohayo-partner
 ├─ handleApi      （Node と同じコード）        └─ Ed25519 署名鍵（secret）
 ├─ D1 ohayo      roster / readings /             ▲
 │                 submissions / decisions /       │ GET /v1/daily-scores（API キー）
 │                 wallet bindings / guests        │
 ├─ Cron（1分）     キュー済みの値を処理 ────────────┘ （取得は管理者のボタン操作）
 ├─ ChainRunnerContainer   Node + @midnight-demo/midnight-chain
 │     seed / salt は secret から、ウォレット同期状態は R2
 │     └─▶ preprod の indexer / rpc
 └─ ProofServerContainer   midnightntwrk/proof-server:8.1.0
                                   │
                                   ▼
                     Midnight preprod: condition-registry
```

ローカルのレーンは残す。`run.sh e2e` は引き続き Node の gateway をローカル devnet に
つないで動かし、その横でローカルの partner mock も動かす。

**基本ルール: Worker のバンドルには Midnight の WASM を一切載せない。** 証明、
ウォレット同期、コミットメント計算は Container で行う。Worker が担当するのは、
認証、D1、読み取り経路（SHA-256 のみ）、partner からの取得、キューの管理。

---

## 2. パートナーのダミーサーバー — `apps/partner-mock/`

別会社の「リング → アプリ → サーバー」経路の代わり。0〜100 の算出はここが持ち、
OHAYO! は算出しない。

| メソッド / パス | 認証 | 内容 |
|---|---|---|
| `POST /v1/measurements` | なし（デモ用の簡略化） | `{ ringId, measuredAt, vitals }` または `{ ringId, measuredAt, score }` を受け取り、決定的な算出式（文書化する）でスコアを計算・保存し、`{ id, ringId, measuredAt, score }` を返す |
| `GET /v1/daily-scores?since=<cursor>` | `Bearer PARTNER_API_KEY` | `{ schemaVersion: 1, keyId, nextCursor, scores: [{ id, ringId, measuredAt, score, signature }] }`。古い順、ページサイズ上限あり |
| `POST /v1/simulate` | `Bearer PARTNER_API_KEY` | 指定したリング ID と日付のスコアを生成（デモ用のデータ投入） |
| `GET /health` | なし | `{ ok: true }` |

- **署名**: Ed25519（WebCrypto。Node 22 と Workers の両方で動く）で
  `ohayo-partner-score-v1\n{id}\n{ringId}\n{measuredAt}\n{score}` に署名する。
  OHAYO! は `PARTNER_PUBLIC_KEY` を持つ。これで仕様書の未解決事項「パートナー署名」を
  オフチェーンで解消する（回路での検証はまだしない）。
- **カーソル**は `measuredAt` ではなく partner 側の単調増加する受信連番にする。
  遅れて届いた計測値を取りこぼさないため。
- **CORS** は `PARTNER_ALLOWED_ORIGIN`（OHAYO! のオリジン）だけを許可する。
- **ストレージ**は OHAYO! とは別にする。ローカルは `data/partner-mock.db`、ホスト時は
  D1 `ohayo-partner`。どちらも既存の `SqlDatabase` インターフェース経由。

---

## 3. ユーザー画面 → partner

- ユーザーの今日（本人）画面に「リング同期」カードを追加する。スコア（0〜100）の入力欄と
  送信ボタンを置く（2026-09-30 決定: スコアは直接入力。partner の API はバイタルも受け付ける）。
- ブラウザから `partnerUrl` へ直接 POST する。生値が OHAYO! に届くのは管理者が取得した
  時点で、実際のデータ経路と同じになる。
- 変更点: `/api/me` に `ringId`（現在の `ring_worker_map`）を追加。`/api/config` に
  `partnerUrl` を追加。CSP の `connect-src` に partner のオリジンを追加（静的な
  `_headers` では分からないので、Worker が `PARTNER_URL` から付与する）。
- 送信後は「管理者の取得後に記録されます」と表示する。

フェーズ 2 での実装: ブラウザが使う partner の URL は `PUBLIC_PARTNER_URL`（未設定なら
`PARTNER_URL`）。gateway は Docker のネットワーク経由（`http://mn-condition-partner:8788`）で
partner に届くが、ブラウザには `http://localhost:8788` が必要なため。ヘッダは
`apps/gateway/src/security.ts` の `securityHeaders(partnerUrl)` が作る。partner がなければ
`_headers` と同じ内容で、あれば `connect-src` に partner のオリジンを加える。Node サーバは
これを静的ファイルの応答すべてに付け、Worker も同じ関数を使う。`ringId` は作業員の
`ring_worker_map` のうち終了していない行（未割り当てなら `null` で、カードは表示しない）。
partner の CORS は `PARTNER_ALLOWED_ORIGIN` だけを許可するので、ダッシュボードは
`127.0.0.1` ではなく `http://localhost:8787` で開く。

---

## 4. 管理者による取得と送信キュー

### 4.1 取得

`POST /api/partner/pull`（admin）は `apps/ingester/src/partner.ts` の
`pullPartnerScores` を呼ぶ（fetch ベース、SDK なし。`npm run ingest:pull` からも使える）。

1. 保存済みのカーソルから `daily-scores` を順にページ取得する。
2. 1 件ずつ、署名を検証 → `0 ≤ score ≤ 100` を確認 → リングが roster にあるかを確認する。
3. `condition_readings` に `source='partner_api'`、`status='pending'`、`external_id`、
   `partner_sig` で投入する。同じ `external_id` で内容も同じなら重複として扱う。
   内容が違えば**衝突**として扱い、上書きはしない。
4. ページを保存し終えてからカーソルを進める。

戻り値は `{ fetched, inserted, duplicates, conflicts, badSignature, invalid, unknownRing, cursor }`。

フェーズ 1 での実装（API と詳細は [`partner_mock_api.md`](partner_mock_api.md)）:
`invalid` は、署名は正しいが 0..100 の外にあるスコアの件数。`keyId` が固定した鍵と違う
場合や HTTP エラーの場合は、カーソルを進めずに取得全体を失敗させる。拒否したスコアも消費済み
としてカーソルを進める。ページごとの行とカーソルは 1 回のバッチで書く。カーソルは
`partner_sync` に持つ。

### 4.2 キューの UI

データ管理画面に、送信待ちの値の一覧（既存の `GET /api/staged`。現状は UI がない）と、
「チェーンへ送信」ボタン（`POST /api/staged/submit`）を追加する。

| status | 意味 |
|---|---|
| `pending` | 取得済み、送信はまだ依頼されていない |
| `queued` | 管理者が送信を押した。チェーン実行側の処理待ち |
| `submitted` | チェーンに記録済み。`submissions` の行も書き込み済み |
| `skipped` | 計画できなかった（`skip_reason`） |
| `failed` | チェーン実行側が断念した（`last_error`）。再度キューに入れられる |

Node（ローカル devnet）では今どおりプロセス内で送信する。ホスト時は、ボタンで行を
`queued` にして **202** を返し、Cron が処理する（§8.3）。

フェーズ 1 での実装: ボタンは `pending`、`queued`、`failed` の行をすべて送信し、
`recordOutcomes`（`apps/ingester/src/submit.ts`）が、同じ順序で返る `ReadingOutcome[]` から
行ごとの結果を書く。失敗しても一括送信は止めず、その行を `failed` にして `last_error` を残す。
`skip_reason` に `unknown_ring` と `invalid_value` を加えた。別会社の行は、管理者にはバンドだけを
見せる（`GET /api/staged` は `value: null` を返す）。2026-09-30 決定:
管理者の単発の送信フォーム（と `POST /api/submit`）は廃止し、スコアを入力するのは作業員だけにした。
改ざんデモのチェックボックスは「チェーンへ送信」の横に移した（`POST /api/staged/submit { tamper }`）。
今後もここに置く（§9.8）。手入力の行を扱う `POST /api/staged` と `PATCH /api/staged/:id` も
廃止したので、管理者が値を入力・編集する API はない。

### 4.3 スキーマの変更

ホスト用の D1 ができるまで（フェーズ 6 まで）は、`packages/db/migrations/0001_condition_schema.sql`
を直接編集する（`.claude/skills/ohayo-demo/SKILL.md` にある現行の規約）。D1 にデータが
入った後の変更は、番号付きの新しい migration ファイルにする。直接の編集はフェーズ 6（キューの列と
`chain_jobs`、§8.6）が最後。

- `condition_readings`: `external_id TEXT UNIQUE`、`partner_sig TEXT`、`last_error TEXT` を追加し、
  `status` に `queued` / `failed` を追加。
- `partner_sync (source TEXT PRIMARY KEY, cursor TEXT, synced_at TEXT)`。
- `submissions`: `opening_ciphertext TEXT`（§8.4）。
- §5、§6、§9.4 のテーブル。

---

## 5. 就業判断（管理者の理由記載）

```
work_decisions (
  id             TEXT PRIMARY KEY,
  worker_id      TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  entry_key      TEXT,
  band           TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('worked', 'light_duty', 'rested')),
  reason         TEXT NOT NULL,
  decided_by     TEXT NOT NULL,
  decided_at     TEXT NOT NULL,
  supersedes_id  TEXT
)
```

- **追記のみ。** API は `POST` だけで、訂正は `supersedes_id` を持つ新しい行として追加する。
  現在の判断は、置き換えられていない最新の行。書き込みのたびに `audit_log` にも記録する。
- その日のバンドが `caution` / `danger` で、判断が `worked` / `light_duty` の場合は
  理由を**必須**にする。それ以外は任意。`band` と `entry_key` には、管理者が判断した
  時点の状態を残す。
- API: `GET /api/decisions?workerId=&from=&to=`（admin。worker は自分の分だけ）、
  `POST /api/decisions`（admin）。
- UI: 管理者の今日画面で、要注意・危険の日のカードに「判断未記入」を表示 → ダイアログで
  判断と理由を入力。一覧画面と CSV に判断の列を追加。ユーザー本人の画面では判断と理由を
  読み取り専用で表示する。
- **保証しないこと:** 運用者は DB を直接書き換えられるので、判断の記録は改ざんを検知
  できない。コミットメントをチェーンに刻む案は今後の課題として残す（仕様書 §11 に追記する）。

---

## 6. ウォレットログイン（トークンログインを置き換える）

BACCHIRI が preprod 上で動かしている方式と同じ（§0.2 の `browser-wallet-signature.ts` と
`midnight-device.ts`）。

```
SPA                                    Worker
 │ window.midnight[*] のうち apiVersion 4.x
 │ connect(walletNetworkId)
 │── POST /api/auth/challenge {inviteCode?} ──▶ {id, message, 有効期限5分} を保存
 │◀─ { challengeId, message } ──────────────────
 │ signData(message, { encoding: 'text', keyType: 'unshielded' })
 │── POST /api/auth/verify {challengeId, data, signature, verifyingKey} ──▶
 │                          一度限り・期限内・data === message、
 │                          schnorr.verify(signature, sha256(message), verifyingKey)
 │                          keyHash = sha256(verifyingKey) → ロール
 │◀─ { session, role, workerId } ────────────────
```

- **メッセージ**: `OHAYO-LOGIN-V1\n{origin}\n{challengeId}\n{nonce}\n{issuedAt}`。
  招待コードを使うときは `invite:{code}` を加える。
- **検証**には `@noble/curves` を使う（ペイロードの SHA-256 に対する secp256k1 BIP-340）。
  WASM 不要で Worker 上で動く。署名に資金は要らない。
- **ロール**: `keyHash ∈ ADMIN_WALLET_KEY_HASHES`（secret）なら admin。`wallet_bindings`
  に行があればその worker。どちらでもなければ 403 `unregistered` を返し、admin を
  初期登録できるように key hash を表示する。
- **worker の紐付け**: 管理者が worker ごとに一度限りの招待コードを発行する（表示は
  一度だけ、ハッシュで保存、有効期限あり）。worker がウォレットを接続すると、署名される
  メッセージに招待コードが含まれ、紐付けが作られる。
- **セッション**: `v1.<payload>.<HMAC-SHA256>`。中身は `{ sub: keyHash, role, workerId, exp }`
  で、`SESSION_SECRET` で署名する。有効期間は 12 時間。今と同じく `Bearer` で送る。
  `apps/gateway/src/auth.ts` の `authenticate()` は、MAC、有効期限、紐付けが取り消されて
  いないことを確認する。
- **廃止するもの**: `ADMIN_TOKEN` と worker-id トークン。README、デモ用スキル、
  仕様書 §3 を更新する。ウォレットを持たない評価者はゲスト入場（§9.4）を使う。
  ゲスト入場はサンドボックス用のセッションしか発行せず、`GUEST_ENTRY=1` のときだけ有効になる。
- **ローカル**: `GUEST_ENTRY=1` でなければ `run.sh e2e` でも Lace が必要になる。ログインは
  ネットワークに依存しないので、Lace を preprod に接続したままでも、ローカル devnet に送信する
  ダッシュボードにログインできる。テストは `@noble/curves` で生成した鍵で署名する。

```
wallet_bindings (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, worker_id TEXT NOT NULL,
                 created_at TEXT NOT NULL, revoked_at TEXT)
                 -- revoked_at IS NULL の行の中で key_hash と worker_id はそれぞれ一意
worker_invites  (code_hash TEXT PRIMARY KEY, worker_id TEXT NOT NULL,
                 expires_at TEXT NOT NULL, used_at TEXT, created_by TEXT NOT NULL)
auth_challenges (id TEXT PRIMARY KEY, message TEXT NOT NULL, invite_hash TEXT,
                 expires_at TEXT NOT NULL, used_at TEXT)
```

フェーズ 5 での実装（`apps/gateway/src/{login,auth,session,wallet-signature}.ts`）:

- メッセージには招待コードそのものではなく `invite:<コードの sha256>` を入れる。チャレンジと
  一緒に平文のコードを保存しないため（`auth_challenges.invite_hash`）。
- `wallet_bindings` は独自の id と部分一意インデックスを持つ。解除した紐付けの後に、同じ
  ウォレットや作業員を新しく紐付け直せる。
- 鍵ハッシュは verifyingKey の文字列の SHA-256（BACCHIRI の `walletKeySha256` と同じ）。
  SHA-256 は WebCrypto で計算し、追加した依存は `@noble/curves` 1.9.7 だけ（ルートに既にあった）。
- 署名されるバイト列は `midnight_signed_message:<バイト長>:` + メッセージ。DApp Connector の
  仕様でこの接頭辞は必須（MUST）で、Lace は lace-extension 2.4.0（2026-09-23、`sign-message-prefix.ts`）
  から付けている。BACCHIRI の固定コミットの検証はそれより前のもので、接頭辞なしのメッセージを
  検証するため、今の Lace の署名とは一致しない。
- チャレンジは署名を検証する前に使用済みにする。失敗した試行を同じチャレンジでやり直せない。
- セッションは状態を持たない。`authenticate()` が毎回、管理者の鍵の一覧と作業員の紐付けを
  確認し直すので、ウォレット連携を解除するとそのセッションは使えなくなる。
- `run.sh e2e` はローカル用の `SESSION_SECRET` を `.state/gateway/session-secret` に作り、
  ゲスト入場を有効にする（Lace を必須にするなら `GUEST_ENTRY=0`）。未登録のウォレットで初めて
  Lace ログインすると、`ADMIN_WALLET_KEY_HASHES` に設定する鍵ハッシュが表示される。
- `/api/auth/*` のレート制限は Workers の `ratelimits` バインディングに任せる（フェーズ 6）。

---

## 7. preprod へのデプロイと手順書

デプロイは Cloudflare からではなく開発ホストから行う。BACCHIRI の
`docs/operations/demo_runbook.md` と同じ分担。`docs/deploy_preprod.md`（と `docs/ja/`）に書く内容:

1. `.env.preprod`（`run.sh e2e` が devnet 用のウォレットを書き込む `.env` とは別）に、
   private state のパスワードと `INGESTER_SALT_HEX` を書く。レーンは `DEVELOPMENT_ENV_FILE` で
   CLI にこのファイルを読ませ、証明サーバのコンテナも自分で起動する。
2. `run.sh deploy_preprod wallet` → アドレスを確認。ニーモニックは `.env.preprod` に書き込まれる。
3. preprod の faucet から tNIGHT を入金。
4. `run.sh deploy_preprod funding` → tNIGHT が届くのを待つ。
5. `run.sh deploy_preprod deploy` → DUST ウォレットの同期、NIGHT の登録、DUST、証明、デプロイ →
   `CONDITION_REGISTRY_CONTRACT_ADDRESS` を得る。2026-09-30 に新しいウォレットで約 70 分かかり、
   そのうち約 65 分が DUST ウォレットの同期だった。
6. `run.sh deploy_preprod status` → 確認。
7. `run.sh cloudflare deploy` で Cloudflare に引き継ぐ（[`deploy_cloudflare.md`](deploy_cloudflare.md)）:
   Alchemy のスタックが `.env.preprod` からニーモニック（→ Worker のシークレット
   `OPERATING_WALLET_MNEMONIC`）、salt、プライベートステートのパスワード、コントラクトのアドレスを読むので、
   画面に出したり手で入力したりしない。
   **これ以降、このウォレットは Container だけが使う。** submitter の鍵は seed から作られる
   （`packages/midnight-chain/src/state.ts` の `submitterSecretKeyHex`）ので、2 つのホストから
   同時に使うと DUST が競合する。
8. ショーケース用の履歴を投入する（§9.7）。
9. コントラクトの差し替え: 新しいアドレスは新しいレジストリになる。既存の行は元の
   `deployment_id` を保持し、salt は変えない。

フェーズ 4 で実装済み: ホストに Node がなくても実行できる `run.sh deploy_preprod` レーン（と `run.ps1`）を追加し、コントラクトは preprod の `1fca6b4cec100a425db72d769d1ef19f673de7552b4c9196611797f6b565e7ed` にある（詳細は [`deploy_preprod.md`](deploy_preprod.md)）。

---

## 8. Cloudflare へのホスティング

### 8.1 リソース

| リソース | 役割 |
|---|---|
| Worker `midnight-proof-ohayo` | `worker.ts`: `handleApi(request, deps) ?? env.ASSETS.fetch(request)`。Cron と Container クラスもここ |
| D1 `ohayo` | `packages/db/migrations` をデプロイ時に適用（実装では Alchemy のスタックが行う、§8.6） |
| `ChainRunnerContainer` | `@midnight-demo/midnight-chain` を載せた Node イメージ。外向き通信は preprod の indexer / rpc と、Worker 経由の内部ホストだけ。審査期間外の `sleepAfter` は 10 分 |
| `ProofServerContainer` | 公式の `proof-server:8.1.0` イメージ。起動するたびに `srs.midnight.network` から証明パラメータを取得する。審査期間外の `sleepAfter` は 2 分 |
| R2 `ohayo-wallet-state` | 暗号化したウォレット同期状態（再起動時の復元用） |
| Worker `midnight-proof-ohayo-partner` + D1 `ohayo-partner` | partner mock |
| Secrets | `OPERATING_WALLET_SEED`、`INGESTER_SALT_HEX`、`DEVELOPMENT_PRIVATE_STATE_PASSWORD`、`SESSION_SECRET`、`OPENING_KEY`、`ADMIN_WALLET_KEY_HASHES`、`PARTNER_API_KEY`、`PARTNER_PUBLIC_KEY`（と partner の署名鍵）。実装では seed の代わりに `OPERATING_WALLET_MNEMONIC`、`OPENING_KEY` はフェーズ 7 に回す（§8.6） |

Cloudflare Containers の利用には Workers Paid プランが必要で、Container の稼働中は
稼働時間に応じて課金される（§9.10）。

### 8.2 Container の API（Durable Object のバインディング経由でのみ到達可能）

| エンドポイント | 内容 |
|---|---|
| `GET /health` | `starting` / `syncing`（進捗付き）/ `ready` / `degraded`、使える DUST |
| `POST /submit` | `{ readings: [{ readingId, ringId, recordedAt, value }] }` → `submitReadings`（§8.4）の `ReadingOutcome[]`。`readings` と同じ順序で、`submitted`（`PlannedSubmission` — `entryKey`、`periodStartMs`、`recordedAtMs`、`band`、`scoreCommitmentHex`、`nonceHex` — と `txId`、`txHash`、`blockHeight`、`recovered`）、`skipped`（`SkipReason`）、`failed`（`error`）のいずれか |
| `POST /read` | `{ entryKeys }` → チェーン上のエントリ。必要なのは indexer とコンパイル済みコントラクトだけで、ウォレットの同期は**不要**。そのため、ウォレット同期中でも検証は動く |
| `POST /open` | `{ scoreCenti, nonceHex }` → `scoreCommitmentHex`。開示レシートの照合に使う（§9.6） |

### 8.3 キュー

Cron が毎分 `queued` の値を拾う。`/health` が `ready` でなければキューに残したままにし、
UI に「ウォレット同期中」と表示する。`ready` なら件数を区切って `/submit` に渡し、
Worker が `submissions` の行を書き込む。コントラクトの `assert(!entries.member(key))` が
あるので、再試行しても安全。BACCHIRI はさらに Cloudflare Queues + DLQ を使っている
（`wrangler.jsonc` の `queues`）。OHAYO! では量が増えたら後から追加する。

### 8.4 必要になるリファクタ

最初の 3 項目はフェーズ 0 で実装済みで、以下は実装後の状態を書いている。

- **WASM の分離**（完了）: `conditionScoreCommitment`（`persistentCommit`）は
  `packages/shared/src/commitment.ts` に置き、`@midnight-demo/shared/commitment` としてだけ
  公開する。ルートの公開分（バンド、期間、`conditionEntryKey`（WebCrypto）、hex）は Worker から
  読み込める。これを読み込むのは `ingester-core` の `plan.ts`（計画はチェーンを動かす側で行う:
  Node ではプロセス内、ホスト時は Container）とコントラクトのテストだけ。
  `apps/gateway/src/boundary.test.ts` が Worker 向けのモジュール（`routes.ts`、`deps.ts`、
  `apps/ingester/src/{store,submit,reconcile}.ts`、`condition-read`、
  `packages/db/src/{d1,migrate}.ts`）から値の import をたどり（型だけの import は除く）、
  `@midnight-ntwrk/*`、`midnight-chain`、コントラクトのパッケージ、`shared/commitment`、
  `@libsql/*`、`@polkadot/*`、`dotenv`、`node:*` のどれかに届いたら失敗する。`plan.ts` を
  起点にすると検出されることも別のテストで確かめている。
- **チェーン操作と DB の分離**（完了）: `packages/midnight-chain` は `@midnight-demo/db` に
  依存しなくなった。`submitReading` / `submitStagedFeed` / `reconcileSubmissions` から書き込みを
  抜いてそこに残すのではなく、`packages/ingester-core/src/types.ts` の `ConditionChain` を実装する
  `conditionChain(network, address)` を 1 つだけ公開する:
  - `submitReadings({ readings, roster, submittedEntryKeys, salt })` は値ごとに計画し、計画できる
    ものがあるときだけウォレットを開き、証明・送信して、値ごとの `ReadingOutcome` を同じ順序で返す:
    `submitted`（`nonceHex` を含む `PlannedSubmission`、tx、コントラクトが「記録済み」と返したので
    チェーンから読み戻した場合は `recovered: true`）、`skipped`（`SkipReason`）、`failed`（`error`）。
    1 件が失敗しても残りは止めない。DB 側は成功分を記録してから最初の失敗を投げる。
  - `readEntries(entryKeys)` → `Map<entryKey, OnChainEntry>`（`reader.ts` の
    `readConditionEntries`）。1 回の呼び出しで indexer への問い合わせは 1 回。

  DB 側は `apps/ingester/src/` の SDK なしのコード: `store.ts`（行の読み書き）、`submit.ts`
  （改ざんオプション付きの `submitStagedFeed`、`recordOutcomes`）、`reconcile.ts`（`reconcileSubmissions`。§9.8 までは `phased` のまま）。
  どの `ConditionChain` でも動き、偽のチェーンを使ってオフラインでテストしている（`submit.test.ts`）。
  `apps/gateway/src/server.ts` はプロセス内のチェーンを、変更していない `GatewayDeps.submit /
  reconcile / submitStaged` の差し替え口につなぐ。Worker では Container 経由の `ConditionChain`
  （`/submit` → `submitReadings`、`/read` → `readEntries`）を同じ差し替え口につなぎ、Cron からは
  `recordOutcomes` を呼ぶ。CLI の照合も同じポートを通る。
- **D1 アダプタ**（完了）: `SqlDatabase.kind` は `'libsql' | 'd1'`。`d1Database(env.DB)`
  （`@midnight-demo/db/d1`。libSQL を含まない `./sql`、`./migrate` も公開）は BACCHIRI の
  `D1SqlDatabase`（`backend/cloudflare/proof-gateway-worker/src/storage/d1.ts`）を、構造的な
  `D1DatabaseLike` 型に対して移植したもので、まだ `@cloudflare/workers-types` には依存しない。
  libSQL を裏に持つ偽のバインディングでテストしている（`d1.test.ts`）。
- **プライベートステート**: Container のプライベートステートはメモリ上に置く（BACCHIRI の
  `in-memory-private-state-provider.ts`）ので消える。そのため `/submit` が返すコミットメントの
  開示材料（`nonce`）を `submissions.opening_ciphertext` に保存する（`OPENING_KEY` による AES-GCM）。
- **ウォレット同期状態**: BACCHIRI の `checkpoint.ts`、`checkpoint-restore.ts`、
  `checkpoint-upload.ts`、`checkpoint-cache.ts` と、Worker 側の `sponsor-checkpoint.ts` を、
  同期停止からの復旧処理も含めて移植する。同期完了時と送信のたびに保存する。

### 8.5 BACCHIRI との違い

| | BACCHIRI | OHAYO! |
|---|---|---|
| tx を作る主体 | 端末が tx を作り、サーバのウォレットは DUST だけ追加（手数料スポンサー、`docs/implementation/fee_sponsorship.md`） | 運用ウォレットが submitter なので、Container が計画・証明・送信まで行う |
| ジョブの受け渡し | Queues + DLQ + Cron | D1 の `status` 列と Cron |
| フロントエンド | Vite でビルドし midnight-js を同梱（`frontend/verification-portal/vite.config.ts`） | ビルドなし。SPA は `connect` / `signData` を呼ぶだけ |
| Container | 証明サーバ + サーバウォレット（`standard-2` + `standard-4`） | 証明サーバ + チェーン実行。サイズは実測して決める（§9.10） |

### 8.6 フェーズ 6 での実装

- **コードの置き場所。** Worker は `apps/gateway/src/worker.ts` ではなく独立したワークスペース
  `apps/worker/`（`worker.ts`、`containers.ts`、`deps.ts`、`checkpoint-store.ts`、Alchemy のスタック `alchemy.run.ts`）にした。
  `@cloudflare/containers`、Alchemy、Workers の型が必要で、Node の gateway に持たせたくないため。
  `handleApi` と、Worker で動く gateway のモジュール（`@midnight-demo/gateway/{auth,chain-deps,deps,security}`）を
  そのまま使う。コンテナイメージは `apps/chain-runner/`（`Dockerfile`、fetch 形式の `handler.ts`、
  `server.ts`、`jobs.ts`、`checkpoint.ts`）。パートナーモックの Worker の入口は
  `apps/partner-mock/src/worker.ts` で、同じスタックで宣言する。
  `apps/gateway/src/boundary.test.ts` は両方の Worker の入口からたどる。
- **コンテナの API**（§8.2 の実装）: `GET /health`（`{ running, stage }`）、
  `POST /jobs { jobId, request }` → 202（別のジョブの実行中は 409。同じ `jobId` は `exists` として受け付ける）、
  `GET /jobs/:id` → `RunnerJob`（`running` と段階 / `done` と `ReadingOutcome[]` / `failed` とエラー / `unknown`）、
  `POST /read { entryKeys }`。要求に salt（`saltHex`）、ロスター、送信済みの entryKey を含めるので、
  コンテナは salt のシークレットも DB も持たない。`/open` はレシートと一緒にフェーズ 7 に回す。
- **キュー**（§8.3 の実装）: ホスティング時は、管理者の送信は `enqueueReadings`
  （`apps/ingester/src/queue.ts`）で行を `queued` にする（`queued_by`、`queued_at`、`queued_tamper`）
  だけ。`/api/config` は `submitQueued` を返す。1 分ごとの Cron は `drainQueue` を実行する。
  実行中のジョブも処理待ちの行もなければ、コンテナに触れずに終わる。あれば `chain_jobs` に行を
  入れ（部分一意インデックスで `running` は 1 行だけなので、重なった Cron は直列になる）、最大 10 件を
  送り、次の回以降でジョブを確認し、`recordOutcomes`（行ごとの送信者と改ざん）の後、改ざんしていない
  エントリを `/read` で照合する。コンテナが知らないジョブ、受け付けられなかったジョブ、90 分を超えた
  ジョブは `lost` にして行は処理待ちのまま残す。失敗したジョブはその行をエラー付きで `failed` にする。
  ゲストの処理待ちの行は送信上限に数える。送信キューの一覧は最新のジョブを返し、画面はその段階を表示して、
  処理が残っている間は 15 秒ごとに更新する。ローカルの Node の gateway は同期的な送信のまま。
- **プライベートステートと開示材料**: コンテナは LevelDB のプライベートステートを一時ディスクに置く。
  `submissions.opening_ciphertext`（`OPENING_KEY`）は、それを必要とするレシートと一緒にフェーズ 7 に回す。
  それまでホスティング時のエントリの nonce は保存されない。
- **ウォレットのチェックポイント**: BACCHIRI の仕組みを丸ごとは移植していない。コンテナは（Node と同じく）
  ジョブごとにウォレットを作り直すので、チェックポイントはウォレット同期の 3 ファイルを、シードから導いた鍵の
  AES-256-GCM で封をしたもの（`apps/chain-runner/src/checkpoint.ts`）。ジョブの開始時にローカルになければ
  `state.internal` 経由で R2 から戻し、ジョブのたびに保存する（1 つ前は `checkpoint.previous.enc` に残す）。
  定期的なアップロードと同期停止からの復旧はない。止まったジョブは 90 分のタイムアウトで再試行になる。
  最初のチェックポイントは開発機で preprod デプロイ時の同期済み状態から作る（`run.sh cloudflare checkpoint`）。
  これで 1 時間かかる最初の同期を省く。
- **シークレット**: ニーモニックは導出した `OPERATING_WALLET_SEED` ではなく `OPERATING_WALLET_MNEMONIC`
  として渡す（コンテナには `DEVELOPMENT_WALLET_MNEMONIC` として渡るので `getOrCreateWalletCredentials`
  はそのまま動く）。引き継ぎでシードを導出したり表示したりしない。ホスティング用のパートナーの鍵は
  ローカル開発用とは別に作る。`/api/auth/*` はクライアント IP ごとに 1 分 20 回まで（`AUTH_RATE_LIMITER`）。
- **最初のホスティングでの実行（2026-10-03）**: チェーン操作用コンテナが、どのジョブでも開始から約 2.5 分で
  終了コード 1 で終わった。原因は、`createSubmissionService` がウォレットの作成時に `@polkadot` の RPC に
  接続し、CPU を使い切る差分の同期（1/2 vCPU で 99 %）がイベントループを止めたため、RPC の 60 秒の待ち時間切れが
  どこでも捕まえられない場所でエラーになったこと。修正: RPC には最初の送信時に接続し、待ち時間は 5 分にした
  （`packages/midnight-chain/src/submission.ts`）。捕まえていないエラーは、プロセスを落とさずにジョブの失敗に
  する（`jobs.abort`）。実測ではメモリは約 600 MB、CPU は張り付いていたので、チェーン操作用コンテナはカスタムの
  1 vCPU・3 GiB にした（CPU は 2 倍、課金されるメモリは `standard-1` より 1/4 少ない）。証明サーバーは
  `standard-1` のまま。どちらも終了コードと理由（`container_stopped`）を記録し、コンテナのログを送る。その後、
  ゲストの値はコンテナが止まった状態から 3 分以内に記録された。以前の落ちた試行が既にトランザクションを
  記録していたため、チェーンから読み戻した扱い（`tx_id` が `backfilled`）になった。
- **パートナー**: workers.dev の Worker は別の Worker を URL で呼べないので、`midnight-proof-ohayo` はサービスバインディング
  （`PARTNER`）で `midnight-proof-ohayo-partner` を呼ぶ。ブラウザは直接送る。CSP の `connect-src` にパートナーのオリジンを
  入れるため、Worker がすべてのアセットにセキュリティヘッダを付ける（`run_worker_first: true`）。
- **IaC**（2026-10-01 に決定。最初の `wrangler.jsonc` と wrangler の手順を並べたコマンドを置き換えた）:
  Cloudflare 上のものはすべて 1 つの Alchemy v2 のスタック `apps/worker/alchemy.run.ts` で宣言する
  （`alchemy` 2.0.0-beta.79 と `effect` 4.0.0-rc.117。rc.118 は beta.79 が読み込むモジュールの場所を
  変えたため、バージョンを固定し、ルートの `overrides` でもそろえる）。2 つの D1 とマイグレーション、
  R2 バケット（`forceDestroy`）、2 つの Worker のバインディング・シークレット・Cron、レート制限、2 つの
  コンテナを含む。チェーン操作用コンテナのイメージは Alchemy が `apps/chain-runner/Dockerfile` からビルドし、
  証明サーバーのイメージを取り込み直し、Durable Object のクラスとつなぐ。Terraform は Cloudflare
  プロバイダがコンテナイメージをビルド・アップロードできず、Durable Object の migration に未解決の不具合が
  あるため見送った。新しい `cf` CLI（2026-09-28 からベータ）はまだシークレットを設定できず、削除の仕組みもない。
  `run.sh cloudflare [check|plan|deploy|checkpoint|status|tail|destroy|all]`（と `run.ps1`）がスタックを
  Docker の中で実行し、イメージのビルドにはホストの Docker ソケットを使う。認証情報は `.env.cloudflare`
  （API トークン、アカウント ID、workers.dev のサブドメイン）、シークレットは `.env.preprod` と生成した
  `.state/cloudflare/secrets.env` から読む。スタックの状態は `.state/cloudflare/.alchemy/` にあり、
  `.env.preprod` と同じくシークレットの値を平文で持つ。`destroy` は確認を求めてから `alchemy destroy` を
  実行し、残ったコンテナイメージも消す。wrangler はチェックポイントのアップロード、`tail`、このイメージの
  削除にだけ使う。手順書: [`deploy_cloudflare.md`](deploy_cloudflare.md)。

---

## 9. 評価者の体験

### 9.0 評価のされ方

BACCHIRI の `docs/submission/deliverables_plan.md` では、Midnight Buildathon の評価基準を
次のように整理している。使う前に公式のルールと照合すること。

| 観点 | 配点 | デモで見せるべきこと |
|---|---:|---|
| Engineering & Implementation | 40% | 本物の ZK 証明と tx。プライバシー境界が実際に守られていること |
| Quality Assurance & Reliability | 15% | 改ざんの拒否、再現できるテスト、落ちないデモ |
| Product & Vision | 15% | 課題と、誰が何を得るか |
| User Experience & Design | 15% | 迷わない導線、状態の見える化 |
| Communication | 10% | 主張と証拠の対応 |
| Business Development & Viability | 5% | 導入の筋道 |

### 9.1 原則

1. **空の画面を見せない。** 審査が始まる前に、preprod にショーケース用の履歴を入れておく（§9.7）。
2. **1 操作で 1 つの確信を与える。** 各ステップで 1 つの主張を証明し、その主張を横に書いておく。
3. **待ち時間は隠さずに埋める。** tx は `queued → proving → submitted → confirmed` の進行を
   経過時間と explorer リンク付きで表示する。待っている間は、台帳に何が載り何が載らないかを見せる。
4. **主張の横に証拠を置く。** 各ステップに、ソース・テスト・tx へのリンクを付ける。
   `docs/submission/evidence_matrix.md` は同じ内容を表にしたもの。
5. **評価者同士が干渉しない。** ゲストごとに新しい作業員とリングを発行する。コントラクトは
   同じ「リング・日」の記録を二重に受け付けないので、こうしないと 2 人目の評価者の送信が拒否される。
6. **何かが落ちても評価できる。** 動画、README の日付付き tx 証拠、ローカルでの再現手順は、
   ホスト版に依存しない。
7. **限界を正直に書く。** `docs/submission/judge_qa.md` に「証明しないこと」を明記する。

### 9.2 評価経路

| 経路 | 所要 | 必要なもの | 見せるもの |
|---|---|---|---|
| README と動画 | 3 分 | なし | 全体のストーリーと核心の 3 点 |
| ホスト版 | 5 分 | ブラウザ | ゴールデンパス（§9.3） |
| リポジトリ審査 | 15 分 | Docker | `run.sh test_all`、Evidence Matrix、Judge Q&A |
| ローカル再現 | 20 分 | Docker | `GUEST_ENTRY=1` での `run.sh e2e` |

核心の 3 点: 生値を見られるのは本人だけ。チェーンにはバンドしか載らない。運用者の DB を
書き換えても、チェーンで検知できる。

### 9.3 ゴールデンパス

| # | 役 | 操作 | 評価者が得る確信 |
|---|---|---|---|
| 1 | 作業員 | リング同期 → 自分のスコアが見える | 生値を見られるのは本人とパートナーだけ |
| 2 | 管理者 | パートナーから取得 → バンドだけ表示される（数値なし）→ 危険の人に就業判断を記入 | 管理者でも生値は見えない。判断が記録に残る |
| 3 | 管理者 | 送信 → 進行表示 → explorer リンク | 本物の Midnight tx と ZK 証明 |
| 4 | 第三者（ログイン不要） | `/verify` に entryKey か tx を貼る → バンド・コミットメント・ブロックだけが見える。続けて作業員の開示レシートを貼る →「一致」 | チェーンだけでは誰のことか分からず値も分からないが、本人は自分の値を証明できる |
| 5 | 管理者 | ローカル記録を改ざん → 照合 → 不一致を検知し、チェーンの値で復元 | 署名付き DB では得られない改ざん耐性 |

ステップ 2、4、5 はショーケースの履歴を使うので、ステップ 3 の完了を待たない。

### 9.4 ゲスト入場

- `POST /api/auth/guest` は `GUEST_ENTRY=1` のときだけ有効（ホスト版では有効、ローカルでは任意）。
  ゲスト（`guest-<8桁の16進>`）を作り、そのゲスト用に新しい作業員とリングを割り当てて、
  2 時間有効のセッション `{ sub: 'guest:<id>', role, workerId, guest: true }` を返す。
- `POST /api/auth/guest/persona { role }` で、管理者またはそのゲストの作業員としてセッションを
  発行し直す。ヘッダーには今の役と「サンドボックス — 本番のログインはウォレット」の表示を出す。
- ゲストの管理者はデモサイト全体を見られるが、変更できるのは自分の作業員とリング、判断の記録、
  行の改ざんと照合だけ（改ざんした行は照合で元に戻る）。ショーケースの行は削除できない。
- 上限: ゲスト 1 人あたりのチェーン送信は 3 回まで、加えて全体で 1 時間あたりの上限を設ける
  （D1 のカウンタ）。`/api/auth/*` には Workers のレート制限をかける（BACCHIRI の
  `wrangler.jsonc` の `ratelimits`。実装ではクライアント IP ごとに 1 分 20 回、§8.6）。
- 毎晩 D1 をショーケースのスナップショットに戻す。ゲストがチェーンに記録したエントリは残るが、
  仮名なので害はない。

```
guest_sessions (id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, ring_id TEXT NOT NULL,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL)
```

フェーズ 5 での実装: ゲストは作業員の役で始まる。ゲストの管理者はロスターを一切変更できず
（ゲストの作業員とリングは入場時に作る）、削除と送信は自分のリングの値だけ、判断の記録と照合は
どこでもできる。送信回数はカウンタ列ではなく `submissions.submitted_by`（`guest:<id>`）から数える。
ゲストあたり `GUEST_SUBMISSION_LIMIT`（既定 3）、全ゲスト合計で 1 時間あたり
`GUEST_HOURLY_LIMIT`（既定 30）。送信のときは残りの回数を `limit` として渡し、使い切ると 429 を返す。

### 9.5 公開検証ページ — `/verify`

- ログイン不要。`GET /api/public/entry?entryKey=` または `?tx=`（tx ハッシュは `submissions`
  経由で entryKey に変換する）。エントリの中身は必ず**チェーンから**読む（ホスト時は Container の
  `/read`、Node では `ConditionChain.readEntries`（`packages/midnight-chain/src/reader.ts` の
  `readConditionEntries`））。
  D1 からは読まない。
- バンド、日付、`recordedAt`、`scoreCommitment`、ブロック、explorer リンクを表示する。
  あわせて「台帳に載っていないもの」（氏名、リング ID、生値）を明示する。
- レート制限をかける。

### 9.6 開示レシート（選択的開示）

- 作業員は自分の履歴から開示レシートを発行できる: `POST /api/disclosures { entryKey }`
  （作業員本人の、自分のエントリだけ。管理者は発行できない）。Worker が `opening_ciphertext` を
  復号し、`{ v: 1, entryKey, scoreCenti, nonceHex, scoreCommitmentHex, periodDate, issuedAt }` を
  返す。コピーまたはダウンロードできる。発行のたびに `audit_log` に記録する。
- `/verify` に貼ると、`persistentCommit(scoreCenti, nonce)` がチェーン上の `scoreCommitment` と
  一致するかを確認する（例:「78.00 は 2026-09-12 に記録された正常バンドのエントリと一致」）。
- `persistentCommit` には `compact-runtime` が必要なので、ホスト時の照合は Container
  （`POST /open`）で行う。サーバを信頼しない検証は `condition-cli verify-receipt receipt.json` で
  ローカルに再計算する。ブラウザ内での純 JS 実装は試作扱いとし、`compact-runtime` と
  バイト単位で一致することをテストで示せた場合だけ採用する。
- 開示は本人の選択: レシートを受け取った人は、その 1 つの値と、そのエントリが誰のものかを知る。
  salt は開示しない。

### 9.7 ショーケース用データ

- `npm run condition:seed-showcase`（デプロイ後の手順書の 1 ステップ）: 合成の作業員 4 人 × 14 日を、
  preprod の本物の tx として記録する。正常・要注意・危険を混在させ、危険の日には判断の記録
  （理由付きの「就業」と「休養」を 1 件ずつ）を入れ、計測値がない日も 1 日作る。コントラクトの
  期間チェックは `periodStartMs` を基準にしているので、過去の日も記録できる。
- この時点の D1 の状態を、毎晩のリセット用スナップショットにする。

### 9.8 照合と改ざんの UX

- **照合は 1 回押すだけ。** 必ずチェーンを読みに行き（`apps/ingester/src/reconcile.ts` の `reconcileSubmissions` の
  `phased: true` による 2 段階動作は廃止）、ローカルとチェーンの値を並べて表示する。ホスト時の `/read` は
  ウォレットの同期を必要としないので、すぐに結果が返る。
- **改ざんは「チェーンへ送信」の横のチェックボックスのまま**（2026-09-30 決定。行ごとのボタンに
  する当初の計画は取りやめた）。ローカル記録には作業員の値を残し、チェーンには別バンドの値を送る
  （`apps/ingester/src/submit.ts` の `submitStagedFeed(…, { tamper: true })`）。次の照合で不一致を
  報告し、チェーンの値で行を復元する。ホスト時は、このフラグをキューの行と一緒に Cron に渡す。
  改ざんのデモも、通常の送信と同じく tx を 1 件使う。
- 状態バナーに、チェーン実行側（`ready` / `syncing n%`）と証明サーバの状態を表示する。

### 9.9 画面内のデモガイド

- 折りたためるパネルに §9.3 の 5 ステップを並べ、それぞれに操作・証明される内容・ソース /
  テスト / tx へのリンクを付ける。
- 各ステップは `GET /api/guide` の結果で自動的にチェックが付く（ゲストのセッションごとに、
  計測値の送信、取得と判断、送信の確定、公開検証とレシート照合、改ざんの検知を判定）。
- ゲストには最初から開いて表示し、ウォレットのユーザーにはトグルで隠す。日英対応。

### 9.10 審査期間中の運用とコスト

**フェーズ 6 での実装（2026-09-30、費用を Workers Paid の月 5 ドルに収めると決定）: 必要なときだけ起動する。**
2 つの Container はどちらも `standard-1`。Cron がチェーン実行側を起動するのは、処理待ちの値か実行中の
ジョブがあるときだけ。チェーン実行側は 5 分、証明サーバは 3 分使われなければ止まる。照合はエントリを読む
ためにチェーン実行側を起動する。1 回の送信で約 1〜2 GiB 時で、プランに含まれる 25 GiB 時に収まる。D1 の
運用プロファイルは作っていない。代わりに最初の送信に数分かかる（起動、チェックポイントの復元、差分の同期、
証明パラメータのダウンロード）。その段階は送信キューの画面に表示する。審査ですぐに応答させる必要が出たときの
参考として、以下の計画を残す。

運用プロファイルは D1 の設定で持ち、Cron が読む計画だった（BACCHIRI の `sponsor-operating-window.ts`
と同じ）。審査期間中は `always-on`、それ以外は `on-demand`。証明サーバは起動するたびに
`srs.midnight.network` から証明パラメータを取得する（BACCHIRI はポート待ちのタイムアウトを
10 分にしている）ので、on-demand だと最初の証明まで数分かかる。審査期間中は 2 つの Container とも止めない。

Cloudflare Containers の公開料金（2026-09-30 確認、
<https://developers.cloudflare.com/containers/pricing/>）で試算: メモリ $0.0000025 / GiB 秒と
ディスク $0.00000007 / GB 秒は確保したサイズに対して課金、CPU $0.000020 / vCPU 秒は実際に
使った分だけ。Workers Paid（月 $5）に 25 GiB 時間、375 vCPU 分、200 GB 時間が含まれる。
インスタンスのサイズ（<https://developers.cloudflare.com/containers/platform-details/limits/>）:
`standard-1` は 1/2 vCPU・4 GiB・8 GB、`standard-2` は 1 vCPU・6 GiB・12 GB、`standard-4` は
4 vCPU・12 GiB・20 GB。1 か月を 30 日、アイドル時の CPU を 0.05〜0.25 vCPU、1 ドル 150 円として計算。

| 構成 | 月額 | 3 か月 |
|---|---|---|
| BACCHIRI と同じサイズ（証明 `standard-2` + 実行 `standard-4`）、両方 24 時間 | $130〜140 | $390〜420（約 5.9〜6.3 万円） |
| 両方 24 時間、証明 `standard-2` + 実行 `standard-2` | $90〜100 | $270〜300（約 4.0〜4.5 万円） |
| **両方 24 時間、証明 `standard-1` + 実行 `standard-2`（審査期間中の推奨）** | **$75〜85** | **$225〜255（約 3.4〜3.8 万円）** |
| 実行側だけ 24 時間（`standard-2`）、証明は必要時のみ | $50〜60 | $150〜180（約 2.3〜2.7 万円） |
| 実行側は 9〜21 時（JST）のみ、証明は必要時のみ | $27〜33 | $80〜100（約 1.2〜1.5 万円） |

- 費用の約 9 割はメモリなので、サイズの最適化が効く。フェーズ 6 で、実行側のピーク（ウォレットの
  同期と復元）と証明サーバのメモリ使用量を実測してからサイズを決める。BACCHIRI のウォレットは
  `standard-4` で動いているが、OHAYO! より多くの役割を担っている。OHAYO! でも `standard-4` が
  必要だった場合は、月に約 $39 上乗せになる。
- D1、R2、Workers のリクエスト、毎分の Cron は、デモ規模なら Workers Paid の範囲に収まる。
  Durable Object の稼働時間分は多くても数ドル。preprod の手数料は faucet の tNIGHT から作る
  DUST で払うので、お金はかからない。
- ゲストの送信上限 × 日数に足りる DUST を確保し、残りが少なくなったら通知する。
- 証明パラメータを焼き込んだ証明サーバのイメージを作れば、必要時のみの起動でも数分ではなく
  数秒で立ち上がる。審査期間が長いなら試す価値がある。

### 9.11 提出用資料

`docs/submission/`（と `docs/ja/submission/`）を BACCHIRI の `docs/submission/` と同じ構成で作る:
`README.md`（審査ガイドと読む順番）、`evidence_matrix.md`（主張 → ソース → テスト → 日付付き tx）、
`judge_qa.md`（証明しないこと — パートナー値そのものの真正性、判断記録が改ざんを検知できないこと、
作業員との紐付けが運用者の主張であること — を含む）、`one_page_brief.md`。トップの README は、
1 行の価値、動画、「ゲストで試す」付きのホスト版 URL、核心の 3 点、§9.2 の評価経路から始める。
約 3 分の動画は §9.3 の流れに沿って作る。

### 9.12 フェーズ 7 での実装

- **照合は 1 回押すだけ**（§9.8）: `reconcileSubmissions` は常にチェーンを読む。`phased` と
  `localChecked` は廃止した。不一致は `audit_log` に `reconcile.mismatch` を書く（ガイドの改ざんの手順で使う）。
- **公開検証**（§9.5）: `apps/gateway/src/public.ts`。`GET /api/public/entry?entryKey=` または `?tx=`
  （tx のハッシュか ID を `submissions` で entryKey に変換）は、`GatewayDeps.chain`（Node ではプロセス内の
  `ConditionChain`、ホスティング時はチェーン操作用コンテナの `/read`）でエントリを読み、バンド、日付、
  `recordedAt`、コミットメント、分かれば tx、コントラクト、`notOnLedger: [workerName, ringId, value]` を返す。
  ホスティング時は `/api/public/*` をクライアント IP ごとに 1 分 30 回に制限する（`PUBLIC_RATE_LIMITER`）。
  画面の `#/verify` はログイン不要で、各エントリとナビゲーションからリンクする。
- **開示材料とレシート**（§9.6）: `recordOutcomes` は `{ scoreCenti, nonceHex }` を `OPENING_KEY` の AES-256-GCM で
  封をし、entryKey を関連データとして結び付けて（`packages/shared/src/opening.ts`）`submissions.opening_ciphertext`
  に保存する。保存するのは本当に送信したものだけで、改ざんした行やチェーンから回復した行には保存しない
  （nonce がチェーンと一致しないため）。`OPENING_KEY` は `.state/gateway/opening-key`（ローカル）と
  `.state/cloudflare/opening-key`（ホスティング）に一度だけ生成する。失うと開示材料も失われる。
  `POST /api/disclosures { entryKey }`（そのエントリの作業員本人だけ。以前のエントリは 409 `no_opening`）は
  レシートを返し、`audit_log` に `disclosure.issue` を書く。作業員の履歴には、コピーとダウンロードができる
  「レシート」ボタンがある。`POST /api/public/receipt` は `persistentCommit` を計算し直し（Node ではプロセス内の
  `@midnight-demo/shared/commitment`、ホスティング時はチェーン操作用コンテナに追加した `POST /open`）、
  チェーン上のコミットメントと比べる。`npm run condition:verify-receipt -- receipt.json` は、どのサーバーも
  信用せずにレシートをチェーンと照らし合わせる。
- **ガイド**（§9.9）: `GET /api/guide`（`apps/gateway/src/guide.ts`）は、計測（ゲストのリングに値がある）、
  送信（取得したうえで、そのセッションのチェーンで照合済みの送信がある）、判断（そのセッションの就業判断がある）、
  公開検証（そのセッションがレシートを発行した。公開のエンドポイントにはセッションがないため）、改ざん
  （不一致が記録された）でチェックを付ける。パネルはどのページの上にも出て、ゲストには最初から開き、
  開閉の状態は `localStorage` に残す。ソースとテストへのリンクは入れず、`/verify` へのリンクだけ置く。
  判断には記録済みのエントリが要り、ショーケースを投入するまではゲスト自身のエントリしかないため、ガイドでは
  送信を判断の前に置いた（§9.3 ではショーケースの履歴を使って判断を 2 番目にしていた）。ショーケースがあれば、
  ゲストは一覧で見本の過去の日について待たずに判断できる。レシートの画面の「公開検証で確かめる」は、レシートを
  メモリ経由で `/verify` に渡してすぐに確かめる（値が載るので URL には入れない）。
- **ショーケース**（§9.7）: `apps/ingester/src/showcase.ts`（Worker で動く）。見本の作業員 4 人
  （`showcase-a` 〜 `showcase-d`、リング `ring-showcase-*`）× 今日より前の **7** 日（コンテナの稼働時間を半分に
  するため 14 日ではない。計測値 27 件、1 日欠測、全バンドを含み、危険の 2 日に判断を投入する — `rested` が 1 件、
  理由付きの `worked` が 1 件、`decided_by` は `showcase`）。値は日付（曜日の枠）で決まるので、後日もう一度投入しても
  新しい日が増えるだけで、チェーンにある日と食い違わない。`external_id` の `showcase:<ring>:<date>` で冪等にする。
  計測値の出所は `partner_api` なので、管理者のキューにはバンドしか出ない。CLI はない: ウォレットの管理者
  （ゲストのサンドボックスは不可）がデータ管理で **ショーケースを投入** を押す。`POST /api/showcase` は D1 に投入し、
  `audit_log` に `showcase.seed` を書き、ホスティング時はチェーン操作用コンテナのキューに入れる（最大 10 件のジョブ
  3 回）。`GET /api/showcase` が進み具合を返す。ローカルの `gateway serve` では、いつもの送信を待つキューに入る。
  ショーケースが見えるよう、一覧の既定の範囲を 14 日前からにした。
- **毎晩のリセット**（§9.4）: スナップショットへの復元ではない。ゲストはショーケースの行を変えられない
  （ゲストの管理者が送信・改ざん・削除できるのは自分のリングの値だけ）ので、`resetSandbox` は期限切れのゲストが
  作ったもの — 作業員、リング、計測値、`submissions` の行、監査の行、判断 — と、期限切れのログインチャレンジを消す。
  セッションが有効なゲストは残す。ホスティング時は 2 本目の Cron `0 18 * * *`（03:00 JST、
  `apps/worker/src/schedule.ts`）で、Node のサーバーは `GUEST_ENTRY=1` のとき 1 時間ごとに動かす。マイグレーション
  `0002_guest_decisions_resettable.sql` で `work_decisions` の削除トリガーを `decided_by` が `guest:%` の行だけ通すように
  狭めたので、本物の判断は追記のみのまま。残す行が訂正元にしているゲストの判断も残す。チェーンに載ったゲストの
  エントリは残り、パートナーのモックのデータベースには触れない。
- **状態の表示**（§9.8）: 別のバナーは作らない。送信キューの画面が、ジョブの実行中にチェーン操作用コンテナの
  段階を表示している（§8.6）。

---

## 10. プライバシー境界の変化

| データ | このフェーズ以降の置き場所 |
|---|---|
| 生の 0〜100 の値 | partner の D1、OHAYO! の D1（`condition_readings`）。送信時に Worker → Container を通る。R2 やログには残さない |
| バンド / コミットメント / entryKey | 変更なし（チェーン + D1） |
| コミットメントの開示材料（`nonce`） | D1 に AES-GCM で暗号化して保存。外に出るのは本人が発行したレシートの中だけ |
| 開示レシート | 発行できるのは本人だけ。受け取った人はその 1 つの値とエントリを知る |
| ウォレットの verifying key | SHA-256 のみ D1 に保存。チェーンには載せない |
| ゲストのセッション | D1。個人情報は持たず、2 時間で失効 |
| 判断の理由 | D1 のみ。管理者と本人だけが見られる |
| partner の署名 | D1 |
| salt | Worker と Container の secret |

データは合成したものなので、このデモでは生値をクラウドの DB に置くことを許容する。
仕様書のプライバシー表にもその旨を明記する。

---

## 11. フェーズ

各フェーズは 1 セッション分。フェーズが終わったら**状態**を更新する。

| # | フェーズ | 主なファイル | 完了条件 | 状態 |
|---|---|---|---|---|
| 0 | リファクタ: WASM 分離、チェーンと DB の分離、D1 アダプタ（§8.4） | `packages/shared`、`packages/midnight-chain`、`packages/db`、`apps/gateway/src/deps.ts` | `run.sh` のテストレーンがすべて通る。Worker の依存関係に `compact-runtime` がないことを境界テストで確認 | 完了（2026-09-30） |
| 1 | partner mock、取得、キューの UI（機能 1、3） | `apps/partner-mock/`、`apps/ingester/src/partner.ts`、`apps/gateway/src/admin.ts`、`apps/dashboard/public/app.js`、`0001_condition_schema.sql` | 取得が冪等。署名不正・衝突・未登録リングのケースをテスト済み | 完了（2026-09-30）— ローカル devnet でも、取得 → キュー → 3 件の tx の送信と照合まで確認 |
| 2 | ユーザー画面からの送信（機能 2） | `apps/dashboard/public/app.js`、`apps/gateway/src/routes.ts` | ユーザー画面から送った値が、取得と送信を経てチェーンに届く（ローカル devnet） | 完了（2026-09-30）— リング同期 → 取得 → 送信 → 照合済みの tx をローカル devnet で確認 |
| 3 | 就業判断（機能 7） | `apps/gateway`、`apps/dashboard/public/app.js`、`0001_condition_schema.sql` | 理由必須のルールと、追記のみの挙動をテスト済み | 完了（2026-09-30）— ローカル devnet の画面でも、理由なしの拒否・記録・訂正を確認 |
| 4 | preprod へのデプロイと手順書（機能 4） | `docs/deploy_preprod.md`、`docs/ja/deploy_preprod.md`、`run.sh`、`run.ps1` | 手順書だけを見て preprod にデプロイできる | 完了（2026-09-30）— 手順書に書いたレーンでデプロイし、その実行結果を手順書に記録した |
| 5 | ウォレットログインとゲスト入場（機能 5、8） | `apps/gateway/src/auth.ts`、`apps/dashboard/public/`、テスト | トークンログインを廃止。チャレンジの再利用、期限切れ、鍵の不一致、招待コードの再利用が拒否され、ゲストの制限が効くことをテスト済み | 完了（2026-09-30）— ゲストの流れはローカル devnet の画面で確認。接続仕様の `midnight_signed_message:` 接頭辞に対応したうえで、実物の Lace ウォレットでの管理者ログインにも成功 |
| 6 | Worker + D1 + Container（機能 6） | `apps/worker/`、`apps/chain-runner/`、`apps/partner-mock/src/worker.ts`、`run.sh cloudflare`（§8.6） | 開発ホストを止めた状態で、workers.dev 上で一連の流れが動く。§9.10 用のメモリを実測済み | 完了（2026-10-03）— 実装とローカルでの確認（2026-09-30）: 単体テスト、2 つの Worker のバンドル、コンテナイメージのビルド（`run.sh cloudflare check`）。2026-10-02 に `run.sh cloudflare deploy` と `checkpoint` で `https://midnight-proof-ohayo.commun-official.workers.dev` にデプロイ済み（D1 はマイグレーション済み、チェックポイントは R2）。2026-10-03 にゲストの値がリング同期 → 取得 → キュー → チェーン操作用コンテナを経て、チェーンで照合済みの preprod のエントリになった。実測はメモリ約 600 MB で CPU が張り付いたので、チェーン操作用コンテナは 1 vCPU・3 GiB（§8.6）。ホスティングしたサイトで管理者の Lace ログインも確認 |
| 7 | 評価レイヤー: 公開検証、開示レシート、デモガイド、照合と改ざんの UX、ショーケース投入、審査用プロファイル（機能 9〜12） | `apps/gateway`、`apps/dashboard/public/`、`apps/development/condition-cli` | ゲストが workers.dev 上でゴールデンパスを 5 分で終えられる | 進行中 — 照合、公開検証、レシート、ガイド、ショーケースの投入、毎晩のリセットを実装（§9.12）。2026-10-03 に preprod へショーケースを投入（27 件、コンテナの稼働は約 22 分）。その後ゲストとして API で通した所要時間は、コンテナが起動済みの状態で 5 分 32 秒（ショーケースなしでは約 12 分）で、ほぼすべてがチェーンの待ち 2 回 |
| 8 | 提出用資料と動画（§9.11） | `docs/submission/`、`docs/ja/submission/`、`README.md` | Evidence Matrix のすべての主張が、ソース・テスト・tx のいずれかにたどり着ける | 未着手 |

---

## 12. リスク

- **Container 内でのウォレット同期**が最も重い。BACCHIRI の固定コミットまでの履歴は、ほとんどが
  同期停止からの復旧対応（例: `fix(sponsor): recover stalled wallet synchronization`）。
  書き直さずに移植する。
- **コールドスタート**: `sleepAfter` で止まった後の最初の送信は、Container の起動、
  証明パラメータの取得、同期状態の復元、同期の追いつきを待つことになる。UI でそれを表示する必要がある。
- **ゲスト入場は悪用されうる**: ゲストごとと全体の上限、レート制限、毎晩のリセット、DUST 残量の通知で抑える。
- **常時稼働のコスト**は、まだ実測していないサイズに左右される（§9.10）。
- **ブラウザでのレシート照合**には、バイト単位で一致する `persistentCommit` が必要。
  それが示せるまでは Container と CLI で照合する。
- **判断の記録は改ざんを検知できない**（「DB のみ」で了承済み）。
- **§7 の引き継ぎ後は、1 つのウォレットを 1 つのホストだけが使う。**
