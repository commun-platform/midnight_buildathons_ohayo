# OHAYO! — 設計ドキュメント

> 別会社が算出した作業現場のコンディション値を Midnight ブロックチェーンに記録し、
> 権限に応じて 3 状態を参照させるシステム。**このドキュメントが現行リポジトリの正本仕様。**
>
> **ハッカソン構成** — ローカル（libSQL とローカルの Midnight devnet、`run.sh e2e`）でも、
> Cloudflare の workers.dev（D1 と Containers、Midnight preprod、[`deploy_cloudflare.md`](deploy_cloudflare.md)）でも動く。
> ロールは 管理者 / ユーザー の 2 種。現場は 1 か所を前提とし、
> ログインは Midnight ウォレットの署名（またはゲスト用サンドボックス）。

---

## 1. 背景と目的

### 対象システム

工事現場の作業員がスマートリングを装着する。リング → スマホアプリ → 別会社サーバー
までは **別会社の担当**で、そこで毎日 1 人あたり **0〜100 のコンディション値**
（体調指標。**高いほど良い**）が算出される。

このリポジトリが担当するのは、そこから先:

1. 別会社の値を取得する
2. Midnight ブロックチェーンに記録する（改ざん耐性・監査可能性）
3. Web で、権限に応じて各作業員の **3 状態**（`正常` / `要注意` / `危険`）を
   **コントラクトから**参照する

### なぜブロックチェーンか

「作業員 X は D 日に要注意だった」という記録を、**後から書き換えられない**形で残し、
**管理者や本人が独立に検証できる**ようにするため。社内管理者だけが見るなら署名付き
DB で足りるが、第三者による独立検証を成立させるためにチェーンを使う。

**同時に、生の 0〜100 の値はチェーンに出さない。** 出るのは 3 状態のバンドだけ。
体調指標は要配慮個人情報に近く、world-readable な台帳に生値を載せるべきではない。
Midnight のゼロ知識証明が「生値を隠したままバンドの導出が正しいことを証明する」
という、この設計の核になっている。

### 3 状態

| コンディション値 | 状態 | enum |
|---|---|---|
| 60〜100 | 正常 | `normal` |
| 40〜59 | 要注意 | `caution` |
| 0〜39 | 危険 | `danger` |

閾値は `packages/shared/src/condition.ts`（`CONDITION_NORMAL_MIN=60` /
`CONDITION_CAUTION_MIN=40`）。値は小数を許容し、コントラクト内部では
`round(値 × 100)`（0〜10000）で扱う（閾値は 6000 / 4000）。

---

## 2. 全体アーキテクチャ

```
┌─────────────── 別会社 ───────────────┐
│  スマートリング → アプリ → サーバー   │  … 生体計測 & 0–100 コンディション値の算出
└───────────────┬──────────────────────┘
                │  （当面）condition_readings テーブル / （将来）HTTP API
                ▼
        ┌──────────────────┐
        │  Node ingester    │  値が揃ったリングだけ順次処理
        │  apps/ingester    │  - DB からロスター・フィードを読む
        │                   │  - entryKey・scoreCommitment 生成
        └───────┬──────────┘
                │ 証明生成依頼
                ▼
     ┌────────────────────────┐        ┌──────────────────────────────┐
     │ proof-server :6300      │──提出──▶│ Midnight condition-registry   │
     │ （ローカル Docker）      │        │  entries: Map<Field, Entry>   │
     └────────────────────────┘        │  公開: entryKey, periodStartMs,│
                │                        │  recordedAt, scoreCommitment,  │
                │ 提出結果(tx)            │  band                          │
                │                        │  非公開: 0–100 の生値, nonce   │
                ▼                        └──────────────┬───────────────┘
     ┌────────────────────────┐                        │ indexer 照会
     │ libSQL / SQLite         │                        │
     │  rings /                │        ┌───────────────▼───────────────┐
     │  ring_worker_map /      │        │ 読み取り API（apps/gateway）    │
     │  workers / worker_pii / │◀──────▶│  セッション認証 → スコープ判定 →│
     │  condition_readings /   │        │  対象リングの entryKey 計算 →  │
     │  submissions            │        │  band を取得                   │
     └────────────────────────┘        └───────────────┬───────────────┘
                                                          │
                              ┌─────────────────────────┴─────────────────────┐
                              ▼                                               ▼
                        ユーザー（本人）                                管理者（全件）
```

### 信頼境界

| コンポーネント | 信頼の前提 |
|---|---|
| 別会社 | 算出値が正しいことを前提とする。値には別会社の Ed25519 署名が付き、OHAYO! が取得するときにオフチェーンで検証する。回路ではまだ検証しない |
| 管理者（サーバー / DB オーナー） | オンボーディングの起点 — リングと作業員を作り、両者を紐づける。ロスターを正しく維持し、別会社の値を**改変せず**提出すると信頼する。チェーンが保証するのは「提出後の改ざん不可」「否認不可」であって、提出時点のソース認証ではない |
| 作業員の帰属 | **運営者の主張であって暗号的な束縛ではない**。チェーンに載るのは `entryKey` ＋ band ＋ commitment のみ。どのリング・作業員のエントリかは運営者の DB 由来 |
| ログイン | 一度限りのチャレンジへのウォレット署名。管理者の一覧は運用者の設定、作業員の紐付けは管理者が発行した招待コードによるので、ウォレットが誰のものかは運用者の主張にとどまる。ゲスト入場を有効にすると、誰でもサンドボックスに入れる |
| salt 保有者 | リング履歴を総当たりできる。監査時に salt を開示（`salt_epochs` が各世代のハッシュを記録するのでローテーション後も検証可能） |
| band の公開 | 擬似匿名で world-readable。生の 0–100 は出ない |

### 2.1 実行モード

ingester とゲートウェイの Node エントリポイントは、チェーン有り / 無しの
どちらでも動く（`MIDNIGHT_NETWORK` 未設定なら送信・照合が無効になり 501 を返す
だけ）。ただし `run.sh` の Docker ハーネスは、ダッシュボードについてはオンチェーン
モードしか提供しない — **`./run.sh e2e` が devnet の起動・コントラクトの
デプロイ・ダッシュボードの配信までを行う唯一のコマンド**。独立した
`dashboard` レーンは無く、seed 済みのオフラインデモレーンも存在しない。

**ingester のオフライン利用（チェーンなし）** — `./run.sh db` / `ingester record --local`：

```
rings / ring_worker_map /       ロスター — 初期は空。管理者がデータ管理画面で構築
workers / worker_pii            （テストは sample-roster.sql）
condition_readings              別会社 API の代役 — 初期は空
                                （テストは sample-feed.sql。ダッシュボードの
                                 キュー送信はチェーンが必要でここでは 501）
      │
      ▼
apps/ingester   plan → record --local        実処理は ingester-core:
      │                                       periodStartMs・entryKey・scoreCommitment・band
      ▼
submissions テーブル            band は入る。tx_id / tx_hash / block_height / chain_verified_at = NULL
      │
      ▼
gateway serve  （:8787、単一オリジン）
  ├─ GET /api/*   読み取り API — submissions テーブルを dbConditionReader で（verified:false）
  └─ GET /        ダッシュボード SPA
```

ストレージはローカル SQLite ファイル（`data/ingester-local.db`、`LIBSQL_URL` なし）か
docker の libSQL サーバ（`./run.sh db`）。`midnight-node`・proof server・ウォレットは
一切不要。必須 env は `INGESTER_SALT_HEX` のみ。`gateway serve`
（`npm run dashboard:dev`、Node ホスト）はこの状態でもダッシュボード SPA を配信できる
— その場合「照合」ボタンは **501**（`POST /api/reconcile` に照合先のチェーンがない）。
`run.sh` ハーネスはこのモード自体を提供しない — ダッシュボードを配信する唯一の
レーン `e2e` は常に devnet に接続する（次項）。

**ローカル devnet（オンチェーン）** — `./run.sh e2e`：

```
condition_readings ─▶ ingester loadAndPlan ──▶ condition-cli  submit / deploy / fund / reconcile
 (db:seed)            （オフラインと同じ plan）      │         （@midnight-demo/midnight-chain +
                                                   │          運営ウォレット 1 個。devnet genesis
                                                   │          seed から入金 — faucet ではない）
                                                   ▼
                   proof-server :6300  ──証明──▶  midnight-node :9944  ──▶  condition-registry
                                                         │                    (Map<Field, Entry>)
                                    indexer-standalone :8088                        │
                                                   │                               │
  submissions テーブル ◀── reconcileSubmissions ───┴── 各エントリを読み戻し ────────┘
      │                   （band を上書き、chain_verified_at を刻む）
      ▼
  gateway serve :8787  （devnet に接続）
      └─ /api/* は verified:true に。「照合」ボタンが実契約に対して動く

  上記すべて ops/local/midnight-compose.yml で Docker 起動（127.0.0.1 のみ）
```

本物の `midnight-node` 1.0.0 / `indexer-standalone` 4.3.3 / `proof-server` 8.1.0 を
Docker で起動する。`submissions` 行に実際の `tx_id` / `tx_hash` / `block_height` と
`chain_verified_at` が入るのはこのモードだけ。

---

## 3. ロールと権限

ロールは 2 種のみ。スコープの概念は持たない（現場が 1 か所だから）。

| ロール | enum | ログイン方法 | 見えるもの |
|---|---|---|---|
| 管理者 | `admin` | 鍵ハッシュが `ADMIN_WALLET_KEY_HASHES` にある Midnight ウォレット | 全作業員の band 履歴、データ管理画面、チェーン照合、就業判断 |
| ユーザー | `worker` | 一度限りの招待コードで本人に紐付けた Midnight ウォレット | 自分の履歴のみ。**生の 0〜100 の値も見える** |

**ログインはウォレットの署名**（Lace、DApp Connector 4.x の `signData`。BACCHIRI が preprod で
使っている方式と同じ）:

```
POST /api/auth/challenge {inviteCode?}   → { challengeId, message }   （一度限り、5 分）
   message = OHAYO-LOGIN-V1 \n origin \n challengeId \n nonce \n issuedAt [\n invite:<コードの sha256>]
wallet.signData(message, { encoding: 'text', keyType: 'unshielded' })
POST /api/auth/verify {challengeId, data, signature, verifyingKey}
   data === message、
   schnorr.verify(signature, sha256('midnight_signed_message:<バイト長>:' + message), verifyingKey)
     （lace-extension 2.4.0 から Lace が付ける、接続仕様の接頭辞。@noble/curves、WASM 不要）
   keyHash = sha256(verifyingKey)
   keyHash ∈ ADMIN_WALLET_KEY_HASHES → 管理者
   有効な wallet_bindings の行         → その作業員（招待コードで作られる）
   どちらでもない                      → 403 unregistered（登録用に keyHash を返す）
→ セッション v1.<payload>.<SESSION_SECRET による HMAC-SHA256>、12 時間、Bearer で送る
```

`authenticate()`（`apps/gateway/src/auth.ts`）は毎回、MAC と有効期限に加えて、管理者の鍵ハッシュが
まだ設定にあるか、作業員の紐付けがまだ有効かを確認する。紐付けを解除すると、そのセッションは使えなく
なる。署名に手数料はかからず、ウォレットが接続しているネットワークにも依存しない。

**ゲスト入場**（`GUEST_ENTRY=1`）は、ウォレットを持たない評価者向けのサンドボックス。ゲストごとに新しい
作業員とリングを作り、2 時間有効のセッションで作業員と管理者の役を切り替えられる。ロスターは変更できず、
チェーンへの送信は自分のリングの値だけ、ゲストあたり `GUEST_SUBMISSION_LIMIT` 回、全ゲスト合計で
1 時間あたり `GUEST_HOURLY_LIMIT` 回まで。

**生値を見られるのは本人だけ。** 管理者もバンドしか見えない
（`apps/gateway/src/routes.ts` の `attachOwnConditionValues` は
`viewer.role === 'worker'` のときだけ呼ばれる）。

---

## 4. データモデル

### 4.1 オンチェーン（`condition-registry` コントラクト状態）

```
export enum ConditionBand { unclassified, danger, caution, normal }

export struct ConditionEntry {
    periodStartMs: Uint<64>;     // その日の 00:00（APP_TIME_ZONE）のエポックミリ秒
    recordedAt: Uint<64>;        // 実際に計測された日時
    scoreCommitment: Bytes<32>;  // persistentCommit(scoreCenti, nonce)
    band: ConditionBand;
    verified: Boolean;
}

export ledger entries: Map<Field, ConditionEntry>;
export ledger submissionCount: Counter;
export ledger lastSubmittedKey: Field;
export ledger lastSubmittedBand: ConditionBand;
```

**`entryKey` の作り方**（`packages/shared/src/condition.ts` の `conditionEntryKey`）:

```
entryKey = SHA-256( utf8(ringId) || be_u64(periodStartMs) || salt )  の先頭 31 バイト
```

- 31 バイトに切るのは Midnight の `Field` に収めるため。
- `salt` は `INGESTER_SALT_HEX`（≥16 バイト）。**ブラウザには絶対に渡さない。**
- 作業員 ID ではなく **リング ID** を使う。チェーン上の識別子から人物を辿れないようにするため。
- salt を知らない第三者は、どのエントリがどのリングのものか判別できない（擬似匿名）。

### 4.2 オフチェーン DB（`@midnight-demo/db`）

ローカルでは libSQL（ローカル SQLite ファイル or docker の libSQL サーバ）、ホスティング時は
Cloudflare D1（`@midnight-demo/db/d1`）。スキーマは `packages/db/migrations/0001_condition_schema.sql`
から始まり、最初のホスティング以降の変更は同じディレクトリの番号付きファイルになる。

#### リングと作業員

```
rings             (id, label, owner_label, status, created_at)
ring_worker_map   (ring_id, worker_id, from_ts, to_ts?)

workers           (id, created_at)
worker_pii        (worker_id, name)
```

- `rings.id` がオンチェーンの識別子（`entryKey` の材料）。`label` は登録時必須の
  リング表示名で、シリアルやデバイス紐付けといった別概念は持たない。
- `ring_worker_map` が「誰が着けているか」。1 リング : 1 作業員 : 1 日。
- `workers` は識別子だけを持ち、氏名は `worker_pii` に分離する。
- 作業員は `wallet_bindings` で紐付けたウォレットでログインする（有効な紐付けは鍵ごと・作業員ごとに 1 つ）。`worker_invites` は招待コードのハッシュだけを、`auth_challenges` は一度限りのログインチャレンジを、`guest_sessions` はサンドボックスのゲストを持つ。

#### コンディション

```
condition_readings   (id, ring_id, recorded_at, value, source, entered_by?,
                      status, skip_reason?, external_id?, partner_sig?, last_error?, created_at)
partner_sync         (source, cursor, synced_at)

submissions          (entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
                      band, score_commitment_hex, salt_ref?, deployment_id?, submitted_by?,
                      tx_id?, tx_hash?, block_height?, submitted_at, chain_verified_at?, reconciled_at?,
                      opening_ciphertext?)

salt_epochs          (id, salt_hash, from_ms, to_ms?, created_at)
contract_deployments (id, network, address, deployed_at, active)
audit_log            (id, actor_user_id?, action, target_table, target_id, before_json?, after_json?, ts)
work_decisions       (id, worker_id, period_start_ms, entry_key?, band?, decision, reason,
                      decided_by, decided_at, supersedes_id?)
```

- `condition_readings` は別会社フィードの着地点で、送信キューを兼ねる。
  **パートナーから取得**（`POST /api/partner/pull`、`apps/ingester/src/partner.ts` の
  `pullPartnerScores`）が、署名を検証した別会社の値を `source = 'partner_api'`、
  `status = 'pending'` で入れる。別会社の id は `external_id`（一意。同じ内容の再送は重複、
  内容の違う再送は衝突として扱い、上書きしない）、署名は `partner_sig` に入る。
  `partner_sync` は別会社のカーソルを持つ。**チェーンへ送信** で、キューの各行は
  `submitted`、`skipped`（`skip_reason`）、`failed`（`last_error`。次の送信で再試行）の
  どれかになる。`queued` はホスト版の実行側用。スコアは作業員が別会社経由で送るものだけ。管理者は値の一覧・削除・
  取得・送信はできるが、値を入力・編集する手段はない。別会社の API は [`partner_mock_api.md`](partner_mock_api.md)。
- 管理者は別会社の行の生値を受け取らない。`GET /api/staged` は `source = 'partner_api'` の行に
  ついて `value: null` とバンドだけを返す。
- `submissions` は **ingester が持つオンチェーンエントリのローカル複製**。
  `(リング, 現地日)` ごとに 1 行。`entry_key` がオンチェーン `Map` のキーそのもの。
  読み取り API はこのテーブルから band を返す（チェーンに毎回問い合わせない）。
- `chain_verified_at` はチェーンから読み戻して一致を確認した時刻。
  `reconcileSubmissions` が刻む。ダッシュボードの「⚠ 未照合 / ✓ 照合済み」表示の根拠。
- `work_decisions` は、管理者がその日に作業員を就業させた理由を記録する
  （`worked` / `light_duty` / `rested`）。**追記のみ**: トリガーで `UPDATE` と `DELETE` を拒否し（`DELETE` を通すのは、毎晩のリセットが消す
  ゲストのサンドボックスの行、`decided_by` が `guest:<id>` の行だけ）、
  訂正は現在の判断を `supersedes_id` で指す新しい行として加える（部分一意インデックスで、
  作業員・日ごとの起点は 1 行、各行の後継も 1 行に限る）。書き込みのたびに `audit_log` にも
  記録する。その日の `band` と `entry_key` はサーバが `submissions` から写し取る。`caution` /
  `danger` の日に `worked` / `light_duty` とするには理由が必要。判断は**チェーンに載らず**、
  改ざんを検知できない（運用者は DB を書き換えられる）。
- `salt_epochs` は salt 世代のハッシュだけを保持する。**生の salt は DB に入れない。**

#### タイムゾーンの持ち方

現場が 1 か所なので、タイムゾーンはアプリ全体で 1 つ。
`packages/shared/src/period.ts` の **`APP_TIME_ZONE`**（`Asia/Tokyo`）が権威。

- `submissions.timezone` — 提出時点でどのゾーンを使ったかの記録。定数を変えても
  過去の行が再解釈されないように残している。
- `submissions.period_start_ms` — 実際に計算した日の 00:00（エポックミリ秒）。

`zonedDayStartMs(instantMs, timeZone)` が `Intl.DateTimeFormat` でオフセットを
求めて算出する。夏時間も自動で追随する。

### 4.3 private 保管（ingester）

生の `scoreCenti` と `nonce` は、Midnight の private state に暗号化して保管する
（パスフレーズは `DEVELOPMENT_PRIVATE_STATE_PASSWORD`）。DB には入らない。
これが `scoreCommitment` の開示証明の材料になる。

---

## 5. `condition-registry` コントラクト仕様

**単一回路・単一値。** `submitCondition` は公開入力 `(entryKey, periodStartMs,
recordedAt, scoreCommitment)` を取り、生の `scoreCenti` ＋ `nonce` を private
witness として読み、commitment を照合し、3 状態バンドを導出して `ConditionEntry`
を 1 件挿入する（1 回の呼び出しで `(リング, 日)` 1 件）。

### 5.1 witness

```
witness privateScoreCenti(entryKey: Field): Uint<32>;   // round(値 × 100), 0..10000
witness privateScoreNonce(entryKey: Field): Bytes<32>;
```

### 5.2 回路 `submitCondition`

```
export circuit submitCondition(
    entryKey: Field,
    periodStartMs: Uint<64>,   // その日の 00:00 のエポックミリ秒（entryKey の材料と同じ値）
    recordedAt: Uint<64>,      // 記録取得日時（エポックミリ秒）
    scoreCommitment: Bytes<32>
): [] {
    const key = disclose(entryKey);
    assert(!entries.member(key), "entry already submitted for this ring/day");

    // 記録日時が主張する日の範囲内か（108000000 ms = 30h）
    const windowEnd = (periodStartMs + 108000000) as Uint<64>;
    assert(recordedAt >= periodStartMs, "recordedAt is before the period day");
    assert(recordedAt < windowEnd, "recordedAt is after the period-day window");

    const scoreCenti = privateScoreCenti(key);
    const nonce = privateScoreNonce(key);
    assert(
        disclose(persistentCommit<Uint<32>>(scoreCenti, nonce) == scoreCommitment),
        "score commitment mismatch"
    );

    // 6000 = 60点, 4000 = 40点
    const band = disclose(
        scoreCenti >= 6000
            ? ConditionBand.normal
            : (scoreCenti >= 4000 ? ConditionBand.caution : ConditionBand.danger)
    );

    entries.insert(key, disclose(ConditionEntry {
        periodStartMs: periodStartMs,
        recordedAt: recordedAt,
        scoreCommitment: scoreCommitment,
        band: band,
        verified: true
    }));
    submissionCount.increment(1);
    lastSubmittedKey = key;
    lastSubmittedBand = band;
}
```

30 時間窓にしているのは、夜勤や日付跨ぎの計測を許容しつつ、明らかに別日の値を
その日として提出することを防ぐため。

### 5.3 整合性が保証すること / しないこと

**保証する:**
- `band` は `scoreCommitment` にコミットされた値から正しく導出されている
  （＝ 生値を見せずに「バンドの正しさ」だけを証明できる）
- 同じ `(リング, 日)` の二重記録を拒否（`assert(!member)`）
- 提出後、`band` と `scoreCommitment` は改変不可

**保証しない:**
- 提出された `scoreCenti` が別会社の実際の算出値であること
  （＝ ingester＝運営会社への信頼。将来、別会社署名の検証を回路に足せば解消）
- 全リング・全日が漏れなく提出されていること（欠損はエントリ無し）

### 5.4 回路テスト

`contracts/condition-registry/src/test/condition-registry.test.ts`（Vitest、10 ケース）:

- 正当な値を受理し、`normal` / `caution` / `danger` を正しく導出する
- 同一 `entryKey` の再提出を拒否する
- `scoreCommitment` 不一致（値・nonce 改ざん）を拒否する
- 境界値（60→normal / 59→caution / 40→caution / 39→danger）
- `recordedAt` が `periodStartMs` の当日 30h 窓の外（前・後）を拒否する
- オンチェーンの `ConditionEntry.periodStartMs` が入力値どおり記録される

`./run.sh test_contract` でコンパイル（Compact 0.31.1）＋実行。

---

## 6. ingester

3 パッケージ + 1 CLI:

- **`packages/ingester-core`** — Midnight SDK 非依存・DB 非依存の純ロジック（型、
  `periodStartMs` 解決、plan（entryKey / scoreCommitment / band 生成・冪等性判定））。
  オフラインでユニットテスト。
- **`apps/ingester`** — オーケストレーション CLI（`plan` = ドライラン、
  `record --local` = `submissions` テーブルに記録）＋ `db.ts`。加えてチェーン操作の
  DB 側: `store.ts`、`submit.ts`（`submitStagedFeed`、`recordOutcomes`）、`reconcile.ts`
  （`reconcileSubmissions`）。これらは `ingester-core` が定義する `ConditionChain` を
  通してチェーンを扱う。**Midnight SDK を import しない**ことを `boundary.test.ts` が強制する。
- **`packages/midnight-chain`** — Midnight SDK 層。運営ゲートウェイウォレット、
  provider、`submitCondition`（tx ＋ 暗号化 private state）、`deployConditionRegistry`、
  実 `indexerConditionReader`、`conditionChain(network, address)`（`submitReadings` =
  計画・証明・送信を行い値ごとの結果を返す、`readConditionEntries`）。DB は読み書きしない。
- **`apps/development/condition-cli`** — 上記の CLI：
  `deploy` / `submit` / `reconcile` / `status` / `fund` / `wallet` / `funding`。

### 6.1 実行フロー

```
1. ロスター読み込み   rings                                →  (ringId, timezone=APP_TIME_ZONE)
2. フィード読み込み   condition_readings                    →  (ringId, recordedAt, value)
3. plan（ingester-core）
     periodStartMs  = zonedDayStartMs(recordedAt, timezone)
     scoreCenti     = round(value * 100)          … 0..10000 の範囲外は skip
     nonce          = crypto.randomBytes(32)
     scoreCommitment= persistentCommit(scoreCenti, nonce)
     entryKey       = sha256(ringId || be_u64(periodStartMs) || salt)[0..31]
     band           = classifyCondition(value)
     既に submissions に entry_key があれば skip（冪等）
4. 提出            condition-cli submit → 証明生成 → tx → チェーン
5. 記録            submissions に INSERT（tx_id / tx_hash / block_height 付き）
6. 照合            reconcileSubmissions → チェーンから読み戻し → chain_verified_at
```

skip の種類は 3 つ:

| kind | 意味 |
|---|---|
| `unknown-ring` | ロスターに無いリングの値が来た |
| `invalid-value` | 0〜100 の範囲外 |
| `already-submitted` | その `(リング, 日)` は提出済み |

### 6.2 tx 粒度

1 リング × 1 日 = 1 tx。バッチ化しない。理由は 2 つ:

- 1 件の失敗が他を巻き込まない（部分失敗の扱いが単純になる）
- コントラクトの `assert(!entries.member(key))` による二重提出防止が、そのまま
  リトライ安全性になる

---

## 7. 読み取り経路

### 7.1 認可はオフチェーン

チェーンは「誰が読んでよいか」を知らない（band は world-readable）。
認可は読み取り API（`apps/gateway`）が担う。

```
Authorization: Bearer <token>
        │
        ▼
authenticate()          セッション → Viewer{role, workerId}（MAC・期限・紐付けを確認）
        │
        ▼
resolveRingScope()      admin  → 全リング
                        worker → ring_worker_map で自分に紐づくリング
        │
        ▼
conditionHistory()      各リング × 各日 → entryKey を計算 → reader.read(entryKey)
        │                （salt はサーバー側だけが持つ）
        ▼
JSON                    { range, rings: [{ ringId, timezone,
                                           workerId, workerName, entries: [...] }] }
```

`salt` はブラウザに渡らない。よってクライアントは `entryKey` を自力で作れず、
サーバーが許可した範囲のエントリしか読めない。

### 7.2 API

| メソッド / パス | 権限 | 内容 |
|---|---|---|
| `GET /api/config` | 認証不要 | 表示用の文字列（ネットワーク名、Explorer URL、submit 可否） |
| `GET /api/me` | 全ロール | 呼び出し元のロール・氏名・現在の `ringId` |
| `GET /api/decisions?from=&to=[&workerId=][&history=1]` | 管理者（全員）、作業員（本人のみ） | 現在の就業判断（`history=1` で置き換えられたものも含む） |
| `POST /api/decisions` | 管理者 | 就業判断を追記 `{ workerId, date, decision, reason?, supersedesId? }`。理由不足は 400 `reason_required`、`supersedesId` が現在の判断でなければ 409 `stale` |
| `GET /api/conditions/mine` | 全ロール | 自分のスコープ全体の band 履歴 |
| `GET /api/conditions/all` | 管理者 | 全リング |
| `GET /api/conditions/worker/:id` | 管理者・本人 | その作業員のリング |
| `POST /api/reconcile` | 全ロール（スコープ内） | 指定 `entryKeys` をチェーンと再照合 |
| `GET/POST/PATCH/DELETE /api/{rings,workers}` | 管理者 | ロスター CRUD |
| `GET /api/roster` | 管理者 | データ管理画面用の結合済みロスター |
| `GET /api/staged`、`DELETE /api/staged/:id` | 管理者 | `condition_readings` の送信キュー（別会社の行はバンドのみ）。値を入力・編集する API はない |
| `POST /api/partner/pull` | 管理者 | 別会社から署名付きスコアを取得してキューに入れる |
| `POST /api/staged/submit` | 管理者 | 送信待ち・失敗の値を一括オンチェーン提出（devnet）し、1 件ごとの結果を記録。`{ tamper: true }` ならローカル記録には作業員の値を残し、チェーンには別バンドの値を送る（デモ用） |

`from` / `to` クエリで期間指定（既定は直近 30 日）。
データ管理画面の「送信キュー」が `/api/staged*` と `/api/partner/pull` の UI。
スコアを入力するのは作業員だけで、リング同期カードから送る。

### 7.3 ダッシュボード

`apps/dashboard/public/` — ビルド不要のフレームワークレス SPA
（`index.html` + `app.js` + `styles.css`）。日本語 / 英語切替つき。

| 画面 | 管理者 | ユーザー |
|---|:-:|:-:|
| 本日 — 作業員カード（当日バンド）。要注意・危険の日は就業判断を記録するまで「判断未記入」を表示 | ● | — |
| 本日（本人）— 当日のバンド＋**生値**、就業判断と理由（読み取り専用）、月別の記録表、スコアを別会社へ直接送る**リング同期**カード | — | ● |
| 一覧 — 期間・作業員で絞り込み、就業判断・entryKey・tx の列、CSV 書き出し（判断と理由を含む）、照合 | ● | — |
| データ管理 — リング・作業員の CRUD、送信キュー（別会社から取得・チェーンへ送信・改ざんオプション） | ● | — |

- ログインは **Lace で接続してログイン**（作業員は初回だけ招待コードを入れる）。ゲスト入場が
  有効なら **ゲストとして試す** もある。ゲスト用のバーで作業員と管理者の役を切り替えられる。
  データ管理画面で招待コードの発行（一度だけ表示）とウォレット連携の解除ができる。
- リング同期カードは、ブラウザから別会社（`PUBLIC_PARTNER_URL`）へ直接送る。OHAYO! は経由
  しない。値が OHAYO! に届くのは管理者が取得したとき。gateway は CSP の `connect-src` に
  別会社のオリジンを加える。
- 「照合」ボタンは `POST /api/reconcile` を叩く。devnet 接続時は実際に
  チェーンから読み戻して `chain_verified_at` を更新する。バンドが食い違えば
  **チェーン側を正**として上書きし、警告を出す。

### 7.4 独立検証

管理者は 2 段階で検証できる:

1. **バンドの照合** — ダッシュボードの「照合」ボタン。`submissions` の band を
   チェーンの `entries` と突き合わせる。改ざんがあればここで露見する。

   1 回押すとチェーンを読む（`reconcileSubmissions` → `ConditionChain.readEntries`。ホスティング時は
   チェーン操作用コンテナの `/read` で、ウォレットの同期は要らない）。不一致があれば報告し、ローカルの行を
   チェーンの値に直し、照合済みを取り消す。
2. **生値の開示検証** — salt と `scoreCenti` / `nonce` の開示を受け、
   `persistentCommit(scoreCenti, nonce) == scoreCommitment` を自分で計算し、
   さらに `entryKey == sha256(ringId || periodStartMs || salt)[0..31]` を確認する。
   これでチェーン上のバンドが「その生値から導かれたものである」ことを、
   運営者のサーバーを信頼せずに確認できる。

デモでは、データ管理画面の送信キューにある「ローカル記録を改ざんする」チェックボックスで
DB とチェーンを意図的に食い違わせ、照合ボタンで検知される様子を見せられる。

---

## 8. プライバシー整理（何がどこに出るか）

| データ | チェーン | サーバー DB | 管理者 | 本人 |
|---|:-:|:-:|:-:|:-:|
| 生の 0〜100 の値 | — | ○（`condition_readings`） | — | ○ |
| バンド（正常/要注意/危険） | ○ | ○ | ○ | ○ |
| `scoreCommitment` | ○ | ○ | ○ | — |
| `entryKey` | ○ | ○ | ○ | — |
| 氏名 | — | ○（`worker_pii`） | ○ | ○ |
| リング ID | — | ○ | ○ | ○ |
| salt | — | ハッシュのみ | 開示可 | — |
| 就業判断と理由 | — | ○（`work_decisions`） | ○ | ○（本人の分） |

**チェーン単体からは個人が特定できない。** 載っているのは salt 付きハッシュの
`entryKey` と、そのバンド・コミットメント・時刻だけ。salt を持たない第三者には、
どのエントリが同一人物のものかすら分からない。

---

## 9. リポジトリ構成

```
run.sh / run.ps1 / run.bat      Docker ワンコマンドハーネス（テスト・画面・devnet・E2E）
contracts/condition-registry/   Compact コントラクト: submitCondition + witness + 回路テスト
packages/shared/                バンド語彙、タイムゾーン計算、hex ユーティリティ。commitment は ./commitment
packages/db/                    SqlDatabase（libSQL、D1）、スキーマ、マイグレーション、seed
packages/ingester-core/         純粋な取り込みロジック: 型、タイムゾーン、plan、冪等性
packages/condition-read/        読み取り側: スコープ解決、band 履歴の組み立て、ConditionReader
packages/midnight-chain/        Midnight SDK 層: ウォレット、provider、submit、deploy、チェーン読み取り
apps/ingester/                  ingester CLI ＋ チェーン操作（送信・照合）の DB 側
apps/gateway/                   読み取り API ＋ ローカル Node サーバー（SPA も配信）
apps/development/condition-cli/ オンチェーン CLI: deploy / submit / status / fund / …
apps/dashboard/public/          フレームワークレス SPA
ops/local/                      libSQL / Midnight devnet の docker-compose
docs/ , docs/ja/                英語ドキュメントと日本語訳
```

---

## 10. 動かし方

すべて `run.sh`（Windows は `run.ps1` / `run.bat`）1 本。ホストに Node は不要で、
Docker だけあればよい。

```bash
./run.sh test           # SDK 非依存のユニットテスト ＋ typecheck（高速）
./run.sh test_sdk       # Midnight SDK ワークスペースの typecheck ＋ テスト
./run.sh test_contract  # condition-registry のコンパイル ＋ ZK 回路テスト
./run.sh test_all       # 上記 3 つ
./run.sh db             # ingester を Docker の libSQL サーバに対して end-to-end
./run.sh devnet         # ローカル Midnight devnet を起動
./run.sh e2e            # 1 コマンドで: devnet → fund → deploy → dashboard を :8787 で配信
./run.sh down           # 停止（clean = ボリュームも削除）
```

`./run.sh e2e` がダッシュボードを見るための唯一の入口。独立した `dashboard`
レーンは無い。`RESUME=1 ./run.sh e2e` で fund/deploy を省略し既存のデプロイを
再利用できる — 再デプロイなしでダッシュボードだけ再起動したいときに使う。

必須の設定は `.env` の `INGESTER_SALT_HEX`（16 バイト以上の hex）だけ。
`.env.example` をコピーして使う。

---

## 11. 未決事項・将来拡張

- **回路内での別会社署名の検証** — 値には別会社の Ed25519 署名が付き、取得時に検証する
  ので、偽造・改変された値はキューに入らない。ただし運営者はチェーンに別の値を送れる。
  署名を回路内で検証すれば、運営者を信頼の前提から外せる。
- **就業判断の改ざん検知** — 判断は DB にだけ記録される。判断ごとのコミットメントを
  チェーンに刻めば、書き換えられた判断を検知できる。
- **salt ローテーション** — `salt_epochs` のスキーマは用意してあるが、
  ローテーション手順は未実装。
- **欠測の扱い** — 記録の無い日は「エントリ無し」とだけ分かる。
  「出勤したが未装着」と「非稼働」の区別は現構成では付けない。
- **複数現場** — 現在は 1 現場前提。複数現場を扱うには現場テーブルと、リング／
  作業員の現場割当を再導入する必要がある。
- **認証** — ウォレットログインが証明するのは鍵を持っていることで、本人であることではない。
  紐付けは管理者の招待による。`/api/auth/*` のレート制限はホスト版の Worker（フェーズ 6）で入れる。
