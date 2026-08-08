// ============================================================
// 방명록 앱 로직
// ============================================================
(function () {
  'use strict';

  const supabase = window.__supabase;

  // ---- DOM ---- //
  const userBox = document.getElementById('user-box');
  const userName = document.getElementById('user-name');
  const logoutBtn = document.getElementById('logout-btn');
  const writeForm = document.getElementById('write-form');
  const contentEl = document.getElementById('content');
  const countEl = document.getElementById('count');
  const submitBtn = document.getElementById('submit-btn');
  const loginCta = document.getElementById('login-cta');
  const loaderEl = document.getElementById('loader');
  const listEl = document.getElementById('list');
  const footCount = document.getElementById('foot-count');
  const toastWrap = document.getElementById('toasts');

  const MAX_LEN = 1000;

  // ---- 유틸 ---- //
  function toast(message, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  function avatarChar(name) {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- 렌더링 ---- //
  function renderMessages(messages, currentUserId) {
    listEl.innerHTML = '';

    if (!messages || messages.length === 0) {
      listEl.innerHTML =
        '<div class="empty"><span class="big">🫧</span>아직 남겨진 글이 없어요.<br />첫 번째 방명록을 남겨보세요!</div>';
      footCount.textContent = '';
      return;
    }

    messages.forEach((msg) => {
      const isMine = currentUserId && msg.user_id === currentUserId;
      const card = document.createElement('article');
      card.className = 'msg';

      const actions = isMine
        ? `<div class="msg-actions"><button class="mini-btn" data-del="${escapeHtml(msg.id)}" type="button">삭제</button></div>`
        : '';

      card.innerHTML = `
        <div class="msg-head">
          <div class="msg-author">
            <span class="avatar">${escapeHtml(avatarChar(msg.author_name))}</span>
            <span>${escapeHtml(msg.author_name)}</span>
          </div>
          <span class="msg-time">${escapeHtml(formatTime(msg.created_at))}</span>
        </div>
        <div class="msg-content">${escapeHtml(msg.content)}</div>
        ${actions}
      `;

      // 삭제 버튼 이벤트 연결
      card.querySelector('[data-del]')?.addEventListener('click', () => deleteMessage(msg.id));
      listEl.appendChild(card);
    });

    footCount.textContent = `총 ${messages.length}개의 메시지`;
  }

  // ---- 데이터 ---- //
  async function loadMessages() {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const session = (await supabase.auth.getSession()).data.session;
      renderMessages(data, session?.user?.id);
    } catch (err) {
      listEl.innerHTML =
        '<div class="empty"><span class="big">⚠️</span>메시지를 불러오지 못했어요.<br />' +
        escapeHtml(err.message || err) + '</div>';
    } finally {
      loaderEl.style.display = 'none';
    }
  }

  async function postMessage() {
    const content = contentEl.value.trim();
    if (!content) {
      toast('메시지를 입력해주세요.', 'error');
      contentEl.focus();
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast('로그인이 필요합니다.', 'error');
      return;
    }

    const authorName = (session.user.email || '익명').split('@')[0] || '익명';

    submitBtn.disabled = true;
    try {
      const { error } = await supabase
        .from('messages')
        .insert([{ user_id: session.user.id, author_name: authorName, content }]);

      if (error) throw error;

      contentEl.value = '';
      countEl.textContent = '0';
      toast('방명록이 남겨졌습니다! 🎉', 'success');
      await loadMessages(); // 새 글 반영 (realtime 이벤트와 중복돼도 무해)
    } catch (err) {
      toast('작성 실패: ' + (err.message || err), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function deleteMessage(id) {
    if (!confirm('이 메시지를 삭제할까요?')) return;
    try {
      const { error } = await supabase.from('messages').delete().eq('id', id);
      if (error) throw error;
      toast('삭제되었습니다.', 'success');
      await loadMessages();
    } catch (err) {
      toast('삭제 실패: ' + (err.message || err), 'error');
    }
  }

  // ---- 실시간 구독 (다른 사용자가 남긴 글 즉시 반영) ---- //
  let channel = null;
  function subscribeRealtime() {
    try {
      channel = supabase
        .channel('messages-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages' },
          () => loadMessages()
        )
        .subscribe();
    } catch {
      // realtime이 꺼져 있어도 치명적이지 않음 — 새로고침 시 반영됨
    }
  }

  // ---- 로그인 상태에 따른 UI ---- //
  function applySession(session) {
    const loggedIn = Boolean(session?.user);

    userBox.style.display = loggedIn ? 'flex' : 'none';
    writeForm.style.display = loggedIn ? 'block' : 'none';
    loginCta.style.display = loggedIn ? 'none' : 'block';

    if (loggedIn) {
      userName.textContent = session.user.email || '사용자';
    }
  }

  // ---- 이벤트 ---- //
  contentEl.addEventListener('input', () => {
    countEl.textContent = contentEl.value.length;
    countEl.classList.toggle('over', contentEl.value.length > MAX_LEN);
  });

  writeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    postMessage();
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await supabase.auth.signOut();
      toast('로그아웃되었습니다.', 'success');
      setTimeout(() => location.reload(), 400);
    } catch (err) {
      toast('로그아웃 실패: ' + (err.message || err), 'error');
    }
  });

  // ---- 초기화 ---- //
  (async function init() {
    if (!supabase) return; // config 미설정 — supabase.js 가 안내 표시

    const { data: { session } } = await supabase.auth.getSession();
    applySession(session);

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    await loadMessages();
    subscribeRealtime();
  })();
})();
