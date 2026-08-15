/* ============================================================
   중부권광역우편물류센터 — 노선별 네비게이션
   ============================================================
   - 좌측(30%): 최적 노선 목록.
       · 각 노선 카드는 연한 대표색 배경, 위아래 색이 겹치지 않음
         (황금각 137.5° 색상 회전으로 인접 노선 hue 를 확실히 분리)
       · 맨 처음 노선이 기본 선택 — 지도에도 첫 노선 경로가 표시됨
       · 선택 시 카드 테두리가 해당 노선 대표색으로 강조
   - 우측(70%): 선택 노선의 경로를 대표색으로 표시.
       · 지도 프로바이더: 카카오 지도 / 네이버 지도 / 무료 Leaflet(OSM·CARTO 타일)
         - 기본 'kakao': 카카오 JavaScript 키로 카카오 지도 표시
         - 'naver' / 'leaflet' 으로도 고정 가능 (js/node-navigation-data.js 의 mapProvider)
   - 노선명 규칙: "중부권" + 출발 우체국명(우체국 제외) + "수집1-N"
   - 최적화: Clarke-Wright 절약법 + 2-opt 경유 순서 개선
     (제약: 노선당 방문 수 ≤ maxStopsPerRoute, 거리 ≤ maxKmPerRoute
      → 그 범위 안에서 노선 수를 최소화)
   - 거리: 실제 도로 주행 거리(OSRM 공개 서버, 키 불필요) 기준.
       · 좌표 확정 후 거리 행렬을 1회 계산해 브라우저에 저장(재방문 즉시)
       · OSRM 접속 불가 시 직선거리 × roadFactor(1.3) 추정치로 폴백
   [네이버 지도 키(선택)]
   - js/node-navigation-data.js 의 NAVER.clientId 를 채우거나
   - 지도 영역의 안내창에서 바로 입력(브라우저 localStorage 저장) 가능
   - 키가 없어도 무료 지도(Leaflet)가 자동으로 표시됩니다.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 설정 ---------------- */
  var CFG = window.NODE_NAV_CONFIG || {};
  var NAVER_CFG = CFG.naver || {};
  // ── 카카오 지도 비활성화 (Leaflet 사용): appkey 설정을 읽지 않습니다 ──
  // var KAKAO_CFG = CFG.kakao || {};
  // var KAKAO_APPKEY = KAKAO_CFG.appkey || '';
  var DEPOT = CFG.depot || { name: '중부권광역우편물류센터', addr: '', lat: 36.2706944, lng: 127.4733805 };
  var OFFICES = CFG.postOffices || [];
  var MAX_STOPS = CFG.maxStopsPerRoute || 8;
  var MAX_KM = CFG.maxKmPerRoute || 60;
  var ROAD = CFG.roadFactor || 1.3;
  var PROVIDER = String(CFG.mapProvider || 'auto').toLowerCase(); // 'auto' | 'naver' | 'leaflet'

  var LS_KEY = 'nav_client_id';
  var USE_ROAD = CFG.roadRouting !== false; // 실제 도로 주행 거리(OSRM) 사용 여부
  var OSRM_API = CFG.osrmUrl || 'https://router.project-osrm.org'; // 공개 서버 — 키 불필요
  var MATRIX_KEY = 'nav_road_matrix_v2';
  var GEO_CACHE = {}; // 노선 실제 도로 경로(폴리라인) 메모리 캐시

  /* ---------------- 유틸 ---------------- */
  function $(id) { return document.getElementById(id); }

  // 하버사인 거리(km)
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

  // HSL(h 0~360, s/l 0~100) → hex
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    };
    var to255 = function (v) { return Math.round(255 * v).toString(16).padStart(2, '0'); };
    return '#' + to255(f(0)) + to255(f(8)) + to255(f(4));
  }

  // 노선 대표색(진한색) / 카드 배경(연한색) / 선택 테두리 글로우
  function hueLine(h) { return hslToHex(h, 72, 46); }
  function hueBorder(h) { return hslToHex(h, 65, 42); }
  function hueBg(h) { return hslToHex(h, 55, 92); }
  function hueGlow(h) {
    var c = hslToHex(h, 72, 46);
    var r = parseInt(c.substr(1, 2), 16), g = parseInt(c.substr(3, 2), 16), b = parseInt(c.substr(5, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',0.32)';
  }

  function fmtKm(km) { return (Math.round(km * 10) / 10).toFixed(1); }
  function shortName(n) {
    return String(n).replace(/(우편취급국|우편취급소|우체국|취급국|취급소|출장소)/g, '').trim();
  }
  function routeName(stops, idx) {
    return '중부권' + shortName(stops[0].name) + '수집1-' + (idx + 1);
  }
  // 사용자 데이터(데이터 파일)를 innerHTML/속성에 넣기 전에 이스케이프
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 좌표가 없는 우체국: 구 단위 근사 좌표로 임시 사용 (이후 무료 좌표 변환으로 보정)
  var GU_CENTER = {
    동구: [36.327, 127.435], 중구: [36.319, 127.420], 서구: [36.322, 127.373],
    유성구: [36.366, 127.340], 대덕구: [36.376, 127.425]
  };
  function fallbackCoord(o) {
    var m = (o.addr || '').match(/(동구|중구|서구|유성구|대덕구)/);
    var c = m && GU_CENTER[m[1]];
    return c || [36.33, 127.39];
  }
  function pointOf(o) {
    // Number.isFinite: null/undefined 모두 false → 근사 좌표로 폴백
    return {
      lat: Number.isFinite(o.lat) ? o.lat : fallbackCoord(o)[0],
      lng: Number.isFinite(o.lng) ? o.lng : fallbackCoord(o)[1]
    };
  }

  /* ---------------- 실제 도로 주행 거리 (OSRM, 키 불필요) ----------------
     지도상 직선거리가 아니라 실제 주행 가능한 도로 네트워크 기준 거리.
     공개 OSRM 서버(router.project-osrm.org) 사용.
     - 거리 행렬(table): 좌표 확정 후 1회 계산 → 브라우저(localStorage)에 저장해 재방문 즉시
     - 경로 기하(route): 선택 노선의 실제 도로 경로 폴리라인을 지도에 표시
     서버 접속 실패 시에는 기존 직선거리 × roadFactor 추정치로 폴백합니다. */
  function getJson(url, timeoutMs) {
    var ctrl = new AbortController();
    var tmr = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (d) { clearTimeout(tmr); return d; })
      .catch(function (e) { clearTimeout(tmr); throw e; });
  }

  // OSRM 좌표 문자열 (경도,위도)
  function osrmCoordStr(o) {
    var p = pointOf(o);
    return p.lng.toFixed(6) + ',' + p.lat.toFixed(6);
  }

  // 전체 거리 행렬(미터) 요청 — 실패 시 40개씩 청크로 분할 재시도
  function osrmTable(points) {
    var n = points.length, all = [], i;
    for (i = 0; i < n; i++) all.push(points[i].lng.toFixed(6) + ',' + points[i].lat.toFixed(6));
    var path = all.join(';');
    var base = OSRM_API + '/table/v1/driving/' + path + '?annotations=distance';
    var allIdx = [];
    for (i = 0; i < n; i++) allIdx.push(i);

    var attempt = function (sources, destinations) {
      return getJson(base + '&sources=' + sources.join(';') + '&destinations=' + destinations.join(';'), 20000)
        .then(function (res) {
          if (!res || res.code !== 'Ok' || !res.distances) throw new Error('osrm table fail');
          return res.distances;
        });
    };

    // 전체를 한 번에 → 실패하면 청크로 분할(공개 서버 부하 배려, 요청 간격 400ms)
    // 부분 성공한 청크는 그대로 병합하고, 실패한 행만 null로 두어 폴백하게 함
    return attempt(allIdx, allIdx).catch(function () {
      var m = [], pos = 0, anyOk = false;
      function nextChunk() {
        if (pos >= n) {
          if (!anyOk) throw new Error('osrm table all chunks failed');
          return m;
        }
        var src = [];
        for (var k = pos; k < Math.min(pos + 40, n); k++) src.push(k);
        return attempt(src, allIdx).then(function (block) {
          block.forEach(function (row, r) { m[pos + r] = row; });
          anyOk = true;
          pos += src.length;
          return new Promise(function (res) { setTimeout(res, 400); }).then(nextChunk);
        }).catch(function () {
          pos += src.length; // 이 청크 실패 — 해당 행은 null(직선 폴백) 처리 후 계속
          return new Promise(function (res) { setTimeout(res, 400); }).then(nextChunk);
        });
      }
      return nextChunk();
    });
  }

  var ROAD_MATRIX = null;   // n×n 도로 거리(km) — 0=물류센터, 1..=우체국
  var ROAD_MATRIX_SIG = ''; // 행렬 생성 당시 좌표 시그니처
  var ROAD_FAILED = false;  // OSRM 접속 실패 시 true — 중복 요청 방지

  function matrixSig() {
    return [pointOf(DEPOT)].concat(OFFICES.map(pointOf))
      .map(function (p) { return p.lat.toFixed(4) + ',' + p.lng.toFixed(4); }).join('|');
  }

  // 좌표 확정 후 도로 거리 행렬 계산 + 캐시. done: 완료 콜백
  function computeRoadMatrix(done) {
    done = done || function () {};
    if (!USE_ROAD || !OFFICES.length) { done(); return; }
    var pts = [pointOf(DEPOT)].concat(OFFICES.map(pointOf));
    var sig = matrixSig();
    var n = pts.length;

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(MATRIX_KEY) || 'null'); } catch (e) { /* 무시 */ }
    if (cached && cached.sig === sig && Array.isArray(cached.m) && cached.m.length === n) {
      ROAD_MATRIX = cached.m;
      ROAD_MATRIX_SIG = sig;
      done();
      return;
    }

    statusEl.hidden = false;
    statusEl.textContent = '실제 도로 거리 계산 중 (첫 1회만, 이후 자동 저장)…';
    osrmTable(pts).then(function (dists) {
      var m = dists.map(function (row, i) {
        return row.map(function (v, j) {
          return Number.isFinite(v) ? v / 1000 : distKm(pts[i], pts[j]) * ROAD;
        });
      });
      ROAD_MATRIX = m;
      ROAD_MATRIX_SIG = sig;
      try { localStorage.setItem(MATRIX_KEY, JSON.stringify({ sig: sig, m: m })); } catch (e) { /* 무시 */ }
      clearTimeout(statusTimer);
      statusEl.textContent = '실제 도로 거리 반영 완료 — 노선 재계산';
      statusTimer = setTimeout(function () { statusEl.hidden = true; }, 3000);
      done();
    }).catch(function () {
      ROAD_MATRIX = null;
      ROAD_FAILED = true;
      statusText('도로 거리 서버 접속 실패 — 직선거리 × ' + ROAD + ' 추정치로 계산합니다');
      done();
    });
  }

  // 선택 노선의 실제 도로 경로 기하(geojson 좌표) 요청 — 실패 시 null
  function routeGeoSig(r) {
    return r.stops.concat([DEPOT]).map(function (o) {
      var p = pointOf(o);
      return p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
    }).join('>');
  }
  function fetchRouteGeometry(r, cb) {
    if (!USE_ROAD) { cb(null); return; }
    var sig = routeGeoSig(r);
    if (GEO_CACHE[sig]) { cb(GEO_CACHE[sig]); return; }
    var path = r.stops.concat([DEPOT]).map(osrmCoordStr).join(';');
    getJson(OSRM_API + '/route/v1/driving/' + path + '?overview=full&geometries=geojson&alternatives=false&steps=false', 15000)
      .then(function (res) {
        var g = res && res.routes && res.routes[0] && res.routes[0].geometry
          ? res.routes[0].geometry.coordinates : null;
        if (g && g.length) { GEO_CACHE[sig] = g; cb(g); } else { cb(null); }
      })
      .catch(function () { cb(null); });
  }

  /* ---------------- 노선 최적화 (Clarke-Wright + 2-opt) ----------------
     노선은 '첫 방문 우체국에서 출발 → … → 물류센터에 도착'하는 개방형 경로.
     최적화는 물류센터를 종점으로 두고 진행합니다. */
  // 개방형 경로 길이: 첫 우체국 → … → 마지막 우체국 → 물류센터
  function openRouteLen(order, d0, d) {
    var t = 0, k;
    for (k = 1; k < order.length; k++) t += d(order[k - 1], order[k]);
    return t + d0[order[order.length - 1]];
  }

  function twoOpt(order, d0, d) {
    var best = order.slice(), improved = true, i, k, x, tmp, cand;
    while (improved) {
      improved = false;
      for (i = 0; i < best.length - 1; i++) {
        for (k = i + 1; k < best.length; k++) {
          cand = best.slice();
          for (x = 0; x < Math.floor((k - i + 1) / 2); x++) {
            tmp = cand[i + x]; cand[i + x] = cand[k - x]; cand[k - x] = tmp;
          }
          if (openRouteLen(cand, d0, d) < openRouteLen(best, d0, d) - 1e-9) {
            best = cand;
            improved = true;
          }
        }
      }
    }
    return best;
  }

  function buildRoutes() {
    var n = OFFICES.length, i, j, k;
    if (!n) return [];

    // 실제 도로 거리 행렬(OSRM)이 현재 좌표와 일치하면 사용, 아니면 직선거리 × 보정 계수
    var pts = [pointOf(DEPOT)].concat(OFFICES.map(pointOf));
    var useRoad = USE_ROAD && ROAD_MATRIX && ROAD_MATRIX.length === pts.length && ROAD_MATRIX_SIG === matrixSig();
    var roadDist = function (a, b) {
      if (useRoad) {
        var v = ROAD_MATRIX[a] && ROAD_MATRIX[a][b];
        if (Number.isFinite(v)) return v;
      }
      return distKm(pts[a], pts[b]) * ROAD;
    };
    var d0 = OFFICES.map(function (_, kk) { return roadDist(0, kk + 1); });
    var d = function (a, b) { return roadDist(a + 1, b + 1); };

    // 1) 절약값(savings) 계산 후 내림차순
    var pairs = [];
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        pairs.push({ i: i, j: j, s: d0[i] + d0[j] - d(i, j) });
      }
    }
    pairs.sort(function (a, b) { return b.s - a.s; });

    // 2) 각 우체국을 단독 노선으로 시작
    var routes = OFFICES.map(function (_, kk) { return { stops: [kk], km: 2 * d0[kk] }; });
    var which = OFFICES.map(function (_, kk) { return kk; });

    // 3) 절약값이 큰 순서대로 제약을 지키는 범위에서 노선 병합
    pairs.forEach(function (p) {
      var ri = which[p.i], rj = which[p.j];
      if (ri === rj) return;
      var A = routes[ri], B = routes[rj];
      var tailI = A.stops[A.stops.length - 1] === p.i;
      var headJ = B.stops[0] === p.j;
      var tailJ = B.stops[B.stops.length - 1] === p.j;
      var headI = A.stops[0] === p.i;
      if (!((tailI && headJ) || (tailJ && headI))) return; // 경로 끝끼리만 연결

      var newStops = tailI ? A.stops.concat(B.stops) : B.stops.concat(A.stops);
      if (newStops.length > MAX_STOPS) return;

      var km = d0[newStops[0]];
      for (k = 1; k < newStops.length; k++) km += d(newStops[k - 1], newStops[k]);
      km += d0[newStops[newStops.length - 1]];
      if (km > MAX_KM) return; // km 는 이미 실제 도로 거리(km)

      var keep = tailI ? A : B, drop = tailI ? B : A;
      var keepIdx = keep === A ? ri : rj;
      var dropCust = drop.stops.slice();
      keep.stops = newStops;
      keep.km = km;
      drop.stops = [];
      dropCust.forEach(function (c) { which[c] = keepIdx; });
    });

    // 4) 2-opt 로 각 노선의 경유 순서를 더 짧게 (물류센터 종점 기준)
    var live = routes.filter(function (r) { return r.stops.length > 0; });
    live.forEach(function (r) {
      r.stops = twoOpt(r.stops, d0, d);
      r.km = openRouteLen(r.stops, d0, d); // 첫 우체국 출발 → 물류센터 도착
    });

    // 5) 첫 방문 우체국 이름순 정렬 → 번호/색상 부여
    live.sort(function (a, b) {
      return a.stops[0] === b.stops[0] ? 0 : (a.stops[0] < b.stops[0] ? -1 : 1);
    });

    return live.map(function (r, idx) {
      var hue = (idx * 137.508) % 360; // 황금각: 인접 노선 hue 가 겹치지 않음
      var stopObjs = r.stops.map(function (c) { return OFFICES[c]; });
      return {
        id: idx,
        hue: hue,
        name: routeName(stopObjs, idx),
        stops: stopObjs,
        km: r.km, // 이미 실제 도로 거리(또는 폴백 추정치)
        lineColor: hueLine(hue),
        borderColor: hueBorder(hue),
        bgColor: hueBg(hue),
        glowColor: hueGlow(hue)
      };
    });
  }

  /* ---------------- DOM ---------------- */
  var listEl = $('route-list'), countEl = $('route-count'), legendEl = $('legend');
  var nowEl = $('now-route'), mapEl = $('map');
  var emptyEl = $('map-empty'), statusEl = $('map-status'), badgeEl = $('map-badge');

  var routes = [], selectedId = null;

  /* ---------------- 좌측: 노선 목록 렌더링 ---------------- */
  function renderList() {
    listEl.innerHTML = '';
    var legendHtml = '';
    routes.forEach(function (r) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'route-card';
      card.dataset.id = r.id;
      card.style.setProperty('--rc', r.borderColor);
      card.style.setProperty('--rc-soft', r.bgColor);
      card.style.setProperty('--rc-glow', r.glowColor);
      card.innerHTML =
        '<span class="route-bar"></span>' +
        '<span class="route-info">' +
        '<span class="route-name">' + esc(r.name) + '</span>' +
        '<span class="route-meta">출발 ' + esc(shortName(r.stops[0].name)) + ' · 물류센터 도착</span>' +
        '</span>' +
        '<span class="route-count">' + r.stops.length + '곳</span>' +
        '<span class="route-km">' + fmtKm(r.km) + '<small>km</small></span>';
      card.addEventListener('click', function () { selectRoute(r.id); });
      listEl.appendChild(card);

      legendHtml += '<span class="lg" style="--sw:' + r.borderColor + '"><i class="swatch"></i>' + esc(r.name) + '</span>';
    });
    legendEl.innerHTML = legendHtml;

    countEl.textContent = routes.length + '개';
  }

  /* ---------------- 노선 선택 (테두리 강조 + 지도 갱신) ---------------- */
  function selectRoute(id) {
    selectedId = id;
    Array.prototype.forEach.call(listEl.children, function (c) {
      c.classList.toggle('selected', Number(c.dataset.id) === id);
    });
    var r = routes[id];
    if (!r) return;

    nowEl.style.setProperty('--rc', r.borderColor);
    nowEl.innerHTML =
      '<span class="nr-name" style="color:' + r.borderColor + '">' + esc(r.name) + '</span>' +
      '<span class="nr-km">' + fmtKm(r.km) + ' km · ' + r.stops.length + '곳</span>' +
      '<div class="nr-stops">' +
      r.stops.map(function (o, k) {
        return '<button type="button" class="nr-stop" data-stop="' + k + '" title="' + esc(o.name) + ' — 클릭 시 지도 중앙 이동">' +
          (k + 1) + '. ' + esc(shortName(o.name)) + '</button>';
      }).join('') +
      '<button type="button" class="nr-stop depot" data-stop="depot" title="중부권광역우편물류센터 — 도착지">🏢 물류센터 도착</button>' +
      '</div>';

    drawRoute(r);
  }

  /* ---------------- 노선당 방문 수 컨트롤 (최적 노선 수 탐색) ---------------- */
  var stopsSegEl = $('stops-seg');

  function reoptimize() {
    routes = buildRoutes();
    renderList();
    if (selectedId == null || selectedId >= routes.length) selectedId = 0;
    selectRoute(selectedId);
  }

  function buildStopsSeg() {
    if (!stopsSegEl) return;
    [5, 8, 10, 12].forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (n === MAX_STOPS ? ' active' : '');
      b.dataset.n = n;
      b.textContent = n + '곳';
      b.title = '노선당 최대 방문 우체국 수 ' + n + '곳';
      b.addEventListener('click', function () {
        if (Number(b.dataset.n) === MAX_STOPS) return;
        MAX_STOPS = Number(b.dataset.n);
        Array.prototype.forEach.call(stopsSegEl.children, function (x) {
          x.classList.toggle('active', x === b);
        });
        reoptimize();
      });
      stopsSegEl.appendChild(b);
    });
  }

  /* ============================================================
     지도 프로바이더 추상화
     - 'kakao'  : 카카오 지도 (appkey 필요)
     - 'naver'  : 네이버 지도 (Client ID 필요)
     - 'leaflet': 무료 지도 (키 불필요, OSM/CARTO 타일)
     mapProvider 가 'auto' 이면 카카오 → 네이버 → 무료 순으로 자동 선택
     ============================================================ */
  function effectiveClientId() {
    try { return localStorage.getItem(LS_KEY) || NAVER_CFG.clientId || ''; }
    catch (e) { return NAVER_CFG.clientId || ''; }
  }

  function pickProvider() {
    // ── Leaflet 지도 고정: 카카오/네이버 선택 로직 비활성화 ──
    return 'leaflet';
    /* 원래 로직 (비활성화)
    if (PROVIDER === 'kakao') return 'kakao';
    if (PROVIDER === 'naver') return 'naver';
    if (PROVIDER === 'leaflet') return 'leaflet';
    if (KAKAO_APPKEY) return 'kakao';
    return effectiveClientId() ? 'naver' : 'leaflet';
    */
  }

  // 무료 지도(Leaflet) CSS/JS 로드 — 키 필요 없음 (CSS → JS 순서 보장)
  function loadLeaflet(cb) {
    if (window.L) { cb(); return; }
    var loadJs = function () {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      s.onload = cb;
      s.onerror = function () {
        statusText('무료 지도(Leaflet) 로드 실패 — 인터넷 연결을 확인해주세요');
      };
      document.head.appendChild(s);
    };
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    css.onload = loadJs;
    css.onerror = loadJs; // CSS 실패해도 JS로 계속 진행
    document.head.appendChild(css);
  }

  function showNoKey(msg) {
    statusEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.innerHTML =
      '<div class="empty-card">' +
      '<div class="ec-icon">🗺️</div>' +
      '<h3>네이버 지도 키가 필요합니다</h3>' +
      '<p>' + esc(msg || '네이버 지도(naver.maps)를 표시하려면 네이버 클라우드 플랫폼에서 발급받은 <b>Client ID</b>가 필요합니다.<br/>' +
      '(키 없이 무료 지도를 쓰려면 데이터 파일의 <b>mapProvider</b>를 <b>"leaflet"</b>으로 바꾸세요.)') + '</p>' +
      '<ol>' +
      '<li>네이버 클라우드 플랫폼(<b>console.ncloud.com</b>) 가입 → 콘솔</li>' +
      '<li><b>AI·Application Service → Maps</b> 서비스 신청 (무료)</li>' +
      '<li>애플리케이션 등록 후 <b>Client ID</b> 복사</li>' +
      '<li>아래에 붙여넣고 저장하면 바로 지도가 표시됩니다</li>' +
      '</ol>' +
      '<div class="ec-form">' +
      '<input id="key-input" class="input" type="text" placeholder="Client ID (예: abcdefghij1234567890)" />' +
      '<button id="key-save" class="btn primary" type="button">저장하고 다시 로드</button>' +
      '</div>' +
      '<p class="ec-note">※ 이 브라우저에만 저장됩니다. 파일(js/node-navigation-data.js)에 입력해도 됩니다.</p>' +
      '</div>';
    $('key-input').value = effectiveClientId();
    $('key-save').addEventListener('click', function () {
      var v = $('key-input').value.trim();
      if (!v) return;
      try { localStorage.setItem(LS_KEY, v); } catch (e) { /* 무시 */ }
      location.reload();
    });
  }

  var statusTimer = null;
  function statusText(t) {
    statusEl.hidden = false;
    statusEl.textContent = t;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.hidden = true; }, 2600);
  }

  var mapApi = {
    name: pickProvider(),
    map: null,
    overlays: [],
    lineOverlays: [],
    infoWin: null,

    // 좌표 객체 → 해당 지도 API 포맷
    latLng: function (o) {
      var p = pointOf(o);
      if (this.name === 'naver') return new naver.maps.LatLng(p.lat, p.lng);
      // if (this.name === 'kakao') return new kakao.maps.LatLng(p.lat, p.lng); // ← 카카오 비활성화
      return [p.lat, p.lng];
    },

    load: function (cb) {
      var self = this;
      if (self.name === 'leaflet') { loadLeaflet(cb); return; }
      // ── 카카오 지도 SDK 로드 비활성화 (Leaflet 사용) ──
      /* if (self.name === 'kakao') {
        if (window.kakao && window.kakao.maps) { cb(); return; }
        if (!KAKAO_APPKEY) {
          statusText('카카오 지도 appkey가 설정되지 않았습니다 — js/node-navigation-data.js 의 kakao.appkey 를 확인해주세요.');
          return;
        }
        var ksrc = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(KAKAO_APPKEY) + '&autoload=false';
        var ks = document.createElement('script');
        ks.async = true;
        ks.src = ksrc;
        ks.onload = function () {
          if (window.kakao && window.kakao.maps) { kakao.maps.load(cb); return; }
          statusText('카카오 지도 스크립트 로드 실패 — appkey와 허용 도메인 설정을 확인해주세요.');
        };
        ks.onerror = function () {
          statusText('카카오 지도 스크립트를 불러오지 못했습니다 — appkey를 확인해주세요.');
        };
        document.head.appendChild(ks);
        return;
      } */
      if (window.naver && window.naver.maps) { cb(); return; }
      var cid = effectiveClientId();
      if (!cid) { showNoKey(); return; }
      var src = 'https://openapi.map.naver.com/openapi/v3/maps.js?ncpClientId=' + encodeURIComponent(cid);
      if (NAVER_CFG.subKey) src += '&subKey=' + encodeURIComponent(NAVER_CFG.subKey);
      var s = document.createElement('script');
      s.async = true;
      s.src = src;
      s.onload = cb;
      s.onerror = function () {
        showNoKey('네이버 지도 스크립트를 불러오지 못했습니다. Client ID가 정확한지 확인해주세요.');
      };
      document.head.appendChild(s);
    },

    init: function () {
      var self = this;
      if (self.name === 'leaflet') {
        self.map = L.map(mapEl, { zoomControl: true, minZoom: 7 })
          .setView([DEPOT.lat, DEPOT.lng], 11);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 19
        }).addTo(self.map);
        self.map.on('click', function () {
          if (self.infoWin) { self.map.closePopup(); self.infoWin = null; }
        });
        setTimeout(function () { self.map.invalidateSize(); }, 120);
        statusText('무료 지도(Leaflet + OSM/CARTO) 로드 완료');
      }
      /* ── 카카오 지도 비활성화 (Leaflet 사용) ──
      else if (self.name === 'kakao') {
        self.map = new kakao.maps.Map(mapEl, {
          center: new kakao.maps.LatLng(DEPOT.lat, DEPOT.lng),
          level: 9,
          minLevel: 1,
          maxLevel: 14
        });
        kakao.maps.event.addListener(self.map, 'click', function () {
          if (self.infoWin) { self.infoWin.close(); self.infoWin = null; }
        });
        statusText('카카오 지도 로드 완료');
      }
      */
      else {
        self.map = new naver.maps.Map(mapEl, {
          center: new naver.maps.LatLng(DEPOT.lat, DEPOT.lng),
          zoom: 11,
          minZoom: 7,
          maxZoom: 18
        });
        naver.maps.Event.addListener(self.map, 'click', function () {
          if (self.infoWin) { self.infoWin.close(); self.infoWin = null; }
        });
        statusText('네이버 지도 로드 완료');
      }
      if (selectedId != null) drawRoute(routes[selectedId]);
    },

    clear: function () {
      var self = this, i;
      for (i = 0; i < self.overlays.length; i++) {
        if (self.name === 'leaflet') self.overlays[i].remove();
        else self.overlays[i].setMap(null);
      }
      self.overlays = [];
      self.clearLines();
      if (self.infoWin) {
        if (self.name === 'leaflet') self.map.closePopup();
        else self.infoWin.close();
        self.infoWin = null;
      }
    },

    addPolyline: function (path, color) {
      var self = this;
      var line;
      if (self.name === 'naver') {
        line = new naver.maps.Polyline({
          map: self.map,
          path: path,
          strokeColor: color,
          strokeWeight: 6,
          strokeOpacity: 0.95
        });
      }
      /* ── 카카오 지도 비활성화 (Leaflet 사용) ──
      else if (self.name === 'kakao') {
        line = new kakao.maps.Polyline({
          map: self.map,
          path: path,
          strokeWeight: 6,
          strokeColor: color,
          strokeOpacity: 0.95
        });
      }
      */
      else {
        line = L.polyline(path, {
          color: color,
          weight: 6,
          opacity: 0.95
        }).addTo(self.map);
      }
      self.lineOverlays.push(line);
    },

    clearLines: function () {
      var self = this, i;
      for (i = 0; i < self.lineOverlays.length; i++) {
        if (self.name === 'leaflet') self.lineOverlays[i].remove();
        else self.lineOverlays[i].setMap(null);
      }
      self.lineOverlays = [];
    },

    addMarker: function (o, opts) {
      var self = this;
      var size = opts.size || 26;
      // 마커 DOM 요소를 직접 만들어 두 API 모두에 전달 → 이후 스타일/라벨 제어 가능
      var el = document.createElement('div');
      el.className = 'nmarker' + (opts.depot ? ' depot' : '');
      if (opts.depot) {
        el.textContent = '🏢';
      } else {
        el.textContent = opts.label || '';
        el.style.background = opts.color || '#8a4bff';
      }
      if (opts.name) el.dataset.name = opts.name;
      if (opts.title) el.title = opts.title;

      var m;
      if (self.name === 'naver') {
        m = new naver.maps.Marker({
          map: self.map,
          position: self.latLng(o),
          zIndex: opts.zIndex || 0,
          title: opts.title || '',
          icon: {
            content: el,
            size: new naver.maps.Size(size, size),
            anchor: new naver.maps.Point(size / 2, size / 2)
          }
        });
        if (opts.onClick) {
          naver.maps.Event.addListener(m, 'click', function () { opts.onClick(m); });
        }
      }
      /* ── 카카오 지도 비활성화 (Leaflet 사용) ──
      else if (self.name === 'kakao') {
        // 커스텀 오버레이: 콘텐츠 DOM 요소를 직접 사용 (기본 xAnchor/yAnchor 0.5 → 좌표에 중앙 정렬)
        m = new kakao.maps.CustomOverlay({
          map: self.map,
          position: self.latLng(o),
          content: el,
          zIndex: opts.zIndex || 0,
          clickable: !!opts.onClick
        });
        if (opts.onClick) {
          el.addEventListener('click', function () { opts.onClick(m); });
        }
      }
      */
      else {
        m = L.marker(self.latLng(o), {
          icon: L.divIcon({
            className: '',
            html: el,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
          }),
          title: opts.title || '',
          zIndexOffset: opts.zIndex || 0
        }).addTo(self.map);
        if (opts.onClick) m.on('click', function () { opts.onClick(m); });
      }
      self.overlays.push(m);
      return { marker: m, el: el, office: o }; // 마커 + DOM 요소 + 대상 좌표
    },

    showInfo: function (marker, html) {
      var self = this;
      if (self.name === 'naver') {
        if (self.infoWin) self.infoWin.close(); // 이전 팝업이 쌓이지 않도록 먼저 닫기
        self.infoWin = new naver.maps.InfoWindow({
          borderWidth: 0,
          disableAnchor: true,
          backgroundColor: 'transparent',
          content: html
        });
        self.infoWin.open(self.map, marker);
      }
      /* ── 카카오 지도 비활성화 (Leaflet 사용) ──
      else if (self.name === 'kakao') {
        if (self.infoWin) self.infoWin.close();
        self.infoWin = new kakao.maps.InfoWindow({ content: html, zIndex: 210 });
        var pos = typeof marker.getPosition === 'function' ? marker.getPosition() : self.latLng(marker.office || marker);
        self.infoWin.open(self.map, pos);
      }
      */
      else {
        self.map.closePopup();
        self.infoWin = L.popup({ closeButton: false })
          .setLatLng(marker.getLatLng())
          .setContent(html)
          .openOn(self.map);
      }
    },

    fit: function (points) {
      var self = this;
      if (self.name === 'naver') {
        var b = new naver.maps.LatLngBounds();
        points.forEach(function (p) { b.extend(p); });
        self.map.fitBounds(b, 90, 90, 90, 90);
      }
      /* ── 카카오 지도 비활성화 (Leaflet 사용) ──
      else if (self.name === 'kakao') {
        var kb = new kakao.maps.LatLngBounds();
        points.forEach(function (p) { kb.extend(p); });
        self.map.setBounds(kb, 90, 90, 90, 90);
      }
      */
      else {
        self.map.fitBounds(points, { padding: [50, 50] });
      }
    },

    // 지도 정중앙으로 이동 (줌/상태 유지)
    panTo: function (latlng) {
      var self = this;
      if (!self.map) return;
      if (self.name === 'naver') self.map.panTo(latlng);
      else self.map.panTo(latlng);
    }
  };

  /* ---------------- 우측: 선택 노선 경로 그리기 ----------------
     경로는 '첫 방문 우체국 → … → 물류센터' 순서로 표시합니다. */
  var depotMarker = null, stopMarkers = [], focusedStop = null;

  function stopInfoHtml(o, k, r) {
    return '<div class="ninfow"><b>' + esc(o.name) + '</b>' +
      '<span>' + esc(o.addr) + '</span>' +
      '<em>방문 순서 ' + (k + 1) + ' / ' + r.stops.length + ' · ' + esc(r.name) + '</em></div>';
  }

  function drawRoute(r) {
    if (!mapApi.map) return;
    mapApi.clear();
    depotMarker = null;
    stopMarkers = [];
    focusedStop = null;

    // 경로: 첫 우체국 → … → 마지막 우체국 → 물류센터
    var path = r.stops.map(function (o) { return mapApi.latLng(o); });
    path.push(mapApi.latLng(DEPOT));

    mapApi.addPolyline(path, r.lineColor);

    // 물류센터 마커 (도착지 — 경로 끝)
    depotMarker = mapApi.addMarker(DEPOT, {
      depot: true,
      size: 36,
      zIndex: 100,
      name: DEPOT.name,
      title: esc(DEPOT.name)
    });

    // 방문 우체국 마커 (방문 순서 번호)
    r.stops.forEach(function (o, k) {
      var sm = mapApi.addMarker(o, {
        label: String(k + 1),
        color: r.borderColor,
        size: 26,
        zIndex: 50,
        name: o.name,
        title: esc(o.name),
        onClick: function (marker) {
          mapApi.showInfo(marker, stopInfoHtml(o, k, r));
        }
      });
      stopMarkers.push(sm);
    });

    // 선택 노선이 화면에 맞게 확대/이동
    mapApi.fit(path);

    // 실제 도로 경로(OSRM)를 구할 수 있으면 직선 대신 도로 폴리라인 표시
    if (USE_ROAD && !ROAD_FAILED) {
      statusText('실제 도로 경로 표시 중…');
      var geoKey = routeGeoSig(r); // 재최적화로 id가 재사용돼도 경유지가 같을 때만 적용
      fetchRouteGeometry(r, function (geo) {
        var cur = routes[selectedId];
        if (!geo || !cur || routeGeoSig(cur) !== geoKey) return;
        var pts = geo.map(function (c) {
          if (mapApi.name === 'naver') return new naver.maps.LatLng(c[1], c[0]);
          // if (mapApi.name === 'kakao') return new kakao.maps.LatLng(c[1], c[0]); // ← 카카오 비활성화
          return [c[1], c[0]];
        });
        mapApi.clearLines();
        mapApi.addPolyline(pts, r.lineColor);
        statusText('실제 도로 경로 표시 완료');
      });
    }
  }

  /* ---------------- 경유지 포커스 (지도 중앙 이동 + 마커 확대/이름) ---------------- */
  function updateStopFocusUI() {
    // 마커 강조 (숫자 확대 + 이름 라벨)
    if (depotMarker) depotMarker.el.classList.toggle('focus', focusedStop === 'depot');
    stopMarkers.forEach(function (sm, k) {
      if (sm) sm.el.classList.toggle('focus', focusedStop === k);
    });
    // 하단 경유 목록 칩 강조
    Array.prototype.forEach.call(nowEl.querySelectorAll('.nr-stop'), function (ch) {
      ch.classList.toggle('focus', ch.dataset.stop === String(focusedStop));
    });
  }

  // 경유지/물류센터 선택 → 현재 상태 유지하며 지도 정중앙 이동 + 마커 강조
  function focusStop(k) {
    var idx = k === 'depot' ? 'depot' : Number(k); // 문자열 → 숫자 통일 (=== 비교용)
    var sm = idx === 'depot' ? depotMarker : stopMarkers[idx];
    if (!sm || !mapApi.map) return;
    focusedStop = idx;
    updateStopFocusUI();
    mapApi.panTo(mapApi.latLng(sm.office));
  }

  /* ---------------- (선택) 주소 → 좌표 자동 보정 (네이버 전용) ---------------- */
  function refineCoordinates(done) {
    if (mapApi.name !== 'naver' || !NAVER_CFG.subKey || !naver.maps.Service || !OFFICES.length) { done(); return; }
    statusEl.hidden = false;
    statusEl.textContent = '주소 → 좌표 보정 중 (0/' + OFFICES.length + ')…';

    var cache = {};
    try { cache = JSON.parse(localStorage.getItem('nav_geocode') || '{}'); } catch (e) { /* 무시 */ }
    var pending = OFFICES.length, doneCount = 0, failCount = 0, finished = false;

    // 안전장치: geocode 응답이 없어도 15초 안에는 무조건 완료 처리
    var watchdog = setTimeout(function () {
      if (!finished) { pending = 1; finish(); }
    }, 15000);

    var finish = function () {
      if (finished) return;
      if (--pending > 0) return;
      finished = true;
      clearTimeout(watchdog);
      statusEl.textContent = '좌표 보정 완료 (' + doneCount + '곳' + (failCount ? ', 실패 ' + failCount + '곳' : '') + ')';
      setTimeout(function () { statusEl.hidden = true; }, 3000);
      done();
    };
    var tick = function () {
      statusEl.textContent = '주소 → 좌표 보정 중 (' + (doneCount + failCount) + '/' + OFFICES.length + ')…';
    };

    OFFICES.forEach(function (o) {
      var key = o.addr;
      if (cache[key]) {
        o.lat = cache[key].lat; o.lng = cache[key].lng;
        doneCount++; tick(); finish();
        return;
      }
      naver.maps.Service.geocode({ query: key }, function (status, res) {
        try {
          var a = res && res.v2 && res.v2.addresses && res.v2.addresses[0];
          if (status === naver.maps.Service.Status.OK && a) {
            o.lat = parseFloat(a.y); o.lng = parseFloat(a.x);
            cache[key] = { lat: o.lat, lng: o.lng };
            doneCount++;
          } else { failCount++; }
        } catch (e) { failCount++; }
        try { localStorage.setItem('nav_geocode', JSON.stringify(cache)); } catch (e) { /* 무시 */ }
        tick(); finish();
      });
    });
  }

  /* ---------------- 무료 좌표 자동 변환 (Nominatim, 키 불필요) ----------------
     좌표(lat/lng)가 없는 우체국을 도로명 주소로 조회합니다.
     1초당 1건 제한을 지키며 순차 처리 → 결과는 브라우저에 캐시되어
     다음 방문부터는 즉시 로드됩니다. 실패 시 구 단위 근사 좌표 유지. */
  // 이전에 변환해 둔 좌표를 데이터에 적용 (재방문 시 첫 렌더링부터 정확)
  function applyGeocodeCache() {
    var cache = {};
    try { cache = JSON.parse(localStorage.getItem('nav_geo_nom') || '{}'); } catch (e) { return; }
    OFFICES.forEach(function (o) {
      var c = cache[o.addr];
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        o.lat = c.lat; o.lng = c.lng;
      }
    });
  }

  function resolveCoordinates(done) {
    if (!CFG.geocode) { done(0, 0); return; }
    var need = OFFICES.filter(function (o) { return !Number.isFinite(o.lat) || !Number.isFinite(o.lng); });
    if (!need.length) { done(0, 0); return; }

    var cache = {};
    try { cache = JSON.parse(localStorage.getItem('nav_geo_nom') || '{}'); } catch (e) { /* 무시 */ }
    applyGeocodeCache();
    var queue = need.filter(function (o) {
      return !(cache[o.addr] && Number.isFinite(cache[o.addr].lat) && Number.isFinite(cache[o.addr].lng));
    });
    if (!queue.length) { done(0, 0); return; }

    statusEl.hidden = false;
    statusEl.textContent = '무료 좌표 변환 중 (0/' + queue.length + ')…';
    var i = 0, okCount = 0, failCount = 0;

    function next() {
      if (i >= queue.length) {
        statusEl.textContent = '좌표 변환 완료 (' + okCount + '곳' + (failCount ? ', 실패 ' + failCount + '곳' : '') + ') — 노선 재계산';
        setTimeout(function () { statusEl.hidden = true; }, 3200);
        try { localStorage.setItem('nav_geo_nom', JSON.stringify(cache)); } catch (e) { /* 무시 */ }
        done(okCount, failCount);
        return;
      }
      var o = queue[i++];
      var q = o.addr.replace(/\s*\([^)]*\)\s*$/, '').trim();
      // 응답이 없어도 큐가 멈추지 않도록 8초 타임아웃
      var ctrl = new AbortController();
      var tmr = setTimeout(function () { ctrl.abort(); }, 8000);
      fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q), {
        headers: { 'Accept-Language': 'ko' },
        signal: ctrl.signal
      })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (arr) {
          clearTimeout(tmr);
          if (arr && arr.length) {
            o.lat = parseFloat(arr[0].lat);
            o.lng = parseFloat(arr[0].lon);
            cache[o.addr] = { lat: o.lat, lng: o.lng };
            // 성공할 때마다 저장 — 중간에 닫아도 진행이 보존됨
            try { localStorage.setItem('nav_geo_nom', JSON.stringify(cache)); } catch (e) { /* 무시 */ }
            okCount++;
          } else { failCount++; }
          statusEl.textContent = '무료 좌표 변환 중 (' + (okCount + failCount) + '/' + queue.length + ')…';
          setTimeout(next, 1100);
        })
        .catch(function () {
          clearTimeout(tmr);
          failCount++;
          statusEl.textContent = '무료 좌표 변환 중 (' + (okCount + failCount) + '/' + queue.length + ')…';
          setTimeout(next, 1100);
        });
    }
    next();
  }

  /* ---------------- 비용산정기준 오버레이 (standard.html iframe) ---------------- */
  var overlayEl = $('standard-overlay'), costBtn = $('cost-standard-btn');
  var stdFrame = $('standard-frame');

  function openStandard() {
    overlayEl.hidden = false;
    document.body.style.overflow = 'hidden';
    // 첫 열림: src 를 지정해 로드 / 이후 열림: 새로고침해 DB 최신 데이터 반영
    if (!stdFrame.getAttribute('src')) {
      stdFrame.src = stdFrame.getAttribute('data-src') || 'standard.html';
    } else {
      stdFrame.src = stdFrame.src;
    }
  }
  function closeStandard() {
    overlayEl.hidden = true;
    document.body.style.overflow = '';
  }
  // 열림 상태에서는 오버레이가 화면을 덮어 뒤의 노선 화면은 조작할 수 없음.
  // 닫기는 standard.html 의 "닫기" 버튼이 부모로 postMessage 를 보내 처리.
  // ※ 출처(origin) 검증은 하지 않음: file:// 이나 일부 브라우저에서
  //    origin 값이 제각각이라 닫기 메시지가 무시될 수 있기 때문. (닫기뿐이라 보안 영향 없음)
  function bindStandardModal() {
    if (!overlayEl || !costBtn) return;
    costBtn.addEventListener('click', openStandard);
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'close-cost-standard') closeStandard();
    });
    // 편의: 열려 있는 동안 Esc 키로도 닫기 (둘 중 열린 쪽을 닫음)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (loadedOverlayEl && !loadedOverlayEl.hidden) closeLoaded();
      else if (!overlayEl.hidden) closeStandard();
    });
  }

  /* ---------------- 기존물량등록 오버레이 (loaded.html iframe) ---------------- */
  var loadedOverlayEl = $('loaded-overlay'), loadedBtn = $('loaded-btn');
  var loadedFrame = $('loaded-frame');

  function openLoaded() {
    loadedOverlayEl.hidden = false;
    document.body.style.overflow = 'hidden';
    // 첫 열림: src 지정 / 이후 열림: 새로고침해 DB 최신 데이터 반영
    if (!loadedFrame.getAttribute('src')) {
      loadedFrame.src = loadedFrame.getAttribute('data-src') || 'loaded.html';
    } else {
      loadedFrame.src = loadedFrame.src;
    }
  }
  function closeLoaded() {
    loadedOverlayEl.hidden = true;
    document.body.style.overflow = '';
  }
  function bindLoadedModal() {
    if (!loadedOverlayEl || !loadedBtn) return;
    loadedBtn.addEventListener('click', openLoaded);
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'close-loaded') closeLoaded();
    });
  }

  /* ---------------- 초기화 ---------------- */
  function init() {
    // 지도 배지 (있는 경우에만 표시)
    if (badgeEl) {
      var badgeMap = {
        // kakao: { text: '지도 : 카카오 지도', title: '카카오 지도 JavaScript API' }, // ← 카카오 비활성화
        naver: { text: '지도 : 네이버 지도', title: '네이버 지도 JavaScript API v3' }
      };
      var bd = badgeMap[mapApi.name] || { text: '지도 : 무료 (키 불필요)', title: '무료 지도 (Leaflet + OpenStreetMap/CARTO 타일) — 키 없이 사용 가능' };
      badgeEl.textContent = bd.text;
      badgeEl.title = bd.title;
    }

    if (!OFFICES.length) {
      listEl.innerHTML = '<div class="empty-note">우체국 데이터가 없습니다.<br/>js/node-navigation-data.js 를 확인해주세요.</div>';
      return;
    }

    // 하단 경유 목록 칩 클릭 → 해당 위치로 지도 중앙 이동 + 마커 강조
    nowEl.addEventListener('click', function (e) {
      var ch = e.target && e.target.closest ? e.target.closest('.nr-stop') : null;
      if (!ch) return;
      focusStop(ch.dataset.stop);
    });

    applyGeocodeCache(); // 이전에 변환한 좌표를 첫 렌더링부터 사용
    buildStopsSeg();
    bindStandardModal();
    bindLoadedModal();
    reoptimize(); // 첫 노선 자동 선택 → 지도에도 첫 노선 경로 (근사 좌표 기준)

    mapApi.load(function () {
      mapApi.init();
      // 좌표 확정 → 도로 거리 행렬 계산(캐시 사용) → 노선 재계산
      var finish = function () {
        computeRoadMatrix(function () { reoptimize(); });
      };
      if (mapApi.name === 'naver' && NAVER_CFG.subKey && CFG.geocode) {
        refineCoordinates(finish);
      } else {
        resolveCoordinates(finish);
      }
    });
  }

  init();
})();
