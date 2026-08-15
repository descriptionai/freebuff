/* ============================================================
   다운/로드 (files.html)
   - 제목 + 첨부파일을 함께 저장하고, 저장된 항목의 첨부파일을 다운로드
   - 상단 80%: 저장된 항목 리스트
       · 각 항목 오른쪽 '-' → 확인 팝업 후 삭제
       · 제목 클릭 → 첨부파일 다운로드 팝업
   - 중간 10%: 제목 입력
   - 하단 10%: 업로드 개수(25%) · 찾기(25%) · 초기화(25%) · 저장(25%)
       · 업로드 개수 클릭 → 업로드할 파일 목록 팝업 (파일명 오른쪽 '-'로 개별 제외)
       · 찾기 → 파일 선택 창 → 업로드 목록에 추가
       · 초기화 → 확인 후 업로드할 파일 + 제목 삭제
       · 저장 → 제목 + 첨부파일 함께 저장
   - 드래그&드롭: 파일을 하단 영역(제목/업로드 바)에 놓으면 자동 첨부
   - 파일 본문: Supabase Storage (public 버킷 file-attachments)
     메타데이터: public.file_posts / public.file_items
   - node-navigation.html 의 iframe 오버레이로 열리며,
     "✕" 클릭 시 부모로 postMessage 를 보내 오버레이를 닫습니다.
   ============================================================ */
(function () {
  'use strict';

  const supabase = window.__supabase;
  const BUCKET = 'file-attachments';
  const MAX_FILES = 10; // 첨부파일 최대 개수

  const listEl = document.getElementById('post-list');
  const titleEl = document.getElementById('inp-title');
  const countBtn = document.getElementById('btn-count');
  const pickBtn = document.getElementById('btn-pick');
  const resetBtn = document.getElementById('btn-reset');
  const saveBtn = document.getElementById('btn-save');
  const fileInput = document.getElementById('file-input');
  const closeBtn = document.getElementById('btn-close');
  const modalEl = document.getElementById('modal');
  const toastEl = document.getElementById('toast');

  let queue = [];   // 업로드 대기 중인 파일 (File 객체)
  let posts = [];   // 저장된 항목 목록
  let saving = false;

  // innerHTML 에 넣기 전에 이스케이프
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' err' : '');
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------------- 팝업 (확인/취소 · 다운로드 · 업로드 목록) ---------------- */
  function closeModal() {
    modalEl.hidden = true;
    modalEl.innerHTML = '';
  }

  // actions: [{ text, cls, click }]  — cls: 'yes' | 'no'
  function openModal(titleHtml, bodyHtml, actions) {
    modalEl.innerHTML = '';
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const card = document.createElement('div');
    card.className = 'modal-card';
    if (titleHtml) {
      const h = document.createElement('h3');
      h.className = 'modal-title';
      h.innerHTML = titleHtml;
      card.appendChild(h);
    }
    if (bodyHtml) {
      const b = document.createElement('div');
      b.className = 'modal-body';
      b.innerHTML = bodyHtml;
      card.appendChild(b);
    }
    if (actions && actions.length) {
      const row = document.createElement('div');
      row.className = 'modal-actions';
      actions.forEach(function (a) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mbtn' + (a.cls ? ' ' + a.cls : '');
        btn.textContent = a.text;
        btn.addEventListener('click', function () { if (a.click) a.click(); });
        row.appendChild(btn);
      });
      card.appendChild(row);
    }
    bd.appendChild(card);
    // 배경을 눌러도 팝업은 닫히지 않음 — 반드시 버튼(확인/취소/닫기)으로만 닫기
    // 배경이 화면 전체를 덮으므로 뒤쪽 화면은 클릭/선택 불가
    modalEl.appendChild(bd);
    modalEl.hidden = false;
  }

  // 확인 팝업 (리스트 삭제 / 업로드 파일 제외 / 초기화 공통)
  function confirmMsg(title, msg, onYes) {
    openModal('<span class="mt-ico">⚠️</span> ' + esc(title),
      '<p class="modal-msg">' + msg + '</p>',
      [
        { text: '확인', cls: 'yes', click: function () { closeModal(); onYes(); } },
        { text: '취소', cls: 'no', click: closeModal }
      ]);
  }

  // 저장소 공개 URL (public 버킷 → URL만으로 다운로드 가능)
  function publicUrl(it) {
    if (!supabase) return '';
    try {
      let url = supabase.storage.from(BUCKET).getPublicUrl(it.storage_path).data.publicUrl;
      // 저장 경로는 영문 파일명이므로, 원본 파일명으로 다운로드되도록 ?download= 지정
      if (it.file_name) url += '?download=' + encodeURIComponent(it.file_name);
      return url;
    } catch (e) {
      return '';
    }
  }

  /* ---------------- 제목 클릭 → 첨부파일 다운로드 팝업 ---------------- */
  function showDownload(post) {
    const items = post.items || [];
    if (!items.length) { toast('첨부파일이 없습니다.', true); return; }
    const rows = items.map(function (it) {
      return '<a class="dl-row" href="' + esc(publicUrl(it)) + '" target="_blank" rel="noopener" title="다운로드">' +
        '<span class="dl-ico">⬇️</span>' +
        '<span class="dl-name">' + esc(it.file_name) + '</span>' +
        '<span class="dl-size">' + esc(fmtSize(it.size)) + '</span>' +
        '</a>';
    }).join('');
    openModal('<span class="mt-ico">📥</span> ' + esc(post.title),
      '<p class="modal-sub">첨부파일 ' + items.length + '개 — 클릭하면 다운로드됩니다.</p>' +
      '<div class="dl-list">' + rows + '</div>',
      [{ text: '닫기', cls: 'no', click: closeModal }]);
  }

  /* ---------------- 업로드 개수 클릭 → 업로드할 파일 목록 팝업 (개별 제외) ---------------- */
  function showQueue() {
    if (!queue.length) {
      toast('업로드할 첨부파일이 없습니다. (찾기 또는 드래그&드롭)', true);
      return;
    }
    const rows = queue.map(function (f, i) {
      return '<div class="q-row">' +
        '<span class="q-name" title="' + esc(f.name) + '">' + esc(f.name) +
        ' <em>' + esc(fmtSize(f.size)) + '</em></span>' +
        '<button type="button" class="mini-x" data-idx="' + i + '" title="업로드 목록에서 제외">−</button>' +
        '</div>';
    }).join('');
    openModal('<span class="mt-ico">📎</span> 업로드할 첨부파일 ' + queue.length + '/' + MAX_FILES + '개',
      '<div class="q-list">' + rows + '</div>',
      [{ text: '닫기', cls: 'no', click: closeModal }]);
    // 개별 제외: 파일명 오른쪽 '-' → 확인 후 목록에서 제거
    Array.prototype.forEach.call(modalEl.querySelectorAll('.q-row .mini-x'), function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.dataset.idx);
        const f = queue[idx];
        if (!f) return;
        confirmMsg('첨부파일 제외', "'" + esc(f.name) + "' 파일을 업로드 목록에서 제외할까요?", function () {
          queue.splice(idx, 1);
          renderCount();
          showQueue(); // 갱신된 목록 다시 표시
        });
      });
    });
  }

  function renderCount() {
    countBtn.textContent = '📎 ' + queue.length + '/' + MAX_FILES + '개';
    countBtn.title = queue.length
      ? '업로드할 첨부파일 목록 보기 (' + queue.length + '/' + MAX_FILES + '개)'
      : '업로드할 첨부파일이 없습니다 (찾기 또는 드래그&드롭)';
  }

  /* ---------------- 상단 리스트 (80%) 렌더링 ---------------- */
  function renderList() {
    listEl.innerHTML = '';
    if (!posts.length) {
      listEl.innerHTML =
        '<div class="list-empty">📂 저장된 첨부파일이 없습니다.<br/>' +
        '제목과 파일을 넣고 <b>저장</b>을 누르면 이곳에 표시됩니다.</div>';
      return;
    }
    posts.forEach(function (post) {
      const row = document.createElement('div');
      row.className = 'post-row';
      row.innerHTML =
        '<div class="post-info">' +
        '<button type="button" class="post-title" title="클릭하면 첨부파일 다운로드">' + esc(post.title) + '</button>' +
        '<span class="post-meta">첨부 ' + (post.items ? post.items.length : 0) + '개 · ' + esc(fmtDate(post.created_at)) + '</span>' +
        '</div>' +
        '<button type="button" class="mini-x" title="이 항목 삭제">−</button>';
      row.querySelector('.post-title').addEventListener('click', function () { showDownload(post); });
      row.querySelector('.mini-x').addEventListener('click', function () {
        confirmMsg('항목 삭제', "'" + esc(post.title) + "' 항목을 삭제할까요?<br/>첨부파일도 함께 삭제됩니다.", function () {
          deletePost(post);
        });
      });
      listEl.appendChild(row);
    });
  }

  /* ---------------- 항목 삭제 (DB 행 + Storage 파일) ---------------- */
  function deletePost(post) {
    if (!supabase) { toast('Supabase 설정이 없어 삭제할 수 없습니다.', true); return; }
    const paths = (post.items || []).map(function (it) { return it.storage_path; });
    supabase.from('file_posts').delete().eq('id', post.id)
      .then(function (res) {
        if (res.error) throw res.error;
        // file_items 는 외래키 cascade 로 함께 삭제 — Storage 파일만 별도 정리
        if (paths.length) {
          return supabase.storage.from(BUCKET).remove(paths).catch(function () { /* 실패해도 치명적이지 않음 */ });
        }
      })
      .then(function () { toast('삭제되었습니다.'); load(); })
      .catch(function (err) { toast('삭제 실패: ' + (err.message || err), true); });
  }

  /* ---------------- 파일 추가 (찾기/드래그&드롭 공통) ---------------- */
  function addFiles(files) {
    const list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    // 같은 파일(이름+크기)이 이미 업로드 목록에 있으면 중복 제외
    const added = list.filter(function (f) {
      return !queue.some(function (q) { return q.name === f.name && q.size === f.size; });
    });
    if (!added.length) { toast('이미 추가된 파일입니다.', true); return; }
    // 10개 제한: 이번 추가로 개수를 넘기면 일부만 넣지 않고 추가 동작 전체를 취소
    if (queue.length + added.length > MAX_FILES) {
      toast('첨부파일은 최대 ' + MAX_FILES + '개까지입니다. (' +
        (MAX_FILES - queue.length) + '개 자리만 남아 있어 추가를 취소했습니다.)', true);
      return;
    }
    queue = queue.concat(added);
    renderCount();
    toast(added.length + '개 첨부됨' + (added.length !== list.length ? ' (중복 제외)' : ''));
  }

  /* ---------------- 저장 (제목 + 첨부파일 함께) ---------------- */
  function save() {
    const title = titleEl.value.trim();
    if (!title) { toast('제목을 입력하세요.', true); titleEl.focus(); return; }
    if (!queue.length) { toast('업로드할 첨부파일을 추가하세요.', true); return; }
    if (!supabase) { toast('Supabase 설정이 없어 저장할 수 없습니다.', true); return; }
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';

    const paths = [];
    // 1) 파일 본문을 Storage 에 먼저 업로드 → 2) 메타데이터(제목+첨부 목록)를 DB 에 저장
    const uploadAll = function (i) {
      if (i >= queue.length) {
        return supabase.from('file_posts')
          .insert([{ title: title, file_count: queue.length }])
          .select('id')
          .then(function (res) {
            if (res.error) throw res.error;
            const postId = res.data[0].id;
            const items = queue.map(function (f, k) {
              return { post_id: postId, file_name: f.name, storage_path: paths[k], size: f.size };
            });
            return supabase.from('file_items').insert(items).then(function (r) {
              if (r.error) throw r.error;
            });
          })
          .then(function () {
            const n = queue.length;
            queue = [];
            titleEl.value = '';
            renderCount();
            toast('저장되었습니다 (' + n + '개).');
            load();
          });
      }
      const f = queue[i];
      // 저장 시점마다 고유 폴더명 사용 → 같은 이름의 파일도 충돌 없이 저장
      const folder = 'post-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      // 한글 등 S3 키에 허용되지 않는 문자가 파일명에 있으면 업로드 경로만 영문으로 교체
      // (표시/다운로드명은 아래 file_items.file_name 에 원본을 그대로 저장)
      const extMatch = f.name.match(/\.([A-Za-z0-9]{1,10})$/);
      const ext = extMatch ? '.' + extMatch[1] : '';
      const path = folder + '/' + 'file-' + (i + 1) + ext;
      paths.push(path);
      return supabase.storage.from(BUCKET).upload(path, f, { upsert: false }).then(function (r) {
        if (r.error) throw r.error;
        return uploadAll(i + 1);
      });
    };

    uploadAll(0)
      .catch(function (err) {
        toast('저장 실패: ' + (err.message || err), true);
        // 일부만 올라간 경우 정리
        if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(function () {});
      })
      .finally(function () {
        saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
      });
  }

  /* ---------------- 초기화 (업로드할 파일 + 제목 삭제) ---------------- */
  function reset() {
    const n = queue.length;
    const hasTitle = !!titleEl.value.trim();
    if (!n && !hasTitle) { toast('초기화할 내용이 없습니다.'); return; }
    confirmMsg('초기화', '업로드할 첨부파일 <b>' + n + '개</b>와 제목을 모두 삭제할까요?', function () {
      queue = [];
      titleEl.value = '';
      renderCount();
      toast('초기화되었습니다.');
      titleEl.focus();
    });
  }

  /* ---------------- 데이터 로드 / 실시간 구독 ---------------- */
  function load() {
    if (!supabase) { renderList(); return; }
    supabase.from('file_posts')
      .select('id, title, file_count, created_at, file_items(id, file_name, storage_path, size)')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(function (res) {
        if (res.error) throw res.error;
        posts = (res.data || []).map(function (p) {
          return { id: p.id, title: p.title, created_at: p.created_at, items: p.file_items || [] };
        });
        renderList();
      })
      .catch(function (err) {
        listEl.innerHTML = '<div class="list-empty">⚠️ 목록을 불러오지 못했습니다.<br/>' + esc(err.message || err) + '</div>';
      });
  }

  function subscribe() {
    if (!supabase) return;
    try {
      supabase.channel('file-posts-changes')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'file_posts' },
          function () { load(); })
        .subscribe();
    } catch (e) {
      // realtime 이 꺼져 있어도 치명적이지 않음 — 새로고침 시 반영됨
    }
  }

  /* ---------------- 닫기 (chat.html 과 동일 패턴) ---------------- */
  function close() {
    if (window.parent && window.parent !== window) {
      try {
        const pd = window.parent.document;
        const ov = pd.getElementById('files-overlay');
        if (ov) {
          ov.hidden = true;
          pd.body.style.overflow = '';
          return;
        }
      } catch (e) { /* 교차 출처 — 아래 postMessage 로 처리 */ }
      try { window.parent.postMessage({ type: 'close-files' }, '*'); } catch (e) { /* 무시 */ }
    } else {
      location.href = 'node-navigation.html';
    }
  }

  /* ---------------- 이벤트 ---------------- */
  pickBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  countBtn.addEventListener('click', showQueue);
  resetBtn.addEventListener('click', reset);
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', close);

  // Esc: 팝업이 열려 있으면 팝업부터 닫고, 아니면 화면(오버레이) 닫기
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!modalEl.hidden) closeModal();
    else close();
  });

  // 드래그&드롭: 하단 영역(제목/업로드 바)에 놓으면 자동 첨부
  const dropZone = document.getElementById('bottom-zone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });

  /* ---------------- 초기화 ---------------- */
  renderCount();
  load();
  subscribe();
})();
