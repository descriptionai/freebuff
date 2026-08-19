/* ============================================================
   중부권광역우편물류센터 — 노선별 네비게이션
   ============================================================
   카카오 로컬 API로 우체국·취급국 좌표를 자동 수집하고
   Clarke-Wright + 2-opt 알고리즘으로 최적 노선을 계산하여
   카카오 지도에 표시합니다.

   거리 계산: OSRM 공개 서버 (실제 도로 주행 거리, 키 불필요)
   지도 표시: 카카오 지도 JavaScript API
   좌표 수집: 카카오 로컬 API (REST API 키 필요)
   ============================================================ */
(function () {
  'use strict';

  /* ================================================================
     1. 설정
     ================================================================ */
  var CFG = window.NODE_NAV_CONFIG || {};
  var KAKAO_CFG = CFG.kakao || {};
  var KAKAO_APPKEY = KAKAO_CFG.appkey || '';
  var KAKAO_REST_KEY = KAKAO_CFG.restApiKey || '';
  var DEPOT = CFG.depot || { name: '중부권광역우편물류센터', addr: '대전 동구 안골로 11', lat: 36.2706944, lng: 127.4733805 };
  var MAX_STOPS = CFG.maxStopsPerRoute || 8;
  var MAX_KM = CFG.maxKmPerRoute || 60;
  var ROAD_FACTOR = CFG.roadFactor || 1.3;
  var USE_ROAD = CFG.roadRouting !== false;
  var OSRM_API = CFG.osrmUrl || 'https://router.project-osrm.org';
  var SEARCH_CFG = CFG.search || {};
  var SEARCH_KEYWORDS = SEARCH_CFG.keywords || ['대전 우체국', '대전 우편취급국'];
  var SEARCH_RECT = SEARCH_CFG.rect || '127.25,36.23,127.55,36.48';

  var LS_GEO_KEY = 'nav_geo_kakao_v1';   // 카카오 검색 좌표 캐시
  var LS_MATRIX_KEY = 'nav_road_matrix_v3'; // OSRM 거리 행렬 캐시

  /* ================================================================
     2. 상태
     ================================================================ */
  var OFFICES = [];        // 우체국 목록 (카카오 API에서 수집)
  var routes = [];
  var selectedId = null;
  var ROAD_MATRIX = null;
  var ROAD_DUR_MATRIX = null;  // 소요시간 행렬 (초)
  var ROAD_MATRIX_SIG = '';
  var ROAD_FAILED = false;
  var GEO_CACHE = {};      // 노선 도로 경로 메모리 캐시

  /* ================================================================
     3. 유틸리티
     ================================================================ */
  function $(id) { return document.getElementById(id); }

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

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    var to255 = function (v) { return Math.round(255 * v).toString(16).padStart(2, '0'); };
    return '#' + to255(f(0)) + to255(f(8)) + to255(f(4));
  }

  function hueLine(h) { return hslToHex(h, 72, 46); }
  function hueBorder(h) { return hslToHex(h, 65, 42); }
  function hueBg(h) { return hslToHex(h, 55, 92); }
  function hueGlow(h) {
    var c = hslToHex(h, 72, 46);
    var r = parseInt(c.substr(1, 2), 16), g = parseInt(c.substr(3, 2), 16), b = parseInt(c.substr(5, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',0.32)';
  }

  function fmtKm(km) { return (Math.round(km * 10) / 10).toFixed(1); }
  function fmtTime(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return '';
    minutes = Math.round(minutes);
    if (minutes < 1) return '1분 미만';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h > 0 && m > 0) return h + '시간 ' + m + '분';
    if (h > 0) return h + '시간';
    return m + '분';
  }
  function shortName(n) {
    return String(n).replace(/(우편취급국|우편취급소|우체국|취급국|취급소|출장소)/g, '').trim();
  }
  function routeName(stops, idx) {
    return '중부권' + shortName(stops[0].name) + '수집1-' + (idx + 1);
  }
  function esc(s) {
    return String(s).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pointOf(o) {
    return {
      lat: Number.isFinite(o.lat) ? o.lat : DEPOT.lat,
      lng: Number.isFinite(o.lng) ? o.lng : DEPOT.lng
    };
  }

  /* ================================================================
     4. 카카오 로컬 API — 우체국 검색
     ================================================================ */
  function kakaoFetch(url) {
    return fetch(url, {
      headers: { 'Authorization': 'KakaoAK ' + KAKAO_REST_KEY }
    }).then(function (r) {
      if (!r.ok) throw new Error('카카오 API HTTP ' + r.status);
      return r.json();
    });
  }

  /**
   * 카카오 키워드 검색 — 페이지 단위로 전체 결과 수집
   * @param {string} query  검색어
   * @param {function} onProgress  진행 상태 콜백
   * @returns {Promise<Array>} 검색 결과 문서 배열
   */
  function kakaoSearchAllPages(query, onProgress) {
    var allDocs = [];
    var page = 1;
    var pageSize = SEARCH_CFG.pageSize || 15;

    function searchPage() {
      var url = 'https://dapi.kakao.com/v2/local/search/keyword.json'
        + '?query=' + encodeURIComponent(query)
        + '&rect=' + SEARCH_RECT
        + '&size=' + pageSize
        + '&page=' + page
        + '&sort=accuracy';

      return kakaoFetch(url).then(function (data) {
        var docs = data.documents || [];
        allDocs = allDocs.concat(docs);
        if (onProgress) onProgress(allDocs.length);
        if (data.meta && !data.meta.is_end) {
          page++;
          return new Promise(function (resolve) { setTimeout(resolve, 350); }).then(searchPage);
        }
        return allDocs;
      });
    }
    return searchPage();
  }

  /**
   * 전체 우체국 검색: 키워드별로 검색 → 이름 기준 중복 제거
   */
  function searchPostOfficesFromKakao(callback) {
    if (!KAKAO_REST_KEY) {
      statusText('카카오 REST API 키가 설정되지 않았습니다');
      callback(false);
      return;
    }

    var allResults = [];
    var seenNames = {};
    var kwIdx = 0;

    statusText('카카오 로컬 API로 우체국 검색 중…');

    function nextKeyword() {
      if (kwIdx >= SEARCH_KEYWORDS.length) {
        if (allResults.length > 0) {
          OFFICES = allResults.map(function (doc) {
            return {
              name: doc.place_name,
              addr: doc.road_address_name || doc.address_name,
              lat: parseFloat(doc.y),
              lng: parseFloat(doc.x),
              phone: doc.phone || '',
              kakaoId: doc.id
            };
          });
          // 캐시 저장 (다음 방문 시 즉시 사용)
          try { localStorage.setItem(LS_GEO_KEY, JSON.stringify(OFFICES)); } catch (e) { /* 무시 */ }
          statusText('우체국 ' + OFFICES.length + '곳 검색 완료 ✅');
          callback(true);
        } else {
          statusText('카카오 검색 결과 없음');
          callback(false);
        }
        return;
      }

      var query = SEARCH_KEYWORDS[kwIdx];
      statusText('검색 중: ' + query + '…');

      kakaoSearchAllPages(query, function (count) {
        statusText('검색 중: ' + query + ' — ' + count + '곳');
      }).then(function (docs) {
        docs.forEach(function (doc) {
          // 이름+카카오ID 기준 중복 제거
          var key = doc.id || doc.place_name;
          if (!seenNames[key]) {
            seenNames[key] = true;
            allResults.push(doc);
          }
        });
        kwIdx++;
        setTimeout(nextKeyword, 400);
      }).catch(function (err) {
        statusText('검색 실패: ' + err.message + ' — 다음 키워드로 계속');
        kwIdx++;
        setTimeout(nextKeyword, 400);
      });
    }
    nextKeyword();
  }

  /**
   * 캐시된 검색 결과 로드 (로드 즉시 렌더링 가능)
   */
  function loadCachedOffices() {
    try {
      var cached = JSON.parse(localStorage.getItem(LS_GEO_KEY) || 'null');
      if (Array.isArray(cached) && cached.length > 0) {
        OFFICES = cached;
        return true;
      }
    } catch (e) { /* 무시 */ }
    return false;
  }

  /* ================================================================
     5. OSRM — 실제 도로 주행 거리
     ================================================================ */
  function getJson(url, timeoutMs) {
    var ctrl = new AbortController();
    var tmr = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { clearTimeout(tmr); return d; })
      .catch(function (e) { clearTimeout(tmr); throw e; });
  }

  function osrmCoordStr(o) {
    var p = pointOf(o);
    return p.lng.toFixed(6) + ',' + p.lat.toFixed(6);
  }

  function matrixSig() {
    return [pointOf(DEPOT)].concat(OFFICES.map(pointOf))
      .map(function (p) { return p.lat.toFixed(4) + ',' + p.lng.toFixed(4); }).join('|');
  }

  function osrmTable(points) {
    var n = points.length, all = [];
    for (var i = 0; i < n; i++) all.push(points[i].lng.toFixed(6) + ',' + points[i].lat.toFixed(6));
    var path = all.join(';');
    var base = OSRM_API + '/table/v1/driving/' + path + '?annotations=distance,duration';
    var allIdx = [];
    for (var j = 0; j < n; j++) allIdx.push(j);

    var attempt = function (sources, destinations) {
      return getJson(base + '&sources=' + sources.join(';') + '&destinations=' + destinations.join(';'), 20000)
        .then(function (res) {
          if (!res || res.code !== 'Ok' || !res.distances) throw new Error('osrm table fail');
          return res.distances;
        });
    };

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
          anyOk = true; pos += src.length;
          return new Promise(function (res) { setTimeout(res, 400); }).then(nextChunk);
        }).catch(function () {
          pos += src.length;
          return new Promise(function (res) { setTimeout(res, 400); }).then(nextChunk);
        });
      }
      return nextChunk();
    });
  }

  /** OSRM table — distance + duration 한 번에 가져오기 */
  function osrmTableDistDur(points) {
    var n = points.length, all = [];
    for (var i = 0; i < n; i++) all.push(points[i].lng.toFixed(6) + ',' + points[i].lat.toFixed(6));
    var path = all.join(';');
    var base = OSRM_API + '/table/v1/driving/' + path + '?annotations=distance,duration';
    var allIdx = [];
    for (var j = 0; j < n; j++) allIdx.push(j);

    var attempt = function (sources, destinations) {
      return getJson(base + '&sources=' + sources.join(';') + '&destinations=' + destinations.join(';'), 20000)
        .then(function (res) {
          if (!res || res.code !== 'Ok' || !res.distances || !res.durations) throw new Error('osrm table fail');
          return { distances: res.distances, durations: res.durations };
        });
    };

    return attempt(allIdx, allIdx).catch(function () {
      var dm = [], tm = [], pos = 0, anyOk = false;
      function nextChunk() {
        if (pos >= n) {
          if (!anyOk) throw new Error('osrm table all chunks failed');
          return { distances: dm, durations: tm };
        }
        var src = [];
        for (var k = pos; k < Math.min(pos + 40, n); k++) src.push(k);
        return attempt(src, allIdx).then(function (block) {
          // block.distances는 (src.length × n) 행렬
          for (var r = 0; r < block.distances.length; r++) {
            dm[pos + r] = block.distances[r];
            tm[pos + r] = block.durations[r];
          }
          anyOk = true; pos += src.length;
          return new Promise(function (res) { setTimeout(res, 400); }).then(nextChunk);
        }).catch(function () {
          pos += src.length;
          return new Promise(function (res) { setTimeout(res, 400); }).then(nextChunk);
        });
      }
      return nextChunk();
    });
  }

  function computeRoadMatrix(done) {
    done = done || function () {};
    if (!USE_ROAD || !OFFICES.length) { done(); return; }
    var pts = [pointOf(DEPOT)].concat(OFFICES.map(pointOf));
    var sig = matrixSig();
    var n = pts.length;

    // 캐시 확인
    try {
      var cached = JSON.parse(localStorage.getItem(LS_MATRIX_KEY) || 'null');
      if (cached && cached.sig === sig && Array.isArray(cached.m) && cached.m.length === n) {
        ROAD_MATRIX = cached.m; ROAD_DUR_MATRIX = cached.t || null; ROAD_MATRIX_SIG = sig; done(); return;
      }
    } catch (e) { /* 무시 */ }

    statusText('실제 도로 거리·소요시간 계산 중 (첫 1회만)…');
    osrmTableDistDur(pts).then(function (res) {
      var m = res.distances.map(function (row, i) {
        return row.map(function (v, j) {
          return Number.isFinite(v) ? v / 1000 : distKm(pts[i], pts[j]) * ROAD_FACTOR;
        });
      });
      var tm = res.durations.map(function (row) {
        return row.map(function (v) { return Number.isFinite(v) ? v : 0; });
      });
      ROAD_MATRIX = m; ROAD_DUR_MATRIX = tm; ROAD_MATRIX_SIG = sig;
      try { localStorage.setItem(LS_MATRIX_KEY, JSON.stringify({ sig: sig, m: m, t: tm })); } catch (e) { /* 무시 */ }
      statusText('도로 거리·소요시간 반영 완료 ✅');
      done();
    }).catch(function () {
      ROAD_MATRIX = null; ROAD_DUR_MATRIX = null; ROAD_FAILED = true;
      statusText('도로 거리 서버 접속 실패 — 추정치로 계산');
      done();
    });
  }

  function routeGeoSig(r) {
    return r.stops.concat([DEPOT]).map(function (o) {
      var p = pointOf(o); return p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
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

  /* ================================================================
     6. 노선 최적화 — Clarke-Wright + 2-opt
     ================================================================ */
  function openRouteLen(order, d0, d) {
    var t = 0;
    for (var k = 1; k < order.length; k++) t += d(order[k - 1], order[k]);
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
            best = cand; improved = true;
          }
        }
      }
    }
    return best;
  }

  function buildRoutes() {
    var n = OFFICES.length;
    if (!n) return [];

    var pts = [pointOf(DEPOT)].concat(OFFICES.map(pointOf));
    var useRoad = USE_ROAD && ROAD_MATRIX && ROAD_MATRIX.length === pts.length && ROAD_MATRIX_SIG === matrixSig();
    var roadDist = function (a, b) {
      if (useRoad) {
        var v = ROAD_MATRIX[a] && ROAD_MATRIX[a][b];
        if (Number.isFinite(v)) return v;
      }
      return distKm(pts[a], pts[b]) * ROAD_FACTOR;
    };
    var useDur = useRoad && ROAD_DUR_MATRIX && ROAD_DUR_MATRIX.length === pts.length;
    var roadDur = function (a, b) {
      if (useDur) {
        var v = ROAD_DUR_MATRIX[a] && ROAD_DUR_MATRIX[a][b];
        if (Number.isFinite(v)) return v;
      }
      return distKm(pts[a], pts[b]) * ROAD_FACTOR / 40 * 3600; // 추정: 40km/h 평균속도
    };
    var d0 = OFFICES.map(function (_, kk) { return roadDist(0, kk + 1); });
    var d = function (a, b) { return roadDist(a + 1, b + 1); };
    var t0 = OFFICES.map(function (_, kk) { return roadDur(0, kk + 1); });
    var t = function (a, b) { return roadDur(a + 1, b + 1); };
    function routeTimeMin(stops) {
      if (!stops.length) return 0;
      var sec = t0[stops[0]];
      for (var k = 1; k < stops.length; k++) sec += t(stops[k - 1], stops[k]);
      sec += t0[stops[stops.length - 1]];
      return Math.round(sec / 60);
    }

    // Clarke-Wright 절약값
    var pairs = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        pairs.push({ i: i, j: j, s: d0[i] + d0[j] - d(i, j) });
      }
    }
    pairs.sort(function (a, b) { return b.s - a.s; });

    // 단독 노선으로 시작
    var routesArr = OFFICES.map(function (_, kk) { return { stops: [kk], km: 2 * d0[kk], minutes: Math.round((2 * t0[kk]) / 60) }; });
    var which = OFFICES.map(function (_, kk) { return kk; });

    // 병합
    pairs.forEach(function (p) {
      var ri = which[p.i], rj = which[p.j];
      if (ri === rj) return;
      var A = routesArr[ri], B = routesArr[rj];
      var tailI = A.stops[A.stops.length - 1] === p.i;
      var headJ = B.stops[0] === p.j;
      var tailJ = B.stops[B.stops.length - 1] === p.j;
      var headI = A.stops[0] === p.i;
      if (!((tailI && headJ) || (tailJ && headI))) return;

      var newStops = tailI ? A.stops.concat(B.stops) : B.stops.concat(A.stops);
      if (newStops.length > MAX_STOPS) return;

      var km = d0[newStops[0]];
      for (var k = 1; k < newStops.length; k++) km += d(newStops[k - 1], newStops[k]);
      km += d0[newStops[newStops.length - 1]];
      if (km > MAX_KM) return;

      var keep = tailI ? A : B, drop = tailI ? B : A;
      var keepIdx = keep === A ? ri : rj;
      var dropCust = drop.stops.slice();
      keep.stops = newStops; keep.km = km; keep.minutes = routeTimeMin(newStops);
      drop.stops = [];
      dropCust.forEach(function (c) { which[c] = keepIdx; });
    });

    // 2-opt
    var live = routesArr.filter(function (r) { return r.stops.length > 0; });
    live.forEach(function (r) {
      r.stops = twoOpt(r.stops, d0, d);
      r.km = openRouteLen(r.stops, d0, d);
      r.minutes = routeTimeMin(r.stops);
    });

    // 정렬 + 색상 부여
    live.sort(function (a, b) { return a.stops[0] - b.stops[0]; });

    return live.map(function (r, idx) {
      var hue = (idx * 137.508) % 360;
      var stopObjs = r.stops.map(function (c) { return OFFICES[c]; });
      return {
        id: idx, hue: hue,
        name: routeName(stopObjs, idx),
        stops: stopObjs, km: r.km, minutes: r.minutes,
        lineColor: hueLine(hue), borderColor: hueBorder(hue),
        bgColor: hueBg(hue), glowColor: hueGlow(hue)
      };
    });
  }

  /* ================================================================
     7. DOM — 노선 목록 렌더링
     ================================================================ */
  var listEl = $('route-list'), countEl = $('route-count'), legendEl = $('legend');
  var nowEl = $('now-route'), mapEl = $('map');
  var emptyEl = $('map-empty'), statusEl = $('map-status');
  var searchTypeEl = $('search-type'), searchInputEl = $('search-input'), searchBtnEl = $('search-btn');

  /* ================================================================
     7-A. 검색 필터
     ================================================================ */
  function filterRoutes(query, type) {
    if (!query) return routes;
    var q = query.toLowerCase();
    return routes.filter(function (r) {
      if (type === 'start') {
        // 출발: 첫 번째 방문 우체국명에 포함
        return r.stops.length > 0 && r.stops[0].name.toLowerCase().indexOf(q) !== -1;
      }
      if (type === 'end') {
        // 도착: 마지막 방문 우체국명에 포함
        return r.stops.length > 0 && r.stops[r.stops.length - 1].name.toLowerCase().indexOf(q) !== -1;
      }
      // 전체: 노선명 또는 모든 방문 우체국명에 포함
      if (r.name.toLowerCase().indexOf(q) !== -1) return true;
      for (var i = 0; i < r.stops.length; i++) {
        if (r.stops[i].name.toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
  }

  function applySearch() {
    var query = (searchInputEl.value || '').trim();
    var type = searchTypeEl.value;
    var filtered = filterRoutes(query, type);
    renderList(filtered);
  }

  if (searchBtnEl) {
    searchBtnEl.addEventListener('click', applySearch);
  }
  if (searchInputEl) {
    searchInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applySearch();
    });
  }

  function renderList(list) {
    list = list || routes;
    listEl.innerHTML = '';
    var legendHtml = '';
    list.forEach(function (r) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'route-card';
      card.dataset.id = r.id;
      card.style.setProperty('--rc', r.borderColor);
      card.style.setProperty('--rc-soft', r.bgColor);
      card.style.setProperty('--rc-glow', r.glowColor);
      var timeStr = Number.isFinite(r.minutes) ? fmtTime(r.minutes) : '';
      card.innerHTML =
        '<span class="route-bar"></span>' +
        '<span class="route-info">' +
        '<span class="route-name">' + esc(r.name) + '</span>' +
        '<span class="route-meta">출발 ' + esc(shortName(r.stops[0].name)) + ' · 물류센터 도착</span>' +
        '</span>' +
        '<span class="route-count">' + r.stops.length + '곳</span>' +
        '<span class="route-km">' + fmtKm(r.km) + '<small>km</small>' + (timeStr ? '<span class="rt-time">' + timeStr + '</span>' : '') + '</span>';
      card.addEventListener('click', function () { selectRoute(r.id); });
      listEl.appendChild(card);
      legendHtml += '<span class="lg" style="--sw:' + r.borderColor + '"><i class="swatch"></i>' + esc(r.name) + '</span>';
    });
    legendEl.innerHTML = legendHtml;
    countEl.textContent = list.length + '개';
  }

  function selectRoute(id) {
    selectedId = id;
    Array.prototype.forEach.call(listEl.children, function (c) {
      c.classList.toggle('selected', Number(c.dataset.id) === id);
    });
    var r = routes[id];
    if (!r) return;

    nowEl.style.setProperty('--rc', r.borderColor);
    var timeStr = Number.isFinite(r.minutes) ? ' ' + fmtTime(r.minutes) : '';
    nowEl.innerHTML =
      '<span class="nr-name" style="color:' + r.borderColor + '">' + esc(r.name) + '</span>' +
      '<span class="nr-km">' + fmtKm(r.km) + ' km · ' + r.stops.length + '곳' + timeStr + '</span>' +
      '<div class="nr-stops">' +
      r.stops.map(function (o, k) {
        return '<button type="button" class="nr-stop" data-stop="' + k + '" title="' + esc(o.name) + ' — 클릭 시 지도 중앙 이동">' +
          (k + 1) + '. ' + esc(shortName(o.name)) + '</button>';
      }).join('') +
      '<button type="button" class="nr-stop depot" data-stop="depot" title="중부권광역우편물류센터 — 도착지">🏢 물류센터 도착</button>' +
      '</div>';

    drawRoute(r);
  }

  function reoptimize() {
    routes = buildRoutes();
    applySearch();
    if (selectedId == null || selectedId >= routes.length) selectedId = 0;
    selectRoute(selectedId);
  }

  /* ================================================================
     8. 노선당 방문 수 컨트롤
     ================================================================ */
  var stopsSegEl = $('stops-seg');

  function buildStopsSeg() {
    if (!stopsSegEl) return;
    [5, 8, 10, 12].forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'seg-btn' + (n === MAX_STOPS ? ' active' : '');
      b.dataset.n = n; b.textContent = n + '곳';
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

  /* ================================================================
     9. 카카오 지도
     ================================================================ */
  var statusTimer = null;
  function statusText(t) {
    statusEl.hidden = false;
    statusEl.textContent = t;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.hidden = true; }, 3500);
  }

  var mapApi = {
    map: null,
    overlays: [],
    lineOverlays: [],
    infoWin: null,

    latLng: function (o) {
      var p = pointOf(o);
      return new kakao.maps.LatLng(p.lat, p.lng);
    },

    load: function (cb) {
      if (window.kakao && window.kakao.maps) { cb(); return; }
      if (!KAKAO_APPKEY) {
        statusText('카카오 지도 appkey가 설정되지 않았습니다');
        return;
      }
      var ks = document.createElement('script');
      ks.async = true;
      ks.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(KAKAO_APPKEY) + '&autoload=false';
      ks.onload = function () {
        if (window.kakao && window.kakao.maps) { kakao.maps.load(cb); return; }
        statusText('카카오 지도 스크립트 로드 실패');
      };
      ks.onerror = function () { statusText('카카오 지도 스크립트를 불러오지 못했습니다'); };
      document.head.appendChild(ks);
    },

    init: function () {
      this.map = new kakao.maps.Map(mapEl, {
        center: new kakao.maps.LatLng(DEPOT.lat, DEPOT.lng),
        level: 9, minLevel: 1, maxLevel: 14
      });
      var self = this;
      kakao.maps.event.addListener(this.map, 'click', function () {
        if (self.infoWin) { self.infoWin.close(); self.infoWin = null; }
      });
      statusText('카카오 지도 로드 완료');
    },

    clear: function () {
      for (var i = 0; i < this.overlays.length; i++) this.overlays[i].setMap(null);
      this.overlays = [];
      this.clearLines();
      if (this.infoWin) { this.infoWin.close(); this.infoWin = null; }
    },

    addPolyline: function (path, color) {
      var line = new kakao.maps.Polyline({
        map: this.map, path: path,
        strokeWeight: 6, strokeColor: color, strokeOpacity: 0.95
      });
      this.lineOverlays.push(line);
    },

    clearLines: function () {
      for (var i = 0; i < this.lineOverlays.length; i++) this.lineOverlays[i].setMap(null);
      this.lineOverlays = [];
    },

    addMarker: function (o, opts) {
      var size = opts.size || 26;
      var el = document.createElement('div');
      el.className = 'nmarker' + (opts.depot ? ' depot' : '');
      el.textContent = opts.depot ? '🏢' : (opts.label || '');
      if (!opts.depot) el.style.background = opts.color || '#8a4bff';
      if (opts.name) el.dataset.name = opts.name;
      if (opts.title) el.title = opts.title;

      var m = new kakao.maps.CustomOverlay({
        map: this.map, position: this.latLng(o),
        content: el, zIndex: opts.zIndex || 0,
        clickable: !!opts.onClick
      });
      if (opts.onClick) {
        el.addEventListener('click', function () { opts.onClick(m); });
      }
      this.overlays.push(m);
      return { marker: m, el: el, office: o };
    },

    showInfo: function (marker, html) {
      if (this.infoWin) this.infoWin.close();
      this.infoWin = new kakao.maps.InfoWindow({ content: html, zIndex: 210 });
      var pos = typeof marker.getPosition === 'function' ? marker.getPosition() : this.latLng(marker.office || marker);
      this.infoWin.open(this.map, pos);
    },

    fit: function (points) {
      var kb = new kakao.maps.LatLngBounds();
      points.forEach(function (p) { kb.extend(p); });
      this.map.setBounds(kb, 90, 90, 90, 90);
    },

    panTo: function (latlng) {
      if (this.map) this.map.panTo(latlng);
    }
  };

  /* ================================================================
     10. 경로 그리기
     ================================================================ */
  var depotMarker = null, stopMarkers = [], focusedStop = null;

  function stopInfoHtml(o, k, r) {
    var phoneLine = o.phone ? '<span class="ninfo-phone">📞 ' + esc(o.phone) + '</span>' : '';
    return '<div class="ninfow">' +
      '<b>' + esc(o.name) + '</b>' +
      '<span>' + esc(o.addr) + '</span>' +
      phoneLine +
      '<em>방문 순서 ' + (k + 1) + ' / ' + r.stops.length + ' · ' + esc(r.name) + '</em></div>';
  }

  function drawRoute(r) {
    if (!mapApi.map) return;
    mapApi.clear();
    depotMarker = null; stopMarkers = []; focusedStop = null;

    // 직선 경로
    var path = r.stops.map(function (o) { return mapApi.latLng(o); });
    path.push(mapApi.latLng(DEPOT));
    mapApi.addPolyline(path, r.lineColor);

    // 물류센터 마커
    depotMarker = mapApi.addMarker(DEPOT, {
      depot: true, size: 36, zIndex: 100,
      name: DEPOT.name, title: esc(DEPOT.name),
      onClick: function () { toggleStopLabel('depot'); }
    });

    // 우체국 마커
    r.stops.forEach(function (o, k) {
      var sm = mapApi.addMarker(o, {
        label: String(k + 1), color: r.borderColor,
        size: 26, zIndex: 50, name: o.name, title: esc(o.name),
        onClick: function () { toggleStopLabel(k); }
      });
      stopMarkers.push(sm);
    });

    mapApi.fit(path);

    // 실제 도로 경로 (OSRM)
    if (USE_ROAD && !ROAD_FAILED) {
      statusText('실제 도로 경로 표시 중…');
      var geoKey = routeGeoSig(r);
      fetchRouteGeometry(r, function (geo) {
        var cur = routes[selectedId];
        if (!geo || !cur || routeGeoSig(cur) !== geoKey) return;
        var pts = geo.map(function (c) { return new kakao.maps.LatLng(c[1], c[0]); });
        mapApi.clearLines();
        mapApi.addPolyline(pts, r.lineColor);
        statusText('실제 도로 경로 표시 완료');
      });
    }
  }

  /* ================================================================
     11. 경유지 포커스
     ================================================================ */
  function updateStopFocusUI() {
    if (depotMarker) depotMarker.el.classList.toggle('focus', focusedStop === 'depot');
    stopMarkers.forEach(function (sm, k) {
      if (sm) sm.el.classList.toggle('focus', focusedStop === k);
    });
    Array.prototype.forEach.call(nowEl.querySelectorAll('.nr-stop'), function (ch) {
      ch.classList.toggle('focus', ch.dataset.stop === String(focusedStop));
    });
  }

  function focusStop(k) {
    var idx = k === 'depot' ? 'depot' : Number(k);
    var sm = idx === 'depot' ? depotMarker : stopMarkers[idx];
    if (!sm || !mapApi.map) return;
    focusedStop = idx;
    updateStopFocusUI();
    mapApi.panTo(mapApi.latLng(sm.office));
  }

  // 지도 마커 클릭 시: 라벨 토글 (지도 이동 없음)
  function toggleStopLabel(k) {
    var idx = (k === 'depot') ? 'depot' : Number(k);
    var sm = idx === 'depot' ? depotMarker : stopMarkers[idx];
    if (!sm) return;
    // 같은 거 다시 클릭 → 해제
    if (focusedStop === idx) {
      focusedStop = null;
    } else {
      focusedStop = idx;
    }
    updateStopFocusUI();
  }

  /* ================================================================
     12. 오버레이 모달 (비용산정기준, 기존물량, 기준자료, 채팅, 파일)
     ================================================================ */
  function makeModal(overlayId, btnId, frameId, closeMsgType) {
    var overlayEl = $(overlayId), btnEl = $(btnId), frameEl = $(frameId);
    if (!overlayEl || !btnEl) return { open: function () {}, close: function () {} };

    function open() {
      overlayEl.hidden = false;
      document.body.style.overflow = 'hidden';
      if (!frameEl.getAttribute('src')) {
        frameEl.src = frameEl.getAttribute('data-src') || '';
      } else {
        frameEl.src = frameEl.src; // 새로고침
      }
    }
    function close() {
      overlayEl.hidden = true;
      document.body.style.overflow = '';
    }

    btnEl.addEventListener('click', open);
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === closeMsgType) close();
    });
    return { open: open, close: close, isOpen: function () { return !overlayEl.hidden; } };
  }

  var modalStandard = makeModal('standard-overlay', 'cost-standard-btn', 'standard-frame', 'close-cost-standard');
  var modalLoaded   = makeModal('loaded-overlay', 'loaded-btn', 'loaded-frame', 'close-loaded');
  var modalData     = makeModal('data-overlay', 'data-btn', 'data-frame', 'close-data-viewer');
  var modalChat     = makeModal('chat-overlay', 'chat-btn', 'chat-frame', 'close-chat');
  var modalFiles    = makeModal('files-overlay', 'files-btn', 'files-frame', 'close-files');

  // Esc 키로 닫기
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modalFiles.isOpen()) modalFiles.close();
    else if (modalChat.isOpen()) modalChat.close();
    else if (modalData.isOpen()) modalData.close();
    else if (modalLoaded.isOpen()) modalLoaded.close();
    else if (modalStandard.isOpen()) modalStandard.close();
  });

  /* ================================================================
     13. 초기화
     ================================================================ */
  function init() {
    if (!OFFICES.length) {
      listEl.innerHTML = '<div class="empty-note">우체국 데이터를 불러오는 중입니다…</div>';
    }

    buildStopsSeg();

    // 하단 경유지 칩 클릭
    nowEl.addEventListener('click', function (e) {
      var ch = e.target && e.target.closest ? e.target.closest('.nr-stop') : null;
      if (ch) focusStop(ch.dataset.stop);
    });

    // 지도 로드 → 카카오 API 검색 → 도로 거리 → 노선 최적화
    mapApi.load(function () {
      mapApi.init();

      function afterSearch() {
        reoptimize(); // 첫 렌더링
        computeRoadMatrix(function () { reoptimize(); }); // 도로 거리 반영 후 재계산
      }

      // 카카오 로컬 API로 우체국 검색 시도
      if (KAKAO_REST_KEY) {
        // 캐시가 있으면 먼저 로드 (즉시 렌더링)
        loadCachedOffices();

        // 백그라운드에서 최신 데이터 검색
        searchPostOfficesFromKakao(function (ok) {
          if (ok) {
            afterSearch(); // 검색 성공 → 검색 결과로 재계산
          } else if (OFFICES.length > 0) {
            afterSearch(); // 검색 실패 but 캐시 있음 → 기존 데이터로 동작
          } else {
            // 검색도 실패, 캐시도 없음
            listEl.innerHTML = '<div class="empty-note">' +
              '⚠️ 우체국 데이터를 불러올 수 없습니다<br>' +
              '카카오 REST API 키를 확인해주세요<br>' +
              '<small>js/config.keys.js → restApiKey</small></div>';
          }
        });
      } else {
        statusText('카카오 REST API 키 미설정 — 우체국 검색 불가');
        listEl.innerHTML = '<div class="empty-note">' +
          '⚠️ 카카오 REST API 키가 설정되지 않았습니다<br>' +
          '<small>js/config.keys.js 에 restApiKey 를 입력해주세요</small></div>';
      }
    });
  }

  init();
})();
