# partner mock の API

> [English](../partner_mock_api.md)

`apps/partner-mock/` は、別会社の「リング → アプリ → サーバー」経路の代わり。0〜100 の
スコアはここが持つ。バイタルからスコアを算出し、**自分専用の** DB に保存し、渡すスコアには
すべて署名する。OHAYO! の DB には触れない。OHAYO! はここから取得する（データ管理画面の
**パートナーから取得** ボタン、`POST /api/partner/pull`）。

ハンドラは fetch 形（`apps/partner-mock/src/handler.ts` の `handlePartner(request, deps)`）
なので、同じコードがローカルでは Node サーバとして、ホスト時は専用の Worker として動く
（[`next_phase_design.md`](next_phase_design.md) §2、§8）。

## エンドポイント

| メソッド / パス | 認証 | 内容 |
|---|---|---|
| `POST /v1/measurements` | なし（デモ用の簡略化） | `{ ringId, measuredAt, vitals }` または `{ ringId, measuredAt, score }` を受け取って保存し、`201 { id, ringId, measuredAt, score }` を返す |
| `GET /v1/daily-scores?since=<cursor>[&limit=n]` | `Bearer PARTNER_API_KEY` | カーソルより後の署名付きスコアを古い順に返す |
| `POST /v1/simulate` | `Bearer PARTNER_API_KEY` | `{ ringIds, date: 'YYYY-MM-DD' }` → その日のスコアをリングごとに 1 件、決定的に作る（デモ用のデータ投入） |
| `GET /health` | なし | `{ ok: true }` |

- `ringId` は `A–Z a–z 0–9 _ -` の 1〜64 文字。
- `measuredAt` は任意の ISO 8601 の時刻。保存と署名は UTC の正規形
  （`new Date(ms).toISOString()`）で行うので、`2026-09-30T07:30:00+09:00` は
  `2026-09-29T22:30:00.000Z` になる。
- リクエストボディは 4 KiB まで。

### スコアの算出式

バイタル `{ heartRate, hrvMs, sleepHours, spo2, skinTempDelta }`（すべて数値）と
`clamp01(x) = min(1, max(0, x))` を使って:

```
score = 30 · clamp01(sleepHours / 8)
      + 25 · clamp01((hrvMs − 20) / 60)
      + 20 · clamp01((90 − heartRate) / 35)
      + 15 · clamp01((spo2 − 90) / 8)
      + 10 · clamp01(1 − |skinTempDelta| / 1.5)
```

を小数第 2 位に丸める。睡眠 8 時間、HRV 80 ms 以上、心拍 55 bpm 以下、SpO₂ 98 % 以上、
体温の偏差なしで 100 になる。`score` を直接送った場合も小数第 2 位に丸める。式は説明用で、
OHAYO! はこの式に依存しない。

`POST /v1/simulate` はバイタルを使わない。スコアは
`20 + (SHA-256("ringId|date") の先頭 2 バイト mod 8001) / 100`、id は `sim-<ringId>-<date>`、
`measuredAt` はその日の 7:30 JST。同じ呼び出しを繰り返すと、同じスコアを `created: false` で返す。

### `GET /v1/daily-scores`

```json
{
  "schemaVersion": 1,
  "keyId": "3f2a9c0d1e4b5a67",
  "nextCursor": "42",
  "scores": [
    { "id": "m-…", "ringId": "ring-1", "measuredAt": "2026-09-29T22:30:00.000Z", "score": 78.5, "signature": "…128 桁の hex…" }
  ]
}
```

- **カーソル。** `nextCursor` はページ最後のスコアの、partner 側の単調増加する受信連番。
  `measuredAt` ではないので、過去の時刻の計測値が遅れて届いても取りこぼさない。次回は
  `since` に渡す。空のページは同じカーソルを返す。ページの大きさは最大 100。
- **署名。** 次の文字列の UTF-8 バイト列に対する Ed25519 署名。

  ```
  ohayo-partner-score-v1\n{id}\n{ringId}\n{measuredAt}\n{score}
  ```

  `{score}` は JavaScript の `String(score)`。定義は `packages/shared/src/partner.ts` の
  `partnerScoreMessage` と `verifyPartnerScore` の 1 か所だけで、mock の署名にも OHAYO! の
  検証にも使う（WebCrypto なので Node 22 でも Workers でも動く）。
- **`keyId`** は、公開鍵（raw）の SHA-256 の先頭 16 桁（hex）。

## OHAYO! がページをどう扱うか

`apps/ingester/src/partner.ts` の `pullPartnerScores`:

1. 保存済みのカーソル（`partner_sync`、source は `partner_api`）を読み、空のページが返るまで
   ページを取得する。
2. `keyId` が OHAYO! の固定した鍵（`PARTNER_PUBLIC_KEY`）と違う場合や、partner が HTTP エラーを
   返した場合は、カーソルを進めずに取得全体を失敗させる。
3. 1 件ずつ判定する: 署名が不正 → `badSignature`。0..100 の外、または時刻が読めない →
   `invalid`。リングが `rings` にない → `unknownRing`。同じ `external_id` が同じリング・時刻・
   スコアで保存済み → `duplicates`。内容が違う → `conflicts`（上書きしない）。それ以外は
   `source='partner_api'`、`status='pending'`、`external_id`、`partner_sig` 付きで
   `condition_readings` の行になる。
4. ページ分の行と新しいカーソルを 1 回のバッチで書き込む。

拒否したスコアも消費済みとして扱い、カーソルはその先に進む。後から登録したリングは、
取りこぼしたスコアを拾わない。partner が新しい id で送り直せばよい。

## 鍵と設定

```bash
npm run keygen -w @midnight-demo/partner-mock
```

で `PARTNER_SIGNING_KEY`（PKCS#8、base64）、`PARTNER_PUBLIC_KEY`（raw、hex）と、ランダムな
`PARTNER_API_KEY` を表示する。

| 変数 | partner mock | OHAYO! の gateway |
|---|---|---|
| `PARTNER_SIGNING_KEY` | 必須 | — |
| `PARTNER_PUBLIC_KEY` | — | 取得に必須 |
| `PARTNER_API_KEY` | 必須 | 取得に必須 |
| `PARTNER_URL` | — | 取得に必須 |
| `PARTNER_ALLOWED_ORIGIN` | `POST /v1/measurements` を許可する OHAYO! のオリジン（既定は `http://localhost:8787`） | — |
| `PARTNER_DB_URL` | libSQL の URL（既定は `file:data/partner-mock.db`） | — |
| `PARTNER_PORT` | 既定は `8788` | — |

`run.sh e2e` は、初回に開発用の鍵一式を `.state/partner-mock/dev.env`（git の管理対象外）に
作り、専用のボリューム `mn-condition-partner-data` を使う `mn-condition-partner` を
<http://localhost:8788> で起動し、gateway に公開鍵と API キーを渡す。リングのスコアを
投入するには:

```bash
docker exec mn-condition-partner npx tsx apps/partner-mock/src/cli.ts simulate --rings ring-1
```

## CORS

ブラウザから使うのは `POST /v1/measurements` だけ（作業員のリング同期カード。`PUBLIC_PARTNER_URL` に送る）。
プリフライトに `204` を返すのは、`Origin` が `PARTNER_ALLOWED_ORIGIN`、メソッドが `POST`、
ヘッダが `content-type` 以下の場合だけで、`Access-Control-Allow-Origin` もそのオリジンに
だけ付ける。`daily-scores` と `simulate` はサーバ間の通信なので、CORS ヘッダを付けない。
