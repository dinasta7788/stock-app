"use strict";
// 株マーケット: stock-data(非公開)の data/*.json を読み、4つのタブに表示する
// チャートは stock-data の「charts」の枝にあり、タップしたときにその項目の分だけ読む

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
  ui: { kind: "すべて", mover: "値上がり率", top30: "代金", candle: "連続陽線", sectorSort: "前日比", sectorsAll: false, flowAll: false, more: {} },
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
function amount(v) {
  // 増減の値(円・ポイント)。小さい値は小数2けた、それ以外は1けたまで
  if (!isNum(v)) return "—";
  return (v > 0 ? "+" : "") + v.toLocaleString("ja-JP", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 });
}
function chg2(rate, amt) {
  // 前日比: 上に %、下に増減の値
  return `<span class="chg2 ${cls(rate ?? amt)}"><span>${signed(rate, 2, "%")}</span><span class="amt">${amount(amt)}</span></span>`;
}
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
function md(iso) { return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`; }
function noYear(text) { return String(text ?? "").replace(/\d{4}-(\d{2})-(\d{2})/g, (_, m, d) => `${Number(m)}/${Number(d)}`); }
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
function apiHeaders(token) {
  return { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
}

async function fetchFile(name) {
  if (LOCAL) {
    const dir = new URLSearchParams(location.search).get("dir") || "data";   // ?dir=data_local_test で試しのデータを読む
    const r = await fetch(`../stock-data/${encodeURIComponent(dir)}/${name}.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const token = store.get("token");
  if (!token) throw new Error("鍵が未設定です");
  const headers = apiHeaders(token);
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
  chartCache.clear();   // データが新しくなったら、チャートも読み直す
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
// タップでチャートを開く印。path は charts の枝の中の場所(拡張子なし)
function tapAttr(path, title, extra = "") {
  return path ? ` data-chart="${esc(path)}" data-title="${esc(title)}"${extra}` : "";
}
function stockTap(code, name, months = 12) {
  return tapAttr(`s/${code}`, `${code} ${name}`, ` data-kind="stock" data-months="${months}"`);
}
function quoteRows(list) {
  if (!list?.length) return `<div class="empty">データがありません</div>`;
  return list.map((q) => `<div class="row${q.グラフ ? " tap" : ""}"${tapAttr(q.グラフ, q.名前)}><span class="name">${esc(q.名前)}</span><span class="val">${fmt(q.値)}</span>${chg2(q.前日比率, q.前日比)}</div>`).join("");
}
function stockName(code, name) {
  return `<span class="code">${esc(code)}</span>${esc(name)}`;
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
    t10 && `<div class="row${t10.グラフ ? " tap" : ""}"${tapAttr(t10.グラフ, "米10年債利回り(%)")}><span class="name">米10年債利回り</span><span class="val">${fmt(t10.値, 3)}%</span>${chg(t10.前日比, 3, "")}</div>`,
    ts && `<div class="row${ts.米2年債?.グラフ ? " tap" : ""}"${tapAttr(ts.米2年債?.グラフ, "米2年債利回り(%)")}><span class="name">米2年債利回り <span class="muted small">${esc(md(ts.日付))}</span></span><span class="val">${fmt(ts.米2年債?.利回り, 2)}%</span>${chg(ts.米2年債?.前日差, 2, "")}</div>`,
  ].filter(Boolean).join("");

  const today = (m.今日の予定 || []).map((e) => `<div class="event${e.重要 ? " important" : ""}"><span class="time">${esc(e.時刻 || "")}</span><span class="what">${esc(e.内容)}</span></div>`).join("")
    || `<div class="empty">今日の予定はありません</div>`;

  const k = m.決算発表 || { 一覧: [] };
  const kList = limited("kessan", k.一覧, 10).map((x) => `<div class="row tap"${stockTap(x.コード, x.会社名)}><span class="name">${stockName(x.コード, x.会社名)}</span><span class="val muted small">${isNum(x["20日平均売買代金_億円"]) ? `${fmt(x["20日平均売買代金_億円"], 0)}億 ` : ""}${esc(x.市場 || "")} ${esc(x.種別 || "")}</span></div>`).join("");
  const kTitle = `決算発表 ${k.社数 ?? 0}社${isNum(k.全社数) ? `(全${k.全社数}社中)` : ""}`;
  const kNote = k.条件 ? `<p class="muted small">${esc(k.条件)}の銘柄だけ。右の数字は20日平均の売買代金。</p>` : "";

  return [
    card("寄り付きの目安", quoteRows(m.寄り付きの目安)),
    card("米国市場", quoteRows(m.米国市場)),
    card("金利", rateRows || `<div class="empty">データがありません</div>`, "前日差はポイント"),
    card("商品", quoteRows(m.商品)),
    card("米国の注目株", quoteRows(m.米国の注目株)),
    card("今日の予定", today),
    card(kTitle, kNote + (kList || `<div class="empty">予定はありません</div>`) + moreButton("kessan", 10, k.一覧.length), k.日付 ? dayLabel(k.日付) : ""),
  ].join("");
}

// ---------- 夜タブ ----------
function stat(label, value, extra = "", graph = null) {
  return `<div class="stat${graph ? " tap" : ""}"${tapAttr(graph, label)}><div class="label">${esc(label)}</div><div class="num ${extra}">${value}</div></div>`;
}

function renderEvening() {
  const e = state.data.evening;
  if (!e) return `<div class="card empty">夜のデータがまだありません。</div>`;
  const s = e.商況, g = e.地合い, sh = e.空売り;
  const gg = g?.グラフ || {};
  const idx = [...(e.指数 || [])];
  if (s?.TOPIX) {
    const t = s.TOPIX, prev = isNum(t.値) && isNum(t.前日比率) ? t.値 / (1 + t.前日比率 / 100) : null;
    idx.splice(1, 0, { 名前: "TOPIX", 値: t.値, 前日比率: t.前日比率, 前日比: isNum(prev) ? t.値 - prev : null, グラフ: e.TOPIXのグラフ });
  }

  let breadth = `<div class="empty">データがありません</div>`;
  if (s || g) {
    const t = s?.東証全体 || {};
    breadth = `<div class="stats">
        ${stat("値上がり", fmt(t.値上がり, 0), "up", gg.値上がり値下がり)}${stat("値下がり", fmt(t.値下がり, 0), "down", gg.値上がり値下がり)}${stat("変わらず", fmt(t.変わらず, 0))}
        ${stat("騰落レシオ25日", g ? fmt(g.騰落レシオ25日, 1) + "%" : "—", "", gg.騰落レシオ)}
        ${stat("新高値", g ? fmt(g.新高値銘柄数, 0) : "—", "up")}${stat("新安値", g ? fmt(g.新安値銘柄数, 0) : "—", "down")}
        ${stat("売買代金", t.売買代金_億円 != null ? fmt(t.売買代金_億円 / 10000, 2) + "兆円" : "—", "", gg.売買代金)}
        ${stat("空売り比率", sh ? fmt(sh.空売り比率, 1) + "%" : "—")}
      </div>`;
    if (s?.市場別) {
      breadth += `<table class="table" style="margin-top:10px"><tr><th>市場</th><th>値上がり</th><th>値下がり</th><th>変わらず</th><th>売買代金</th></tr>
        ${Object.entries(s.市場別).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="up">${fmt(v.値上がり, 0)}</td><td class="down">${fmt(v.値下がり, 0)}</td><td>${fmt(v.変わらず, 0)}</td><td>${oku(v.売買代金_億円)}</td></tr>`).join("")}
      </table>`;
    }
    if (s?.日付 && s.日付 !== e.対象日) breadth += `<p class="muted small">商況プリントは ${esc(s.日付)} 分です。</p>`;
  }

  // 33業種の騰落率(前日比・10日前比・20日前比)。業種をタップすると、売買代金の多い10銘柄とグラフ
  let sectorHtml = `<div class="empty">データがありません</div>`;
  if (s?.業種?.length) {
    const field = { 前日比: "前日比率", "10日前比": "10日前比", "20日前比": "20日前比" }[state.ui.sectorSort];
    const sorted = [...s.業種].sort((a, b) => (b[field] ?? -Infinity) - (a[field] ?? -Infinity));
    const show = state.ui.sectorsAll ? sorted : [...sorted.slice(0, 5), null, ...sorted.slice(-5)];
    const method = e.業種の比較方法 && e.業種の比較方法 !== "公式"
      ? `<p class="muted small">10日前比・20日前比は${esc(e.業種の比較方法)}。各銘柄の値動きを売買代金の重みで平均した値で、公式の指数と少しずれます。</p>` : "";
    sectorHtml = chips("sectorSort", ["前日比", "10日前比", "20日前比"], state.ui.sectorSort)
      + `<div class="scroll-x"><table class="table"><tr><th>業種</th><th>前日比</th><th>10日前比</th><th>20日前比</th></tr>
        ${show.map((x) => x ? `<tr class="tap"${tapAttr(`m/業種/${x.業種}`, x.業種, ' data-kind="sector"')}><td>${esc(x.業種)}</td><td>${chg(x.前日比率)}</td><td>${chg(x["10日前比"])}</td><td>${chg(x["20日前比"])}</td></tr>`
          : `<tr><td colspan="4" class="muted small">…</td></tr>`).join("")}
      </table></div>` + method
      + `<button class="more" data-toggle="sectorsAll">${state.ui.sectorsAll ? "上位・下位だけ表示" : "33業種すべて見る"}</button>`;
  }

  // 資金が集まっている業種
  const flowDays = e.業種別資金流入?.[0]?.平均日数 ?? 5;
  let flowHtml = `<div class="empty">データがありません</div>`;
  if (e.業種別資金流入?.length) {
    const list = state.ui.flowAll ? e.業種別資金流入 : e.業種別資金流入.slice(0, 8);
    flowHtml = `<div class="scroll-x"><table class="table"><tr><th>業種</th><th>${flowDays}日平均</th><th>10日前比</th><th>20日前比</th></tr>
      ${list.map((x) => `<tr class="${x.詳細 ? "tap" : ""}"${tapAttr(x.詳細, x.業種, ' data-kind="sector"')}><td>${esc(x.業種)}</td><td>${oku(x.平均売買代金_億円 ?? x["5日平均売買代金_億円"])}</td><td>${chg(x["10日前比"], 0)}</td><td>${chg(x["20日前比"], 0)}</td></tr>`).join("")}
      </table></div><p class="muted small">直近${flowDays}営業日の売買代金の平均を、10営業日前・20営業日前の時点の${flowDays}日平均と比べた増減。業種をタップすると、売買代金の多い10銘柄が出ます。</p>
      <button class="more" data-toggle="flowAll">${state.ui.flowAll ? "上位だけ表示" : "33業種すべて見る"}</button>`;
  }

  // 連続陽線・連続陰線
  let candleHtml = `<div class="empty">データがありません</div>`;
  if (e.連続足) {
    const list = e.連続足[state.ui.candle] || [];
    const cols = [
      { label: "日数", html: (x) => `<span class="${state.ui.candle === "連続陽線" ? "up" : "down"}">${fmt(x.連続日数, 0)}日</span>` },
      { label: "終値", html: (x) => fmt(x.終値, 0) },
      { label: "前日比", html: (x) => chg2(x.前日比率, x.前日比) },
      { label: "代金", html: (x) => `${fmt(x.売買代金_億円, 1)}億` },
    ];
    candleHtml = chips("candle", ["連続陽線", "連続陰線"], state.ui.candle)
      + stockTable(limited("candle", list, 20), cols, 6) + moreButton("candle", 20, list.length)
      + `<p class="muted small">終値が始値より高い(陽線)・安い(陰線)日が、最新日まで続いた日数。3日以上、その日の売買代金7億円以上。</p>`;
  }

  // 週次の需給
  const w = e.週次 || {};
  const inv = w.投資部門別, mg = w.信用残;
  const weekly = `
    ${inv ? `<div class="row"><span class="name">海外投資家 <span class="muted small">${esc(noYear(inv.期間))}</span></span><span class="chg ${cls(inv.海外投資家_億円)}">${inv.海外投資家_億円 >= 0 ? "買い越し" : "売り越し"} ${oku(Math.abs(inv.海外投資家_億円))}</span></div>
            <div class="row"><span class="name">個人</span><span class="chg ${cls(inv.個人_億円)}">${inv.個人_億円 >= 0 ? "買い越し" : "売り越し"} ${oku(Math.abs(inv.個人_億円))}</span></div>` : ""}
    ${mg ? `<div class="row"><span class="name">信用買い残 <span class="muted small">${esc(mg.申込日)}申込</span></span><span class="val">${oku(mg.買い残_億円)}</span><span class="chg ${cls(mg.買い残前週比_億円)}">${signed(mg.買い残前週比_億円, 0)}億</span></div>
           <div class="row"><span class="name">信用売り残</span><span class="val">${oku(mg.売り残_億円)}</span><span class="chg ${cls(mg.売り残前週比_億円)}">${signed(mg.売り残前週比_億円, 0)}億</span></div>
           <div class="row"><span class="name">信用倍率</span><span class="val">${fmt(mg.信用倍率, 2)}倍</span></div>` : ""}
    <a class="link-btn" href="${esc(w.信用評価損益率のページ || SINYOU_URL)}" target="_blank" rel="noopener">信用評価損益率を見る(nikkei225jp.com)</a>`;

  const jgb = e.日本10年債;
  const asia = quoteRows(e.アジア) + (jgb ? `<div class="row${jgb.グラフ ? " tap" : ""}"${tapAttr(jgb.グラフ, "日本10年債利回り(%)")}><span class="name">日本10年債利回り <span class="muted small">${esc(md(jgb.日付))}</span></span><span class="val">${fmt(jgb.利回り, 3)}%</span>${chg(jgb.前日差, 3, "")}</div>` : "");

  return [
    card("指数", quoteRows(idx), e.対象日 ? dayLabel(e.対象日) : ""),
    card("地合い(東証全体)", breadth),
    card("業種別 騰落率", sectorHtml),
    card("資金が集まっている業種", flowHtml, `${flowDays}日平均売買代金の増減`),
    card("連続陽線・連続陰線", candleHtml, "代金7億円以上"),
    card("週次の需給", weekly),
    card("アジア・国内金利", asia),
  ].join("");
}

// ---------- 注目タブ ----------
function reactionHtml(r) {
  if (!r) return `<span class="muted small">反応待ち</span>`;
  const extra = [r.ストップ高 && "ストップ高", r.ストップ安 && "ストップ安", isNum(r.出来高倍率) && r.出来高倍率 >= 2 && `出来高${fmt(r.出来高倍率, 1)}倍`].filter(Boolean).join(" ");
  return `${chg2(r.前日比率, r.前日比)}${extra ? ` <span class="muted small">${esc(extra)}</span>` : ""}`;
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
      <div class="item-head"><span class="tap stock-name"${stockTap(x.コード, x.社名)}>${stockName(x.コード, x.社名)}</span><span class="reaction">${reactionHtml(x.反応)}</span></div>
      <div class="item-title">${x.種類.map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div>
      ${x.開示.map((d) => `<div class="item-title"><a href="${esc(d.資料)}" target="_blank" rel="noopener">${esc(d.表題)}</a>
        <span class="muted small">${esc(dayLabel(d.日付))} ${esc(d.時刻)}</span></div>`).join("")}
    </div>`).join("");
}
function stockTable(list, cols, months = 12) {
  if (!list?.length) return `<div class="empty">該当なし</div>`;
  return `<div class="scroll-x"><table class="table"><tr><th>銘柄</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>
    ${list.map((x) => `<tr class="tap"${stockTap(x.コード, x.銘柄名, months)}><td class="stock">${stockName(x.コード, x.銘柄名)}</td>${cols.map((c) => `<td>${c.html(x)}</td>`).join("")}</tr>`).join("")}
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
    { label: "前日比", html: (x) => chg2(x.前日比率, x.前日比) },
    { label: "代金", html: (x) => `${fmt(x.売買代金_億円, 1)}億` },
    { label: "出来高", html: (x) => isNum(x.出来高倍率) ? `${fmt(x.出来高倍率, 1)}倍` : "—" },
  ];

  const sortKey = { 代金: "5日平均売買代金_億円", "10日前比": "10日前比", "20日前比": "20日前比" }[state.ui.top30];
  const top = [...(a.売買代金上位30 || [])].sort((p, q) => (q[sortKey] ?? -Infinity) - (p[sortKey] ?? -Infinity));
  const topCols = [
    { label: "5日平均", html: (x) => `${fmt(x["5日平均売買代金_億円"], 0)}億` },
    { label: "10日前比", html: (x) => chg(x["10日前比"], 0) },
    { label: "20日前比", html: (x) => chg(x["20日前比"], 0) },
    { label: "前日比", html: (x) => chg2(x.前日比率, x.前日比) },
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

// ---------- チャート ----------
const chartCache = new Map();

async function fetchChart(path) {
  if (chartCache.has(path)) return chartCache.get(path);
  const p = path.split("/").map(encodeURIComponent).join("/");
  let r;
  if (LOCAL) {
    const dir = new URLSearchParams(location.search).get("charts") || "chart_out";   // ?charts=chart_local_test で試しのチャートを読む
    r = await fetch(`../stock-data/${encodeURIComponent(dir)}/${p}.json?t=${Date.now()}`, { cache: "no-store" });
  } else {
    const token = store.get("token");
    if (!token) throw new Error("データを読む鍵が未設定です");
    r = await fetch(`https://api.github.com/repos/${REPO}/contents/${p}.json?ref=charts`, { headers: apiHeaders(token), cache: "no-store" });
  }
  if (r.status === 404) throw new Error("このグラフのデータはまだありません(次の収集のあとに出ます)");
  if (!r.ok) throw new Error(`グラフを読めませんでした(HTTP ${r.status})`);
  const d = await r.json();
  chartCache.set(path, d);
  return d;
}

function sma(values, n) {
  // 移動平均(n日)。足りないところは空
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= n) sum -= values[i - n] ?? 0;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}
function niceTicks(lo, hi, count = 4) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
function axisNum(v) {
  const a = Math.abs(v);
  return v.toLocaleString("ja-JP", { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : 2 });
}
function volText(v) {
  if (!isNum(v)) return "—";
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}億株`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ja-JP")}万株`;
  return `${v.toLocaleString("ja-JP")}株`;
}
function changeText(now, prev) {
  if (!isNum(now) || !isNum(prev) || prev === 0) return "";
  const r = (now / prev - 1) * 100;
  return `<span class="${cls(r)}">${amount(now - prev)}(${signed(r, 2, "%")})</span>`;
}

function drawChart(box, d, months) {
  const candle = d.種類 === "ローソク足";
  const n = d.日付?.length || 0;
  const s0 = months === 6 ? Math.max(0, n - 125) : 0;
  const cut = (a) => (a || []).slice(s0);
  const dates = cut(d.日付), m = dates.length;
  const series = candle ? [] : (d.系列 || [{ 名前: d.名前, 値: d.値 }]).map((x) => ({ ...x, 全: x.値, 値: cut(x.値) }));
  const O = candle ? cut(d.始) : [], H = candle ? cut(d.高) : [], L = candle ? cut(d.安) : [], C = candle ? cut(d.終) : [], V = candle ? cut(d.量) : [];
  const ma = candle ? [{ 名前: "25日線", c: "ma25", 値: cut(sma(d.終, 25)) }, { 名前: "75日線", c: "ma75", 値: cut(sma(d.終, 75)) }] : [];

  let lo = Infinity, hi = -Infinity;
  const take = (v) => { if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
  if (candle) { H.forEach(take); L.forEach(take); ma.forEach((x) => x.値.forEach(take)); } else series.forEach((x) => x.値.forEach(take));
  if (!m || !isFinite(lo)) { box.innerHTML = `<div class="empty">データがありません</div>`; return; }
  if (hi === lo) { hi += 1; lo -= 1; }
  const padv = (hi - lo) * 0.06; lo -= padv; hi += padv;

  const W = Math.max(280, Math.round(box.clientWidth || 340));
  const PR = 44, PH = 190, GAP = candle ? 6 : 0, VH = candle ? 48 : 0, XL = 16;
  const TH = PH + GAP + VH + XL;
  const pw = W - PR, step = pw / m;
  const X = (i) => (i + 0.5) * step;
  const Y = (v) => 6 + (hi - v) / (hi - lo) * (PH - 12);
  const f1 = (v) => v.toFixed(1);

  let g = "";
  for (const t of niceTicks(lo, hi)) g += `<line class="grid" x1="0" x2="${f1(pw)}" y1="${f1(Y(t))}" y2="${f1(Y(t))}"/><text class="axis" x="${f1(pw + 4)}" y="${f1(Y(t) + 3.5)}">${axisNum(t)}</text>`;
  let lastM = dates[0].slice(5, 7), lastX = -99;
  dates.forEach((iso, i) => {
    const mo = iso.slice(5, 7);
    if (mo === lastM) return;
    lastM = mo;
    if (X(i) - lastX < 30 || X(i) > pw - 14) return;
    lastX = X(i);
    g += `<line class="grid" x1="${f1(X(i))}" x2="${f1(X(i))}" y1="0" y2="${PH + GAP + VH}"/><text class="axis" x="${f1(X(i) + 2)}" y="${TH - 4}">${mo === "01" ? `${iso.slice(2, 4)}年1月` : `${Number(mo)}月`}</text>`;
  });

  const path = (vals) => {
    let p = "", pen = false;
    vals.forEach((v, i) => { if (isNum(v)) { p += `${pen ? "L" : "M"}${f1(X(i))},${f1(Y(v))}`; pen = true; } else pen = false; });
    return p;
  };
  if (candle) {
    const bw = Math.max(1, step * 0.65);
    for (let i = 0; i < m; i++) {
      const c = C[i]; if (!isNum(c)) continue;
      const o = isNum(O[i]) ? O[i] : c, k = c >= o ? "up" : "down";
      g += `<line class="wick ${k}" x1="${f1(X(i))}" x2="${f1(X(i))}" y1="${f1(Y(H[i]))}" y2="${f1(Y(L[i]))}"/>`;
      g += `<rect class="body ${k}" x="${f1(X(i) - bw / 2)}" y="${f1(Y(Math.max(o, c)))}" width="${f1(bw)}" height="${f1(Math.max(1, Math.abs(Y(o) - Y(c))))}"/>`;
    }
    for (const x of ma) g += `<path class="line ${x.c}" d="${path(x.値)}"/>`;
    const vmax = Math.max(1, ...V.filter(isNum));
    const vb = PH + GAP + VH;
    for (let i = 0; i < m; i++) {
      if (!isNum(V[i])) continue;
      const hgt = V[i] / vmax * VH, k = isNum(C[i]) && C[i] >= (isNum(O[i]) ? O[i] : C[i]) ? "up" : "down";
      g += `<rect class="vol ${k}" x="${f1(X(i) - bw / 2)}" y="${f1(vb - hgt)}" width="${f1(bw)}" height="${f1(Math.max(0.5, hgt))}"/>`;
    }
    g += `<text class="axis" x="${f1(pw + 4)}" y="${PH + GAP + 10}">出来高</text>`;
  } else {
    for (const x of series) g += `<path class="line ${x.色 || "main"}" d="${path(x.値)}"/>`;
  }
  g += `<line class="cross" x1="0" x2="0" y1="0" y2="${PH + GAP + VH}" visibility="hidden"/>`;

  // 期間の変化(先頭と最後の値)
  const first = candle ? C.find(isNum) : series[0].値.find(isNum);
  const last = candle ? [...C].reverse().find(isNum) : [...series[0].値].reverse().find(isNum);
  const legend = candle
    ? `<span><i class="sw ma25"></i>25日線</span><span><i class="sw ma75"></i>75日線</span>`
    : series.length > 1 ? series.map((x) => `<span><i class="sw ${x.色 || "main"}"></i>${esc(x.名前)}</span>`).join("") : "";
  const period = series.length > 1 ? "" : `<span>${months === 6 ? "半年" : "1年"}の変化 ${changeText(last, first)}</span>`;

  box.innerHTML = `<div class="readout"></div>
    <svg viewBox="0 0 ${W} ${TH}" width="${W}" height="${TH}" role="img" aria-label="${esc(d.名前 || "")}のグラフ">${g}</svg>
    <div class="legend">${legend}${period}</div>`;

  const readout = box.querySelector(".readout"), svg = box.querySelector("svg"), cross = svg.querySelector(".cross");
  const read = (i) => {
    const iso = dates[i];
    if (candle) {
      const prev = i > 0 ? C[i - 1] : d.終[s0 - 1];
      return `<b>${esc(md(iso))}</b> 終値 ${fmt(C[i], 1)} ${changeText(C[i], prev)}<br><span class="muted">始 ${fmt(O[i], 1)} 高 ${fmt(H[i], 1)} 安 ${fmt(L[i], 1)} 出来高 ${volText(V[i])}</span>`;
    }
    return `<b>${esc(md(iso))}</b> ` + series.map((x) => {
      const prev = i > 0 ? x.値[i - 1] : x.全[s0 - 1];
      return `${series.length > 1 ? esc(x.名前) + " " : ""}${fmt(x.値[i])} ${series.length > 1 ? "" : changeText(x.値[i], prev)}`;
    }).join(" / ");
  };
  readout.innerHTML = read(m - 1);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const i = Math.min(m - 1, Math.max(0, Math.floor((ev.clientX - r.left) * (W / r.width) / step)));
    cross.setAttribute("x1", f1(X(i))); cross.setAttribute("x2", f1(X(i)));
    cross.setAttribute("visibility", "visible");
    readout.innerHTML = read(i);
  };
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointermove", move);
}

// 下から出る画面(チャート・業種の詳細)。stack は「業種 → 銘柄」のように重ねて開いた順
const sheet = { stack: [], pending: [] };
const sheetDialog = $("#chart");

function rangeChips(v) {
  return `<div class="chips">${[[6, "半年"], [12, "1年"]].map(([n, label]) => `<button class="chip${v.months === n ? " on" : ""}" data-range="${n}">${label}</button>`).join("")}</div>`;
}
function chartBox(d, months) {
  sheet.pending.push({ d, months });
  return `<div class="chart-box" data-i="${sheet.pending.length - 1}"></div>`;
}
function stockView(d, v) {
  const code = d.コード || v.path.split("/").pop();
  return rangeChips(v) + chartBox(d, v.months)
    + `<p class="muted small">ローソク足は赤が陽線、緑が陰線。グラフを指でなぞると、その日の値が出ます。</p>`
    + `<a class="link-btn" href="https://kabutan.jp/stock/?code=${encodeURIComponent(code)}" target="_blank" rel="noopener">株探で詳しく見る</a>`;
}
function lineView(d, v) {
  return rangeChips(v) + chartBox(d, v.months) + `<p class="muted small">グラフを指でなぞると、その日の値が出ます。</p>`;
}
function sectorView(d, v) {
  const cols = [
    { label: "終値", html: (x) => fmt(x.終値, 0) },
    { label: "前日比", html: (x) => chg2(x.前日比率, x.前日比) },
    { label: "5日平均", html: (x) => `${fmt(x["5日平均売買代金_億円"], 0)}億` },
    { label: "10日前比", html: (x) => chg(x["10日前比"], 0) },
  ];
  return `<h3 class="sheet-sub">売買代金の多い${d.上位?.length || 0}銘柄 <span class="muted small">(全${d.銘柄数 ?? "—"}銘柄)</span></h3>
    ${stockTable(d.上位, cols, 6)}
    <p class="muted small">銘柄をタップすると半年のチャートが出ます。代金は5日平均、10日前比は5日平均売買代金の増減。</p>
    ${rangeChips(v)}
    <h3 class="sheet-sub">${esc(d.値動き?.名前 || "値動き")}</h3>${d.値動き ? chartBox(d.値動き, v.months) : ""}
    <h3 class="sheet-sub">${esc(d.売買代金?.名前 || "売買代金")}</h3>${d.売買代金 ? chartBox(d.売買代金, v.months) : ""}`;
}

async function drawSheet() {
  const v = sheet.stack.at(-1);
  if (!v) return;
  $("#chart-title").textContent = v.title;
  $("#chart-back").hidden = sheet.stack.length < 2;
  const body = $("#chart-body");
  body.innerHTML = `<div class="empty">読み込み中…</div>`;
  try {
    const d = await fetchChart(v.path);
    if (sheet.stack.at(-1) !== v) return;   // 読み込み中に別の画面に切り替わった
    sheet.pending = [];
    body.innerHTML = v.kind === "sector" ? sectorView(d, v) : d.種類 === "ローソク足" ? stockView(d, v) : lineView(d, v);
    body.querySelectorAll(".chart-box").forEach((box) => { const p = sheet.pending[box.dataset.i]; drawChart(box, p.d, p.months); });
  } catch (e) {
    body.innerHTML = `<div class="empty">${esc(e.message || String(e))}</div>`;
  }
}

function openSheet(el) {
  const v = { path: el.dataset.chart, title: el.dataset.title || "", kind: el.dataset.kind || "chart", months: Number(el.dataset.months) || 12 };
  if (sheetDialog.open) {
    sheet.stack.push(v);
  } else {
    sheet.stack = [v];
    sheetDialog.showModal();
  }
  drawSheet();
  $("#chart-body").scrollTop = 0;
}
function backSheet() {
  if (sheet.stack.length > 1) { sheet.stack.pop(); drawSheet(); return true; }
  return false;
}
$("#chart-close").addEventListener("click", () => sheetDialog.close());
$("#chart-back").addEventListener("click", backSheet);
// スマホの「戻る」: 業種から銘柄を開いているときは業種に戻る。それ以外は閉じる
sheetDialog.addEventListener("cancel", (ev) => { if (backSheet()) ev.preventDefault(); });
sheetDialog.addEventListener("close", () => { sheet.stack = []; $("#chart-body").innerHTML = ""; });
sheetDialog.addEventListener("click", (ev) => { if (ev.target === sheetDialog) sheetDialog.close(); });   // 外側を押したら閉じる

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
  if (ev.target.closest("a")) return;   // リンク(開示の資料など)はそのまま開く
  const t = ev.target.closest("button, [data-chart]");
  if (!t) return;
  if (t.dataset.chart) return openSheet(t);
  if (t.dataset.range) { const v = sheet.stack.at(-1); if (v) { v.months = Number(t.dataset.range); drawSheet(); } return; }
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
