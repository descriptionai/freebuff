// ============================================================
// Supabase 클라이언트 초기화
// config.js 가 먼저 로드되어 있어야 합니다.
// ============================================================
(function () {
  'use strict';

  const cfg = window.SUPABASE_CONFIG;

  function fatal(message) {
    const el = document.getElementById('setup-warning');
    if (el) {
      el.style.display = 'block';
      el.textContent = message;
    }
    console.error('[supabase]', message);
  }

  // 설정이 아직 채워지지 않았다면 안내만 표시하고 중단
  if (
    !cfg ||
    !cfg.url ||
    cfg.url.includes('PASTE_YOUR') ||
    !cfg.anonKey ||
    cfg.anonKey.includes('PASTE_YOUR')
  ) {
    fatal(
      '아직 Supabase 설정이 입력되지 않았습니다. ' +
        'js/config.js 에서 Project URL과 anon key를 채운 뒤 새로고침하세요. (README.md 참고)'
    );
    window.__supabase = null;
    return;
  }

  const { createClient } = window.supabase;
  window.__supabase = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  // 설정이 잘못된 경우 (URL 형식 오류 등) 빠르게 알려주기
  window.__supabase.auth.getSession().catch((err) => {
    fatal('Supabase 연결에 실패했습니다. js/config.js 의 URL/키를 확인하세요. (' + err.message + ')');
  });
})();
