/* ============================================================
   기준자료 조회 (data-viewer.html)
   - 적재수량표 / 직영단가표 / 민간위탁 단가표 / 수집운송 조사결과
   - 데이터: data/*.js (엑셀에서 추출)
   - node-navigation.html 의 오버레이(iframe)로 열리며,
     "닫기" 시 부모로 postMessage 를 보냅니다.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 숫자 포맷 (3자리 콤마, 소수점 최대 2자리)
  function fmt(n) {
    if (n == null || n === '') return '';
    var v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  function fmtInt(n) {
    if (n == null) return '';
    return Number(n).toLocaleString('ko-KR');
  }

  var CAP = window.LOADING_CAPACITY || {};
  var DIR = window.DIRECT_RATE_2026 || null;
  var CON = window.CONSIGNMENT_RATE_2026 || null;
  var SURVEY = window.COLLECTION_SURVEY || [];

  /* ---------------- 탭 전환 ---------------- */
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.dv-pane').forEach(function (p) {
        p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab);
      });
    });
  });

  /* ---------------- 1) 적재수량표 ---------------- */
  function renderCapacity() {
    var wrap = $('capacity-table');
    if (!CAP.rows) { wrap.innerHTML = '<div class="info-note warn">적재수량 데이터가 없습니다.</div>'; return; }
    var rng = function (r) {
      if (!r) return '–';
      if (r.max == null) return r.min + ' 이상';
      return r.min + '~' + r.max;
    };
    var html =
      '<div class="info-note">수집편 적재 기준: <b>롤팔레트 + 낱소포만 적재</b> · 평팔레트는 수집편에서 사용하지 않음 (평팔레트 컬럼은 참고용)</div>' +
      '<table><thead><tr>' +
      CAP.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      CAP.rows.map(function (r) {
        return '<tr>' +
          '<td>' + esc(r.vehicle) + '</td>' +
          '<td class="c"><b>' + esc(r.ton) + '</b></td>' +
          '<td class="c">' + esc(rng(r.direct.roll)) + '</td>' +
          '<td class="c">' + esc(rng(r.direct.flat)) + '</td>' +
          '<td class="c">' + esc(rng(r.carrier.roll)) + '</td>' +
          '<td class="c">' + esc(rng(r.carrier.flat)) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<div class="info-note warn" style="margin:10px 0 0;">' +
      esc(CAP.remark || '') +
      (CAP.annotations && CAP.annotations.length ? '<br/>※ ' + CAP.annotations.map(esc).join('<br/>※ ') : '') +
      '</div>';
    wrap.innerHTML = html;
  }

  /* ---------------- 2) 직영단가표 ---------------- */
  var directSel = $('direct-tbl');
  function renderDirect() {
    if (!DIR) { $('direct-pane-inner').innerHTML = '<div class="info-note warn">직영단가표 데이터가 없습니다.</div>'; return; }
    var t = DIR.tables[Number(directSel.value)];
    var html = '<div class="info-note">' + esc(DIR.label) + ' · 거리(km) × 톤급 · 단위: 원</div>' +
      '<table class="rate"><thead><tr><th>거리(km)</th>' +
      DIR.tonnages.map(function (tn) { return '<th class="num">' + esc(tn) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      t.values.map(function (row, i) {
        return '<tr><td>' + fmtInt(DIR.distances[i]) + '</td>' +
          row.map(function (v) { return '<td class="num">' + fmtInt(v) + '</td>'; }).join('') +
          '</tr>';
      }).join('') +
      '</tbody></table>';
    $('direct-pane-inner').innerHTML = html;
  }
  if (DIR) {
    DIR.tables.forEach(function (t, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = t.name;
      directSel.appendChild(o);
    });
    directSel.addEventListener('change', renderDirect);
  }

  /* ---------------- 3) 민간위탁 단가표 ---------------- */
  var consignSec = $('consign-sec'), consignBlk = $('consign-blk');
  var BLK_KEYS = [['base', '원단가'], ['contract_2025', '2025.1.1 계약단가 (낙찰률 78%)'], ['contract_2026', '2026.4.1 계약단가 (물가변동 3.48% ↑)']];
  function renderConsign() {
    if (!CON) { $('consign-pane-inner').innerHTML = '<div class="info-note warn">민간위탁 단가표 데이터가 없습니다.</div>'; return; }
    var sec = CON.sections[Number(consignSec.value)];
    var bk = BLK_KEYS[Number(consignBlk.value)];
    var vals = sec[bk[0]];
    var html = '<div class="info-note">' + esc(CON.label) + ' · ' + esc(sec.name) + ' · ' + esc(bk[1]) + ' · 단위: 원</div>' +
      '<table class="rate"><thead><tr><th>거리(km)</th>' +
      CON.tonnages.map(function (tn) { return '<th class="num">' + esc(tn) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      vals.map(function (row, i) {
        return '<tr><td>' + fmtInt(sec.distances[i]) + '</td>' +
          row.map(function (v) { return '<td class="num">' + fmtInt(v) + '</td>'; }).join('') +
          '</tr>';
      }).join('') +
      '</tbody></table>';
    $('consign-pane-inner').innerHTML = html;
  }
  if (CON) {
    CON.sections.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = s.name;
      consignSec.appendChild(o);
    });
    BLK_KEYS.forEach(function (b, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = b[1];
      consignBlk.appendChild(o);
    });
    consignSec.addEventListener('change', renderConsign);
    consignBlk.addEventListener('change', renderConsign);
  }

  /* ---------------- 4) 수집운송 조사결과 ---------------- */
  var surveyQ = $('survey-q'), surveyMode = $('survey-mode'), surveyCount = $('survey-count');
  var COLS = [
    ['no', 'NO'], ['name', '관서명'], ['hq', '총괄국'], ['type', '구분'],
    ['addr', '주소'], ['hub', '집중국'], ['mid_deadline', '중간수집'], ['final_deadline', '마감수집'],
    ['depart', '출발시간'], ['line', '수집선로'], ['parcels', '소포'], ['letters', '통상'],
    ['containers', '용기'], ['mode', '상차방식'], ['max_ton', '최대톤급'], ['liftgate', '리프트'],
    ['note', '비고']
  ];
  function renderSurvey() {
    var q = surveyQ.value.trim().toLowerCase();
    var md = surveyMode.value;
    var rows = SURVEY.filter(function (r) {
      if (md && r.mode !== md) return false;
      if (!q) return true;
      return (r.name + ' ' + r.addr + ' ' + r.line + ' ' + r.hq + ' ' + r.type).toLowerCase().indexOf(q) !== -1;
    });
    surveyCount.textContent = '검색 결과 ' + rows.length + '곳 / 전체 ' + SURVEY.length + '곳';
    var MAX = 300;
    var shown = rows.slice(0, MAX);
    var html = '<table><thead><tr>' +
      COLS.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      shown.map(function (r) {
        var cls = r.mode === '롤' ? 'mode-roll' : (r.mode === '낱소포' ? 'mode-parcel' : '');
        return '<tr class="' + cls + '">' +
          '<td>' + fmtInt(r.no) + '</td>' +
          '<td><b>' + esc(r.name) + '</b></td>' +
          '<td>' + esc(r.hq) + '</td>' +
          '<td>' + esc(r.type) + '</td>' +
          '<td>' + esc(r.addr) + '</td>' +
          '<td>' + esc(r.hub) + '</td>' +
          '<td class="c">' + esc(r.mid_deadline) + '</td>' +
          '<td class="c">' + esc(r.final_deadline) + '</td>' +
          '<td class="c">' + esc(r.depart) + '</td>' +
          '<td>' + esc(r.line) + '</td>' +
          '<td class="num">' + fmt(r.parcels) + '</td>' +
          '<td class="num">' + fmt(r.letters) + '</td>' +
          '<td class="num">' + fmt(r.containers) + '</td>' +
          '<td class="mode">' + esc(r.mode || '') + '</td>' +
          '<td>' + esc(r.max_ton) + '</td>' +
          '<td>' + esc(r.liftgate) + '</td>' +
          '<td>' + esc(r.note) + '</td>' +
          '</tr>';
      }).join('') +
      (rows.length > MAX ? '<tr><td colspan="' + COLS.length + '">결과가 많아 처음 ' + MAX + '곳만 표시합니다. 검색어로 좁혀주세요.</td></tr>' : '') +
      '</tbody></table>';
    $('survey-table').innerHTML = html;
  }
  surveyQ.addEventListener('input', renderSurvey);
  surveyMode.addEventListener('change', renderSurvey);

  /* ---------------- 닫기 ---------------- */
  function closeViewer() {
    if (window.parent && window.parent !== window) {
      try {
        var pd = window.parent.document;
        var ov = pd.getElementById('data-overlay');
        if (ov) {
          ov.hidden = true;
          pd.body.style.overflow = '';
          return;
        }
      } catch (e) { /* 교차 출처 */ }
      try { window.parent.postMessage({ type: 'close-data-viewer' }, '*'); } catch (e) { /* 무시 */ }
    } else {
      location.href = 'node-navigation.html';
    }
  }
  $('btn-close').addEventListener('click', closeViewer);

  /* ---------------- 초기 렌더 ---------------- */
  renderCapacity();
  if (DIR) renderDirect();
  if (CON) renderConsign();
  renderSurvey();
})();
