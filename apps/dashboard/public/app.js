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
    submit_h: 'コンディション値を送信（devnet）',
    submit_p: 'パートナー API の代わりに 1 件の測定値をオンチェーン記録します。生値は非公開で band のみ。',
    submit_value: 'コンディション値（0–100）', submit_recorded: '取得時刻', submit_btn: '送信',
    submit_pending: '送信中…（証明生成のため数十秒かかることがあります）',
    submit_ok: '送信しました', submit_ok_tampered: '送信（記録とチェーンを不一致に）',
    submit_ok_recovered: 'この記録は既にチェーンにありました（ローカル複製を復元）',
    submit_tamper: 'ローカル記録を改ざんする（デモ）',
    submit_tamper_hint: '— 入力値をローカル記録に、チェーンには別バンドの値を送信します。次回の照合で不一致として検知されます。',
    submit_dup: 'この日はすでに送信済みです（1 日 1 件）。',
    submit_fail: '送信に失敗しました。',
    data_h: 'データ管理（サーバー管理者）',
    data_p: 'リング・作業員のロスターをここで管理します。',
    d_workers: '作業員', d_rings: 'リング',
    add: '追加', del: '削除', del_confirm: '削除しますか？', edit: '編集',
    none_yet: 'まだありません。', added: '追加しました', updated: '更新しました', deleted: '削除しました',
    name: '名称',
    req_fail: '処理に失敗しました。',
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
    submit_h: 'Submit a condition value (devnet)',
    submit_p: 'A manual stand-in for the partner API — record one reading on-chain. The raw value stays private; only the band is disclosed.',
    submit_value: 'Condition value (0–100)', submit_recorded: 'Recorded at', submit_btn: 'Submit',
    submit_pending: 'Submitting… (generating the proof can take tens of seconds)',
    submit_ok: 'Submitted', submit_ok_tampered: 'Submitted (record vs chain now disagree)',
    submit_ok_recovered: 'This entry was already on chain (recovered the local copy)',
    submit_tamper: 'Tamper the local record (demo)',
    submit_tamper_hint: '— the entered value goes into the local record; the chain gets a value from a different band. The next reconcile flags the mismatch.',
    submit_dup: 'That day is already submitted (one entry per day).',
    submit_fail: 'Submit failed.',
    data_h: 'Data admin (server administrator)',
    data_p: 'Manage the roster — rings and workers.',
    d_workers: 'Workers', d_rings: 'Rings',
    add: 'Add', del: 'Delete', del_confirm: 'Delete?', edit: 'Edit',
    none_yet: 'None yet.', added: 'Added', updated: 'Updated', deleted: 'Deleted',
    name: 'Name',
    req_fail: 'Request failed.',
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
  return crudSection('d_rings', [t('name'), t('worker'), 'status', '記録', ''], rows, form);
}

function submitOneForm(rings) {
  if (!state.cfg.submitEnabled || !rings.length) return null;
  const ring = h('select', { name: 'ring' }, rings.map((r) => opt(r.id, `${r.label || r.id}${r.workerName ? ` · ${r.workerName}` : ''}`)));
  const value = h('input', { name: 'value', type: 'number', min: '0', max: '100', step: '0.1', required: true });
  const recorded = h('input', { name: 'recorded', type: 'datetime-local', value: toLocalInput(Date.now()), required: true });
  const tamper = h('input', { name: 'tamper', type: 'checkbox' });
  const doIt = async (form) => {
    const btn = form.querySelector('button[type=submit]');
    const fields = [ring, value, recorded, tamper];
    btn.disabled = true;
    btn.textContent = t('submit_pending');
    form.classList.add('is-pending');
    fields.forEach((f) => { f.disabled = true; });
    try {
      const r = await api('/api/submit', { method: 'POST', body: { ringId: ring.value, value: Number(value.value), recordedAt: new Date(recorded.value).toISOString(), tamper: tamper.checked } });
      if (r.recovered) toast(`${t('submit_ok_recovered')}: ${bandOf(r.band)}`, 'warn');
      else if (r.tampered) toast(`${t('submit_ok_tampered')}: ${bandOf(r.storedBand)} ⇄ ${bandOf(r.band)}`, 'warn');
      else toast(`${t('submit_ok')}: ${bandOf(r.band)}`, 'ok');
      route();
    } catch (e) {
      if (String(e.message) === 'unauthorized') return;
      const err = e.body && e.body.error;
      toast(err && /already-submitted/.test(err) ? t('submit_dup') : err || t('submit_fail'), 'err');
      btn.disabled = false;
      btn.textContent = t('submit_btn');
      form.classList.remove('is-pending');
      fields.forEach((f) => { f.disabled = false; });
    }
  };
  return h('form', { class: 'submit-form', onsubmit: (ev) => { ev.preventDefault(); doIt(ev.currentTarget); } },
    h('h3', {}, t('submit_h')),
    h('p', { class: 'muted' }, t('submit_p')),
    h('div', { class: 'submit-row' },
      h('label', {}, t('ring'), ring), h('label', {}, t('submit_value'), value),
      h('label', {}, t('submit_recorded'), recorded), h('button', { class: 'btn', type: 'submit' }, t('submit_btn'))),
    h('label', { class: 'submit-tamper' }, tamper, h('span', {}, t('submit_tamper'), ' ', h('span', { class: 'muted' }, t('submit_tamper_hint')))));
}

async function viewDataAdmin() {
  mount(h('div', { class: 'loading' }, '…'));
  let roster;
  try {
    roster = await api('/api/roster');
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
    submitOneForm(roster.rings),
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
