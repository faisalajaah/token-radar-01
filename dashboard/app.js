// Token Radar radar-3 page: renders window.RADAR (data.js) into the board, the top
// picks, the detail view and the calibration table. No fetch, no network: every
// number on the page comes from the snapshot through lib/model.ts. The URL carries
// the view (?view=board|detail|filtered, ?slug=, ?scope=, ?cat=, ?chain=, ?sort=,
// ?q=) so a screenshot of any view is reproducible.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.textContent = 'No radar data loaded.'; return; }
  var rows = R.rows;
  var live = R.live || [];
  var watch = {};
  R.watchlist.forEach(function (s) { watch[s] = true; });

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function probClass(p) { return p >= 0.7 ? 'high' : p >= 0.45 ? 'mid' : 'low'; }
  function ageText(days) {
    if (days === null || days === undefined) return 'age unknown';
    if (days < 30) return days + 'd old';
    if (days < 365) return Math.round(days / 30) + 'mo old';
    return (days / 365).toFixed(1) + 'y old';
  }
  function groupLabel(row) {
    var g = R.model.category_groups;
    for (var k in g) { if (row.base_multiple === g[k].multiple) return g[k].label; }
    return row.category || 'Other';
  }

  // ---- header facts -------------------------------------------------------
  $('meta').innerHTML =
    '<span>Snapshot ' + esc(R.as_of) + '</span><span>Model ' + esc(R.model_version) + '</span>' +
    '<span>' + R.board_size + ' rows</span><span>Watchlist ' + R.watchlist_size + '</span>';
  var top = rows[0];
  $('facts').innerHTML =
    '<div class="fact"><span>Top expected value</span><b>' + esc(top.name) + ' · ' + money(top.implied_value_usd) + '</b></div>' +
    '<div class="fact"><span>Watchlist covered</span><b>' + R.watchlist_size + ' / ' + R.watchlist_size + '</b></div>' +
    '<div class="fact"><span>Early finds below the floor</span><b>' + R.early_size + '</b></div>' +
    '<div class="fact"><span>Live tokens set aside</span><b>' + R.live_size + '</b></div>' +
    '<div class="fact"><span>Snapshot floor</span><b>' + money(R.floor_usd) + ' TVL</b></div>';

  // ---- top picks ----------------------------------------------------------
  $('picks').innerHTML = rows.slice(0, 5).map(function (r) {
    return '<button type="button" class="pick" data-slug="' + esc(r.slug) + '">' +
      '<span class="rank">#' + r.rank + '</span><b>' + esc(r.name) + '</b>' +
      '<span class="val">' + money(r.implied_value_usd) + ' <small>expected · FDV ' + money(r.fdv_implied_usd) + '</small></span>' +
      '<span class="why">' + esc(r.drivers.join(' · ')) + '</span>' +
      '</button>';
  }).join('');

  // ---- calibration table --------------------------------------------------
  $('calib').querySelector('tbody').innerHTML = Object.keys(R.model.category_groups).map(function (k) {
    var g = R.model.category_groups[k];
    return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.multiple.toFixed(2) + 'x</td>' +
      '<td class="num">' + g.live_comps + '</td><td class="num">' + g.median_mcap_tvl.toFixed(3) + '</td>' +
      '<td class="num">' + Math.round(g.token_share * 100) + '%</td></tr>';
  }).join('');

  // ---- filters ------------------------------------------------------------
  var params = new URLSearchParams(location.search);
  var state = {
    scope: params.get('scope') || 'all',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    sort: params.get('sort') || 'expected',
    dir: 1,
    selected: null,
  };
  var catSel = $('cat');
  var cats = {};
  rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  var chainSel = $('chain');
  var chains = {};
  rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = true; }); });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
  });
  catSel.value = state.cat; chainSel.value = state.chain;
  $('q').value = state.q; $('sort').value = state.sort;

  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name.localeCompare(b.name); },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    probability: function (a, b) { return b.launch_probability - a.launch_probability; },
    expected: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
  };

  function visible() {
    var list = rows.slice();
    if (state.scope === 'watchlist') list = list.filter(function (r) { return watch[r.slug]; });
    if (state.scope === 'early') list = list.filter(function (r) { return !watch[r.slug]; });
    if (state.scope === 'live') return live.map(function (r) { return r; });
    if (state.q) {
      var q = state.q.toLowerCase();
      list = list.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0; });
    }
    if (state.cat) list = list.filter(function (r) { return r.category === state.cat; });
    if (state.chain) list = list.filter(function (r) { return r.chains.indexOf(state.chain) >= 0; });
    var fn = SORTS[state.sort] || SORTS.expected;
    var dir = state.dir;
    list.sort(function (a, b) { return fn(a, b) * dir; });
    return list;
  }

  function renderBoard() {
    var list = visible();
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-scope') === state.scope ? 'true' : 'false');
    });
    $('count').textContent = list.length + (state.scope === 'live' ? ' live tokens' : ' protocols');
    $('empty').hidden = list.length > 0;
    var maxExp = rows[0].implied_value_usd;
    if (state.scope === 'live') {
      $('rows').innerHTML = list.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"><td class="num">—</td>' +
          '<td><span class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + '</span></span></td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
          '<td><span class="prob">trades</span></td>' +
          '<td class="num">' + money(r.mcap_usd || 0) + ' <span class="fdv">mcap</span></td></tr>';
      }).join('');
      return;
    }
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + ' · ' + ageText(r.age_days) + '</span></span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td><span class="prob ' + probClass(r.launch_probability) + '">' + Math.round(r.launch_probability * 100) + '%</span></td>' +
        '<td><span class="implied"><span class="bar"><i style="width:' + Math.max(2, Math.round(r.implied_value_usd / maxExp * 100)) + '%"></i></span>' +
        '<span class="num">' + money(r.implied_value_usd) + '</span></span><span class="fdv">FDV ' + money(r.fdv_implied_usd) + '</span></td></tr>';
    }).join('');
  }

  // ---- detail -------------------------------------------------------------
  function gauge(p) {
    var r = 52, c = 2 * Math.PI * r, off = c * (1 - p);
    return '<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Launch probability ' + Math.round(p * 100) + '%">' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="#22304d" stroke-width="12"/>' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + (p >= 0.7 ? '#34d399' : p >= 0.45 ? '#fbbf24' : '#f87171') + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 70 70)"/>' +
      '<text x="70" y="66" text-anchor="middle" fill="#e8edf7" font-size="24" font-family="monospace">' + Math.round(p * 100) + '%</text>' +
      '<text x="70" y="86" text-anchor="middle" fill="#93a1bd" font-size="11">launch chance</text></svg>';
  }
  function tvlBars(row) {
    var top10 = rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).slice(0, 10);
    var max = top10[0].tvl_usd;
    return '<svg width="100%" height="180" viewBox="0 0 520 180" role="img" aria-label="TVL of the ten largest protocols">' +
      top10.map(function (r, i) {
        var w = Math.max(4, Math.round(r.tvl_usd / max * 460));
        var y = 8 + i * 18;
        var hot = r.slug === row.slug;
        return '<text x="0" y="' + (y + 10) + '" fill="' + (hot ? '#38bdf8' : '#93a1bd') + '" font-size="11" font-family="monospace">' + esc(r.name.slice(0, 14)) + '</text>' +
          '<rect x="120" y="' + y + '" width="' + w + '" height="12" rx="2" fill="' + (hot ? '#38bdf8' : '#26304d') + '"/>' +
          '<text x="' + (126 + w) + '" y="' + (y + 10) + '" fill="#93a1bd" font-size="11" font-family="monospace">' + money(r.tvl_usd) + '</text>';
      }).join('') + '</svg>';
  }
  function showDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { $('detail').hidden = true; state.selected = null; renderBoard(); return; }
    state.selected = slug;
    var steps = row.farm_steps.map(function (s) {
      var parts = s.split(' Cost: ');
      var head = parts[0];
      var tail = parts[1] ? parts[1].split(' Time: ') : [];
      return '<li><b>' + esc(head) + '</b><span class="cost">Cost: ' + esc(tail[0] || '') + ' · Time: ' + esc(tail[1] || '') + '</span></li>';
    }).join('');
    $('detail').innerHTML =
      '<div class="detail-head"><div><span class="sub">Rank #' + row.rank + ' · ' + esc(row.category || '—') + ' · ' + esc(row.chains.join(', ')) + '</span>' +
      '<h2>' + esc(row.name) + '</h2></div>' +
      '<button class="close" id="close-detail" type="button">Close</button></div>' +
      '<div class="detail-grid"><div class="gauge-wrap">' + gauge(row.launch_probability) +
      '<span class="cap">Expected ' + money(row.implied_value_usd) + ' · FDV ' + money(row.fdv_implied_usd) + '</span></div>' +
      '<div><div class="equation">' +
      '<div><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Calibrated multiple</span><b>' + row.base_multiple.toFixed(2) + 'x</b></div>' +
      '<div><span>Growth multiplier</span><b>' + row.growth_multiplier.toFixed(2) + 'x</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + row.maturity_multiplier.toFixed(2) + 'x</b></div>' +
      '<div><span>Chain multiplier</span><b>' + row.chain_multiplier.toFixed(2) + 'x</b></div>' +
      '<div class="big"><span>Expected value</span><b>' + money(row.implied_value_usd) + '</b></div>' +
      '<div class="big"><span>Launch chance</span><b>' + Math.round(row.launch_probability * 100) + '%</b></div>' +
      '</div><div class="detail-section"><h3>Why it ranks here</h3><ul class="drivers">' +
      row.drivers.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></div></div>' +
      '<div class="detail-section"><h3>TVL against the ten largest pre-token protocols</h3>' + tvlBars(row) + '</div>' +
      '<div class="detail-section"><h3>How to farm it — seven steps</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="warn" style="margin-top:12px">Never pay to claim an airdrop. A real claim costs gas only, and only from the protocol’s own page.</p></div>';
    $('detail').hidden = false;
    $('close-detail').addEventListener('click', function () { showDetail(null); });
    renderBoard();
    window.scrollTo(0, $('detail').offsetTop - 8);
  }

  // ---- events ---------------------------------------------------------------
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { state.scope = b.getAttribute('data-scope'); renderBoard(); });
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  $('reset').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.scope = 'all';
    $('q').value = ''; catSel.value = ''; chainSel.value = ''; renderBoard();
  });
  document.querySelectorAll('th button').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = b.getAttribute('data-sort');
      if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = 1; }
      if (s === 'expected' || s === 'probability' || s === 'tvl' || s === 'growth' || s === 'age') $('sort').value = s;
      renderBoard();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr && tr.getAttribute('data-slug')) showDetail(tr.getAttribute('data-slug'));
  });
  $('picks').addEventListener('click', function (e) {
    var card = e.target.closest('.pick');
    if (card) showDetail(card.getAttribute('data-slug'));
  });

  // ---- initial view from the URL --------------------------------------------
  if (params.get('view') === 'filtered') {
    state.scope = 'all'; state.cat = params.get('cat') || 'Lending'; state.sort = 'expected';
    catSel.value = state.cat;
  }
  if (params.get('view') === 'detail') {
    var slug = params.get('slug') || (rows[0] && rows[0].slug);
    renderBoard();
    showDetail(slug);
  } else {
    renderBoard();
  }
})();
