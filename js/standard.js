/* ============================================================
   비용산정기준 (standard.html)
   - 수정 가능한 기준 리스트: 번호 / 차량구분 / 톤수 / 거리 / 비용 / 추가·삭제
   - 데이터는 Supabase(public.cost_standards) 에 저장
   - node-navigation.html 의 iframe 오버레이로 열리며,
     "닫기" 클릭 시 부모로 postMessage 를 보내 오버레이를 닫습니다.
   ============================================================ */
(function () {
  'use strict';

  var supabase = window.__supabase;

  var VEHICLE_TYPES = ['전용', '아웃소싱', '재위탁'];
  var TONNAGES = ['2.5톤', '4.5톤', '5톤', '8톤', '11톤', '18톤', '25톤'];

  var rowsEl = document.getElementById('rows');
  var statusEl = document.getElementById('std-status');
  var saveBtn = document.getElementById('btn-save');
  var closeBtn = document.getElementById('btn-close');

  function $(id) { return document.getElementById(id); }

  // DB 값(숫자·문자)을 innerHTML 에 넣기 전에 이스케이프
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 비용 3자리마다 쉼표 표시 (예: 1234567 → 1,234,567, 소수점 유지, 음수 불가)
  function fmtCost(v) {
    var parts = String(v == null ? '' : v).replace(/[^\d.]/g, '').split('.');
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return intPart + (parts.length > 1 && parts[1] !== '' ? '.' + parts[1] : '');
  }
  // 쉼표를 제거하고 숫자로 변환 (저장용)
  function parseCost(inp) {
    var v = parseFloat(String(inp.value).replace(/,/g, ''));
    return Number.isFinite(v) ? v : null;
  }

  /* ---------------- 상태 메시지(토스트) ---------------- */
  function toast(msg, isError, onClose) {
    statusEl.textContent = msg;
    statusEl.className = 'std-status ' + (isError ? 'err' : 'ok');
    statusEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      statusEl.hidden = true;
      if (onClose) onClose();
    }, 2800);
  }

  /* ---------------- 행(라인) 생성/관리 ---------------- */
  function opts(values, sel) {
    return values.map(function (v) {
      return '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
  }

  function numOrNull(inp) {
    var v = parseFloat(inp.value);
    return Number.isFinite(v) ? v : null;
  }

  // 데이터 한 건을 입력 라인으로 만든다 (data 는 DB 행 또는 빈 객체)
  function makeRow(data) {
    data = data || {};
    var div = document.createElement('div');
    div.className = 'std-grid std-row';
    div.innerHTML =
      '<span class="num"></span>' +
      '<select class="in sel vehicle" title="차량구분">' + opts(VEHICLE_TYPES, data.vehicle_type || '전용') + '</select>' +
      '<select class="in sel tonnage" title="톤수">' + opts(TONNAGES, data.tonnage || '2.5톤') + '</select>' +
      '<input class="in num distance" type="number" min="1" step="0.1" inputmode="decimal" placeholder="거리" value="' + esc(data.distance != null ? data.distance : '') + '" />' +
      '<input class="in num cost" type="text" inputmode="numeric" autocomplete="off" placeholder="비용" value="' + esc(fmtCost(data.cost)) + '" />' +
      '<span class="act">' +
      '<button type="button" class="icon-btn add" title="아래에 새 줄 추가">+</button>' +
      '<button type="button" class="icon-btn del" title="이 줄 삭제">-</button>' +
      '</span>';

    // 비용 입력 중 3자리마다 쉼표 자동 표시 (커서 위치 유지)
    var costInp = div.querySelector('.cost');
    costInp.addEventListener('input', function () {
      var pos = costInp.selectionStart || costInp.value.length;
      var beforeDigits = costInp.value.slice(0, pos).replace(/[^\d]/g, '');
      var formatted = fmtCost(costInp.value);
      costInp.value = formatted;
      var newPos = beforeDigits.length + Math.floor(Math.max(beforeDigits.length - 1, 0) / 3);
      costInp.setSelectionRange(newPos, newPos);
    });

    // "+" → 해당 라인 바로 아래에 새 입력 라인 추가
    div.querySelector('.add').addEventListener('click', function () {
      rowsEl.insertBefore(makeRow(), div.nextSibling);
      renumber();
      var fresh = div.nextSibling;
      if (fresh) fresh.querySelector('.vehicle').focus();
    });

    // "-" → 해당 라인 삭제 (마지막 1줄이면 빈 줄로 초기화해 항상 1줄 유지)
    div.querySelector('.del').addEventListener('click', function () {
      if (rowsEl.children.length <= 1) {
        var fresh = makeRow();
        rowsEl.replaceChild(fresh, div);
      } else {
        rowsEl.removeChild(div);
      }
      renumber();
    });

    return div;
  }

  // 1, 2, 3 … 순서대로 번호 재부여
  function renumber() {
    Array.prototype.forEach.call(rowsEl.children, function (row, i) {
      row.querySelector('.num').textContent = i + 1;
    });
  }

  /* ---------------- DB 로드/저장 ---------------- */
  function collectRows() {
    return Array.prototype.map.call(rowsEl.children, function (row, i) {
      return {
        sort_order: i,
        vehicle_type: row.querySelector('.vehicle').value,
        tonnage: row.querySelector('.tonnage').value,
        distance: numOrNull(row.querySelector('.distance')),
        cost: parseCost(row.querySelector('.cost'))
      };
    });
  }

  // 기존 데이터가 있으면 보여주고, 없으면 항상 1줄 (로드 실패 시에도 1줄 유지)
  function load() {
    if (!supabase) { rowsEl.appendChild(makeRow()); renumber(); return; }
    supabase.from('cost_standards')
      .select('*')
      .order('sort_order')
      .then(function (res) {
        rowsEl.innerHTML = '';
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) { rowsEl.appendChild(makeRow()); }
        else res.data.forEach(function (r) { rowsEl.appendChild(makeRow(r)); });
        renumber();
      })
      .catch(function (err) {
        rowsEl.innerHTML = '';
        rowsEl.appendChild(makeRow());
        renumber();
        toast('데이터를 불러오지 못했습니다: ' + (err.message || err), true);
      });
  }

  // 기존 행 전체 삭제 후 현재 리스트를 재저장 (순서 보장을 위한 단순 전략)
  function save() {
    if (!supabase) { toast('Supabase 설정이 없어 저장할 수 없습니다.', true); return; }

    // 입력 검증: 비어 있으면 "반드시 입력" / 1 미만(0 등)이면 "1이상 입력" 경고 + 즉시 포커스
    var firstInvalid = null, isEmpty = false;
    for (var vi = 0; vi < rowsEl.children.length; vi++) {
      var row = rowsEl.children[vi];
      var dInp = row.querySelector('.distance');
      var cInp = row.querySelector('.cost');
      var dVal = numOrNull(dInp), cVal = parseCost(cInp);
      if (dVal >= 1 && cVal >= 1) continue;
      if (dVal < 1) {
        firstInvalid = dInp;
        isEmpty = String(dInp.value).trim() === '';
      } else {
        firstInvalid = cInp;
        isEmpty = String(cInp.value).trim() === '';
      }
      break;
    }
    if (firstInvalid) {
      toast(isEmpty ? '거리와 비용 항목은 반드시 입력하셔야 합니다.' : '거리와 비용은 1이상 입력해야 합니다.', true);
      firstInvalid.focus();
      try { firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 무시 */ }
      return;
    }

    saveBtn.disabled = true;
    var rows = collectRows();

    supabase.from('cost_standards').select('id').then(function (res) {
      if (res.error) throw res.error;
      var remove = res.data && res.data.length
        ? supabase.from('cost_standards').delete().in('id', res.data.map(function (r) { return r.id; }))
        : Promise.resolve({ error: null });
      return remove.then(function (dr) {
        if (dr && dr.error) throw dr.error; // 삭제 실패 시 저장 중단 (중복 방지)
        return supabase.from('cost_standards').insert(rows);
      });
    }).then(function (res) {
      if (res && res.error) throw res.error;
      toast('저장되었습니다 ✔');
    }).catch(function (err) {
      toast('저장 실패: ' + (err.message || err), true);
    }).then(function () {
      saveBtn.disabled = false;
    });
  }

  /* ---------------- 닫기 ---------------- */
  // iframe(오버레이)으로 열린 경우:
  //   1) 같은 출처 → 부모 DOM 을 직접 제어 (가장 확실)
  //   2) 교차 출처 → postMessage 로 부모에 닫음을 요청
  // 단독으로 열린 경우에는 노선 화면으로 이동
  function close() {
    if (window.parent && window.parent !== window) {
      try {
        var pd = window.parent.document;
        var ov = pd.getElementById('standard-overlay');
        if (ov) {
          ov.hidden = true;
          pd.body.style.overflow = '';
          return;
        }
      } catch (e) { /* 교차 출처 — 아래 postMessage 로 처리 */ }
      try { window.parent.postMessage({ type: 'close-cost-standard' }, '*'); } catch (e) { /* 무시 */ }
    } else {
      location.href = 'node-navigation.html';
    }
  }

  /* ---------------- 이벤트 ---------------- */
  $('btn-upload').addEventListener('click', function () {
    toast('기준파일 업로드는 준비 중입니다.', false);
  });
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', close);

  load();
})();
