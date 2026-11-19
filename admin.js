/* A古手作管理台（Supabase 版）— 邮箱+密码登录、订单列表改状态、菜单设置、导出 CSV */
(function () {
"use strict";
/* Supabase 项目 a-gu-qian-ceng。anon key 是公开密钥（配合 RLS 使用），按设计放在前端。 */
var SUPABASE_URL = "https://rokaagkozrpkcsxfrgcj.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJva2FhZ2tvenJwa2NzeGZyZ2NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNjYxODgsImV4cCI6MjExMDY0MjE4OH0.DNN4rLTCA2j4-G040lz6p_gjI8Gik7-AOtVDhtZFvR8";
var TOKEN_KEY = "agu_admin_token";
var STATUSES = ["待确认", "已确认", "制作中", "已送达", "已取消"];
var PILL = { "待确认": "pill-wait", "已确认": "pill-ok", "制作中": "pill-make", "已送达": "pill-done", "已取消": "pill-cancel" };
var currentFilter = "";
var currentQ = "";
var settings = null;

function $(id) { return document.getElementById(id); }
function toast(msg) {
  var t = $("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(function () { t.classList.remove("show"); }, 2200);
}
function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
function setToken(t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }
function authHeaders(extra) {
  var h = { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + getToken() };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}
function rest(path, opts) {
  opts = opts || {};
  opts.headers = authHeaders(opts.headers);
  return fetch(SUPABASE_URL + path, opts).then(function (r) {
    return r.json().then(function (j) { return { status: r.status, body: j }; })
      .catch(function () { return { status: r.status, body: {} }; });
  });
}
/* 北京时间 YYYY-MM-DD HH:MM:SS */
function fmtTime(iso) {
  if (!iso) return "";
  var p = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second;
}
function shanghaiDate(iso) {
  var p = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day;
}
function todayShanghai() {
  var p = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day;
}

function showLogin() {
  $("loginBox").style.display = "block";
  $("dash").style.display = "none";
}
function showDash() {
  $("loginBox").style.display = "none";
  $("dash").style.display = "block";
  buildFilters();
  loadOrders();
  loadStats();
  loadSettings();
}

/* ---------- 登录（Supabase Auth 邮箱+密码） ---------- */
$("loginBtn").addEventListener("click", doLogin);
$("adminPw").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
function doLogin() {
  var email = $("adminEmail").value.trim();
  var pw = $("adminPw").value;
  var err = $("loginError");
  err.classList.remove("show");
  if (!email || !pw) { err.textContent = "邮箱和密码都要填。"; err.classList.add("show"); return; }
  fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: pw })
  }).then(function (r) {
    return r.json().then(function (j) { return { status: r.status, body: j }; })
      .catch(function () { return { status: r.status, body: {} }; });
  }).then(function (res) {
    if (res.status === 200 && res.body.access_token) {
      setToken(res.body.access_token);
      $("adminPw").value = "";
      showDash();
    } else {
      err.textContent = "邮箱或密码不对，再试一次。";
      err.classList.add("show");
    }
  }).catch(function () {
    err.textContent = "网络不太好，再试一次。";
    err.classList.add("show");
  });
}

$("logoutBtn").addEventListener("click", function () {
  fetch(SUPABASE_URL + "/auth/v1/logout", {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + getToken() }
  }).catch(function () {});
  setToken("");
  showLogin();
});
$("refreshBtn").addEventListener("click", function () { loadOrders(); loadStats(); });
$("exportBtn").addEventListener("click", exportCsv);

/* ---------- 订单 ---------- */
function buildFilters() {
  var row = $("filterRow");
  row.innerHTML = "";
  [{ label: "全部", v: "" }].concat(STATUSES.map(function (s) { return { label: s, v: s }; }))
    .forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "fbtn";
      b.textContent = f.label;
      b.setAttribute("aria-pressed", f.v === currentFilter ? "true" : "false");
      b.addEventListener("click", function () {
        currentFilter = f.v;
        buildFilters();
        loadOrders();
      });
      row.appendChild(b);
    });
}
var searchTimer = null;
$("searchBox").addEventListener("input", function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    currentQ = $("searchBox").value.trim();
    loadOrders();
  }, 400);
});

function picksText(items) {
  return items.map(function (it) {
    var picks = Object.keys(it.picks).map(function (k) { return k + " ×" + it.picks[k]; }).join("、");
    return "最底层：" + it.bottom + "｜其余：" + picks + "｜×" + it.qty + "份";
  }).join("；");
}

function loadOrders() {
  var q = "/rest/v1/orders?select=*&order=id.desc&limit=200";
  if (currentFilter) q += "&status=eq." + encodeURIComponent(currentFilter);
  if (currentQ) {
    var e = encodeURIComponent(currentQ);
    q += "&or=(order_no.ilike.*" + e + "*,phone.ilike.*" + e + "*,name.ilike.*" + e + "*)";
  }
  rest(q).then(function (res) {
    if (res.status === 401) { setToken(""); showLogin(); return; }
    if (res.status !== 200 || !Array.isArray(res.body)) {
      $("orderList").innerHTML = '<p class="muted">订单没加载出来，点刷新再试。</p>';
      return;
    }
    var list = $("orderList");
    var orders = res.body;
    if (!orders.length) {
      list.innerHTML = '<p class="muted" style="margin-top:12px">还没有订单。</p>';
      return;
    }
    list.innerHTML = "";
    orders.forEach(function (o) {
      var card = document.createElement("div");
      card.className = "order-card";
      var sel = STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (s === o.status ? " selected" : "") + ">" + s + "</option>";
      }).join("");
      card.innerHTML =
        '<div class="oc-top"><span class="oc-no">' + o.order_no + '</span>' +
        '<span class="pill ' + (PILL[o.status] || "") + '">' + o.status + "</span>" +
        '<span class="oc-time">' + fmtTime(o.created_at) + "</span>" +
        '<span class="oc-total">¥' + o.total + "</span></div>" +
        '<div class="oc-line">' + picksText(o.items) + "</div>" +
        '<div class="oc-line"><b>' + o.campus + " · " + o.building + (o.room ? " " + o.room : "") +
        "</b>　配送：" + o.slot_date + " " + o.slot_time + "</div>" +
        '<div class="oc-line">称呼：<b>' + o.name + "</b>　电话：<b>" + o.phone + "</b>　付款：" + o.pay + "</div>" +
        (o.remark ? '<div class="oc-line">备注：' + o.remark + "</div>" : "") +
        '<div class="status-row"><span>状态：</span><select>' + sel + "</select></div>";
      var select = card.querySelector("select");
      select.addEventListener("change", function () {
        rest("/rest/v1/orders?id=eq." + o.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
          body: JSON.stringify({ status: select.value })
        }).then(function (r2) {
          if (r2.status === 200) {
            toast("订单 " + o.order_no + " 已改成" + select.value);
            loadOrders(); loadStats();
          } else {
            toast("改状态没成功，再试一次。");
            loadOrders();
          }
        });
      });
      list.appendChild(card);
    });
  });
}

/* ---------- 今日统计（从全部订单里算，和原来服务端统计口径一致） ---------- */
function loadStats() {
  rest("/rest/v1/orders?select=total,status,created_at&limit=1000").then(function (res) {
    if (res.status !== 200 || !Array.isArray(res.body)) return;
    var today = todayShanghai();
    var count = 0, total = 0, waiting = 0;
    res.body.forEach(function (o) {
      if (o.status === "待确认") waiting++;
      if (shanghaiDate(o.created_at) === today) { count++; total += o.total || 0; }
    });
    $("statToday").textContent = count;
    $("statTotal").textContent = "¥" + total;
    $("statWaiting").textContent = waiting;
  });
}

/* ---------- 导出 CSV（浏览器里生成，和原来服务端导出列一致，UTF-8 BOM） ---------- */
function csvCell(v) {
  v = String(v == null ? "" : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function pickSummary(items) {
  return items.map(function (it) {
    var picks = Object.keys(it.picks).map(function (k) { return k + " ×" + it.picks[k]; }).join("、");
    return "最底层：" + it.bottom + "｜其余搭配：" + picks + "｜×" + it.qty + "份";
  }).join("；");
}
function exportCsv() {
  rest("/rest/v1/orders?select=*&order=id.desc&limit=1000").then(function (res) {
    if (res.status !== 200 || !Array.isArray(res.body)) { toast("导出没成功，再试一次。"); return; }
    var rows = [["订单号", "下单时间", "校区", "配送日期", "配送时间", "宿舍楼",
      "宿舍号", "称呼", "电话", "付款方式", "份数", "总价(元)",
      "状态", "备注", "搭配明细"]];
    res.body.forEach(function (o) {
      rows.push([o.order_no, fmtTime(o.created_at), o.campus, o.slot_date, o.slot_time,
        o.building, o.room, o.name, o.phone, o.pay, o.qty_total, o.total,
        o.status, o.remark, pickSummary(o.items)]);
    });
    var csv = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    var now = new Date();
    var stamp = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) + "-" +
      pad2(now.getHours()) + pad2(now.getMinutes());
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "agu-orders-" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast("已导出 " + res.body.length + " 条订单");
  }).catch(function () { toast("导出没成功，再试一次。"); });
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }

/* ---------- 菜单设置 ---------- */
function loadSettings() {
  rest("/rest/v1/settings?id=eq.1").then(function (res) {
    if (res.status !== 200 || !Array.isArray(res.body) || !res.body[0]) return;
    settings = res.body[0];
    $("priceInput").value = settings.price;
    $("announceInput").value = settings.announcement || "";
    $("slot1200").checked = !!(settings.slots_enabled && settings.slots_enabled["12:00"]);
    $("slot1700").checked = !!(settings.slots_enabled && settings.slots_enabled["17:00"]);
    buildChecks("fruitChecks", settings.fruits);
    buildChecks("creamChecks", settings.creams);
  });
}
function buildChecks(boxId, items) {
  var box = $(boxId);
  box.innerHTML = "";
  items.forEach(function (it) {
    var label = document.createElement("label");
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!it.available;
    input.setAttribute("data-name", it.name);
    label.appendChild(input);
    label.appendChild(document.createTextNode(it.name + (it.tag ? "（" + it.tag + "）" : "")));
    box.appendChild(label);
  });
}
function readChecks(boxId) {
  var out = {};
  $(boxId).querySelectorAll("input[type=checkbox]").forEach(function (c) {
    out[c.getAttribute("data-name")] = c.checked;
  });
  return out;
}
function applyChecks(items, avail) {
  return items.map(function (it) {
    var copy = {};
    for (var k in it) copy[k] = it[k];
    if (it.name in avail) copy.available = !!avail[it.name];
    return copy;
  });
}
$("saveMenuBtn").addEventListener("click", function () {
  var err = $("menuError");
  err.classList.remove("show");
  $("menuSaved").textContent = "";
  var price = parseInt($("priceInput").value, 10);
  if (isNaN(price) || price < 1 || price > 999) {
    err.textContent = "价格要在 1–999 元之间。";
    err.classList.add("show");
    return;
  }
  var patch = {
    price: price,
    announcement: $("announceInput").value.trim(),
    slots_enabled: { "12:00": $("slot1200").checked, "17:00": $("slot1700").checked },
    fruits: applyChecks(settings.fruits, readChecks("fruitChecks")),
    creams: applyChecks(settings.creams, readChecks("creamChecks"))
  };
  rest("/rest/v1/settings?id=eq.1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(patch)
  }).then(function (res) {
    if (res.status === 200) {
      settings = Array.isArray(res.body) ? res.body[0] : settings;
      $("menuSaved").textContent = "已保存，顾客页已生效 ✓";
      toast("菜单已保存");
    } else {
      err.textContent = (res.body && (res.body.message || res.body.error)) || "保存失败。";
      err.classList.add("show");
    }
  }).catch(function () {
    err.textContent = "网络不太好，再试一次。";
    err.classList.add("show");
  });
});

/* ---------- 入口 ---------- */
if (getToken()) showDash();
else showLogin();
})();
