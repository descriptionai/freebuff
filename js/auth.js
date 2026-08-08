// ============================================================
// 로그인 / 회원가입 로직
// ============================================================
(function () {
  'use strict';

  const supabase = window.__supabase;

  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const form = document.getElementById('auth-form');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');
  const submitBtn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');

  let mode = 'login'; // 'login' | 'signup'

  function showAlert(message, type) {
    alertEl.className = 'alert ' + type;
    alertEl.textContent = message;
    alertEl.style.display = 'block';
  }

  function setMode(next) {
    mode = next;
    tabLogin.classList.toggle('active', mode === 'login');
    tabSignup.classList.toggle('active', mode === 'signup');
    submitBtn.textContent = mode === 'login' ? '로그인' : '가입하기';
    passwordEl.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    alertEl.style.display = 'none';
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const email = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;

    if (!email || !password) {
      showAlert('이메일과 비밀번호를 모두 입력해주세요.', 'error');
      return;
    }
    if (password.length < 6) {
      showAlert('비밀번호는 6자 이상이어야 합니다.', 'error');
      return;
    }

    submitBtn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.href = 'index.html';
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) {
          // 이메일 확인을 끈 상태면 바로 로그인됨
          location.href = 'index.html';
        } else {
          // 기본 설정(이메일 확인 켜짐) — 확인 메일 발송됨
          // 주의: setMode()가 alert를 숨기므로 반드시 먼저 호출한다.
          setMode('login');
          showAlert(
            '확인 메일을 보냈습니다 📧\n이메일의 링크를 클릭해 계정을 확인한 뒤 로그인해주세요.\n\n' +
            '(테스트를 위해 바로 로그인하고 싶다면 Supabase 대시보드 → Authentication → Providers → Email에서 ' +
            '"Confirm email"을 끄세요)',
            'success'
          );
        }
      }
    } catch (err) {
      showAlert('오류: ' + (err.message || err), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  }

  tabLogin.addEventListener('click', () => setMode('login'));
  tabSignup.addEventListener('click', () => setMode('signup'));
  form.addEventListener('submit', handleSubmit);

  // 이미 로그인 상태라면 바로 방명록으로
  (async function () {
    if (!supabase) return; // config 미설정
    const { data: { session } } = await supabase.auth.getSession();
    if (session) location.replace('index.html');
  })();
})();
