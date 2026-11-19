/* A古手作点餐页 — 纯静态前端 + Supabase（菜单读 settings 表，下单调 create_order RPC） */
(function () {
"use strict";
/* Supabase 项目 a-gu-qian-ceng。anon key 是公开密钥（配合 RLS 使用），按设计放在前端。 */
var SUPABASE_URL = "https://rokaagkozrpkcsxfrgcj.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJva2FhZ2tvenJwa2NzeGZyZ2NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNjYxODgsImV4cCI6MjExMDY0MjE4OH0.DNN4rLTCA2j4-G040lz6p_gjI8Gik7-AOtVDhtZFvR8";
var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

var PRICE = 25;
var FRUITS = [];
var CREAMS = [];
var ITEMS = []; // fruits + creams, in menu order
var BOTTOM_FRUITS = [];
var CAMPUSES = ["天平学院", "江枫校区"];
var PAY_METHODS = ["微信转账", "货到付款"];
var SLOTS = [];
var SLOTS_ENABLED = { "12:00": true, "17:00": true };

var state = {
  bottom: null,
  picks: [],
  qty: 1,
  cart: [],
  campus: "天平学院",
  slot: null,
  pay: "微信转账"
};

function $(id) { return document.getElementById(id); }
function picksTotal() { return state.picks.reduce(function (a, b) { return a + b; }, 0); }
function cartCount() { return state.cart.reduce(function (a, it) { return a + it.qty; }, 0); }
function cartTotal() { return cartCount() * PRICE; }

var toastTimer = null;
function toast(msg) {
  var t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
}
function showError(el, msg) { el.textContent = msg; el.classList.add("show"); }
function hideError(el) { el.classList.remove("show"); }

/* ---------- 北京时间（Asia/Shanghai） ---------- */
function shanghaiParts(d) {
  var o = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, ss: +o.second };
}
function pad(n) { return (n < 10 ? "0" : "") + n; }
/* 接下来 3 个 12:00 / 17:00 配送时段（今天起三天内），只保留已开启的。 */
function computeSlots() {
  var now = shanghaiParts(new Date());
  var base = Date.UTC(now.y, now.m - 1, now.d);
  var out = [];
  for (var off = 0; off < 3 && out.length < 3; off++) {
    var day = new Date(base + off * 86400000);
    [12, 17].forEach(function (h) {
      if (out.length >= 3) return;
      var t = pad(h) + ":00";
      if (!SLOTS_ENABLED[t]) return;
      if (off === 0 && h <= now.hh) return; // 今天已过的趟次不要
      out.push({
        date: day.getUTCFullYear() + "-" + pad(day.getUTCMonth() + 1) + "-" + pad(day.getUTCDate()),
        time: t,
        day_label: off === 0 ? "今天" : (off === 1 ? "明天" : "后天"),
        date_text: day.getUTCMonth() + 1 + "月" + day.getUTCDate() + "日 " + WEEK[day.getUTCDay()],
        time_label: h === 12 ? "中午 12:00" : "下午 17:00"
      });
    });
  }
  return out;
}

/* ---------- 菜单加载（Supabase settings 表，id=1） ---------- */
function loadMenu() {
  return fetch(SUPABASE_URL + "/rest/v1/settings?id=eq.1", {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + SUPABASE_ANON_KEY }
  }).then(function (r) {
    if (!r.ok) throw new Error("菜单加载失败");
    return r.json();
  }).then(function (rows) {
    var menu = rows && rows[0];
    if (!menu) throw new Error("菜单还没准备好");
    PRICE = menu.price;
    FRUITS = menu.fruits.filter(function (f) { return f.available; });
    CREAMS = menu.creams.filter(function (c) { return c.available; });
    ITEMS = FRUITS.concat(CREAMS.map(function (c) { return { name: c.name, tag: c.tag }; }));
    BOTTOM_FRUITS = menu.bottom_fruits.filter(function (n) {
      return FRUITS.some(function (f) { return f.name === n; });
    });
    CAMPUSES = menu.campuses;
    PAY_METHODS = menu.pay_methods;
    SLOTS_ENABLED = menu.slots_enabled || { "12:00": true, "17:00": true };
    SLOTS = computeSlots();
    state.picks = ITEMS.map(function () { return 0; });
    $("heroPrice").textContent = PRICE;
    $("buildHint").textContent = "¥" + PRICE + " / 份";
    var ann = $("announce");
    if (menu.announcement) { ann.textContent = menu.announcement; ann.classList.add("show"); }
    buildBottomGrid();
    buildPickList();
    buildCampusSeg();
    buildSlotGrid();
    buildPayGrid();
    refreshPicks(); refreshQty(); renderCart();
  }).catch(function () {
    showError($("orderError"), "菜单没加载出来，刷新页面再试一次。");
  });
}

/* ---------- 最底层 ---------- */
function buildBottomGrid() {
  var grid = $("bottomGrid");
  grid.innerHTML = "";
  BOTTOM_FRUITS.forEach(function (name) {
    var f = null;
    FRUITS.forEach(function (x) { if (x.name === name) f = x; });
    if (!f) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.setAttribute("aria-pressed", "false");
    b.innerHTML = '<span class="dot" style="background:' + f.color + '"></span>' + name;
    b.addEventListener("click", function () {
      state.bottom = name;
      grid.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      hideError($("buildError"));
    });
    grid.appendChild(b);
  });
}

/* ---------- 其余搭配 ---------- */
var pickCntEls = [];
function buildPickList() {
  var list = $("pickList");
  list.innerHTML = "";
  pickCntEls = [];
  ITEMS.forEach(function (it, i) {
    var row = document.createElement("div");
    row.className = "naifu-row";
    var lead = it.color ? '<span class="dot" style="background:' + it.color + '"></span>' : "";
    var tag = it.tag ? '<span class="tag">' + it.tag + '</span>' : "";
    row.innerHTML =
      lead + '<span class="nm">' + it.name + tag + '</span>' +
      '<span class="stepper">' +
      '<button type="button" aria-label="减少' + it.name + '">−</button>' +
      '<span class="cnt">0</span>' +
      '<button type="button" aria-label="增加' + it.name + '">＋</button>' +
      '</span>';
    var minus = row.querySelectorAll("button")[0];
    var plus = row.querySelectorAll("button")[1];
    var cnt = row.querySelector(".cnt");
    pickCntEls.push({ cnt: cnt, minus: minus, plus: plus });
    minus.addEventListener("click", function () {
      if (state.picks[i] > 0) { state.picks[i]--; refreshPicks(); hideError($("buildError")); }
    });
    plus.addEventListener("click", function () {
      if (picksTotal() < 2) { state.picks[i]++; refreshPicks(); hideError($("buildError")); }
    });
    list.appendChild(row);
  });
}
function refreshPicks() {
  var total = picksTotal();
  pickCntEls.forEach(function (o, i) {
    o.cnt.textContent = state.picks[i];
    o.minus.disabled = state.picks[i] <= 0;
    o.plus.disabled = total >= 2;
  });
  $("pickBar").style.width = (total / 2 * 100) + "%";
  var pt = $("pickProgressText");
  var wrap = $("pickProgress");
  if (total === 2) {
    pt.textContent = "已选满 2 份 ✓ 加上最底层一共 3 份";
    wrap.classList.add("done");
  } else {
    pt.textContent = "已选 " + total + " / 2，还差 " + (2 - total) + " 份";
    wrap.classList.remove("done");
  }
  refreshAddBtn();
}

/* ---------- 份数 ---------- */
function refreshQty() {
  $("qtyVal").textContent = state.qty;
  $("qtyMinus").disabled = state.qty <= 1;
  $("qtyPlus").disabled = state.qty >= 20;
  refreshAddBtn();
}
function refreshAddBtn() {
  $("addBtnPrice").textContent = "小计 ¥" + (state.qty * PRICE);
}
$("qtyMinus").addEventListener("click", function () { if (state.qty > 1) { state.qty--; refreshQty(); } });
$("qtyPlus").addEventListener("click", function () { if (state.qty < 20) { state.qty++; refreshQty(); } });

/* ---------- 加入购物车 ---------- */
$("addBtn").addEventListener("click", function () {
  if (!state.bottom) {
    showError($("buildError"), "先选最底层的水果：最底层只能放芒果、阳光玫瑰、火龙果、玉菇、哈密瓜、红柚这 6 种。");
    $("builder").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (picksTotal() !== 2) {
    showError($("buildError"), "水果和奶芙一共选 3 份：最底层算 1 份，其余搭配还要再选 " + (2 - picksTotal()) + " 份（可以重复选同一种）。");
    return;
  }
  hideError($("buildError"));
  state.cart.push({ bottom: state.bottom, picks: state.picks.slice(), qty: state.qty });
  state.bottom = null;
  $("bottomGrid").querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
  state.picks = ITEMS.map(function () { return 0; });
  state.qty = 1;
  refreshPicks(); refreshQty();
  renderCart();
  toast("已加入订单，一共 " + cartCount() + " 份");
});

/* ---------- 购物车 ---------- */
function picksSummary(counts) {
  var parts = [];
  counts.forEach(function (c, i) { if (c > 0) parts.push(ITEMS[i].name + " ×" + c); });
  return parts.join("、");
}
function renderCart() {
  var body = $("cartBody");
  var n = cartCount();
  $("cartHint").textContent = n ? (n + " 份 · ¥" + cartTotal()) : "还没加";
  $("cartHint").classList.toggle("done", n > 0);
  if (!state.cart.length) {
    body.innerHTML = '<p class="cart-empty">还没有选千层，先在上面搭配一份加进来。<br />想吃不同搭配，可以加好几份不同的。</p>';
  } else {
    body.innerHTML = "";
    state.cart.forEach(function (it, idx) {
      var div = document.createElement("div");
      div.className = "cart-item";
      div.innerHTML =
        '<div class="ci-top"><span class="ci-name">手作千层</span><span class="ci-price">¥' + (it.qty * PRICE) + '</span></div>' +
        '<div class="ci-detail">最底层：<b>' + it.bottom + '</b></div>' +
        '<div class="ci-detail">其余搭配：<b>' + picksSummary(it.picks) + '</b></div>' +
        '<div class="ci-actions"><span class="stepper">' +
        '<button type="button" aria-label="减少份数">−</button><span class="cnt">' + it.qty + '</span><button type="button" aria-label="增加份数">＋</button>' +
        '</span><button type="button" class="remove-btn">删除</button></div>';
      var btns = div.querySelectorAll(".stepper button");
      btns[0].addEventListener("click", function () {
        if (it.qty > 1) { it.qty--; } else { state.cart.splice(idx, 1); }
        renderCart();
      });
      btns[1].addEventListener("click", function () { if (it.qty < 20) { it.qty++; renderCart(); } });
      div.querySelector(".remove-btn").addEventListener("click", function () {
        state.cart.splice(idx, 1); renderCart(); toast("已删除这一份");
      });
      body.appendChild(div);
    });
    var tot = document.createElement("div");
    tot.className = "cart-total";
    tot.innerHTML = '<span>合计 ' + n + ' 份 <span class="free">· 免配送费</span></span><span class="amt">¥' + cartTotal() + '</span>';
    body.appendChild(tot);
  }
  $("stickyAmt").textContent = "¥" + cartTotal();
  $("stickyCnt").textContent = n ? (n + " 份千层 · 免配送费") : "还没选千层 · 免配送费";
}

/* ---------- 校区 / 付款 ---------- */
function buildCampusSeg() {
  var seg = $("campusSeg");
  seg.innerHTML = "";
  CAMPUSES.forEach(function (c, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-campus", c);
    b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    b.innerHTML = c + '<span class="small">苏州科技大学' + c + '</span>';
    b.addEventListener("click", function () {
      seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      state.campus = c;
      hideError($("orderError"));
    });
    seg.appendChild(b);
  });
  state.campus = CAMPUSES[0];
}
function buildPayGrid() {
  var grid = $("payGrid");
  grid.innerHTML = "";
  var colors = ["#3e7a3a", "#2f7fd0"];
  PAY_METHODS.forEach(function (m, i) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "pay-card"; b.setAttribute("data-pay", m);
    b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    b.innerHTML = '<span class="pdot" style="background:' + colors[i % colors.length] + '"></span>' + m;
    b.addEventListener("click", function () {
      grid.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      state.pay = m;
      hideError($("orderError"));
    });
    grid.appendChild(b);
  });
  state.pay = PAY_METHODS[0];
}

/* ---------- 配送时段 ---------- */
function buildSlotGrid() {
  var grid = $("slotGrid");
  grid.innerHTML = "";
  SLOTS.forEach(function (s, i) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "slot-card";
    b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    b.innerHTML = '<span class="d">' + s.day_label + ' · ' + s.date_text + '</span><span class="t">' + s.time_label + '</span>';
    b.addEventListener("click", function () {
      grid.querySelectorAll(".slot-card").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      state.slot = s;
    });
    grid.appendChild(b);
  });
  state.slot = SLOTS[0] || null;
}

/* ---------- 下单校验（照抄服务端 validate_order，报错文案原样） ---------- */
function validateOrder(body) {
  var fruitMap = {}, creamMap = {}, allMap = {};
  FRUITS.forEach(function (f) { fruitMap[f.name] = f; allMap[f.name] = f; });
  CREAMS.forEach(function (c) { creamMap[c.name] = c; allMap[c.name] = c; });
  var bottomAllowed = {};
  BOTTOM_FRUITS.forEach(function (n) { bottomAllowed[n] = true; });

  if (!body.items || !body.items.length || body.items.length > 10) {
    return "订单里至少要有一份千层，最多 10 种搭配。";
  }
  var qtyTotal = 0;
  for (var i = 0; i < body.items.length; i++) {
    var it = body.items[i];
    if (!bottomAllowed[it.bottom]) {
      return "最底层只能放芒果、阳光玫瑰、火龙果、玉菇、哈密瓜、红柚这 6 种水果。";
    }
    if (!fruitMap[it.bottom] || !fruitMap[it.bottom].available) {
      return "最底层水果「" + it.bottom + "」今天没有了，换一种吧。";
    }
    var totalPicks = 0;
    for (var name in it.picks) {
      if (!allMap[name]) return "没有「" + name + "」这个搭配。";
      if (!allMap[name].available) return "「" + name + "」今天没有了，换一种吧。";
      var cnt = it.picks[name];
      if (typeof cnt !== "number" || cnt < 0 || cnt > 2) return "搭配数量不对。";
      totalPicks += cnt;
    }
    if (totalPicks !== 2) {
      return "每份千层水果和奶芙一共选 3 份：最底层算 1 份，其余搭配还要再选 2 份。";
    }
    if (typeof it.qty !== "number" || it.qty < 1 || it.qty > 20) return "每种搭配 1–20 份。";
    qtyTotal += it.qty;
  }
  if (qtyTotal > 40) return "一次最多 40 份，超过请分两次下单。";
  if (CAMPUSES.indexOf(body.campus) < 0) return "校区只能选天平学院或江枫校区。";
  var slotOk = SLOTS.some(function (s) { return s.date === body.slot_date && s.time === body.slot_time; });
  if (!slotOk) return "配送时间不对，请重新选（每天 12:00 / 17:00 两趟）。";
  if (!body.building || body.building.length > 20) {
    return "填一下宿舍楼号（如 5 号楼），送到楼下要按楼号找你。";
  }
  if (!body.name || body.name.length > 20) return "填一下你的称呼，到了楼下好喊你。";
  if (!/^1\d{10}$/.test(body.phone)) return "手机号好像不对，填 11 位手机号，送到楼下会打这个电话。";
  if (PAY_METHODS.indexOf(body.pay) < 0) return "付款方式只能选微信转账或货到付款。";
  return null;
}

/* ---------- 提交订单（调 create_order RPC） ---------- */
$("orderBtn").addEventListener("click", function () {
  var err = $("orderError");
  if (!state.cart.length) {
    showError(err, "订单还是空的，先在第 1 步搭配一份千层加入订单。");
    $("builder").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  var building = $("building").value.trim();
  var room = $("room").value.trim();
  var name = $("buyerName").value.trim();
  var phone = $("phone").value.replace(/[\s-]/g, "");
  var remark = $("remark").value.trim();
  if (!building) { showError(err, "填一下宿舍楼号（如 5 号楼），送到楼下要按楼号找你。"); $("deliverySection").scrollIntoView({ behavior: "smooth" }); $("building").focus(); return; }
  if (!name) { showError(err, "填一下你的称呼，到了楼下好喊你。"); $("buyerName").focus(); return; }
  if (!/^1\d{10}$/.test(phone)) { showError(err, "手机号好像不对，填 11 位手机号，送到楼下会打这个电话。"); $("phone").focus(); return; }
  if (!state.slot) { showError(err, "配送时间还没选。"); return; }

  var items = state.cart.map(function (it) {
    var picks = {};
    it.picks.forEach(function (c, i) { if (c > 0) picks[ITEMS[i].name] = c; });
    return { bottom: it.bottom, picks: picks, qty: it.qty };
  });
  var body = {
    items: items,
    campus: state.campus,
    slot_date: state.slot.date,
    slot_time: state.slot.time,
    building: building, room: room, name: name,
    phone: phone, remark: remark, pay: state.pay
  };
  var vErr = validateOrder(body);
  if (vErr) { showError(err, vErr); return; }
  hideError(err);

  var btn = $("orderBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 提交中…';
  fetch(SUPABASE_URL + "/rest/v1/rpc/create_order", {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body: body })
  }).then(function (r) {
    return r.json().then(function (j) { return { status: r.status, body: j }; })
      .catch(function () { return { status: r.status, body: {} }; });
  }).then(function (res) {
    btn.disabled = false;
    btn.textContent = "提交订单";
    if (res.status !== 200) {
      showError(err, (res.body && (res.body.message || res.body.error)) || "下单没成功，再试一次。");
      return;
    }
    var o = res.body;
    var lines = [];
    o.items.forEach(function (it, i) {
      var picks = Object.keys(it.picks).map(function (k) { return k + " ×" + it.picks[k]; }).join("、");
      lines.push((i + 1) + ". 最底层：" + it.bottom + "｜其余搭配：" + picks + "｜×" + it.qty + "份");
    });
    lines.push("合计：" + o.qty_total + " 份 ¥" + o.total + "（免配送费）");
    lines.push("校区：" + o.campus);
    lines.push("宿舍：" + o.building + (o.room ? " " + o.room : "") + "（送到楼下）");
    lines.push("配送：" + o.slot_date + " " + o.slot_time);
    lines.push("称呼：" + o.name + "　电话：" + o.phone);
    lines.push("付款：" + o.pay);
    if (o.remark) lines.push("备注：" + o.remark);
    $("orderNo").textContent = "订单号：" + o.order_no;
    $("orderSummary").textContent = lines.join("\n");
    $("resultPanel").classList.add("show");
    $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    // 清空购物车，保留配送信息方便再下一单
    state.cart = [];
    renderCart();
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = "提交订单";
    showError(err, "网络不太好，下单没成功，再试一次。");
  });
});

$("againBtn").addEventListener("click", function () {
  $("resultPanel").classList.remove("show");
  $("cartSection").scrollIntoView({ behavior: "smooth", block: "start" });
});

loadMenu();
})();
