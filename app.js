"use strict";
// 株マーケット: stock-data(非公開)の data/*.json を読み、4つのタブに表示する

const REPO = "dinasta7788/stock-data";
const FILES = ["morning", "evening", "calendar"];
// 開発用の PC で試すときは、隣の stock-data フォルダのデータを直接読む(公開のリポジトリにはデータを置かない)
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const SINYOU_URL = "https://nikkei225jp.com/data/sinyou.php";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では何もしない */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

const state = {
  data: {},
  loadErrors: [],
  lastLoad: 0,
  tab: null,
  ui: { kind: "すべて", mover: "値上がり率", top30: "代金", sectorsAll: false, flowAll: false, more: {} },
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- 数字の表示 ----------
function isNum(v) { return typeof v === "number" && isFinite(v); }
function fmt(v, digits) {
  if (!isNum(v)) return "—";
  const d = digits ?? (Math.abs(v) < 10 ? 3 : 2);
  return v.toLocaleString("ja-JP", { maximumFractionDigits: d, minimumFractionDigits: digits ?? 0 });
}
function signed(v, d = 2, unit = "") { return isNum(v) ? (v > 0 ? "+" : "") + fmt(v, d) + unit : "—"; }
function cls(v) { return isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : ""; }
function chg(v, d = 2, unit = "%") { return `<span class="chg ${cls(v)}">${signed(v, d, unit)}</span>`; }
function oku(v) {
  // 億円の数字を「6兆5,236億円」のように表示する
  if (!isNum(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(Math.round(v));
  if (a < 10000) return `${sign}${a.toLocaleString("ja-JP")}億円`;
  const cho = Math.floor(a / 10000), rest = a % 10000;
  return `${sign}${cho}兆${rest ? rest.toLocaleString("ja-JP") + "億" : ""}円`;
}
const WEEK = "日月火水木金土";
function dayLabel(iso) {
  const d = new Date(iso + "T00:00:00+09:00");
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`;
}
function todayIso() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}
function jstHour() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
}
function hoursSince(stamp) {
  if (!stamp) return Infinity;
  return (Date.now() - new Date(stamp.replace(" ", "T") + ":00+09:00").getTime()) / 3.6e6;
}

// ---------- データの読み込み ----------
async function fetchFile(name) {
  if (LOCAL) {
    const dir = new URLSearchParams(location.search).get("dir") || "data";   // ?dir=data_local_test で試しのデータを読む
    const r = await fetch(`../stock-data/${encodeURIComponent(dir)}/${name}.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const token = store.get("token");
  if (!token) throw new Error("鍵が未設定です");
  const headers = { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const cached = store.get(`data:${name}`);
  const etag = store.get(`etag:${name}`);
  if (cached && etag) headers["If-None-Match"] = etag;   // 前回から変わっていなければ本体を受け取らない
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/data/${name}.json`, { headers, cache: "no-store" });
  if (r.status === 304 && cached) return JSON.parse(cached);
  if (r.status === 401) throw new Error("鍵が正しくないか、期限が切れています");
  if (r.status === 403 || r.status === 404) throw new Error("データを読めません(鍵の権限を確認してください)");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  store.set(`data:${name}`, text);
  const e = r.headers.get("ETag");
  if (e) store.set(`etag:${name}`, e);
  return JSON.parse(text);
}

function loadCached() {
  for (const name of FILES) {
    const t = store.get(`data:${name}`);
    if (t) { try { state.data[name] = JSON.parse(t); } catch { /* 壊れていれば無視 */ } }
  }
}

async function loadAll() {
  $("#reload").disabled = true;
  const errors = [];
  await Promise.all(FILES.map(async (name) => {
    try {
      state.data[name] = await fetchFile(name);
    } catch (e) {
      errors.push({ name, message: e.message || String(e) });
    }
  }));
  state.loadErrors = errors;
  state.lastLoad = Date.now();
  $("#reload").disabled = false;
  render();
}

// ---------- お知らせ欄 ----------
const FILE_LABEL = { morning: "朝のデータ", evening: "夜のデータ", calendar: "予定のデータ" };

function renderNotices() {
  const list = [];
  const { morning, evening, calendar } = state.data;
  const noToken = state.loadErrors.some((e) => e.message === "鍵が未設定です");
  if (noToken) {
    list.push({ error: true, text: "データを読む鍵が未設定です。右上の ⚙ から設定してください。" });
  } else {
    for (const e of state.loadErrors) {
      const has = !!state.data[e.name];
      list.push({ error: true, text: `${FILE_LABEL[e.name]}を読み込めませんでした(${e.message})。${has ? "前回のデータを表示しています。" : ""}` });
    }
  }
  for (const t of calendar?.お知らせ || []) list.push({ text: t });
  for (const [label, d] of [["朝", morning], ["夜", evening]]) {
    const errs = d?.エラー || [];
    if (errs.length) list.push({ error: true, text: `${label}の収集で取得できなかった項目: ${errs.map((x) => x.項目).join("、")}` });
    if (d && hoursSince(d.更新) > 96) list.push({ text: `${label}のデータが ${d.更新} から更新されていません。` });
  }
  const box = $("#notices");
  box.hidden = list.length === 0;
  box.innerHTML = list.map((n) => `<div class="notice${n.error ? " error" : ""}">${esc(n.text)}</div>`).join("");
}

// ---------- 部品 ----------
function card(title, body, sub = "") {
  return `<div class="card"><h2>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</h2>${body}</div>`;
}
function quoteRows(list) {
  if (!list?.length) return `<div class="empty">データがありません</div>`;
  return list.map((q) => `<div class="row"><span class="name">${esc(q.名前)}</span><span class="val">${fmt(q.値)}</span>${chg(q.前日比率)}</div>`).join("");
}
function stockLink(code, name) {
  return `<a href="https://kabutan.jp/stock/?code=${encodeURIComponent(code)}" target="_blank" rel="noopener"><span class="code">${esc(code)}</span>${esc(name)}</a>`;
}
function chips(key, options, current) {
  return `<div class="chips">${options.map((o) => `<button class="chip${o === current ? " on" : ""}" data-chip="${esc(key)}" data-value="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
}
function moreButton(key, shown, total) {
  if (total <= shown) return "";
  return `<button class="more" data-more="${esc(key)}">すべて表示(${total}件)</button>`;
}
function limited(key, list, n) {
  return state.ui.more[key] ? list : list.slice(0, n);
}

// ---------- 朝タブ ----------
function renderMorning() {
  const m = state.data.morning;
  if (!m) return `<div class="card empty">朝のデータがまだありません。</div>`;
  const rates = m.金利 || {};
  const t10 = rates.米10年債, ts = rates["米国債(米財務省)"];
  const rateRows = [
    t10 && `<div class="row"><span class="name">米10年債利回り</span><span class="val">${fmt(t10.値, 3)}%</span>${chg(t10.前日比, 3, "")}</div>`,
    ts && `<div class="row"><span class="name">米2年債利回り <span class="muted small">${esc(ts.日付)}</span></span><span class="val">${fmt(ts.米2年債?.利回り, 2)}%</span>${chg(ts.米2年債?.前日差, 2, "")}</div>`,
  ].filter(Boolean).join("");

  const today = (m.今日の予定 || []).map((e) => `<div class="event${e.重要 ? " important" : ""}"><span class="time">${esc(e.時刻 || "")}</span><span class="what">${esc(e.内容)}</span></div>`).join("")
    || `<div class="empty">今日の予定はありません</div>`;

  const k = m.決算発表 || { 一覧: [] };
  const kList = limited("kessan", k.一覧, 10).map((x) => `<div class="row"><span class="name">${stockLink(x.コード, x.会社名)}</span><span class="val muted small">${esc(x.市場 || "")} ${esc(x.種別 || "")}</span></div>`).join("");

  return [
    card("寄り付きの目安", quoteRows(m.寄り付きの目安)),
    card("米国市場", quoteRows(m.米国市場)),
    card("金利", rateRows || `<div class="empty">データがありません</div>`, "前日差はポイント"),
    card("商品", quoteRows(m.商品)),
    card("米国の注目株", quoteRows(m.米国の注目株)),
    card("今日の予定", today),
    card(`決算発表 ${k.社数 ?? 0}社`, (kList || `<div class="empty">予定はありません</div>`) + moreButton("kessan", 10, k.一覧.length), k.日付 ? dayLabel(k.日付) : ""),
  ].join("");
}

// ---------- 夜タブ ----------
function stat(label, value, extra = "") {
  return `<div class="stat"><div class="label">${esc(label)}</div><div class="num ${extra}">${value}</div></div>`;
}

function renderEvening() {
  const e = state.data.evening;
  if (!e) return `<div class="card empty">夜のデータがまだありません。</div>`;
  const s = e.商況, g = e.地合い, sh = e.空売り;
  const idx = [...(e.指数 || [])];
  if (s?.TOPIX) idx.splice(1, 0, { 名前: "TOPIX", 値: s.TOPIX.値, 前日比率: s.TOPIX.前日比率 });

  let breadth = `<div class="empty">データがありません</div>`;
  if (s || g) {
    const t = s?.東証全体 || {};
    breadth = `<div class="stats">
        ${stat("値上がり", fmt(t.値上がり, 0), "up")}${stat("値下がり", fmt(t.値下がり, 0), "down")}${stat("変わらず", fmt(t.変わらず, 0))}
        ${stat("騰落レシオ25日", g ? fmt(g.騰落レシオ25日, 1) + "%" : "—")}
        ${stat("新高値", g ? fmt(g.新高値銘柄数, 0) : "—", "up")}${stat("新安値", g ? fmt(g.新安値銘柄数, 0) : "—", "down")}
        ${stat("売買代金", t.売買代金_億円 != null ? fmt(t.売買代金_億円 / 10000, 2) + "兆円" : "—")}
        ${stat("空売り比率", sh ? fmt(sh.空売り比率, 1) + "%" : "—")}
      </div>`;
    if (s?.市場別) {
      breadth += `<table class="table" style="margin-top:10px"><tr><th>市場</th><th>値上がり</th><th>値下がり</th><th>変わらず</th><th>売買代金</th></tr>
        ${Object.entries(s.市場別).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="up">${fmt(v.値上がり, 0)}</td><td class="down">${fmt(v.値下がり, 0)}</td><td>${fmt(v.変わらず, 0)}</td><td>${oku(v.売買代金_億円)}</td></tr>`).join("")}
      </table>`;
    }
    if (s?.日付 && s.日付 !== e.対象日) breadth += `<p class="muted small">商況プリントは ${esc(s.日付)} 分です。</p>`;
  }

  // 33業種の騰落率
  let sectorHtml = `<div class="empty">データがありません</div>`;
  if (s?.業種?.length) {
    const sorted = [...s.業種].sort((a, b) => b.前日比率 - a.前日比率);
    const show = state.ui.sectorsAll ? sorted : [...sorted.slice(0, 5), null, ...sorted.slice(-5)];
    sectorHtml = show.map((x) => x ? `<div class="row"><span class="name">${esc(x.業種)}</span>${chg(x.前日比率)}</div>` : `<div class="row muted small"><span class="name">…</span></div>`).join("")
      + `<button class="more" data-toggle="sectorsAll">${state.ui.sectorsAll ? "上位・下位だけ表示" : "33業種すべて見る"}</button>`;
  }

  // 資金が集まっている業種
  let flowHtml = `<div class="empty">データがありません</div>`;
  if (e.業種別資金流入?.length) {
    const list = state.ui.flowAll ? e.業種別資金流入 : e.業種別資金流入.slice(0, 8);
    flowHtml = `<div class="scroll-x"><table class="table"><tr><th>業種</th><th>5日平均</th><th>10日前比</th><th>20日前比</th></tr>
      ${list.map((x) => `<tr><td>${esc(x.業種)}</td><td>${oku(x["5日平均売買代金_億円"])}</td><td>${chg(x["10日前比"], 0)}</td><td>${chg(x["20日前比"], 0)}</td></tr>`).join("")}
      </table></div><button class="more" data-toggle="flowAll">${state.ui.flowAll ? "上位だけ表示" : "33業種すべて見る"}</button>`;
  }

  // 週次の需給
  const w = e.週次 || {};
  const inv = w.投資部門別, mg = w.信用残;
  const weekly = `
    ${inv ? `<div class="row"><span class="name">海外投資家 <span class="muted small">${esc(inv.期間)}</span></span><span class="chg ${cls(inv.海外投資家_億円)}">${inv.海外投資家_億円 >= 0 ? "買い越し" : "売り越し"} ${oku(Math.abs(inv.海外投資家_億円))}</span></div>
            <div class="row"><span class="name">個人</span><span class="chg ${cls(inv.個人_億円)}">${inv.個人_億円 >= 0 ? "買い越し" : "売り越し"} ${oku(Math.abs(inv.個人_億円))}</span></div>` : ""}
    ${mg ? `<div class="row"><span class="name">信用買い残 <span class="muted small">${esc(mg.申込日)}申込</span></span><span class="val">${oku(mg.買い残_億円)}</span><span class="chg ${cls(mg.買い残前週比_億円)}">${signed(mg.買い残前週比_億円, 0)}億</span></div>
           <div class="row"><span class="name">信用売り残</span><span class="val">${oku(mg.売り残_億円)}</span><span class="chg ${cls(mg.売り残前週比_億円)}">${signed(mg.売り残前週比_億円, 0)}億</span></div>
           <div class="row"><span class="name">信用倍率</span><span class="val">${fmt(mg.信用倍率, 2)}倍</span></div>` : ""}
    <a class="link-btn" href="${esc(w.信用評価損益率のページ || SINYOU_URL)}" target="_blank" rel="noopener">信用評価損益率を見る(nikkei225jp.com)</a>`;

  const jgb = e.日本10年債;
  const asia = quoteRows(e.アジア) + (jgb ? `<div class="row"><span class="name">日本10年債利回り <span class="muted small">${esc(jgb.日付)}</span></span><span class="val">${fmt(jgb.利回り, 3)}%</span>${chg(jgb.前日差, 3, "")}</div>` : "");

  return [
    card("指数", quoteRows(idx), e.対象日 ? dayLabel(e.対象日) : ""),
    card("地合い(東証全体)", breadth),
    card("業種別 騰落率", sectorHtml),
    card("資金が集まっている業種", flowHtml, "5日平均売買代金の増減"),
    card("週次の需給", weekly),
    card("アジア・国内金利", asia),
  ].join("");
}

// ---------- 注目タブ ----------
function reactionHtml(r) {
  if (!r) return `<span class="muted small">反応待ち</span>`;
  const extra = [r.ストップ高 && "ストップ高", r.ストップ安 && "ストップ安", isNum(r.出来高倍率) && r.出来高倍率 >= 2 && `出来高${fmt(r.出来高倍率, 1)}倍`].filter(Boolean).join(" ");
  return `${chg(r.前日比率)}${extra ? ` <span class="muted small">${esc(extra)}</span>` : ""}`;
}
function groupByCode(list) {
  // 同じ銘柄の開示(決算と業績修正など)を1件にまとめる。並び順は最初に出てきた順
  const map = new Map();
  for (const x of list) {
    const g = map.get(x.コード);
    if (g) {
      g.開示.push(x);
      for (const k of x.種類 || []) if (!g.種類.includes(k)) g.種類.push(k);
    } else {
      map.set(x.コード, { ...x, 種類: [...(x.種類 || [])], 開示: [x] });
    }
  }
  return [...map.values()];
}
function materialItems(list) {
  return list.map((x) => `<div class="item">
      <div class="item-head"><span>${stockLink(x.コード, x.社名)}</span><span>${reactionHtml(x.反応)}</span></div>
      <div class="item-title">${x.種類.map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div>
      ${x.開示.map((d) => `<div class="item-title"><a href="${esc(d.資料)}" target="_blank" rel="noopener">${esc(d.表題)}</a>
        <span class="muted small">${esc(dayLabel(d.日付))} ${esc(d.時刻)}</span></div>`).join("")}
    </div>`).join("");
}
function stockTable(list, cols) {
  if (!list?.length) return `<div class="empty">該当なし</div>`;
  return `<div class="scroll-x"><table class="table"><tr><th>銘柄</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>
    ${list.map((x) => `<tr><td class="stock">${stockLink(x.コード, x.銘柄名)}</td>${cols.map((c) => `<td>${c.html(x)}</td>`).join("")}</tr>`).join("")}
  </table></div>`;
}

function renderAttention() {
  const e = state.data.evening, m = state.data.morning;
  if (!e) return `<div class="card empty">夜のデータがまだありません。</div>`;
  const a = e.注目 || {};
  const special = groupByCode(a.特に注目 || []);

  // 引け後の材料: 朝のデータの方が新しければ、朝に集めた「夜間の開示」を使う
  const useMorning = m && m.更新 > e.更新;
  const after = useMorning ? (m.夜間の開示 || []) : (a.引け後の材料 || []);

  const all = [...(a.材料 || []), ...after];
  const kinds = ["すべて", ...new Set(all.flatMap((x) => x.種類 || []))];
  const kind = kinds.includes(state.ui.kind) ? state.ui.kind : "すべて";
  const pick = (list) => kind === "すべて" ? list : list.filter((x) => (x.種類 || []).includes(kind));
  const mats = groupByCode(pick(a.材料 || [])), afters = groupByCode(pick(after));

  const moverKinds = ["値上がり率", "出来高急増", "ストップ高", "ストップ安", "新高値"];
  const mv = (a.値動き || {})[state.ui.mover] || [];
  const moverCols = [
    { label: "終値", html: (x) => fmt(x.終値, 0) },
    { label: "前日比", html: (x) => chg(x.前日比率) },
    { label: "代金", html: (x) => `${fmt(x.売買代金_億円, 1)}億` },
    { label: "出来高", html: (x) => isNum(x.出来高倍率) ? `${fmt(x.出来高倍率, 1)}倍` : "—" },
  ];

  const sortKey = { 代金: "5日平均売買代金_億円", "10日前比": "10日前比", "20日前比": "20日前比" }[state.ui.top30];
  const top = [...(a.売買代金上位30 || [])].sort((p, q) => (q[sortKey] ?? -Infinity) - (p[sortKey] ?? -Infinity));
  const topCols = [
    { label: "5日平均", html: (x) => `${fmt(x["5日平均売買代金_億円"], 0)}億` },
    { label: "10日前比", html: (x) => chg(x["10日前比"], 0) },
    { label: "20日前比", html: (x) => chg(x["20日前比"], 0) },
    { label: "前日比", html: (x) => chg(x.前日比率) },
  ];

  return [
    card("★ 特に注目", special.length ? materialItems(special) : `<div class="empty">材料と大きな値動きが重なった銘柄はありません</div>`, "材料+値動き"),
    card(`材料が出た銘柄 ${mats.length}件`, chips("kind", kinds, kind) + (materialItems(limited("mats", mats, 15)) || `<div class="empty">該当なし</div>`) + moreButton("mats", 15, mats.length), "値動きは開示後の最初の取引日"),
    card(`引け後の材料 ${afters.length}件`, (materialItems(limited("afters", afters, 15)) || `<div class="empty">該当なし</div>`) + moreButton("afters", 15, afters.length), useMorning ? "今朝までの開示" : "反応待ち"),
    card("値動きが目立った銘柄", chips("mover", moverKinds, state.ui.mover) + stockTable(mv, moverCols), "代金7億円以上"),
    card("売買代金 上位30銘柄", chips("top30", ["代金", "10日前比", "20日前比"], state.ui.top30) + stockTable(top, topCols), "5日平均売買代金"),
  ].join("");
}

// ---------- 予定タブ ----------
function renderSchedule() {
  const c = state.data.calendar;
  if (!c) return `<div class="card empty">予定のデータがまだありません。</div>`;
  const today = todayIso();
  const byDay = {};
  for (const ev of c.予定 || []) (byDay[ev.日付] ||= []).push(ev);
  const days = Object.keys(byDay).sort();
  if (!days.length) return card("予定", `<div class="empty">予定はありません</div>`);
  return `<div class="card">${days.map((d) => `<div class="day">
      <div class="day-head${d === today ? " today" : ""}">${esc(dayLabel(d))}${d === today ? " 今日" : ""}</div>
      ${byDay[d].map((ev) => `<div class="event${ev.重要 ? " important" : ""}"><span class="time">${esc(ev.時刻 || "")}</span><span class="what">${ev.重要 ? `<span class="tag star">★</span>` : ""}${esc(ev.内容)}</span></div>`).join("")}
    </div>`).join("")}</div>`;
}

// ---------- 全体 ----------
const RENDER = { morning: renderMorning, evening: renderEvening, attention: renderAttention, schedule: renderSchedule };

function updatedText() {
  const { morning, evening, calendar } = state.data;
  const d = { morning, evening, attention: evening, schedule: calendar }[state.tab];
  return d?.更新 ? `${d.更新} 更新` : "";
}

function render() {
  renderNotices();
  for (const name of Object.keys(RENDER)) {
    const el = $(`#tab-${name}`);
    el.hidden = name !== state.tab;
    if (name === state.tab) el.innerHTML = RENDER[name]();
  }
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  $("#updated").textContent = updatedText();
}

function setTab(tab) {
  state.tab = tab;
  store.set("tab", tab);
  render();
  window.scrollTo(0, 0);
}

function initialTab() {
  const forced = new URLSearchParams(location.search).get("tab");   // ?tab=evening などで最初のタブを指定できる
  if (forced && RENDER[forced]) return forced;
  const h = jstHour();
  if (h < 12) return "morning";
  if (h >= 15) return "evening";
  return store.get("tab") || "morning";
}

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button");
  if (!t) return;
  if (t.dataset.tab) return setTab(t.dataset.tab);
  if (t.dataset.chip) { state.ui[t.dataset.chip] = t.dataset.value; state.ui.more = {}; return render(); }
  if (t.dataset.more) { state.ui.more[t.dataset.more] = true; return render(); }
  if (t.dataset.toggle) { state.ui[t.dataset.toggle] = !state.ui[t.dataset.toggle]; return render(); }
});

$("#reload").addEventListener("click", loadAll);

// 設定(データを読む鍵)
const dialog = $("#settings");
$("#open-settings").addEventListener("click", () => {
  const t = store.get("token");
  $("#token").value = "";
  $("#token-status").textContent = LOCAL ? "開発用の PC では鍵なしで読みます。" : t ? `設定済み(末尾 …${t.slice(-4)})` : "未設定です。";
  dialog.showModal();
});
$("#save-token").addEventListener("click", (ev) => {
  const v = $("#token").value.trim();
  if (!v) return;
  ev.preventDefault();
  store.set("token", v);
  for (const name of FILES) { store.del(`etag:${name}`); }
  dialog.close();
  loadAll();
});

// アプリに戻ってきたとき、前回の読み込みから10分以上たっていれば読み直す
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.lastLoad > 10 * 60 * 1000) {
    state.tab = initialTab();
    loadAll();
  }
});

if ("serviceWorker" in navigator && !LOCAL) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* 使えない環境では、毎回読み込むだけ */ });
}

state.tab = initialTab();
loadCached();
render();
loadAll();
