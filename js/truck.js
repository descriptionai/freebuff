/* ============================================================
   중부권광역우편물류센터 — 차량 관제 모니터링 (시뮬레이션)
   ============================================================
   ┌─────────────────────────────────────────────────────────┐
   │ 【데이터 소스 연동 지점】                                │
   │ 지금은 아래 Sim 엔진이 "가상의 차량 현황"을 생성합니다.  │
   │ 실제 시스템(GPS 관제, CCTV+AI, 수동 입력, Supabase 등)을 │
   │ 연동하려면 아래 공통 데이터 구조로 변환해 주세요.        │
   │                                                         │
   │   차량: { plate, type, cargo, state, side, sub, dockIdx,│
   │           queueStartAt }                                │
   │     state: 'queue' | 'dock' | 'depart'                  │
   │     side : 'bottom'|'right'|'top'|'left' (대기 면)      │
   │     sub  : 1 | 2 (그 면의 대기 차선)                     │
   │     dockIdx: 0~5 (상·하차 중일 때)                       │
   │   도크: { idx, side, truck, busyUntil }                 │
   │                                                         │
   │ 주기적으로 renderTrucks/renderDocks 를 호출하면 지도·    │
   │ 통계·목록·로그가 그대로 갱신됩니다.                      │
   └─────────────────────────────────────────────────────────┘
   ============================================================
   【지형 구조】
   건물 사방(4면)에 각각 주행도로 + 2줄 대기차선이 분리되어 있다.
     건물 쪽 → ① 주행도로 ② 대기1차선 ③ 대기2차선 (바깥)
   도크는 6개(3면): 하단 좌측 2 · 오른쪽 정중앙 2 · 상단 좌측 2.

   【일방통행 순환(반시계)】
   차량은 항상 한 방향으로만 이동한다. 4면이 순서대로 하나의 줄로 연결:
     좌측 → 하단 → 우측 → 상단 → (좌측)
   - 입차: 좌상단 입구 → 맨 뒤(가장 줄이 적은 뒤쪽 면 2차선 tail)에 합류
   - 도크 투입: 그 면 대기열 선두(1차선 front)의 차량이 도크로 진입
   - 캐스케이드: 도크로 빠져 빈 자리가 나면, 뒤 차량이 순차적으로 한 칸씩
     당겨지고, 각 면의 첫 번째 줄선 차량은 다음 면의 맨 끝 자리가 나면
     자연스럽게 그 면 맨 끝으로 붙어 순환한다. (주행도로로 앞을 채우지 않음)
   ============================================================ */

(function () {
  'use strict';   /* ---------------- 상수 ---------------- */
  var MAP = {
    W: 1200, H: 780,
    bld: { x: 410, y: 275, w: 380, h: 220, right: 790, bottom: 495 },
    // 각 면 주행도로 중심선 (건물 바로 옆)
    drive: { topY: 212, bottomY: 564, leftX: 366, rightX: 834 },
    // 각 면 대기차선 중심선 (sub 1 = 건물 쪽, 2 = 바깥쪽)
    wait: {
      bottom: [{ y: 592 }, { y: 620 }],
      right:  [{ x: 862 }, { x: 890 }],
      top:    [{ y: 184 }, { y: 156 }],
      left:   [{ x: 338 }, { x: 310 }]
    },
    capPerLane: 6,
    // 입출차 (좌상단, 상단 주행도로 서쪽 끝)
    entry: { x: 160, y: 212 },
    exit:  { x: 140, y: 212 }
  };

  /* 일방통행 순환(캐스케이드) 순서: 좌측 → 하단 → 우측 → 상단 → (좌측)
     - 차량은 항상 한 방향으로만 면을 넘어가며 줄을 선다.
     - PREV[f] = 'f 면의 맨 뒤(2차선 tail)를 채워줄 이전 면'. */
  var FACE_ORDER = ['left', 'bottom', 'right', 'top']; // 입차 시 줄 서는 순서
  var PREV = { bottom: 'left', right: 'bottom', top: 'right', left: 'top' };

  var TRUCK = { W: 18, H: 6 };

  // 도크 6개: 하단 좌측 2 · 오른쪽 정중앙 2 · 상단 좌측 2
  var DOCKS = [
    { idx: 0, side: 'bottom', x: 424, y: 535, rot: 90  },
    { idx: 1, side: 'bottom', x: 452, y: 535, rot: 90  },
    { idx: 2, side: 'right',  x: 805, y: 355, rot: 0   },
    { idx: 3, side: 'right',  x: 805, y: 415, rot: 0   },
    { idx: 4, side: 'top',    x: 424, y: 250, rot: 270 },
    { idx: 5, side: 'top',    x: 452, y: 250, rot: 270 }
  ];
  var GROUP_LABEL = { bottom: '하단', right: '오른쪽', top: '상단', left: '좌측' };

  var CONFIG = {
    arrivalMean: 7,
    burstMean: 2,
    serviceMin: 40,
    serviceMax: 100,
    seed: { bottom: [3, 2], right: [2, 2], top: [2, 1], left: [1, 1] },
    speeds: [0.5, 1, 2, 4, 8],
    tickMs: 100,
    animSpeed: 300
  };

  var REGIONS = ['서울', '경기', '인천', '충남', '충북', '대전', '대구', '경북', '강원', '세종'];
  var LETTERS = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '허'];
  var TYPES = [
    { name: '카고',     cls: 'cargo',   w: 0.35, cargo: ['우편물', '소포', '일반화물'] },
    { name: '윙바디',   cls: 'wing',    w: 0.30, cargo: ['우편물', '소포', '잡화'] },
    { name: '트레일러', cls: 'trailer', w: 0.20, cargo: ['대형화물', '컨테이너'] },
    { name: '냉동',     cls: 'reefer',  w: 0.15, cargo: ['냉동식품', '신선식품'] }
  ];
  var STATE_LABEL = { queue: '대기', dock: '상·하차', depart: '출차' };
  var SIDE_LABEL = { bottom: '하단', right: '오른쪽', top: '상단', left: '좌측' };

  /* ---------------- 유틸 ---------------- */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function randExp(mean) { return -Math.log(1 - Math.random()) * mean; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + '초';
    return Math.floor(sec / 60) + '분 ' + pad2(sec % 60) + '초';
  }
  function makePlate() {
    return pick(REGIONS) + ' ' + randInt(1, 99) + pick(LETTERS) + ' ' + randInt(1000, 9999);
  }
  function makeType() {
    var r = Math.random(), acc = 0;
    for (var i = 0; i < TYPES.length; i++) {
      acc += TYPES[i].w;
      if (r <= acc) return TYPES[i];
    }
    return TYPES[0];
  }
  // 면(sub 1|2)의 대기열 슬롯 위치. index 0 = 앞(도크 쪽 머리).
  // 순환(반시계): 좌↓ → 하→ → 우↑ → 상←  — 대기열은 tail에서 front 쪽으로 당겨진다.
  function slotCenter(side, sub, slot) {
    var q = MAP.wait[side][sub - 1];
    if (side === 'bottom') return { x: 438 + slot * 40, y: q.y, rot: 270 }; // 동→서로 당김, 캡 북(건물)
    if (side === 'top')    return { x: 438 + slot * 40, y: q.y, rot: 90 };  // 동→서로 당김, 캡 남(건물)
    if (side === 'right')  return { x: q.x, y: 385 + slot * 46, rot: 180 }; // 남→북으로 당김, 캡 서(건물)
    return { x: q.x, y: 500 - slot * 46, rot: 90 };                          // 북→남으로 당김, 캡 남
  }

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var mapEl = $('map'), trucksLayer = $('trucks'), docksLayer = $('docks');
  var clockEl = $('clock'), playBtn = $('play-btn'), speedSeg = $('speed-seg');
  var burstBtn = $('burst-btn'), resetBtn = $('reset-btn');
  var burstChip = $('burst-chip'), fullChip = $('full-chip');
  var tipEl = $('tip'), popEl = $('pop');
  var tbody = $('truck-tbody'), logEl = $('log'), dockListEl = $('dock-list');

  /* ---------------- 상태 ---------------- */
  var sim = {
    time: 0,
    base: Date.now(),
    running: true,
    speed: 1,
    completed: 0,
    totalWait: 0,
    maxWaitSeen: 0,
    nextId: 1,
    // 면별 대기열: side -> { 1:[], 2:[] }  (index 0 = 앞)
    queues: {},
    docks: [],
    trucks: [],
    nextArrivalAt: 4,
    burstUntil: -1,
    events: []
  };
  ['bottom', 'right', 'top', 'left'].forEach(function (s) {
    sim.queues[s] = { 1: [], 2: [] };
  });

  function scale() { return mapEl.clientWidth / MAP.W; }

  /* ---------------- 위치 배치 ---------------- */
  function offsetFor(rot, W, H) {
    var r = ((rot % 360) + 360) % 360;
    switch (r) {
      case 0:   return { tx: -W / 2, ty: -H / 2 };
      case 90:  return { tx: H / 2,  ty: -W / 2 };
      case 180: return { tx: W / 2,  ty: H / 2 };
      case 270: return { tx: -H / 2, ty: W / 2 };
    }
    return { tx: -W / 2, ty: -H / 2 };
  }
  function place(el, cx, cy, rot, anim) {
    var s = scale(), o = offsetFor(rot, TRUCK.W, TRUCK.H);
    if (anim) {
      var delay = anim.delay ? ' ' + anim.delay + 's' : '';
      el.style.transition = 'transform ' + anim.dur + 'ms cubic-bezier(0.32,0.72,0.28,1)' + delay;
    } else {
      el.style.transition = 'none';
    }
    el.style.transform = 'translate(' + ((cx + o.tx) * s).toFixed(1) + 'px,' +
      ((cy + o.ty) * s).toFixed(1) + 'px) rotate(' + rot + 'deg)';
  }

  /* ---------------- 차량 엔티티 ---------------- */
  function createTruckEl(t) {
    var el = document.createElement('div');
    el.className = 'truck t-' + t.type.cls + ' state-' + t.state;
    el.style.width = TRUCK.W + 'px';
    el.style.height = TRUCK.H + 'px';
    el.dataset.id = t.id;
    trucksLayer.appendChild(el);
    return el;
  }

  function makeTruck(side, sub) {
    var type = makeType();
    var t = {
      id: sim.nextId++,
      plate: makePlate(),
      type: type,
      cargo: pick(type.cargo),
      state: 'queue',
      side: side,
      sub: sub,
      slot: null,
      dockIdx: null,
      queueStartAt: sim.time,
      dockStartAt: null,
      moving: false,
      x: 0, y: 0, rot: 0,
      el: null
    };
    t.el = createTruckEl(t);
    return t;
  }

  /* ---------------- 경로 애니메이션 ---------------- */
  function animatePath(t, pts, onDone) {
    t.moving = true;
    t.el.style.zIndex = 4;
    var i = 0;
    function seg() {
      if (i >= pts.length) {
        t.moving = false;
        if (onDone) onDone();
        return;
      }
      var p = pts[i++];
      var dx = p.x - t.x, dy = p.y - t.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var dur = Math.max(150, Math.min(dist / CONFIG.animSpeed * 1000, 2500));
      var rot = (p.rot != null) ? p.rot : t.rot;
      place(t.el, p.x, p.y, rot, { dur: dur });
      t.x = p.x; t.y = p.y; t.rot = rot;
      setTimeout(seg, dur);
    }
    seg();
  }

  /* 진입: 좌상단 → 상단 주행도로 → 배정 면 주행도로 → 대기열 끝 합류 */
  function entryPath(t, back) {
    var E = MAP.entry, D = MAP.drive;
    var pts = [{ x: E.x, y: E.y, rot: 0 }];
    switch (t.side) {
      case 'top':
        pts.push({ x: back.x, y: D.topY, rot: 90 });
        pts.push({ x: back.x, y: back.y, rot: 90 });
        break;
      case 'right':
        pts.push({ x: D.rightX, y: D.topY, rot: 90 });
        pts.push({ x: D.rightX, y: back.y, rot: 90 });
        pts.push({ x: back.x, y: back.y, rot: 180 });
        break;
      case 'bottom':
        pts.push({ x: D.leftX, y: D.topY, rot: 90 });
        pts.push({ x: D.leftX, y: D.bottomY, rot: 0 });
        pts.push({ x: back.x, y: D.bottomY, rot: 0 });
        pts.push({ x: back.x, y: back.y, rot: 270 });
        break;
      default: // left
        pts.push({ x: D.leftX, y: D.topY, rot: 90 });
        pts.push({ x: D.leftX, y: back.y, rot: 90 });
        pts.push({ x: back.x, y: back.y, rot: 90 });
    }
    return pts;
  }

  /* 대기열 앞 → 해당 면 도크 투입 (각 구간은 이동 방향을 향함, 마지막에 도크 자세로 선회) */
  function dockPath(t, d) {
    var D = MAP.drive;
    var pts = [{ x: t.x, y: t.y, rot: t.rot }];
    var cx = t.x;
    if (d.side === 'bottom') {
      if (t.x < 380) { // 좌측 대기열 → 좌측 주행도로 → 하단 주행도로
        pts.push({ x: D.leftX, y: t.y, rot: 0 });
        pts.push({ x: D.leftX, y: D.bottomY, rot: 90 });
        cx = D.leftX;
      } else { // 하단 대기열 → 하단 주행도로로 직진
        pts.push({ x: t.x, y: D.bottomY, rot: 270 });
      }
      pts.push({ x: d.x, y: D.bottomY, rot: d.x >= cx ? 0 : 180 });
      pts.push({ x: d.x, y: d.y, rot: d.rot });
    } else if (d.side === 'right') {
      pts.push({ x: D.rightX, y: t.y, rot: 180 }); // 서진(대기열 → 우측 주행도로)
      pts.push({ x: D.rightX, y: d.y, rot: 270 });  // 북진(주행도로 → 도크 라인)
      pts.push({ x: d.x, y: d.y, rot: 180 });       // 서진(도크 접안)
      pts.push({ x: d.x, y: d.y, rot: d.rot });     // 도크 주차 자세
    } else { // top
      pts.push({ x: t.x, y: D.topY, rot: 90 });
      pts.push({ x: d.x, y: D.topY, rot: d.x >= t.x ? 0 : 180 });
      pts.push({ x: d.x, y: d.y, rot: d.rot });
    }
    return pts;
  }

  /* 출차: 도크 → 주행도로 → 반시계 순환을 따라 좌상단 출구 (일방통행 준수) */
  function exitPath(t) {
    var d = DOCKS[t.dockIdx];
    var D = MAP.drive;
    var ex = { x: MAP.exit.x, y: MAP.exit.y, rot: 180 };
    var toExit = [{ x: 300, y: D.topY, rot: 180 }, ex]; // 상단 주행도로 서쪽(출구 방향)
    if (d.side === 'bottom') {
      // 하단 도크 → 하단 주행도로(동진) → 우측 주행도로(북진) → 상단 주행도로(서진) → 출구
      return [
        { x: d.x, y: d.y, rot: d.rot },
        { x: d.x, y: D.bottomY, rot: 90 },
        { x: D.rightX, y: D.bottomY, rot: 0 },
        { x: D.rightX, y: D.topY, rot: 270 }
      ].concat(toExit);
    }
    if (d.side === 'right') {
      // 우측 도크 → 우측 주행도로(북진) → 상단 주행도로(서진) → 출구
      return [
        { x: d.x, y: d.y, rot: d.rot },
        { x: D.rightX, y: d.y, rot: 0 },
        { x: D.rightX, y: D.topY, rot: 270 }
      ].concat(toExit);
    }
    // 상단 도크 → 상단 주행도로(서진) → 출구
    return [
      { x: d.x, y: d.y, rot: d.rot },
      { x: d.x, y: D.topY, rot: 270 }
    ].concat(toExit);
  }

  /* ---------------- 렌더링: 차량 위치 ---------------- */
  function renderPositions(animate) {
    var side, sub, L, i, t, c;
    for (side in sim.queues) {
      for (sub = 1; sub <= 2; sub++) {
        L = sim.queues[side][sub];
        for (i = 0; i < L.length; i++) {
          t = L[i];
          if (t.moving) continue;
          c = slotCenter(side, sub, i);
          t.x = c.x; t.y = c.y; t.rot = c.rot;
          place(t.el, t.x, t.y, t.rot,
            animate ? { dur: 420, delay: i * 0.04 } : null);
          t.el.style.zIndex = 3;
        }
      }
    }
    sim.docks.forEach(function (d) {
      if (d.truck && !d.truck.moving) {
        var tr = d.truck;
        tr.x = d.x; tr.y = d.y; tr.rot = d.rot;
        place(tr.el, tr.x, tr.y, tr.rot, null);
        tr.el.style.zIndex = 5;
      }
    });
  }

  /* ---------------- 렌더링: 도크 마커 ---------------- */
  function renderDockMarkers() {
    var s = scale();
    sim.docks.forEach(function (d) {
      var el = d.el;
      el.style.transform = 'translate(' + ((d.x - 10) * s).toFixed(1) + 'px,' + ((d.y - 10) * s).toFixed(1) + 'px)';
      if (d.truck) {
        el.className = 'dock-marker busy';
        el.textContent = d.idx + 1;
        el.title = '도크 ' + (d.idx + 1) + ' — ' + d.truck.plate + ' 상·하차 중';
      } else {
        el.className = 'dock-marker free';
        el.textContent = d.idx + 1;
        el.title = '도크 ' + (d.idx + 1) + ' — 대기';
      }
    });
  }

  function buildDockMarkers() {
    docksLayer.innerHTML = '';
    sim.docks.forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'dock-marker';
      el.dataset.dock = d.idx;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        showDockPop(d.idx, el);
      });
      docksLayer.appendChild(el);
      d.el = el;
    });
  }

  /* ---------------- 렌더링: 통계 ---------------- */
  function renderStats() {
    var perSide = { bottom: 0, right: 0, top: 0, left: 0 };
    var totalQueue = 0, side;
    for (side in sim.queues) {
      perSide[side] = sim.queues[side][1].length + sim.queues[side][2].length;
      totalQueue += perSide[side];
    }
    var busy = sim.docks.filter(function (d) { return d.truck; }).length;
    var waiting = sim.trucks.filter(function (t) { return t.state === 'queue'; })
      .map(function (t) { return sim.time - t.queueStartAt; });

    $('st-total').textContent = sim.trucks.length;
    $('st-done').textContent = sim.completed;
    $('st-queue').textContent = totalQueue;
    // 순환 순서(좌→하→우→상) 표기
    $('st-q1').textContent = perSide.left;
    $('st-q2').textContent = perSide.bottom;
    $('st-q3').textContent = perSide.right;
    $('st-q4').textContent = perSide.top;
    $('st-dock').textContent = busy;
    $('st-dockrate').textContent = Math.round(busy / sim.docks.length * 100);

    var avg = waiting.length ? waiting.reduce(function (a, b) { return a + b; }, 0) / waiting.length : 0;
    var max = waiting.length ? Math.max.apply(null, waiting) : 0;
    $('st-avg').textContent = fmtDur(avg);
    $('st-max').textContent = fmtDur(max);

    var hours = sim.time / 3600;
    $('st-tph').textContent = hours > 0 ? Math.round(sim.completed / hours) : 0;

    burstChip.hidden = sim.time >= sim.burstUntil;
    fullChip.hidden = joinSpot() !== null; // 줄 설 곳이 없으면 진입 통제
  }

  /* ---------------- 렌더링: 목록 ---------------- */
  function listSig() {
    return sim.trucks.map(function (t) {
      return t.id + ':' + t.state + ':' + (t.side || '-') + ':' + (t.sub || '-') +
        ':' + (t.slot === null ? '-' : t.slot) +
        ':' + (t.dockIdx === null ? '-' : t.dockIdx) + ':' + Math.round((sim.time - t.queueStartAt) / 5);
    }).join('|') + '|' + sim.docks.map(function (d) { return d.truck ? d.truck.id : 0; }).join('');
  }
  var lastSig = '';

  function badgeOf(t) {
    if (t.state === 'dock') return '<span class="badge dock">도크 ' + (t.dockIdx + 1) + '</span>';
    if (t.state === 'depart') return '<span class="badge depart">출차</span>';
    var cls = t.sub === 1 ? 'q1' : 'q2';
    return '<span class="badge ' + cls + '">' + SIDE_LABEL[t.side] + ' ' + t.sub + '차</span>';
  }

  function renderList() {
    var sig = listSig();
    if (sig === lastSig) return;
    lastSig = sig;

    var ordered = [];
    sim.trucks.forEach(function (t) { if (t.state === 'dock') ordered.push(t); });
    FACE_ORDER.forEach(function (s) {
      [sim.queues[s][1], sim.queues[s][2]].forEach(function (L) {
        L.forEach(function (t) { ordered.push(t); });
      });
    });
    sim.trucks.forEach(function (t) { if (t.state === 'depart') ordered.push(t); });

    if (!ordered.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="ta-c" style="color:var(--dim);padding:22px;text-align:center;">차량이 없습니다</td></tr>';
      return;
    }

    var html = '';
    ordered.forEach(function (t) {
      html += '<tr data-truck="' + t.id + '">' +
        '<td><span class="plate">' + t.plate + '</span>' +
        '<span class="cargo">' + t.type.name + ' · ' + t.cargo + '</span></td>' +
        '<td>' + badgeOf(t) + '</td>' +
        '<td>' + STATE_LABEL[t.state] + '</td>' +
        '<td class="ta-r">' + fmtDur(sim.time - t.queueStartAt) + '</td></tr>';
    });
    tbody.innerHTML = html;
  }

  /* ---------------- 렌더링: 로그 ---------------- */
  function logEvent(kind, text) {
    sim.events.push({ ms: sim.base + sim.time * 1000, kind: kind, text: text });
    if (sim.events.length > 80) sim.events.shift();
    renderLog();
  }
  function renderLog() {
    var html = '';
    sim.events.slice().reverse().forEach(function (e) {
      html += '<div class="log-item k-' + e.kind + '">' +
        '<span class="log-time">' + fmtClock(e.ms) + '</span>' +
        '<span class="log-text">' + e.text + '</span></div>';
    });
    logEl.innerHTML = html;
  }

  /* ---------------- 렌더링: 도크 현황 ---------------- */
  function renderDockList() {
    var html = '';
    sim.docks.forEach(function (d) {
      var busy = !!d.truck;
      html += '<div class="dock-row">' +
        '<span class="d-name">도크 ' + (d.idx + 1) +
        ' <em style="font-style:normal;color:var(--dim);font-size:0.72rem;">' + GROUP_LABEL[d.side] + '</em></span>' +
        '<span class="d-state">' +
        (busy
          ? '<b>' + d.truck.plate + '</b><span class="pill busy">상·하차</span>'
          : '<span class="pill free">대기</span>') +
        '</span></div>';
    });
    dockListEl.innerHTML = html;
  }

  /* ---------------- 렌더링 총괄 ---------------- */
  function renderAll(animate) {
    renderPositions(animate);
    renderDockMarkers();
    renderStats();
    renderList();
    renderDockList();
  }

  /* ---------------- 툴팁 / 팝오버 ---------------- */
  function showTip(el, html) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    var r = el.getBoundingClientRect();
    var tw = tipEl.offsetWidth;
    var x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    tipEl.style.left = x + 'px';
    tipEl.style.top = (r.top - tipEl.offsetHeight - 8) + 'px';
  }
  function hideTip() { tipEl.hidden = true; }
  function showPop(el, html) {
    popEl.innerHTML = html;
    popEl.hidden = false;
    var r = el.getBoundingClientRect();
    var pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    var x = r.left + r.width / 2 - pw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
    var y = r.bottom + 10;
    if (y + ph > window.innerHeight) y = r.top - ph - 10;
    popEl.style.left = x + 'px';
    popEl.style.top = y + 'px';
  }
  function hidePop() { popEl.hidden = true; }

  function truckPopHtml(t) {
    var wait = fmtDur(sim.time - t.queueStartAt);
    var rows = '';
    if (t.state === 'dock') {
      var done = fmtDur(sim.time - t.dockStartAt);
      rows += '<div class="pop-row"><span>도크</span><b>' + (t.dockIdx + 1) + '번 · ' + GROUP_LABEL[DOCKS[t.dockIdx].side] + '</b></div>' +
        '<div class="pop-row"><span>상·하차 경과</span><b>' + done + '</b></div>';
    } else if (t.state === 'queue') {
      rows += '<div class="pop-row"><span>위치</span><b>' + SIDE_LABEL[t.side] + ' ' + t.sub + '차선 (앞에서 ' + (t.slot + 1) + '번째)</b></div>';
    }
    return '<div class="pop-title"><span class="pop-type t-' + t.type.cls + '"></span>' + t.plate + '</div>' +
      '<div class="pop-row"><span>차종 / 화물</span><b>' + t.type.name + ' · ' + t.cargo + '</b></div>' +
      '<div class="pop-row"><span>상태</span><b>' + STATE_LABEL[t.state] + '</b></div>' +
      '<div class="pop-row"><span>대기 시간</span><b>' + wait + '</b></div>' + rows;
  }
  function dockPopHtml(idx) {
    var d = sim.docks[idx];
    var html = '<div class="pop-title">🚪 도크 ' + (idx + 1) + ' · ' + GROUP_LABEL[d.side] + '</div>';
    if (d.truck) {
      html += '<div class="pop-row"><span>차량</span><b>' + d.truck.plate + '</b></div>' +
        '<div class="pop-row"><span>차종 / 화물</span><b>' + d.truck.type.name + ' · ' + d.truck.cargo + '</b></div>' +
        '<div class="pop-row"><span>남은 시간</span><b>약 ' + fmtDur(Math.max(0, d.busyUntil - sim.time)) + '</b></div>';
    } else {
      html += '<div class="pop-row"><span>상태</span><b style="color:var(--success)">대기 중 — 즉시 투입 가능</b></div>';
    }
    return html;
  }

  function bindTruckEvents(t) {
    t.el.addEventListener('mouseenter', function () {
      showTip(t.el, '<b>' + t.plate + '</b> · ' + t.type.name + ' · ' + STATE_LABEL[t.state] +
        ' · 대기 ' + fmtDur(sim.time - t.queueStartAt));
      highlightRow(t.id, true);
    });
    t.el.addEventListener('mouseleave', function () { hideTip(); highlightRow(t.id, false); });
    t.el.addEventListener('click', function (e) {
      e.stopPropagation();
      showPop(t.el, truckPopHtml(t));
    });
  }
  function highlightRow(id, on) {
    var row = tbody.querySelector('tr[data-truck="' + id + '"]');
    if (row) row.classList.toggle('hl', on);
  }

  /* ---------------- 시뮬레이션 로직 ---------------- */

  /* 입차 자리: 순환 맨 뒤(좌측 면)부터 채운다.
     - 좌측 면이 곧 대기열의 꼬리(입구)이며, 줄이 꽉 차면 진입 통제. */
  function joinSpot() {
    if (sim.queues.left[2].length < MAP.capPerLane) return { face: 'left', sub: 2 };
    if (sim.queues.left[1].length < MAP.capPerLane) return { face: 'left', sub: 1 };
    return null;
  }

  function arrive() {
    var spot = joinSpot();
    if (!spot) { sim.nextArrivalAt = sim.time + rand(3, 6); return false; }
    var face = spot.face, sub = spot.sub;
    var t = makeTruck(face, sub);
    t.slot = sim.queues[face][sub].push(t) - 1;
    sim.trucks.push(t);
    bindTruckEvents(t);
    logEvent('in', t.plate + ' ' + t.type.name + ' 차량이 ' + SIDE_LABEL[face] + ' 대기열 맨 뒤에 합류');
    var back = slotCenter(face, sub, t.slot);
    place(t.el, MAP.entry.x, MAP.entry.y, 0, null);
    t.x = MAP.entry.x; t.y = MAP.entry.y; t.rot = 0;
    animatePath(t, entryPath(t, back), function () { t.moving = false; });
    var mean = sim.time < sim.burstUntil ? CONFIG.burstMean : CONFIG.arrivalMean;
    sim.nextArrivalAt = sim.time + randExp(mean);
    return true;
  }

  /* 캐스케이드: 도크로 빠져 생긴 빈 자리를 순환 방향(좌→하→우→상)으로 전파.
     - f.2차선 front → f.1차선 tail (그 면이 한 칸씩 당겨짐)
     - f.2차선 tail이 비면 이전 면(PREV[f])의 첫 번째 줄선 차량이
       다음 면(=f)의 맨 끝으로 자연스럽게 붙어 순환.
     - 좌측 면(입구)까지 도달하면 멈춤 — 빈 자리는 입차 차량이 채운다. */
  function cascadeFrom(start) {
    var cur = start, guard = 0;
    while (guard++ < 40) {
      // 1) cur면 1차선에 자리 → 2차선 front를 1차선 tail로 당김
      if (sim.queues[cur][1].length < MAP.capPerLane && sim.queues[cur][2].length > 0) {
        var t = sim.queues[cur][2].shift();
        sim.queues[cur][2].forEach(function (q, j) { q.slot = j; });
        t.sub = 1;
        t.slot = sim.queues[cur][1].push(t) - 1;
      } else if (cur === 'left') {
        break; // 입구까지 도달 — 다음 자리는 입차 차량이 채움
      }
      // 2) cur면 2차선 tail 자리 → 이전 면 front를 맨 뒤로 충원 (전파)
      if (sim.queues[cur][2].length < MAP.capPerLane) {
        var p = PREV[cur];
        if (cur === 'left' || !sim.queues[p][1].length) break; // 입구까지 도달하면 종료
        var t2 = sim.queues[p][1].shift();
        sim.queues[p][1].forEach(function (q, j) { q.slot = j; });
        t2.slot = sim.queues[cur][2].push(t2) - 1;
        moveFace(t2, p, cur);
        t2.side = cur; t2.sub = 2;
        cur = p;
      } else {
        break;
      }
    }
  }

  /* 캐스케이드로 면이 바뀌는 차량: 이전 면 front → 주행도로 경유 → 다음 면 tail */
  function moveFace(t, fromSide, toSide) {
    var D = MAP.drive;
    var dest = slotCenter(toSide, 2, sim.queues[toSide][2].length - 1);
    var pts = [{ x: t.x, y: t.y, rot: t.rot }];
    if (fromSide === 'left' && toSide === 'bottom') {
      pts.push({ x: D.leftX, y: t.y, rot: 0 });
      pts.push({ x: D.leftX, y: D.bottomY, rot: 90 });
      pts.push({ x: dest.x, y: D.bottomY, rot: 0 });
      pts.push({ x: dest.x, y: dest.y, rot: 270 });
    } else if (fromSide === 'bottom' && toSide === 'right') {
      pts.push({ x: t.x, y: D.bottomY, rot: 270 });
      pts.push({ x: D.rightX, y: D.bottomY, rot: 0 });
      pts.push({ x: D.rightX, y: dest.y, rot: 90 });
      pts.push({ x: dest.x, y: dest.y, rot: 180 });
    } else if (fromSide === 'right' && toSide === 'top') {
      pts.push({ x: D.rightX, y: t.y, rot: 180 });
      pts.push({ x: D.rightX, y: D.topY, rot: 270 });
      pts.push({ x: dest.x, y: D.topY, rot: 180 });
      pts.push({ x: dest.x, y: dest.y, rot: 90 });
    } else { // top → left
      pts.push({ x: t.x, y: D.topY, rot: 90 });
      pts.push({ x: D.leftX, y: D.topY, rot: 180 });
      pts.push({ x: D.leftX, y: dest.y, rot: 90 });
      pts.push({ x: dest.x, y: dest.y, rot: 90 });
    }
    animatePath(t, pts, function () { t.moving = false; });
  }

  function dispatch() {
    var free = sim.docks.filter(function (d) { return !d.truck; });
    if (!free.length) return;
    // 도크 앞 대기열 선두 차량이 그 도크로 진입 (면 단위 순환)
    free.forEach(function (d) {
      var L = sim.queues[d.side][1];
      var head = L[0];
      if (!head) return; // 그 면 대기열이 비어 있으면 대기
      L.shift();
      L.forEach(function (t2, j) { t2.slot = j; });
      head.state = 'dock';
      head.slot = null;
      head.dockIdx = d.idx;
      d.truck = head;
      head.el.className = 'truck t-' + head.type.cls + ' state-dock';
      logEvent('dock', head.plate + ' 차량이 도크 ' + (d.idx + 1) + '(' + GROUP_LABEL[d.side] + ')로 진입');
      animatePath(head, dockPath(head, d), function () {
        head.dockStartAt = sim.time;
        d.busyUntil = sim.time + rand(CONFIG.serviceMin, CONFIG.serviceMax);
      });
      cascadeFrom(d.side);
    });
  }

  function finishDock(d) {
    var t = d.truck;
    d.truck = null;
    t.state = 'depart';
    t.el.className = 'truck t-' + t.type.cls + ' state-depart';
    var wait = sim.time - t.queueStartAt;
    sim.completed++;
    sim.totalWait += wait;
    if (wait > sim.maxWaitSeen) sim.maxWaitSeen = wait;
    logEvent('out', t.plate + ' 상·하차 완료 → 출차 (대기 ' + fmtDur(wait) + ')');

    animatePath(t, exitPath(t), function () {
      t.el.remove();
      var idx = sim.trucks.indexOf(t);
      if (idx > -1) sim.trucks.splice(idx, 1);
    });

    dispatch();
  }

  function step(dt) {
    sim.time += dt;
    var guard = 0;
    while (sim.time >= sim.nextArrivalAt && guard++ < 25) {
      if (!arrive()) break;
    }
    sim.docks.forEach(function (d) {
      if (d.truck && !d.truck.moving && sim.time >= d.busyUntil) finishDock(d);
    });
  }

  /* ---------------- 초기화 / 시드 ---------------- */
  function seed() {
    trucksLayer.innerHTML = '';
    ['bottom', 'right', 'top', 'left'].forEach(function (s) {
      sim.queues[s] = { 1: [], 2: [] };
    });
    sim.trucks = [];
    sim.completed = 0;
    sim.totalWait = 0;
    sim.maxWaitSeen = 0;
    sim.nextId = 1;
    sim.docks = DOCKS.map(function (c) {
      return { idx: c.idx, side: c.side, x: c.x, y: c.y, rot: c.rot, truck: null, busyUntil: 0, el: null };
    });

    // 면별 시드 대기열
    FACE_ORDER.forEach(function (s) {
      [1, 2].forEach(function (sub) {
        var n = CONFIG.seed[s] ? CONFIG.seed[s][sub - 1] : 0;
        for (var k = 0; k < n; k++) {
          var t = makeTruck(s, sub);
          t.slot = sim.queues[s][sub].push(t) - 1;
          t.queueStartAt = sim.time - rand(20, 300);
          sim.trucks.push(t);
          bindTruckEvents(t);
        }
      });
    });
    // 도크 2곳 가동 중 (하단 1, 우측 1)
    [0, 2].forEach(function (k) {
      var t = makeTruck(DOCKS[k].side, 1);
      t.state = 'dock';
      t.dockIdx = k;
      t.dockStartAt = sim.time;
      t.queueStartAt = sim.time - rand(30, 90);
      sim.docks[k].truck = t;
      sim.docks[k].busyUntil = sim.time + rand(15, 60);
      sim.trucks.push(t);
      bindTruckEvents(t);
    });

    sim.nextArrivalAt = sim.time + 4;
    sim.burstUntil = -1;
    buildDockMarkers();
    renderAll(false);
    renderLog();
  }

  function reset() {
    sim.time = 0;
    sim.base = Date.now();
    sim.events = [];
    seed();
    logEvent('sys', '시스템 초기화 — 시뮬레이션 재시작');
  }

  /* ---------------- 메인 루프 ---------------- */
  var lastTick = Date.now();
  function tick() {
    var now = Date.now();
    if (!sim.running) { lastTick = now; return; }
    var dt = Math.min((now - lastTick) / 1000, 30) * sim.speed;
    lastTick = now;
    step(dt);
    renderAll(true);
    clockEl.textContent = fmtClock(sim.base + sim.time * 1000);
  }

  /* ---------------- 컨트롤 ---------------- */
  function setSpeed(sp) {
    sim.speed = sp;
    Array.prototype.forEach.call(speedSeg.children, function (b) {
      b.classList.toggle('active', Number(b.dataset.speed) === sp);
    });
  }

  function initControls() {
    CONFIG.speeds.forEach(function (sp) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'speed-btn' + (sp === 1 ? ' active' : '');
      b.dataset.speed = sp;
      b.textContent = sp + 'x';
      b.addEventListener('click', function () { setSpeed(sp); });
      speedSeg.appendChild(b);
    });

    playBtn.addEventListener('click', function () {
      sim.running = !sim.running;
      playBtn.textContent = sim.running ? '⏸' : '▶';
      playBtn.title = sim.running ? '일시정지' : '재생';
    });
    burstBtn.addEventListener('click', function () {
      sim.burstUntil = sim.time + rand(25, 40);
      logEvent('sys', '🚨 진입 폭주 상황 발생 — 차량 도착 간격 급감');
    });
    resetBtn.addEventListener('click', reset);
    document.addEventListener('click', function (e) {
      if (!popEl.contains(e.target)) hidePop();
    });
    window.addEventListener('resize', function () {
      renderAll(false);
    });
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    sim.base = Date.now();
    seed();
    initControls();
    logEvent('sys', '모니터링 시작 — 일방통행 순환(좌→하→우→상) · 3면 도크');
    setInterval(tick, CONFIG.tickMs);
  }

  init();
})();
