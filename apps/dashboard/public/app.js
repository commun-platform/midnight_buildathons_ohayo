const LS_TOKEN = 'wc_token';
const LS_LANG = 'wc_lang';

const T = {
  ja: {
    title: 'SADAKO', language: '言語', logout: 'ログアウト',
    login_h: 'ログイン', login_p: 'IDを入力してください。',
    token: 'ID', connect: 'ログイン',
    err_token: 'そのIDは無効です。', err_generic: '読み込みに失敗しました。',
    nav_overview: '本日', nav_records: '一覧', nav_data: 'データ管理',
    overview_h: '本日のコンディション',
    from: '開始日', to: '終了日', apply: '適用', all_workers: '全員',
    no_workers: '対象の作業員がいません。',
    latest: '最新', today: '今日', today_none: '本日の記録はまだありません', today_pending: '本日未取得',
    days_danger: '危険', days_caution: '要注意',
    all_confirmed: 'チェーン照合済み', some_pending: '未照合あり',
    self_h: '本日のコンディション', month_h: 'の記録', year_u: '年', month_u: '月',
    worker_h: 'の履歴', back: '← 戻る', no_entries: 'この期間の記録はありません。',
    day: '日', value: 'コンディション値',
    value_note: 'この値はあなただけに表示されます（管理者にはバンドのみ）。',
    recorded: '取得時刻', verified: '照合', entrykey: 'entryKey', commitment: 'commitment',
    tx: 'tx', explorer: 'Explorer',
    records_h: 'コンディション一覧',
    records_p: '独立検証は Node の condition:verify（今後）で。salt はブラウザに渡りません。',
    export_csv: 'CSV 書き出し', verify_btn: '照合', reverify_pending: '未照合を再照合',
    reconciled_local: 'ローカル記録で照合済み（もう一度押すとチェーンに直接照会）',
    reconciled_chain: 'チェーン直接照会で確認',
    reconcile_error: '照合エラー: バンド／生値がコントラクトと不一致（照合を取り消し）',
    reconcile_fail: '照合に失敗しました。',
    ring: 'リング', worker: '作業員', band: 'バンド',
    unset: '—',
    submit_tamper: 'ローカル記録を改ざんする（デモ）',
    submit_tamper_hint: '— 作業員の値はローカル記録に残し、チェーンには別バンドの値を送信します。一覧で照合を 2 回押すと不一致として検知されます。',
    data_h: 'データ管理（サーバー管理者）',
    data_p: 'リング・作業員のロスターと送信キューを管理します。スコアは作業員がリング同期で送り、ここでは取得とチェーンへの送信だけを行います。',
    d_workers: '作業員', d_rings: 'リング', d_records: '記録',
    add: '追加', del: '削除', del_confirm: '削除しますか？', edit: '編集',
    none_yet: 'まだありません。', added: '追加しました', updated: '更新しました', deleted: '削除しました',
    name: '名称',
    req_fail: '処理に失敗しました。',
    q_h: '送信キュー',
    q_p: 'パートナーから取得した値と手入力の値です。パートナーの生値はここにも表示しません（バンドのみ）。',
    q_pull: 'パートナーから取得', q_pulling: '取得中…',
    q_submit: 'チェーンへ送信', q_submitting: '送信中…（1 件ごとに証明を生成するため時間がかかります）',
    q_pulled: '取得', q_new: '新規', q_dup: '重複', q_conflict: '衝突', q_badsig: '署名不正',
    q_invalid: '範囲外', q_unknown_ring: '未登録リング',
    q_result: '送信結果', q_ok: '記録', q_skip: 'スキップ', q_fail: '失敗',
    q_tampered: 'ローカル記録とチェーンを不一致にしました（一覧で照合を 2 回押すと検知）',
    q_none: '送信待ちの値はありません。', q_source: '出所', q_status: '状態',
    src_partner_api: 'パートナー', src_manual: '手入力',
    st_pending: '送信待ち', st_queued: '処理待ち', st_submitted: '記録済み', st_skipped: 'スキップ', st_failed: '失敗',
    skip_already_submitted: 'この日は記録済み', skip_unknown_ring: '未登録のリング', skip_invalid_value: '不正な値',
    sync_h: 'リング同期',
    sync_p: 'リングのスコアを、パートナー（リングの会社）のサーバーへ直接送ります。SADAKO には管理者が取得したときに届きます。リング:',
    sync_score_in: 'スコア（0–100）',
    sync_send: 'パートナーへ送信', sync_sending: '送信中…',
    sync_ok: 'パートナーへ送信しました', sync_fail: 'パートナーへの送信に失敗しました',
    sync_score: 'パートナーが受け付けたスコア', sync_after: '管理者の取得と送信の後にチェーンへ記録されます。',
    sync_hint: '0〜100 のスコアを入力して送信します。',
  },
  en: {
    title: 'SADAKO', language: 'Language', logout: 'Sign out',
    login_h: 'Log in', login_p: 'Enter your ID.',
    token: 'ID', connect: 'Log in',
    err_token: 'That ID is not valid.', err_generic: 'Failed to load.',
    nav_overview: 'Today', nav_records: 'List', nav_data: 'Data admin',
    overview_h: "Today's condition",
    from: 'From', to: 'To', apply: 'Apply', all_workers: 'All workers',
    no_workers: 'No workers in scope.',
    latest: 'latest', today: 'Today', today_none: 'No reading recorded today yet', today_pending: 'not recorded yet',
    days_danger: 'danger', days_caution: 'caution',
    all_confirmed: 'chain-confirmed', some_pending: 'some pending',
    self_h: "Today's condition", month_h: ' records', year_u: '', month_u: '',
    worker_h: ' — history', back: '← Back', no_entries: 'No records in this range.',
    day: 'Day', value: 'Condition value',
    value_note: 'Only you can see this value — the admin sees the band only.',
    recorded: 'Recorded', verified: 'Verified', entrykey: 'entryKey', commitment: 'commitment',
    tx: 'tx', explorer: 'Explorer',
    records_h: 'Condition list',
    records_p: 'Full independent verification runs in Node (condition:verify, planned). The salt is never sent to the browser.',
    export_csv: 'Export CSV', verify_btn: 'verify', reverify_pending: 'Re-verify pending',
    reconciled_local: 'Verified from the local record (press again to check the chain directly)',
    reconciled_chain: 'Verified against the chain directly',
    reconcile_error: 'Reconcile error: band / raw value disagrees with the contract (verification withdrawn)',
    reconcile_fail: 'Reconciliation failed.',
    ring: 'Ring', worker: 'Worker', band: 'Band',
    unset: '—',
    submit_tamper: 'Tamper the local record (demo)',
    submit_tamper_hint: "— the worker's value stays in the local record; the chain gets a value from a different band. Pressing verify twice in the list flags the mismatch.",
    data_h: 'Data admin (server administrator)',
    data_p: 'Manage the roster and the submission queue. Workers send scores through ring sync; here you only pull them and submit them to the chain.',
    d_workers: 'Workers', d_rings: 'Rings', d_records: 'Records',
    add: 'Add', del: 'Delete', del_confirm: 'Delete?', edit: 'Edit',
    none_yet: 'None yet.', added: 'Added', updated: 'Updated', deleted: 'Deleted',
    name: 'Name',
    req_fail: 'Request failed.',
    q_h: 'Submission queue',
    q_p: 'Values pulled from the partner and entered by hand. A partner value is never shown here either — band only.',
    q_pull: 'Pull from partner', q_pulling: 'Pulling…',
    q_submit: 'Submit to chain', q_submitting: 'Submitting… (a proof per value — this takes a while)',
    q_pulled: 'Pulled', q_new: 'new', q_dup: 'duplicate', q_conflict: 'conflict', q_badsig: 'bad signature',
    q_invalid: 'out of range', q_unknown_ring: 'unknown ring',
    q_result: 'Submitted', q_ok: 'recorded', q_skip: 'skipped', q_fail: 'failed',
    q_tampered: 'the local record now disagrees with the chain (press verify twice in the list to catch it)',
    q_none: 'Nothing waiting to be submitted.', q_source: 'Source', q_status: 'Status',
    src_partner_api: 'partner', src_manual: 'manual',
    st_pending: 'pending', st_queued: 'queued', st_submitted: 'recorded', st_skipped: 'skipped', st_failed: 'failed',
    skip_already_submitted: 'day already recorded', skip_unknown_ring: 'unknown ring', skip_invalid_value: 'invalid value',
    sync_h: 'Ring sync',
    sync_p: "Sends your ring's score straight to the partner (the ring company). SADAKO receives it only when the admin pulls. Ring:",
    sync_score_in: 'Score (0–100)',
    sync_send: 'Send to partner', sync_sending: 'Sending…',
    sync_ok: 'Sent to the partner', sync_fail: 'Sending to the partner failed',
    sync_score: 'Score accepted by the partner', sync_after: 'It is recorded on chain after the admin pulls and submits it.',
    sync_hint: 'Enter a score from 0 to 100 and send it.',
  },
};

const BAND = {
  ja: { normal: '正常', caution: '要注意', danger: '危険' },
  en: { normal: 'normal', caution: 'caution', danger: 'danger' },
};

const state = {
  token: localStorage.getItem(LS_TOKEN) || '',
  lang: localStorage.getItem(LS_LANG) || 'ja',
  me: null,
  cfg: { network: null, explorerUrl: null },
};
const t = (k) => T[state.lang][k] ?? k;
const bandOf = (b) => (b ? BAND[state.lang][b] || b : '—');

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === 0 || kid) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}
const $view = () => document.getElementById('view');
function mount(...kids) {
  const v = $view();
  v.replaceChildren();
  for (const kid of kids.flat()) if (kid === 0 || kid) v.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  const applyResize = () =>
    v.querySelectorAll('table:not(.resizable)').forEach(resizableTable);
  requestAnimationFrame(applyResize);
  setTimeout(applyResize, 60);
}

function resizableTable(table) {
  if (!table.tHead || table.classList.contains('resizable')) return;
  if (table.getBoundingClientRect().width === 0) {
    setTimeout(() => resizableTable(table), 150);
    return;
  }
  table.classList.add('resizable');
  const ths = [...table.tHead.rows[0].cells];
  table.style.tableLayout = 'fixed';
  table.style.width = 'auto';
  const widths = ths.map((th) => Math.max(64, Math.min(280, Math.round(th.getBoundingClientRect().width))));
  ths.forEach((th, i) => { th.style.width = `${widths[i]}px`; });
  const setTotal = () => {
    const total = ths.reduce((s, th) => s + parseFloat(th.style.width || '0'), 0);
    table.style.width = `${total}px`;
    table.style.minWidth = `${total}px`;
  };
  setTotal();

  const head = table.tHead;
  const EDGE = 8;
  const edgeCol = (clientX) => {
    for (const th of ths) {
      if (Math.abs(clientX - th.getBoundingClientRect().right) <= EDGE) return th;
    }
    return null;
  };

  const fitWidth = (i) => {
    let w = ths[i].scrollWidth + 20;
    for (const row of table.tBodies[0]?.rows ?? []) {
      const cell = row.cells[i];
      if (!cell) continue;
      const ellip = cell.querySelector('.ellip');
      const need = ellip ? cell.clientWidth - ellip.clientWidth + ellip.scrollWidth : cell.scrollWidth;
      w = Math.max(w, Math.ceil(need) + 4);
    }
    return Math.min(1200, Math.max(44, w));
  };

  head.addEventListener('pointermove', (e) => {
    if (head.hasPointerCapture(e.pointerId)) return;
    const th = edgeCol(e.clientX);
    ths.forEach((x) => x.classList.toggle('col-grab', x === th));
  });
  head.addEventListener('pointerleave', () => ths.forEach((x) => x.classList.remove('col-grab')));

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const th = edgeCol(e.clientX);
    if (!th) return;
    e.preventDefault();
    try { head.setPointerCapture(e.pointerId); } catch {  }
    document.body.classList.add('col-resizing');
    th.classList.add('col-grab');
    const startX = e.clientX;
    const startW = parseFloat(th.style.width);
    const move = (ev) => {
      th.style.width = `${Math.max(44, startW + ev.clientX - startX)}px`;
      setTotal();
    };
    const end = () => {
      try { head.releasePointerCapture(e.pointerId); } catch {  }
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
      document.removeEventListener('pointerup', end);
      document.body.classList.remove('col-resizing');
      th.classList.remove('col-grab');
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    document.addEventListener('pointerup', end);
  });

  head.addEventListener('dblclick', (e) => {
    const th = edgeCol(e.clientX);
    if (!th) return;
    const i = ths.indexOf(th);
    th.style.width = `${fitWidth(i)}px`;
    setTotal();
  });
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: {
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    setToken('');
    location.hash = '#/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const err = new Error(String(res.status));
    err.body = await res.json().catch(() => null);
    throw err;
  }
  return res.json();
}

function toast(msg, kind) {
  const node = h('div', { class: `toast ${kind || ''}` }, msg);
  document.body.append(node);
  setTimeout(() => node.remove(), 3800);
}

async function reconcile(entryKeys, after) {
  if (!entryKeys.length) return;
  try {
    const r = await api('/api/reconcile', { method: 'POST', body: { entryKeys } });
    if (r.valueMismatches || r.mismatches) {
      toast(`${t('reconcile_error')}: ${(r.valueMismatches || 0) + (r.mismatches || 0)}`, 'err');
    } else if (r.localChecked) {
      toast(`${t('reconciled_local')}: ${r.localChecked}`, 'ok');
    } else {
      toast(`${t('reconciled_chain')}: ${r.confirmed}`, 'ok');
    }
    after && after();
  } catch (e) {
    if (String(e.message) === 'unauthorized') return;
    toast((e.body && e.body.error) || t('reconcile_fail'), 'err');
  }
}

function setToken(tok) {
  state.token = tok;
  if (tok) localStorage.setItem(LS_TOKEN, tok);
  else localStorage.removeItem(LS_TOKEN);
  const lo = document.getElementById('logout');
  if (lo) lo.hidden = !tok;
}

const APP_TZ = 'Asia/Tokyo';
const DAY = 86_400_000;
const _ymd = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
const _hm = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = (ms, tz = APP_TZ) => _ymd(tz).format(ms);
const fmtTime = (ms, tz = APP_TZ) => _hm(tz).format(ms);
const todayYmd = () => fmtDay(Date.now());
function defaultRange() {
  const today = todayYmd();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
function rangeFromHash() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = defaultRange();
  let from = q.get('from') || d.from;
  let to = q.get('to') || d.to;
  if (to > d.to) to = d.to;
  if (from > to) from = to;
  return { from, to };
}
const fmtValue = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const toLocalInput = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function bandChip(band) {
  return h('span', { class: `chip ${band || 'none'}` }, band ? bandOf(band) : '—');
}
function banner(msg) {
  return h('div', { class: 'banner', role: 'alert' }, msg);
}
function latestOf(entries) {
  return entries.length ? [...entries].sort((a, b) => b.periodStartMs - a.periodStartMs)[0] : null;
}
function whoLabel(r) {
  return r.workerName || r.workerId || r.ringId;
}
const txExplorerUrl = (txId) =>
  txId && txId !== 'unknown' && state.cfg.explorerUrl
    ? `${state.cfg.explorerUrl.replace(/\/$/, '')}/tx/${txId}`
    : null;

function ellipCell(text, { href = null } = {}) {
  if (!text || text === 'unknown') return h('td', { class: 'ellip-td' }, '—');
  const inner = href
    ? h('a', { class: 'ellip mono ext', href, target: '_blank', rel: 'noreferrer', title: text }, text)
    : h('span', { class: 'ellip mono', title: text }, text);
  return h('td', { class: 'ellip-td' }, h('div', { class: 'ellip-row' }, inner));
}
function verifiedCell(entry) {
  return h('button', {
    class: entry.verified ? 'reverify done' : 'reverify', type: 'button', title: t('some_pending'),
    onclick: (e) => { e.stopPropagation(); reconcile([entry.entryKey], () => route()); },
  }, entry.verified ? '✓ ' : '⚠ ', t('verify_btn'));
}
function pendingButtons(entries) {
  const pending = entries.filter((e) => !e.verified).map((e) => e.entryKey);
  if (!pending.length) return [];
  return [
    h('span', { class: 'pending' }, `⚠ ${pending.length}`),
    h('button', { class: 'btn secondary', type: 'button', onclick: () => reconcile(pending, () => route()) },
      `${t('reverify_pending')} (${pending.length})`),
  ];
}
function viewLogin() {
  const input = h('input', { id: 'id-input', type: 'text', autocomplete: 'off', spellcheck: 'false', value: state.token });
  const err = h('div');
  const submit = async (e) => {
    e.preventDefault();
    err.replaceChildren();
    setToken(input.value.trim());
    try {
      state.me = await api('/api/me');
      location.hash = home();
    } catch {
      setToken('');
      err.replaceChildren(banner(t('err_token')));
    }
  };
  mount(
    h('form', { class: 'card login', onsubmit: submit },
      h('h1', {}, t('login_h')),
      h('p', { class: 'muted' }, t('login_p')),
      err,
      h('label', { for: 'id-input' }, t('token')),
      input,
      h('button', { class: 'btn', type: 'submit' }, t('connect')),
    ),
  );
}

function todayEntry(w) {
  const today = todayYmd();
  return w.entries.find((e) => fmtDay(e.periodStartMs, w.timezone) === today) || null;
}

function workerCard(w) {
  const te = todayEntry(w);
  const target = !w.workerId
    ? ''
    : canRecords()
      ? `#/records?worker=${encodeURIComponent(w.workerId)}&from=${thisYm()}-01T00:00&to=${toLocalInput(Date.now())}`
      : `#/worker/${w.workerId}`;
  return h('div', {
    class: `card worker-card today-${te ? te.band : 'none'}`, role: 'button', tabindex: '0',
    onclick: () => { if (target) location.hash = target; },
    onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && target) location.hash = target; },
  },
    h('div', { class: 'name' }, whoLabel(w)),
    h('div', { class: 'today-block' },
      te
        ? h('span', { class: `chip big ${te.band}` }, bandOf(te.band))
        : h('span', { class: 'chip big none' }, t('today_pending')),
      te && !te.verified && h('span', { class: 'pending' }, '⚠ ' + t('some_pending')),
    ),
  );
}

async function loadConditions(range, extraPath) {
  try {
    return await api(extraPath || `/api/conditions/mine?from=${range.from}&to=${range.to}`);
  } catch (e) {
    if (String(e.message) === 'unauthorized') throw e;
    mount(banner(t('err_generic')));
    return null;
  }
}

async function viewOverview() {
  if (state.me.role === 'worker') return viewWorkerSelf();

  const today = todayYmd();
  mount(h('div', { class: 'loading' }, '…'));
  const data = await loadConditions(null, `/api/conditions/mine?from=${today}&to=${today}`);
  if (!data) return;

  const byWorker = new Map();
  for (const r of data.rings) {
    const key = r.workerId || r.ringId;
    if (!byWorker.has(key)) byWorker.set(key, { ...r, entries: [] });
    byWorker.get(key).entries.push(...r.entries);
  }
  const sections = byWorker.size
    ? [h('div', { class: 'grid' }, [...byWorker.values()].map((w) => workerCard(w)))]
    : [h('p', { class: 'muted' }, t('no_workers'))];

  mount(h('h1', {}, t('overview_h')), h('p', { class: 'muted' }, today), ...sections);
}

const thisYm = () => todayYmd().slice(0, 7);

function ymFromHash() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const ym = q.get('ym') || thisYm();
  return /^\d{4}-\d{2}$/.test(ym) && ym <= thisYm() ? ym : thisYm();
}

function ymRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(last).padStart(2, '0')}`;
  return { from: `${ym}-01`, to: to > todayYmd() ? todayYmd() : to };
}

function monthPicker(ym, nav) {
  const nowY = Number(thisYm().slice(0, 4));
  const nowM = Number(thisYm().slice(5));
  const [selY, selM] = ym.split('-').map(Number);
  const ySel = h('select', {}, [0, 1, 2].map((d) => opt(String(nowY - d), `${nowY - d}${t('year_u')}`, String(selY))));
  const mSel = h('select', {}, Array.from({ length: 12 }, (_, i) =>
    h('option', {
      value: String(i + 1).padStart(2, '0'),
      selected: i + 1 === selM ? true : false,
      disabled: selY === nowY && i + 1 > nowM ? true : false,
    }, `${i + 1}${t('month_u')}`)));
  const go = () => nav(`${ySel.value}-${mSel.value}`);
  ySel.addEventListener('change', () => {
    const yv = Number(ySel.value);
    [...mSel.options].forEach((o, i) => { o.disabled = yv === nowY && i + 1 > nowM; });
    if (mSel.selectedOptions[0]?.disabled) mSel.value = String(nowM).padStart(2, '0');
    go();
  });
  mSel.addEventListener('change', go);
  return { ySel, mSel };
}

function ringSyncCard() {
  if (!state.cfg.partnerUrl || !state.me || !state.me.ringId) return null;
  const score = h('input', { name: 'score', type: 'number', min: '0', max: '100', step: '0.01', required: true });
  const result = h('p', { class: 'sync-result muted' }, t('sync_hint'));
  const send = async (form) => {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = t('sync_sending');
    try {
      const res = await fetch(new URL('/v1/measurements', state.cfg.partnerUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ringId: state.me.ringId, measuredAt: new Date().toISOString(), score: Number(score.value) }),
      });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error((r && r.error) || String(res.status));
      result.className = 'sync-result';
      result.replaceChildren(h('strong', {}, `${t('sync_score')}: ${fmtValue(r.score)}`), ' — ', t('sync_after'));
      toast(t('sync_ok'), 'ok');
      score.value = '';
    } catch (e) {
      toast(`${t('sync_fail')}: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = t('sync_send');
    }
  };
  return h('form', { class: 'card ring-sync', onsubmit: (ev) => { ev.preventDefault(); send(ev.currentTarget); } },
    h('h2', {}, t('sync_h')),
    h('p', { class: 'muted' }, t('sync_p'), ' ', h('span', { class: 'mono' }, state.me.ringId)),
    h('div', { class: 'submit-row' },
      h('label', {}, t('sync_score_in'), score),
      h('button', { class: 'btn', type: 'submit' }, t('sync_send'))),
    result);
}

async function viewWorkerSelf() {
  const workerId = state.me.workerId;
  const ym = ymFromHash();
  const mr = ymRange(ym);
  const today = todayYmd();
  mount(h('div', { class: 'loading' }, '…'));

  let monthData;
  try {
    monthData = await api(`/api/conditions/worker/${workerId}?from=${mr.from}&to=${mr.to}`);
  } catch (e) {
    if (String(e.message) === 'unauthorized') return;
    mount(banner(t('err_generic')));
    return;
  }
  const tz = monthData.rings[0]?.timezone || APP_TZ;
  const entries = monthData.rings.flatMap((r) => r.entries).sort((a, b) => b.periodStartMs - a.periodStartMs);
  const showValue = entries.some((e) => e.value != null);

  let te = entries.find((e) => fmtDay(e.periodStartMs, tz) === today) || null;
  if (!te && ym !== thisYm()) {
    const td = await api(`/api/conditions/worker/${workerId}?from=${today}&to=${today}`).catch(() => null);
    te = td?.rings.flatMap((r) => r.entries)[0] || null;
  }

  const todayCard = h('div', { class: `card self-today band-${te ? te.band : 'none'}` },
    h('div', { class: 'self-today-date' }, today),
    te
      ? h('div', { class: 'self-today-body' },
          h('span', { class: `chip huge ${te.band}` }, bandOf(te.band)),
          showValue && te.value != null && h('span', { class: 'self-today-value' }, fmtValue(te.value)),
          !te.verified && h('span', { class: 'pending' }, '⚠ ' + t('some_pending')))
      : h('div', { class: 'self-today-body muted' }, t('today_none')),
  );

  const [selY, selM] = ym.split('-').map(Number);
  const { ySel, mSel } = monthPicker(ym, (v) => { location.hash = `#/overview?ym=${v}`; });
  const picker = h('div', { class: 'controls' }, ySel, mSel);

  const rows = entries.map((e) => h('tr', {},
    h('td', {}, fmtDay(e.periodStartMs, tz)),
    h('td', {}, bandChip(e.band)),
    showValue && h('td', { class: 'mono' }, e.value != null ? fmtValue(e.value) : '—'),
    h('td', {}, fmtTime(e.recordedAtMs, tz)),
    h('td', {}, verifiedCell(e)),
  ));

  const monthLabel = state.lang === 'ja' ? `${selY}年${selM}月の記録` : `${ym}${t('month_h')}`;

  mount(
    h('h1', {}, t('self_h')),
    todayCard,
    ringSyncCard(),
    picker,
    h('h2', {}, monthLabel),
    showValue ? h('p', { class: 'muted' }, t('value_note')) : false,
    entries.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, t('day')), h('th', {}, t('band')),
            showValue && h('th', {}, t('value')),
            h('th', {}, t('recorded')), h('th', {}, t('verified')))),
          h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, t('no_entries')),
  );
}

async function viewWorker(workerId) {
  const range = rangeFromHash();
  mount(h('div', { class: 'loading' }, '…'));
  const data = await loadConditions(range, `/api/conditions/worker/${workerId}?from=${range.from}&to=${range.to}`);
  if (!data) return;

  const tz = data.rings[0]?.timezone || APP_TZ;
  const entries = data.rings.flatMap((r) => r.entries).sort((a, b) => a.periodStartMs - b.periodStartMs);
  const name = data.rings[0] ? whoLabel(data.rings[0]) : workerId;
  const isAdmin = Boolean(state.me.admin);
  const showValue = entries.some((e) => e.value != null);

  const strip = h('div', { class: 'strip' }, entries.map((e) => h('div', {
    class: `day ${e.band}${e.verified ? '' : ' pending'}`,
    title: `${fmtDay(e.periodStartMs, tz)} · ${bandOf(e.band)}${e.value != null ? ` · ${fmtValue(e.value)}` : ''}${e.verified ? '' : ' (pending)'}`,
  })));

  const rows = entries.map((e) => h('tr', {},
    h('td', {}, fmtDay(e.periodStartMs, tz)),
    h('td', {}, bandChip(e.band)),
    showValue && h('td', { class: 'mono' }, e.value != null ? fmtValue(e.value) : '—'),
    h('td', {}, fmtTime(e.recordedAtMs, tz)),
    h('td', {}, verifiedCell(e)),
    isAdmin && ellipCell(e.entryKey),
    isAdmin && ellipCell(e.scoreCommitmentHex),
    isAdmin && ellipCell(e.txId, { href: txExplorerUrl(e.txId) }),
  ));

  mount(
    h('a', { class: 'link-btn', href: home() }, t('back')),
    h('h1', {}, name, t('worker_h')),
    showValue && h('p', { class: 'muted' }, t('value_note')),
    pendingButtons(entries).length ? h('div', { class: 'pending-bar' }, ...pendingButtons(entries)) : false,
    entries.length ? strip : h('p', { class: 'muted' }, t('no_entries')),
    entries.length && h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, t('day')), h('th', {}, t('band')),
        showValue && h('th', {}, t('value')),
        h('th', {}, t('recorded')), h('th', {}, t('verified')),
        isAdmin && h('th', {}, t('entrykey')), isAdmin && h('th', {}, t('commitment')), isAdmin && h('th', {}, t('tx')))),
      h('tbody', {}, rows))),
  );
}

async function viewRecords() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const nowStr = toLocalInput(Date.now());
  let from = q.get('from') || `${thisYm()}-01T00:00`;
  let to = q.get('to') || nowStr;
  if (to > nowStr) to = nowStr;
  if (from > to) from = to;
  let worker = q.get('worker') || '';
  mount(h('div', { class: 'loading' }, '…'));

  const data = await loadConditions(null,
    `/api/conditions/mine?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (!data) return;

  const isAdmin = Boolean(state.me.admin);
  const dropLabel = (r) => isAdmin
    ? `${r.workerId} - ${r.workerName || r.workerId}`
    : (r.workerName || r.workerId);
  const cellLabel = (r) => isAdmin
    ? `${r.workerName || r.workerId}（${r.workerId}）`
    : (r.workerName || '');

  const people = new Map();
  for (const r of data.rings) {
    if (r.workerId && !people.has(r.workerId)) people.set(r.workerId, dropLabel(r));
  }
  if (worker && !people.has(worker)) worker = '';

  const flat = [];
  for (const r of data.rings) {
    if (worker && r.workerId !== worker) continue;
    for (const e of r.entries) {
      flat.push({
        ring: r.ringId, worker: cellLabel(r), day: fmtDay(e.periodStartMs, r.timezone), recorded: fmtTime(e.recordedAtMs, r.timezone),
        band: e.band, verified: e.verified, entryKey: e.entryKey, commitment: e.scoreCommitmentHex, txId: e.txId || '',
      });
    }
  }
  flat.sort((a, b) => (a.day < b.day ? 1 : -1));

  const fromI = h('input', { type: 'datetime-local', value: from, max: nowStr });
  const toI = h('input', { type: 'datetime-local', value: to, max: nowStr });
  const pSel = h('select', {}, [
    opt('', t('all_workers'), worker),
    ...[...people.entries()].map(([id, label]) => opt(id, label, worker)),
  ]);
  const apply = () => {
    let f = fromI.value || from;
    let tv = toI.value || to;
    if (tv > nowStr) tv = nowStr;
    if (f > tv) f = tv;
    const w = pSel.value;
    location.hash = `#/records?from=${f}&to=${tv}${w ? `&worker=${encodeURIComponent(w)}` : ''}`;
  };
  const range = h('div', { class: 'controls' },
    h('div', {}, h('label', {}, t('from')), fromI),
    h('div', {}, h('label', {}, t('to')), toI),
    h('div', {}, h('label', {}, t('worker')), pSel),
    h('button', { class: 'btn secondary', type: 'button', onclick: apply }, t('apply')),
  );

  const rows = flat.map((f) => h('tr', {},
    h('td', {}, f.day), h('td', {}, f.recorded), h('td', {}, f.ring), h('td', {}, f.worker),
    h('td', {}, bandChip(f.band)), h('td', {}, verifiedCell(f)),
    ellipCell(f.entryKey), ellipCell(f.txId, { href: txExplorerUrl(f.txId) })));

  mount(
    h('h1', {}, t('records_h')),
    h('p', { class: 'muted' }, `${from.replace('T', ' ')} – ${to.replace('T', ' ')}`),
    range,
    h('div', { class: 'pending-bar' },
      h('button', { class: 'btn secondary', type: 'button', onclick: () => downloadCsv(flat) }, t('export_csv')),
      ...pendingButtons(flat)),
    flat.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, t('day')), h('th', {}, t('recorded')), h('th', {}, t('ring')), h('th', {}, t('worker')),
            h('th', {}, t('band')), h('th', {}, t('verified')), h('th', {}, t('entrykey')), h('th', {}, t('tx')))),
          h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, t('no_entries')),
  );
}

function downloadCsv(rows) {
  const head = ['day', 'recorded', 'ring', 'worker', 'band', 'verified', 'entryKey', 'commitment', 'txId'];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [head.join(','), ...rows.map((r) => head.map((k) => esc(r[k])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = h('a', { href: url, download: `condition-records-${todayYmd()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function adminMut(method, path, body, okKey) {
  try {
    await api(path, body === undefined ? { method } : { method, body });
    if (okKey) toast(t(okKey), 'ok');
    route();
  } catch (e) {
    if (String(e.message) === 'unauthorized') return;
    toast((e.body && e.body.error) || t('req_fail'), 'err');
  }
}

function opt(value, label, selected) {
  return h('option', { value, selected: value === selected ? true : false }, label);
}

function crudSection(titleKey, headers, rows, form) {
  return h('section', { class: 'crud-section' },
    h('h2', {}, t(titleKey)),
    rows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'feed-table' },
          h('thead', {}, h('tr', {}, ...headers.map((hd) => h('th', {}, hd)))),
          h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, t('none_yet')),
    form);
}
function delBtn(path) {
  return h('button', { class: 'btn secondary sm', type: 'button',
    onclick: () => { if (confirm(t('del_confirm'))) adminMut('DELETE', path, undefined, 'deleted'); } }, t('del'));
}
function addForm(fields, submit) {
  const inputs = {};
  const kids = fields.map((f) => {
    const el = f.el || h('input', { name: f.name, placeholder: f.ph || f.label, required: f.required ? true : false });
    inputs[f.name] = el;
    return h('label', {}, f.label, el);
  });
  return h('form', {
    class: 'submit-form',
    onsubmit: (ev) => { ev.preventDefault(); submit(inputs); },
  }, h('div', { class: 'submit-row' }, ...kids, h('button', { class: 'btn', type: 'submit' }, t('add'))));
}

function workersSection(r) {
  const rows = r.workers.map((w) => {
    return h('tr', {},
      h('td', {}, w.name), h('td', { class: 'mono small' }, w.id),
      h('td', {}, w.assignedRing || '—'),
      h('td', { class: 'feed-actions' }, delBtn(`/api/workers/${w.id}`)));
  });
  const form = addForm([
    { name: 'name', label: t('name'), required: true },
    { name: 'id', label: 'id', ph: 'auto' },
  ], (i) => adminMut('POST', '/api/workers', { id: i.id.value || undefined, name: i.name.value }, 'added'));
  return crudSection('d_workers', [t('name'), 'ID', t('ring'), ''], rows, form);
}

function ringsSection(r) {
  const rows = r.rings.map((ring) => {
    const wsel = h('select', {}, [opt('', t('unset')), ...r.workers.map((w) => opt(w.id, `${w.id} - ${w.name}`))]);
    wsel.value = ring.workerId || '';
    wsel.addEventListener('change', () => adminMut('PATCH', `/api/rings/${ring.id}`, { workerId: wsel.value || null }, 'updated'));
    return h('tr', {},
      h('td', {}, ring.label),
      h('td', {}, wsel), h('td', {}, ring.status), h('td', {}, String(ring.submissionCount)),
      h('td', { class: 'feed-actions' }, delBtn(`/api/rings/${ring.id}`)));
  });
  const form = addForm([
    { name: 'label', label: t('name'), required: true },
    { name: 'id', label: 'id', ph: 'auto' },
  ], (i) => adminMut('POST', '/api/rings', { id: i.id.value || undefined, label: i.label.value }, 'added'));
  return crudSection('d_rings', [t('name'), t('worker'), 'status', t('d_records'), ''], rows, form);
}

function statusChip(row) {
  const detail = row.status === 'skipped' && row.skipReason
    ? t(`skip_${row.skipReason}`)
    : row.status === 'failed' ? row.lastError : null;
  return h('span', { class: `chip st-${row.status}`, title: detail || '' },
    t(`st_${row.status}`), detail ? ` · ${detail}` : '');
}

async function busyButton(btn, busyKey, idleKey, work) {
  btn.disabled = true;
  btn.textContent = t(busyKey);
  try {
    await work();
    route();
  } catch (e) {
    if (String(e.message) === 'unauthorized') return;
    toast((e.body && e.body.error) || t('req_fail'), 'err');
    btn.disabled = false;
    btn.textContent = t(idleKey);
  }
}

function queueSection(rows) {
  const waiting = rows.filter((r) => ['pending', 'queued', 'failed'].includes(r.status));
  const pull = state.cfg.partnerPullEnabled
    ? h('button', { class: 'btn', type: 'button', onclick: (ev) => busyButton(ev.currentTarget, 'q_pulling', 'q_pull', async () => {
        const r = await api('/api/partner/pull', { method: 'POST', body: {} });
        const parts = [[r.inserted, 'q_new'], [r.duplicates, 'q_dup'], [r.conflicts, 'q_conflict'],
          [r.badSignature, 'q_badsig'], [r.invalid, 'q_invalid'], [r.unknownRing, 'q_unknown_ring']]
          .filter(([n]) => n).map(([n, k]) => `${t(k)} ${n}`);
        const bad = r.conflicts || r.badSignature || r.invalid || r.unknownRing;
        toast(`${t('q_pulled')} ${r.fetched}${parts.length ? ` — ${parts.join(' / ')}` : ''}`, bad ? 'warn' : 'ok');
      }) }, t('q_pull'))
    : null;
  const tamper = h('input', { type: 'checkbox' });
  const submit = state.cfg.submitEnabled && waiting.length
    ? h('button', { class: 'btn', type: 'button', onclick: (ev) => busyButton(ev.currentTarget, 'q_submitting', 'q_submit', async () => {
        const r = await api('/api/staged/submit', { method: 'POST', body: { tamper: tamper.checked } });
        const summary = `${t('q_result')}: ${t('q_ok')} ${r.submitted} / ${t('q_skip')} ${r.skipped} / ${t('q_fail')} ${r.failed}`;
        if (r.tampered) toast(`${summary} — ${t('q_tampered')}`, 'warn');
        else toast(summary, r.failed ? 'err' : r.skipped ? 'warn' : 'ok');
      }) }, `${t('q_submit')} (${waiting.length})`)
    : null;
  const tamperOption = submit
    ? h('label', { class: 'submit-tamper' }, tamper,
        h('span', {}, t('submit_tamper'), ' ', h('span', { class: 'muted' }, t('submit_tamper_hint'))))
    : null;
  const body = rows.map((r) => {
    const ms = Date.parse(r.recordedAt);
    return h('tr', {},
      h('td', { class: 'mono small' }, Number.isFinite(ms) ? `${fmtDay(ms)} ${fmtTime(ms)}` : r.recordedAt),
      h('td', {}, r.ringLabel || r.ringId),
      h('td', {}, r.workerName || '—'),
      h('td', {}, bandChip(r.band)),
      h('td', {}, t(`src_${r.source}`)),
      h('td', {}, statusChip(r)),
      h('td', { class: 'feed-actions' }, ['pending', 'failed'].includes(r.status) ? delBtn(`/api/staged/${r.id}`) : null));
  });
  return h('section', { class: 'crud-section' },
    h('h2', {}, t('q_h')),
    h('p', { class: 'muted' }, t('q_p')),
    pull || submit ? h('div', { class: 'queue-actions' }, pull, submit) : null,
    tamperOption,
    rows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'feed-table' },
          h('thead', {}, h('tr', {}, ...[t('recorded'), t('ring'), t('worker'), t('band'), t('q_source'), t('q_status'), ''].map((hd) => h('th', {}, hd)))),
          h('tbody', {}, body)))
      : h('p', { class: 'muted' }, t('q_none')));
}

async function viewDataAdmin() {
  mount(h('div', { class: 'loading' }, '…'));
  let roster;
  let staged;
  try {
    [roster, staged] = await Promise.all([api('/api/roster'), api('/api/staged')]);
  } catch (e) {
    if (String(e.message) === 'unauthorized') return;
    mount(banner(t('err_generic')));
    return;
  }
  mount(
    h('h1', {}, t('data_h')),
    h('p', { class: 'muted' }, t('data_p')),
    workersSection(roster),
    ringsSection(roster),
    queueSection(staged.rows),
  );
}

const canRecords = () => state.me && state.me.role === 'admin';
const canAdmin = () => Boolean(state.me && state.me.admin);
const home = () => '#/overview';

function renderChrome() {
  document.documentElement.lang = state.lang;
  document.getElementById('brand-title').textContent = t('title');
  document.getElementById('lang-label').textContent = t('language');
  document.getElementById('lang-select').value = state.lang;
  const logout = document.getElementById('logout');
  logout.textContent = t('logout');
  logout.hidden = !state.token;
  document.getElementById('net-label').textContent = state.cfg.network || '';

  const nav = document.getElementById('nav');
  if (state.me) {
    nav.hidden = false;
    const here = location.hash.split('?')[0];
    const link = (href, label, active) => h('a', { href, class: active ? 'active' : '' }, label);
    const links = [];
    links.push(link('#/overview', t('nav_overview'), here.startsWith('#/overview') || here.startsWith('#/worker')));
    if (canRecords()) links.push(link('#/records', t('nav_records'), here === '#/records'));
    if (canAdmin()) links.push(link('#/data', t('nav_data'), here === '#/data'));
    nav.replaceChildren(...links);
  } else {
    nav.hidden = true;
  }
}

async function route() {
  renderChrome();
  const path = location.hash.split('?')[0] || '#/';
  if (!state.token) { viewLogin(); return; }
  if (!state.me) {
    try { state.me = await api('/api/me'); } catch { viewLogin(); return; }
    renderChrome();
  }
  if (path === '#/data') { if (!canAdmin()) { location.hash = home(); return; } return viewDataAdmin(); }
  if (path === '#/records') {
    if (!canRecords()) { location.hash = home(); return; }
    return viewRecords();
  }
  const wm = path.match(/^#\/worker\/(.+)$/);
  if (wm) return viewWorker(decodeURIComponent(wm[1]));
  if (path === '#/login') { location.hash = home(); return; }
  return viewOverview();
}

document.getElementById('lang-select').addEventListener('change', (e) => {
  state.lang = e.target.value;
  localStorage.setItem(LS_LANG, state.lang);
  route();
});
document.getElementById('logout').addEventListener('click', () => {
  setToken('');
  state.me = null;
  location.hash = '#/login';
});
window.addEventListener('hashchange', route);

(async () => {
  try { state.cfg = await (await fetch('/api/config')).json(); } catch {  }
  if (!location.hash) location.hash = state.token ? '#/overview' : '#/login';
  route();
})();
