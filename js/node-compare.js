/* ============================================================
   노선 비교 — 좌/우 독립 길찾기 + 시소 비교
   ============================================================
   - 좌/우 각각 출발지·경유지·도착지를 카카오 로컬 API로 검색
   - OSRM으로 도로 거리·소요시간 계산
   - 가운데 지도에 두 경로 동시 표시
   - 하단에 시소 애니메이션 + 비교 테이블
   ============================================================ */
(function () {
  'use strict';

  /* ================================================================
     1. 설정 & 유틸
     ================================================================ */
  var KAKAO_CFG = (window.KAKAO_KEYS || {});
  var KAKAO_REST_KEY = KAKAO_CFG.restApiKey || '';
  var KAKAO_APPKEY = KAKAO_CFG.appkey || '';
  var OSRM_API = 'https://router.project-osrm.org';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtKm(km) {
    if (!Number.isFinite(km)) return '--';
    return (Math.round(km * 10) / 10).toFixed(1);
  }
  function fmtTime(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return '--';
    minutes = Math.round(minutes);
    if (minutes < 1) return '1분 미만';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h > 0 && m > 0) return h + '시간 ' + m + '분';
    if (h > 0) return h + '시간';
    return m + '분';
  }
  function fmtTimeDiff(sec) {
    if (!Number.isFinite(sec)) return '--';
    sec = Math.abs(Math.round(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + '시간 ' + m + '분';
    return m + '분';
  }
  function distKm(a, b) {
    var R = 6371;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var la = a.lat * Math.PI / 180;
    var lb = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ================================================================
     2. 상태 관리
     ================================================================ */
  var state = {
    a: { dep: null, arr: null, waypoints: [], results: [], routeResult: null },
    b: { dep: null, arr: null, waypoints: [], results: [], routeResult: null }
  };

  /* ================================================================
     3. 카카오 로컬 API — 장소 검색
     ================================================================ */
  function kakaoSearch(query, callback) {
    if (!KAKAO_REST_KEY) {
      callback([], '카카오 REST API 키가 설정되지 않았습니다');
      return;
    }
    var url = 'https://dapi.kakao.com/v2/local/search/keyword.json'
      + '?query=' + encodeURIComponent(query)
      + '&size=15&page=1&sort=accuracy';

    fetch(url, { headers: { 'Authorization': 'KakaoAK ' + KAKAO_REST_KEY } })
      .then(function (r) {
        if (!r.ok) throw new Error('카카오 API HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var docs = (data.documents || []).map(function (doc) {
          return {
            name: doc.place_name,
            addr: doc.road_address_name || doc.address_name,
            lat: parseFloat(doc.y),
            lng: parseFloat(doc.x),
            phone: doc.phone || '',
            kakaoId: doc.id
          };
        });
        callback(docs, null);
      })
      .catch(function (err) {
        callback([], err.message || '검색 실패');
      });
  }

  /* ================================================================
     4. OSRM — 길찾기
     ================================================================ */
  function getJson(url, timeoutMs) {
    var ctrl = new AbortController();
    var tmr = setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { clearTimeout(tmr); return d; })
      .catch(function (e) { clearTimeout(tmr); throw e; });
  }

  function osrmRoute(points, callback) {
    if (!points || points.length < 2) {
      callback(null, '최소 2개 지점이 필요합니다');
      return;
    }
    var coords = points.map(function (p) {
      return p.lng.toFixed(6) + ',' + p.lat.toFixed(6);
    }).join(';');

    var url = OSRM_API + '/route/v1/driving/' + coords
      + '?overview=full&geometries=geojson&alternatives=false&steps=true';

    getJson(url, 20000)
      .then(function (res) {
        if (!res || res.code !== 'Ok' || !res.routes || !res.routes.length) {
          throw new Error('경로를 찾을 수 없습니다');
        }
        var route = res.routes[0];
        callback({
          distance: route.distance,   // 미터
          duration: route.duration,   // 초
          geometry: route.geometry ? route.geometry.coordinates : [],
          legs: route.legs || []
        }, null);
      })
      .catch(function (err) {
        callback(null, err.message || '길찾기 실패');
      });
  }

  /* ================================================================
     5. 카카오 지도 관리
     ================================================================ */
  var mapApi = {
    map: null,
    overlays: [],
    lineOverlays: [],

    load: function (cb) {
      if (window.kakao && window.kakao.maps) { cb(); return; }
      if (!KAKAO_APPKEY) {
        this.showEmpty('카카오 지도 appkey가 설정되지 않았습니다');
        return;
      }
      var ks = document.createElement('script');
      ks.async = true;
      ks.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(KAKAO_APPKEY) + '&autoload=false';
      ks.onload = function () {
        if (window.kakao && window.kakao.maps) { kakao.maps.load(cb); return; }
        mapApi.showEmpty('카카오 지도 스크립트 로드 실패');
      };
      ks.onerror = function () { mapApi.showEmpty('카카오 지도 스크립트를 불러오지 못했습니다'); };
      document.head.appendChild(ks);
    },

    init: function () {
      this.map = new kakao.maps.Map($('map'), {
        center: new kakao.maps.LatLng(36.35, 127.38),
        level: 9, minLevel: 1, maxLevel: 14
      });
      kakao.maps.event.addListener(this.map, 'click', function () {
        clearAllFocus();
      });

      // 이벤트 위임: 지도 영역에서 .nmarker 클릭 감지
      var mapContainer = $('map');
      mapContainer.addEventListener('click', function (e) {
        var target = e.target.closest('.nmarker');
        if (!target) return;
        e.stopPropagation();
        var name = target.dataset.name || '';
        // 어떤 마커인지 판별: markersA / markersB 에서 data-name으로 찾기
        var found = findMarkerByName(name);
        if (found) toggleMarkerByKeys(found.side, found.key);
      }, true); // 캡처 단계에서 처리

      $('map-empty').hidden = true;
    },

    showEmpty: function (msg) {
      var el = $('map-empty');
      if (el) {
        el.hidden = false;
        el.innerHTML = '<div class="map-empty-text"><span class="big">⚠️</span>' + esc(msg) + '</div>';
      }
    },

    statusText: function (t) {
      var el = $('map-status');
      if (!el) return;
      el.hidden = false;
      el.textContent = t;
      clearTimeout(mapApi._statusTimer);
      mapApi._statusTimer = setTimeout(function () { el.hidden = true; }, 4000);
    },
    _statusTimer: null,

    clear: function () {
      for (var i = 0; i < this.overlays.length; i++) this.overlays[i].setMap(null);
      this.overlays = [];
      this.clearLines();
      markersA = { dep: null, stops: [], arr: null };
      markersB = { dep: null, stops: [], arr: null };
      focusedKey = null;
    },

    clearLines: function () {
      for (var i = 0; i < this.lineOverlays.length; i++) this.lineOverlays[i].setMap(null);
      this.lineOverlays = [];
    },

    addPolyline: function (path, color, weight) {
      var line = new kakao.maps.Polyline({
        map: this.map, path: path,
        strokeWeight: weight || 5, strokeColor: color, strokeOpacity: 0.9,
        strokeStyle: 'solid'
      });
      this.lineOverlays.push(line);
      return line;
    },

    addMarker: function (lat, lng, opts) {
      var el = document.createElement('div');
      el.className = 'nmarker' + (opts.depot ? ' depot' : '') + (opts.waypoint ? ' waypoint' : '');
      el.textContent = opts.label || '';
      if (!opts.depot) el.style.background = opts.color || '#8a4bff';
      if (opts.name) el.dataset.name = opts.name;
      if (opts.title) el.title = opts.title;

      var pos = new kakao.maps.LatLng(lat, lng);
      var m = new kakao.maps.CustomOverlay({
        map: this.map, position: pos,
        content: el, zIndex: opts.zIndex || 0,
        clickable: !!opts.onClick
      });
      this.overlays.push(m);
      return { marker: m, el: el };
    },

    fit: function (points) {
      if (!points.length) return;
      var kb = new kakao.maps.LatLngBounds();
      points.forEach(function (p) { kb.extend(new kakao.maps.LatLng(p.lat, p.lng)); });
      this.map.setBounds(kb, 60, 60, 60, 60);
    },

    panTo: function (lat, lng) {
      if (this.map) this.map.panTo(new kakao.maps.LatLng(lat, lng));
    }
  };

  /* ================================================================
     6. 경로 그리기 (좌/우 각각 다른 색상)
     ================================================================ */
  function drawBothRoutes() {
    if (!mapApi.map) return;
    mapApi.clear();

    var allPoints = [];
    var hasA = state.a.routeResult;
    var hasB = state.b.routeResult;

    // 경로 A: 파란색
    if (hasA && hasA.geometry && hasA.geometry.length) {
      var pathA = hasA.geometry.map(function (c) { return new kakao.maps.LatLng(c[1], c[0]); });
      mapApi.addPolyline(pathA, '#2b6cff', 6);
      // 마커
      addRouteMarkers('a', hasA);
      hasA.geometry.forEach(function (c) { allPoints.push({ lat: c[1], lng: c[0] }); });
    }

    // 경로 B: 핑크색
    if (hasB && hasB.geometry && hasB.geometry.length) {
      var pathB = hasB.geometry.map(function (c) { return new kakao.maps.LatLng(c[1], c[0]); });
      mapApi.addPolyline(pathB, '#ff6b9d', 6);
      addRouteMarkers('b', hasB);
      hasB.geometry.forEach(function (c) { allPoints.push({ lat: c[1], lng: c[0] }); });
    }

    if (allPoints.length) {
      mapApi.fit(allPoints);
    }
  }

  /* ================================================================
     마커 포커스 상태 관리 (node-navigation.js와 동일 패턴)
     ================================================================ */
  // 좌/우 각각 마커 참조를 별도로 저장
  var markersA = { dep: null, stops: [], arr: null };
  var markersB = { dep: null, stops: [], arr: null };
  var focusedKey = null; // 'a-dep', 'a-0', 'a-arr', 'b-dep', 'b-0', 'b-arr'

  function findMarkerByName(name) {
    function searchPool(pool, side) {
      if (pool.dep && pool.dep.el && pool.dep.el.dataset.name === name) return { side: side, key: 'dep' };
      if (pool.arr && pool.arr.el && pool.arr.el.dataset.name === name) return { side: side, key: 'arr' };
      for (var i = 0; i < pool.stops.length; i++) {
        if (pool.stops[i] && pool.stops[i].el && pool.stops[i].el.dataset.name === name)
          return { side: side, key: String(i) };
      }
      return null;
    }
    return searchPool(markersA, 'a') || searchPool(markersB, 'b');
  }

  function getMarkerObj(side, key) {
    var pool = side === 'a' ? markersA : markersB;
    if (key === 'dep') return pool.dep;
    if (key === 'arr') return pool.arr;
    var idx = Number(key);
    return pool.stops[idx] || null;
  }

  function toggleMarkerByKeys(side, key) {
    var fullKey = side + '-' + key;
    var sm = getMarkerObj(side, key);
    if (!sm || !sm.el) return;

    if (focusedKey === fullKey) {
      // 같은 거 다시 클릭 → 해제
      sm.el.classList.remove('focus');
      focusedKey = null;
    } else {
      // 기존 포커스 해제
      if (focusedKey) {
        var parts = focusedKey.split('-');
        var oldSm = getMarkerObj(parts[0], parts[1]);
        if (oldSm && oldSm.el) oldSm.el.classList.remove('focus');
      }
      sm.el.classList.add('focus');
      focusedKey = fullKey;
    }
  }

  function clearAllFocus() {
    if (focusedKey) {
      var parts = focusedKey.split('-');
      var oldSm = getMarkerObj(parts[0], parts[1]);
      if (oldSm && oldSm.el) oldSm.el.classList.remove('focus');
      focusedKey = null;
    }
  }

  function addRouteMarkers(side, routeResult) {
    var s = state[side];
    var pool = side === 'a' ? markersA : markersB;
    var color = side === 'a' ? '#2b6cff' : '#ff6b9d';
    var num = 0;

    pool.dep = null; pool.stops = []; pool.arr = null;

    // 출발지
    if (s.dep) {
      pool.dep = mapApi.addMarker(s.dep.lat, s.dep.lng, {
        label: 'S', color: color, zIndex: 100,
        name: s.dep.name, title: s.dep.name,
        onClick: function () { toggleMarkerByKeys(side, 'dep'); }
      });
    }
    // 경유지
    s.waypoints.forEach(function (wp, idx) {
      pool.stops[idx] = mapApi.addMarker(wp.lat, wp.lng, {
        label: String(++num), color: '#8a4bff', zIndex: 80,
        name: wp.name, title: wp.name,
        onClick: function () { toggleMarkerByKeys(side, String(idx)); }
      });
    });
    // 도착지
    if (s.arr) {
      pool.arr = mapApi.addMarker(s.arr.lat, s.arr.lng, {
        label: 'E', color: color, zIndex: 100,
        name: s.arr.name, title: s.arr.name,
        onClick: function () { toggleMarkerByKeys(side, 'arr'); }
      });
    }
  }

  /* ================================================================
     7. 시소 & 비교
     ================================================================ */
  function updateSeesaw() {
    var beam = $('seesaw-beam');
    var charL = $('char-left');
    var charR = $('char-right');

    if (!beam) return;

    var a = state.a.routeResult;
    var b = state.b.routeResult;

    if (!a && !b) {
      // 둘 다 없음: 수평 + 무표정
      beam.className = 'seesaw-beam';
      charL.className = 'seesaw-char left-char';
      charR.className = 'seesaw-char right-char';
      charL.querySelector('.char-body').textContent = '🧑';
      charR.querySelector('.char-body').textContent = '🧑';
      return;
    }

    if (!a || !b) {
      // 하나만 있음: 수평 + 무표정
      beam.className = 'seesaw-beam';
      charL.className = 'seesaw-char left-char';
      charR.className = 'seesaw-char right-char';
      charL.querySelector('.char-body').textContent = '🧑';
      charR.querySelector('.char-body').textContent = '🧑';
      return;
    }

    // 둘 다 있음: 거리 비교
    var distA = a.distance / 1000;
    var distB = b.distance / 1000;

    if (Math.abs(distA - distB) < 0.1) {
      // 거의 동일: 수평
      beam.className = 'seesaw-beam';
      charL.className = 'seesaw-char left-char';
      charR.className = 'seesaw-char right-char';
      charL.querySelector('.char-body').textContent = '😐';
      charR.querySelector('.char-body').textContent = '😐';
    } else if (distA > distB) {
      // A가 더 김 → A 내려감(뚱뚱+어두운), B 올라감(날씬+밝음)
      beam.className = 'seesaw-beam tilt-left';
      charL.className = 'seesaw-char left-char tilt-down';
      charR.className = 'seesaw-char right-char tilt-up';
      charL.querySelector('.char-body').textContent = '😤';
      charR.querySelector('.char-body').textContent = '😊';
    } else {
      // B가 더 김 → B 내려감, A 올라감
      beam.className = 'seesaw-beam tilt-right';
      charL.className = 'seesaw-char left-char tilt-up';
      charR.className = 'seesaw-char right-char tilt-down';
      charL.querySelector('.char-body').textContent = '😊';
      charR.querySelector('.char-body').textContent = '😤';
    }
  }

  function updateCompareTable() {
    var a = state.a.routeResult;
    var b = state.b.routeResult;
    var tableEl = $('compare-table');
    var emptyEl = $('compare-empty');
    var tbody = $('compare-tbody');

    if (!a || !b) {
      if (tableEl) tableEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (tableEl) tableEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;

    var distA = a.distance / 1000;
    var distB = b.distance / 1000;
    var durA = a.duration;
    var durB = b.duration;
    var stopsA = (state.a.waypoints.length) + 2;
    var stopsB = (state.b.waypoints.length) + 2;
    var distDiff = distA - distB;
    var durDiff = durA - durB;

    var rows = [
      { label: '총 거리', left: fmtKm(distA) + ' km', right: fmtKm(distB) + ' km',
        diff: (distDiff > 0 ? '+' : '') + fmtKm(distDiff) + ' km', positive: distDiff > 0 },
      { label: '소요 시간', left: fmtTime(durA / 60), right: fmtTime(durB / 60),
        diff: (durDiff > 0 ? '+' : '') + fmtTimeDiff(durDiff), positive: durDiff > 0 },
      { label: '방문 지점', left: stopsA + '곳', right: stopsB + '곳',
        diff: (stopsA - stopsB > 0 ? '+' : '') + (stopsA - stopsB) + '곳',
        positive: stopsA - stopsB > 0 }
    ];

    tbody.innerHTML = rows.map(function (r) {
      var cls = r.positive ? 'positive' : (r.diff.indexOf('-') === 0 ? 'negative' : '');
      return '<tr>' +
        '<td class="row-label">' + esc(r.label) + '</td>' +
        '<td class="left-val">' + r.left + '</td>' +
        '<td class="right-val">' + r.right + '</td>' +
        '<td class="diff-val ' + cls + '">' + r.diff + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ================================================================
     8. 입력 패널 관리
     ================================================================ */
  function createPanel(side) {
    var depInput = $(side + '-dep');
    var arrInput = $(side + '-arr');
    var addWpBtn = $(side + '-add-wp');
    var waypointsEl = $(side + '-waypoints');
    var searchBtn = $(side + '-search-btn');
    var resultsList = $(side + '-results-list');
    var resultsCount = $(side + '-results-count');
    var resultsTitle = $(side + '-results-title');

    var activeInput = null; // 현재 검색 중인 입력 필드
    var searchTimer = null;

    // ---- 입력 포커스 시: 가운데 초기화 ----
    function onInputFocus() {
      activeInput = depInput; // 기본값
      if (document.activeElement === arrInput) activeInput = arrInput;
      resetCenter();
    }

    depInput.addEventListener('focus', function () {
      activeInput = depInput;
      resetCenter();
    });
    arrInput.addEventListener('focus', function () {
      activeInput = arrInput;
      resetCenter();
    });

    function resetCenter() {
      // 비교 초기화
      state[side].routeResult = null;
      updateSeesaw();
      updateCompareTable();
      // 지도에서 해당 경로만 지우기 (다른 쪽 경로는 유지)
      drawBothRoutes();
    }

    // ---- 검색 ----
    function doSearch(query) {
      if (!query || query.length < 2) {
        resultsList.innerHTML = '<div class="result-empty">검색어를 2자 이상 입력하세요</div>';
        resultsCount.textContent = '0건';
        return;
      }
      resultsList.innerHTML = '<div class="result-empty">검색 중…</div>';
      resultsTitle.textContent = '검색 결과';

      kakaoSearch(query, function (docs, err) {
        if (err) {
          resultsList.innerHTML = '<div class="result-empty">⚠️ ' + esc(err) + '</div>';
          resultsCount.textContent = '0건';
          return;
        }
        state[side].results = docs;
        resultsCount.textContent = docs.length + '건';
        renderResults(docs);
      });
    }

    function renderResults(docs) {
      if (!docs.length) {
        resultsList.innerHTML = '<div class="result-empty">검색 결과가 없습니다</div>';
        return;
      }
      resultsList.innerHTML = '';
      docs.forEach(function (doc, idx) {
        var item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML =
          '<div class="result-info">' +
          '<div class="result-name">' + esc(doc.name) + '</div>' +
          '<div class="result-addr">' + esc(doc.addr) + '</div>' +
          '</div>' +
          '<button class="result-select" type="button">선택</button>';

        // 클릭 → 지도에 미리보기
        item.addEventListener('click', function (e) {
          if (e.target.classList.contains('result-select')) return;
          if (mapApi.map) {
            mapApi.clear();
            mapApi.addMarker(doc.lat, doc.lng, {
              label: '*', color: side === 'a' ? '#2b6cff' : '#ff6b9d', zIndex: 100
            });
            mapApi.panTo(doc.lat, doc.lng);
          }
        });

        // 선택 버튼
        item.querySelector('.result-select').addEventListener('click', function () {
          selectPlace(side, activeInput, doc);
          // 확정 표시: 입력 필드에 배경 효과
          if (activeInput) activeInput.classList.add('confirmed');
          // 검색 결과 하이라이트
          resultsList.querySelectorAll('.result-item').forEach(function (el) {
            el.classList.remove('selected');
          });
          item.classList.add('selected');
        });

        resultsList.appendChild(item);
      });
    }

    function selectPlace(side, inputEl, doc) {
      if (inputEl === depInput) {
        state[side].dep = doc;
        depInput.value = doc.name;
      } else if (inputEl === arrInput) {
        state[side].arr = doc;
        arrInput.value = doc.name;
      } else if (inputEl && inputEl.dataset && inputEl.dataset.wpIdx !== undefined) {
        // 경유지 입력 필드인 경우
        var wpIdx = parseInt(inputEl.dataset.wpIdx, 10);
        if (!isNaN(wpIdx) && wpIdx >= 0 && wpIdx < state[side].waypoints.length) {
          state[side].waypoints[wpIdx] = doc;
          inputEl.value = doc.name;
        }
      }
    }

    // ---- 입력 이벤트: 디바운스 검색 ----
    function onInput(e) {
      var val = e.target.value.trim();
      activeInput = e.target;
      // 다시 입력하면 확정 표시 해제
      e.target.classList.remove('confirmed');
      clearTimeout(searchTimer);
      if (val.length >= 2) {
        searchTimer = setTimeout(function () { doSearch(val); }, 400);
      } else {
        state[side].results = [];
        resultsList.innerHTML = '<div class="result-empty">검색어를 2자 이상 입력하세요</div>';
        resultsCount.textContent = '0건';
      }
    }

    depInput.addEventListener('input', onInput);
    arrInput.addEventListener('input', onInput);

    // ---- 경유지 추가 ----
    addWpBtn.addEventListener('click', function () {
      state[side].waypoints.push(null);
      renderWaypoints(side);
    });

    // ---- 길찾기 ----
    searchBtn.addEventListener('click', function () {
      var s = state[side];
      if (!s.dep || !s.arr) {
        mapApi.statusText('출발지와 도착지를 모두 선택해주세요');
        return;
      }
      var points = [s.dep];
      s.waypoints.forEach(function (wp) { if (wp) points.push(wp); });
      points.push(s.arr);

      searchBtn.disabled = true;
      searchBtn.textContent = '⏳ 검색 중…';
      mapApi.statusText((side === 'a' ? '경로 A' : '경로 B') + ' 길찾기 중…');

      osrmRoute(points, function (result, err) {
        searchBtn.disabled = false;
        searchBtn.textContent = '🔍 길찾기';

        if (err) {
          mapApi.statusText('길찾기 실패: ' + err);
          return;
        }
        s.routeResult = result;
        mapApi.statusText((side === 'a' ? '경로 A' : '경로 B') + ' 길찾기 완료 ✅');
        drawBothRoutes();
        updateSeesaw();
        updateCompareTable();
      });
    });

    // ---- 경유지 렌더링 ----
    function renderWaypoints(side) {
      var el = waypointsEl;
      var wps = state[side].waypoints;
      el.innerHTML = '';
      wps.forEach(function (wp, idx) {
        var tag = document.createElement('div');
        tag.className = 'waypoint-tag';

        // 아이콘 + 입력 필드 + 삭제 버튼
        var icon = document.createElement('span');
        icon.className = 'wp-icon';
        icon.textContent = '📍';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'wp-input';
        input.placeholder = '경유지 ' + (idx + 1) + ' 검색…';
        input.value = wp ? wp.name : '';
        input.dataset.wpIdx = idx;

        var removeBtn = document.createElement('button');
        removeBtn.className = 'wp-remove';
        removeBtn.type = 'button';
        removeBtn.title = '경유지 삭제';
        removeBtn.textContent = '✕';

        tag.appendChild(icon);
        tag.appendChild(input);
        tag.appendChild(removeBtn);

        // 입력 포커스 → 해당 경유지가 활성 입력
        input.addEventListener('focus', function () {
          activeInput = input;
          resetCenter();
        });

        // 입력 시 검색
        input.addEventListener('input', function () {
          var val = input.value.trim();
          activeInput = input;
          // 다시 입력하면 확정 표시 해제
          input.classList.remove('confirmed');
          clearTimeout(searchTimer);
          if (val.length >= 2) {
            searchTimer = setTimeout(function () { doSearch(val); }, 400);
          } else {
            state[side].results = [];
            resultsList.innerHTML = '<div class="result-empty">검색어를 2자 이상 입력하세요</div>';
            resultsCount.textContent = '0건';
          }
        });

        // 삭제
        removeBtn.addEventListener('click', function () {
          state[side].waypoints.splice(idx, 1);
          renderWaypoints(side);
        });

        el.appendChild(tag);
      });
    }

    return {
      resetCenter: resetCenter,
      renderWaypoints: renderWaypoints,
      getActiveInput: function () { return activeInput; }
    };
  }

  /* ================================================================
     9. 초기화
     ================================================================ */
  var panelA, panelB;

  function init() {
    panelA = createPanel('a');
    panelB = createPanel('b');

    // 지도 로드
    mapApi.load(function () {
      mapApi.init();
    });

    // ESC 키 → 마커 포커스 해제
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') clearAllFocus();
    });
  }

  init();
})();
