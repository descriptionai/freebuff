/* ============================================================
   기존물량등록 (loaded.html)
   - 수정 가능한 리스트: 번호 / 우체국명 / 날짜 / 파렛 / 공파렛 / 추가·삭제
   - 우체국명은 DB(post_offices)에서 로드하고, 실패 시
     js/node-navigation-data.js 의 우체국명으로 폴백.
     "우체국 리스트 최신 업로드" 버튼으로 데이터 파일의 목록을 DB 에 동기화.
   - 데이터는 Supabase(public.loaded_daily) 에 저장
   - node-navigation.html 의 iframe 오버레이로 열리며,
     "닫기" 클릭 시 부모로 postMessage 를 보내 오버레이를 닫습니다.
   ============================================================ */
(function () {
  'use strict';

  var supabase = window.__supabase;
  var OFFICE_CFG = window.NODE_NAV_CONFIG || {};

  var rowsEl = document.getElementById('rows');
  var statusEl = document.getElementById('std-status');
  var saveBtn = document.getElementById('btn-save');
  var closeBtn = document.getElementById('btn-close');
  var officeUploadBtn = document.getElementById('btn-office-upload');
  var waitEl = document.getElementById('wait');
  var popupEl = document.getElementById('popup');

  var officeNames = []; // 셀렉트 박스 옵션 (우체국명 목록)

  function $(id) { return document.getElementById(id); }

  /* ---------------- 상태 메시지(토스트) ---------------- */
  function toast(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = 'std-status ' + (isError ? 'err' : 'ok');
    statusEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { statusEl.hidden = true; }, 2800);
  }

  /* ---------------- 우체국명 목록 ---------------- */
  // 데이터 파일(js/node-navigation-data.js)에서 전체 우체국/취급국명 추출
  function localOfficeNames() {
    return (OFFICE_CFG.postOffices || []).map(function (o) { return o.name; });
  }

  // 우체국명 오름차순 정렬 (한글 가나다순: 가 → 하)
  function sortAsc(names) {
    return names.slice().sort(function (a, b) {
      return String(a).localeCompare(String(b), 'ko');
    });
  }

  // DB(post_offices) 우선 → 없으면 데이터 파일로 폴백 (매번 검색하지 않음)
  // 우체국명은 항상 오름차순으로 정렬해서 드롭다운에 표시
  function loadOffices(cb) {
    var local = localOfficeNames();
    if (!supabase) { cb(sortAsc(local)); return; }
    supabase.from('post_offices')
      .select('name')
      .then(function (res) {
        if (res.error) throw res.error;
        cb(sortAsc((res.data && res.data.length) ? res.data.map(function (r) { return r.name; }) : local));
      })
      .catch(function () { cb(sortAsc(local)); });
  }

  /* ---------------- 행(라인) 생성/관리 ---------------- */
  function opts(names, sel) {
    var empty = '<option value=""></option>';
    return empty + names.map(function (v) {
      return '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
  }

  function todayStr() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  /* ---------------- 날짜 선택 (네이티브 달력 + 커스텀 폴백) ---------------- */
  // ※ showPicker() 는 크로스 오리진 iframe 안(예: 로컬 file:// 에서
  //    node-navigation.html 의 iframe 오버레이로 열 때)에서는 예외를 던진다.
  //    이때 focus() 폴백만으로는 달력이 열리지 않으므로 커스텀 달력 팝업으로 대체한다.
  var calPopup = null; // 현재 열려 있는 커스텀 달력 팝업

  function pad2(n) { return String(n).padStart(2, '0'); }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDate(v) {
    var p = String(v || '').split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  // 커스텀 달력 팝업을 날짜 입력 옆에 연다 (showPicker() 실패 시 폴백)
  function openCalendar(inp) {
    closeCalendar();
    var wrap = inp.closest ? inp.closest('.date-wrap') : null;
    if (!wrap) return;

    var cur = parseDate(inp.value) || new Date();
    var viewY = cur.getFullYear();
    var viewM = cur.getMonth();
    var tStr = fmtDate(new Date());

    var pop = document.createElement('div');
    pop.className = 'cal-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '날짜 선택');

    function render() {
      var startDow = new Date(viewY, viewM, 1).getDay();
      var daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
      var sel = inp.value;
      var html =
        '<div class="cal-head">' +
        '<button type="button" class="cal-nav" data-m="-1" title="이전 달">◀</button>' +
        '<span class="cal-title">' + viewY + '년 ' + (viewM + 1) + '월</span>' +
        '<button type="button" class="cal-nav" data-m="1" title="다음 달">▶</button>' +
        '</div>' +
        '<div class="cal-dow">' + ['일', '월', '화', '수', '목', '금', '토'].map(function (w) {
          return '<span>' + w + '</span>';
        }).join('') + '</div>' +
        '<div class="cal-grid">';
      for (var i = 0; i < startDow; i++) html += '<span class="cal-cell empty"></span>';
      for (var d = 1; d <= daysInMonth; d++) {
        var dd = new Date(viewY, viewM, d);
        var f = fmtDate(dd);
        var cls = 'cal-cell' + (f === sel ? ' sel' : '') + (f === tStr ? ' today' : '');
        html += '<button type="button" class="' + cls + '" data-date="' + f + '">' + d + '</button>';
      }
      html += '</div>';
      pop.innerHTML = html;
    }

    pop.addEventListener('click', function (e) {
      var nav = e.target.closest ? e.target.closest('.cal-nav') : null;
      if (nav) {
        var m = +nav.getAttribute('data-m');
        viewM += m;
        if (viewM < 0) { viewM = 11; viewY--; }
        if (viewM > 11) { viewM = 0; viewY++; }
        render();
        return;
      }
      var cell = e.target.closest ? e.target.closest('.cal-cell[data-date]') : null;
      if (cell) {
        inp.value = cell.getAttribute('data-date');
        closeCalendar();
        try { inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { /* 무시 */ }
      }
    });

    render();
    wrap.appendChild(pop);
    calPopup = pop;
  }

  function closeCalendar() {
    if (calPopup && calPopup.remove) calPopup.remove();
    calPopup = null;
  }

  // 바깥 클릭 / Esc 로 커스텀 달력 닫기 (한 번만 등록)
  document.addEventListener('mousedown', function (e) {
    if (!calPopup) return;
    if (calPopup.contains(e.target)) return;
    closeCalendar();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCalendar();
  });

  // 파렛/공파렛: 비어 있거나 숫자가 아니면 0
  function numOrZero(inp) {
    var v = parseFloat(inp.value);
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  }

  function makeRow(data) {
    data = data || {};
    var div = document.createElement('div');
    div.className = 'std-grid std-row';
    div.innerHTML =
      '<span class="num"></span>' +
      '<select class="in sel office" title="우체국명">' + opts(officeNames, data.office_name || '') + '</select>' +
      '<span class="date-wrap">' +
      '<input class="in date" type="date" title="달력 아이콘으로 날짜를 선택하세요" value="' + (data.loaded_date || todayStr()) + '" />' +
      '<button type="button" class="cal-btn" title="날짜 선택">📅</button>' +
      '</span>' +
      '<input class="in num pallet" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="' + (data.pallet == null ? 0 : data.pallet) + '" />' +
      '<input class="in num empty-pallet" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="' + (data.empty_pallet == null ? 0 : data.empty_pallet) + '" />' +
      '<span class="act">' +
      '<button type="button" class="icon-btn add" title="아래에 새 줄 추가">+</button>' +
      '<button type="button" class="icon-btn del" title="이 줄 삭제">-</button>' +
      '</span>';

    // 날짜: 직접 타이핑은 차단하고 달력으로만 선택.
    // ※ readonly 를 쓰면 브라우저에서 showPicker() 가 동작하지 않아(InvalidStateError)
    //    달력이 열리지 않으므로, readonly 대신 프린터블 키만 막는다.
    var dateInp = div.querySelector('.date');
    dateInp.addEventListener('keydown', function (e) {
      // 글자/숫자/기호 등 한 글자 키만 차단 (Tab·화살표·Enter·Esc 등은 허용)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
      }
    });
    function openPicker(inp) {
      // 1) 네이티브 달력 우선 시도 — 같은 오리진(직접 열기 / https 배포)에서 동작
      if (inp.showPicker) {
        try { inp.showPicker(); return; } catch (err) { /* 크로스 오리진 iframe 등 → 아래 커스텀 달력 */ }
      }
      // 2) 실패했거나 showPicker 미지원 브라우저 → 커스텀 달력 팝업
      openCalendar(inp);
    }
    // 입력란 클릭 시에도 달력 표시 (네이티브 달력 표시기는 CSS로 숨겨져 있음)
    dateInp.addEventListener('click', function () { openPicker(dateInp); });
    div.querySelector('.cal-btn').addEventListener('click', function () { openPicker(dateInp); });

    // 파렛/공파렛: 포커스가 사라지면 빈 값 → 자동으로 0 채움
    [div.querySelector('.pallet'), div.querySelector('.empty-pallet')].forEach(function (inp) {
      inp.addEventListener('blur', function () {
        if (String(inp.value).trim() === '') inp.value = 0;
      });
    });

    // "+" → 해당 라인 바로 아래에 새 입력 라인 추가
    div.querySelector('.add').addEventListener('click', function () {
      rowsEl.insertBefore(makeRow(), div.nextSibling);
      renumber();
      var fresh = div.nextSibling;
      if (fresh) fresh.querySelector('.office').focus();
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
        office_name: row.querySelector('.office').value,
        loaded_date: row.querySelector('.date').value,
        pallet: numOrZero(row.querySelector('.pallet')),
        empty_pallet: numOrZero(row.querySelector('.empty-pallet'))
      };
    });
  }

  // 우체국명 목록 확정 후 기존 데이터 로드 (없으면 항상 1줄)
  function load() {
    loadOffices(function (names) {
      officeNames = names;
      if (!supabase) { rowsEl.appendChild(makeRow()); renumber(); return; }
      supabase.from('loaded_daily')
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
    });
  }

  // 우체국명/날짜는 필수 (파렛/공파렛은 0 허용 — 체크 안 함)
  function save() {
    if (!supabase) { toast('Supabase 설정이 없어 저장할 수 없습니다.', true); return; }

    var firstInvalid = null;
    for (var vi = 0; vi < rowsEl.children.length; vi++) {
      var row = rowsEl.children[vi];
      var oInp = row.querySelector('.office');
      var dInp = row.querySelector('.date');
      if (!String(oInp.value).trim() || !String(dInp.value).trim()) {
        firstInvalid = String(oInp.value).trim() ? dInp : oInp;
        break;
      }
    }
    if (firstInvalid) {
      toast('우체국명과 날짜 항목은 반드시 입력하셔야 합니다.', true);
      firstInvalid.focus();
      try { firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 무시 */ }
      return;
    }

    saveBtn.disabled = true;
    var rows = collectRows();

    supabase.from('loaded_daily').select('id').then(function (res) {
      if (res.error) throw res.error;
      var remove = res.data && res.data.length
        ? supabase.from('loaded_daily').delete().in('id', res.data.map(function (r) { return r.id; }))
        : Promise.resolve({ error: null });
      return remove.then(function (dr) {
        if (dr && dr.error) throw dr.error;
        return supabase.from('loaded_daily').insert(rows);
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

  /* ---------------- 우체국 리스트 최신 업로드 ---------------- */
  // 데이터 파일의 전체 우체국명을 DB(post_offices)에 동기화.
  // 업데이트 중에는 대기 화면으로 모든 조작 차단 → 완료 팝업 → 닫으면 이 화면만 새로고침
  function uploadOffices() {
    if (!supabase) { toast('Supabase 설정이 없어 업데이트할 수 없습니다.', true); return; }
    var names = localOfficeNames();
    if (!names.length) { toast('우체국 데이터가 없습니다.', true); return; }

    waitEl.hidden = false; // 대기 화면 — 아무 것도 못 하게 함
    var rows = names.map(function (n, i) { return { name: n, sort_order: i }; });
    supabase.from('post_offices')
      .upsert(rows, { onConflict: 'name' })
      .then(function (res) {
        waitEl.hidden = true;
        if (res.error) throw res.error;
        showPopup('업데이트가 완료 되었습니다.', function () { location.reload(); });
      })
      .catch(function (err) {
        waitEl.hidden = true;
        toast('업데이트 실패: ' + (err.message || err), true);
      });
  }

  /* ---------------- 완료 팝업 ---------------- */
  function showPopup(msg, onClose) {
    $('popup-msg').textContent = msg;
    popupEl._onClose = onClose;
    popupEl.hidden = false;
  }
  $('popup-ok').addEventListener('click', function () {
    popupEl.hidden = true;
    if (popupEl._onClose) popupEl._onClose();
  });

  /* ---------------- 닫기 ---------------- */
  function close() {
    if (window.parent && window.parent !== window) {
      try {
        var pd = window.parent.document;
        var ov = pd.getElementById('loaded-overlay');
        if (ov) { ov.hidden = true; pd.body.style.overflow = ''; return; }
      } catch (e) { /* 교차 출처 — 아래 postMessage 로 처리 */ }
      try { window.parent.postMessage({ type: 'close-loaded' }, '*'); } catch (e) { /* 무시 */ }
    } else {
      location.href = 'node-navigation.html';
    }
  }

  /* ---------------- 이벤트 ---------------- */
  officeUploadBtn.addEventListener('click', uploadOffices);
  $('btn-upload').addEventListener('click', function () {
    toast('기준파일 업로드는 준비 중입니다.', false);
  });
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', close);

  load();
})();
