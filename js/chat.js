/* ============================================================
   질의/응답 채팅 (chat.html)
   - 카카오톡 스타일 대화창: 내 글(대화명+내용)은 오른쪽, 남의 글은 왼쪽
   - 데이터는 Supabase(public.chats) 에 저장되고 실시간으로 반영
   - node-navigation.html 의 iframe 오버레이로 열리며,
     "✕" 클릭 시 부모로 postMessage 를 보내 오버레이를 닫습니다.
   ============================================================ */
(function () {
  'use strict';

  const supabase = window.__supabase;

  const listEl = document.getElementById('msg-list');
  const nameEl = document.getElementById('inp-name');
  const contentEl = document.getElementById('inp-content');
  const sendBtn = document.getElementById('btn-send');
  const closeBtn = document.getElementById('btn-close');
  const toastEl = document.getElementById('toast');

  const LS_NAME = 'chat_name';
  const LS_UID = 'chat_uid'; // 브라우저 고유 ID (내 글/남의 글 구분 기준)
  let cached = []; // 마지막으로 불러온 메시지 (대화명 변경 시 재렌더링용)

  // innerHTML 에 넣기 전에 이스케이프
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 오늘은 "HH:MM", 이전 날은 "M/D HH:MM"
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? hm
      : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  function myName() { return nameEl.value.trim(); }

  // 브라우저 고유 ID: 첫 접속 때 생성해 localStorage 에 저장 (로그인 없이 자기 글 구분)
  function myUid() {
    let id = null;
    try { id = localStorage.getItem(LS_UID); } catch (e) { /* 무시 */ }
    if (id) return id;
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem(LS_UID, id); } catch (e) { /* 무시 */ }
    return id;
  }

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' err' : '');
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------------- 대화 내용 렌더링 (카카오톡 스타일) ---------------- */
  function render(messages) {
    cached = messages || [];
    listEl.innerHTML = '';

    if (!cached.length) {
      listEl.innerHTML =
        '<div class="chat-empty">아직 대화가 없습니다.<br/>첫 메시지를 남겨보세요! 💬</div>';
      return;
    }

    const uid = myUid();
    cached.forEach(function (msg) {
      // 브라우저 고유 ID(user_id)가 나와 같으면 "내 글" → 오른쪽 정렬
      // (대화명이 아니라 이 브라우저에서 보낸 메시지만 오른쪽에 표시)
      const mine = !!msg.user_id && msg.user_id === uid;
      const row = document.createElement('div');
      row.className = 'msg-row ' + (mine ? 'mine' : 'other');
      row.innerHTML =
        '<span class="msg-name">' + esc(msg.name) + '</span>' +
        '<div class="msg-wrap">' +
        '<div class="msg-bubble">' + esc(msg.content) + '</div>' +
        '<span class="msg-time">' + esc(fmtTime(msg.created_at)) + '</span>' +
        '</div>';
      listEl.appendChild(row);
    });

    listEl.scrollTop = listEl.scrollHeight; // 맨 아래(최신)로 스크롤
  }

  /* ---------------- 데이터 로드/전송 ---------------- */
  function load() {
    if (!supabase) { render([]); return; }
    supabase.from('chats')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(500)
      .then(function (res) {
        if (res.error) throw res.error;
        render(res.data || []);
      })
      .catch(function (err) {
        listEl.innerHTML =
          '<div class="chat-empty">⚠️ 대화를 불러오지 못했습니다.<br/>' +
          esc(err.message || err) + '</div>';
      });
  }

  function send() {
    const name = myName();
    const content = contentEl.value.trim();
    if (!content) {
      toast('내용을 입력하세요.', true);
      contentEl.focus();
      return;
    }
    if (!supabase) {
      toast('Supabase 설정이 없어 전송할 수 없습니다.', true);
      return;
    }

    sendBtn.disabled = true;
    supabase.from('chats')
      .insert([{ user_id: myUid(), name: name || '익명', content: content }])
      .then(function (res) {
        if (res.error) throw res.error;
        contentEl.value = '';
        load(); // 즉시 반영 (realtime 이벤트와 중복돼도 무해)
      })
      .catch(function (err) {
        toast('전송 실패: ' + (err.message || err), true);
      })
      .finally(function () {
        sendBtn.disabled = false;
        contentEl.focus();
      });
  }

  /* ---------------- 실시간 구독 (다른 사용자 메시지 즉시 반영) ---------------- */
  let channel = null;
  function subscribe() {
    if (!supabase) return;
    try {
      channel = supabase
        .channel('chats-changes')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'chats' },
          function () { load(); })
        .subscribe();
    } catch (e) {
      // realtime 이 꺼져 있어도 치명적이지 않음 — 새로고침 시 반영됨
    }
  }

  /* ---------------- 닫기 (standard.html 과 동일 패턴) ---------------- */
  function close() {
    if (window.parent && window.parent !== window) {
      try {
        const pd = window.parent.document;
        const ov = pd.getElementById('chat-overlay');
        if (ov) {
          ov.hidden = true;
          pd.body.style.overflow = '';
          return;
        }
      } catch (e) { /* 교차 출처 — 아래 postMessage 로 처리 */ }
      try { window.parent.postMessage({ type: 'close-chat' }, '*'); } catch (e) { /* 무시 */ }
    } else {
      location.href = 'node-navigation.html';
    }
  }

  /* ---------------- 이벤트 ---------------- */
  // 저장된 대화명 복원
  try { nameEl.value = localStorage.getItem(LS_NAME) || ''; } catch (e) { /* 무시 */ }

  // 대화명 입력 중: localStorage 저장 (표시용 — 내 글/남의 글 구분은 브라우저 ID 기준)
  nameEl.addEventListener('input', function () {
    try { localStorage.setItem(LS_NAME, nameEl.value); } catch (e) { /* 무시 */ }
  });

  // Enter → 전송 (한글 IME 조합 중에는 무시)
  contentEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  sendBtn.addEventListener('click', send);
  closeBtn.addEventListener('click', close);

  /* ---------------- 초기화 ---------------- */
  load();
  subscribe();
})();
