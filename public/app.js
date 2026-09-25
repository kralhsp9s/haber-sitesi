let currentTab = 'post';
let globalMediaList = [];
let deferredInstallPrompt = null;


/* =========================================================
   SERVICE WORKER
========================================================= */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('[SW] Service Worker aktif'))
    .catch(err => console.error('[SW] Hata:', err));
}


/* =========================================================
   DOM READY
========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  initTheme();

  // Login kontrolünü başlat
  checkAuth();

  // Login
  document
    .getElementById('login-form')
    ?.addEventListener('submit', handleLogin);

  // Logout
  document
    .getElementById('btn-logout')
    ?.addEventListener('click', logout);

  // Profile
  document
    .getElementById('add-profile-form')
    ?.addEventListener('submit', addProfile);

  document
    .getElementById('btn-resolve-user')
    ?.addEventListener('click', resolveInstagramUser);

  // Sync
  document
    .getElementById('btn-sync')
    ?.addEventListener('click', syncAll);

  // Notifications
  document
    .getElementById('btn-notifications')
    ?.addEventListener('click', enableNotifications);

  // Install
  document
    .getElementById('btn-install')
    ?.addEventListener('click', openInstallModal);

  document
    .getElementById('close-install-modal')
    ?.addEventListener('click', closeInstallModal);

  document
    .getElementById('confirm-install')
    ?.addEventListener('click', confirmInstall);

  // Main menu
  document
    .getElementById('btn-open-dashboard')
    ?.addEventListener('click', () => showMainPage('dashboard'));

  document
    .getElementById('btn-open-eval')
    ?.addEventListener('click', () => showMainPage('eval'));

  // Eval
  document
    .getElementById('btn-eval-run')
    ?.addEventListener('click', runEval);

  document
    .getElementById('btn-eval-sourcebin')
    ?.addEventListener('click', uploadEvalToSourcebin);

  document
    .getElementById('btn-eval-txt')
    ?.addEventListener('click', downloadEvalTxt);

  document
    .getElementById('btn-eval-copy')
    ?.addEventListener('click', copyEvalOutput);

  document
    .getElementById('btn-eval-clear')
    ?.addEventListener('click', clearEval);

  // Theme
  document
    .getElementById('btn-theme')
    ?.addEventListener('click', () => {
      document
        .getElementById('theme-menu')
        ?.classList.toggle('hidden');
    });

  document
    .querySelectorAll('[data-theme]')
    .forEach(btn => {
      btn.addEventListener('click', () => {
        setTheme(btn.dataset.theme);
      });
    });


  /* =======================================================
     API MODAL
  ======================================================== */

  const modal = document.getElementById('api-modal');

  document
    .getElementById('btn-api-key')
    ?.addEventListener('click', async () => {

      try {

        const res = await fetch('/api/settings', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        });

        const data = await safeJson(res);

        if (!res.ok) {
          return alert(
            data.error ||
            data.message ||
            'Ayarlar alınamadı.'
          );
        }

        document.getElementById('modal-api-key').value =
          data.apiKey || '';

        document.getElementById('modal-api-host').value =
          data.apiHost || '';

        document.getElementById('modal-api-path').value =
          data.apiPath || '/user_medias';

        document.getElementById('modal-user-path').value =
          data.userLookupPath || '/search_user';

        document.getElementById('modal-story-path').value =
          data.storyPath || '';

        document.getElementById('modal-sourcebin-url').value =
          data.sourcebinUrl || 'https://sourceb.in/api';

        modal?.classList.remove('hidden');

      } catch (error) {
        console.error('[API SETTINGS]', error);
        alert('Ayarlar alınırken hata oluştu.');
      }

    });


  document
    .getElementById('close-modal')
    ?.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });


  document
    .getElementById('save-api-key')
    ?.addEventListener('click', saveApiSettings);


  /* =======================================================
     PWA INSTALL
  ======================================================== */

  window.addEventListener('beforeinstallprompt', e => {

    e.preventDefault();

    deferredInstallPrompt = e;

  });


  window.addEventListener('appinstalled', () => {

    deferredInstallPrompt = null;

  });

});


/* =========================================================
   SAFE JSON
========================================================= */

async function safeJson(res) {

  const text = await res.text();

  try {

    return text
      ? JSON.parse(text)
      : {};

  } catch {

    return {
      error: text || `HTTP ${res.status}`
    };

  }

}


/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(e) {

  e.preventDefault();

  const form = e.currentTarget;

  const btn =
    e.submitter ||
    form?.querySelector('button[type="submit"]');

  const usernameInput =
    document.getElementById('username');

  const passwordInput =
    document.getElementById('password');


  if (!usernameInput || !passwordInput) {

    alert('Login alanları bulunamadı.');

    return;

  }


  const username =
    usernameInput.value.trim();

  const password =
    passwordInput.value;


  if (!username || !password) {

    alert('Kullanıcı adı ve şifreyi girin.');

    return;

  }


  const oldText =
    btn ? btn.innerHTML : 'Giriş Yap';


  if (btn) {

    btn.disabled = true;

    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Giriş yapılıyor...';

  }


  try {

    console.log('[LOGIN] Giriş isteği gönderiliyor...');


    const res = await fetch('/api/login', {

      method: 'POST',

      credentials: 'same-origin',

      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },

      body: JSON.stringify({
        username,
        password
      })

    });


    const data =
      await safeJson(res);


    console.log(
      '[LOGIN] Sunucu cevabı:',
      res.status,
      data
    );


    if (!res.ok || data.success !== true) {

      throw new Error(
        data.message ||
        data.error ||
        'Kullanıcı adı veya şifre hatalı.'
      );

    }


    /*
      Login başarılı.
      Session'ın gerçekten oluşup oluşmadığını
      auth-check ile kontrol ediyoruz.
    */

    const authenticated =
      await checkAuth();


    if (!authenticated) {

      throw new Error(
        'Giriş başarılı görünüyor ancak oturum oluşturulamadı. Sayfayı yenileyip tekrar deneyin.'
      );

    }


  } catch (err) {

    console.error('[LOGIN ERROR]', err);

    alert(
      err.message ||
      'Giriş yapılamadı.'
    );

  } finally {

    if (btn) {

      btn.disabled = false;

      btn.innerHTML = oldText;

    }

  }

}


/* =========================================================
   AUTH CHECK
========================================================= */

async function checkAuth() {

  try {

    console.log('[AUTH] Oturum kontrol ediliyor...');


    const res = await fetch('/api/auth-check', {

      method: 'GET',

      credentials: 'same-origin',

      cache: 'no-store',

      headers: {
        'Accept': 'application/json'
      }

    });


    const data =
      await safeJson(res);


    console.log(
      '[AUTH] Cevap:',
      res.status,
      data
    );


    const loginScreen =
      document.getElementById('login-screen');

    const dashboard =
      document.getElementById('app-dashboard');


    if (!loginScreen || !dashboard) {

      console.error(
        '[AUTH] Login veya dashboard elementi bulunamadı.'
      );

      return false;

    }


    const authenticated =
      data.authenticated === true;


    /*
      Giriş yapılmışsa:
      Login ekranını gizle
      Dashboard'u göster
    */

    if (authenticated) {

      loginScreen.classList.add('hidden');

      dashboard.classList.remove('hidden');


      /*
        Dashboard verilerini yükle.
        Buradaki API'lardan biri hata verse bile
        kullanıcı dashboard'dan atılmasın.
      */

      try {
        await loadDashboardData();
      } catch (error) {
        console.error(
          '[DASHBOARD LOAD]',
          error
        );
      }


      try {
        await updateNotificationButton();
      } catch (error) {
        console.error(
          '[NOTIFICATION]',
          error
        );
      }


      return true;

    }


    /*
      Giriş yapılmamışsa
    */

    loginScreen.classList.remove('hidden');

    dashboard.classList.add('hidden');


    return false;


  } catch (error) {

    console.error(
      '[AUTH CHECK ERROR]',
      error
    );


    document
      .getElementById('login-screen')
      ?.classList.remove('hidden');


    document
      .getElementById('app-dashboard')
      ?.classList.add('hidden');


    return false;

  }

}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

  try {

    await fetch('/api/logout', {

      method: 'POST',

      credentials: 'same-origin'

    });

  } catch (error) {

    console.error(
      '[LOGOUT]',
      error
    );

  } finally {

    /*
      Formu temizle
    */

    document.getElementById('password').value = '';

    /*
      Login ekranına dön
    */

    await checkAuth();

  }

}


/* =========================================================
   RESOLVE INSTAGRAM USER
========================================================= */

async function resolveInstagramUser() {

  const input =
    document.getElementById('target-username');

  const idInput =
    document.getElementById('target-userid');

  const btn =
    document.getElementById('btn-resolve-user');

  const status =
    document.getElementById('resolve-status');


  const username =
    input.value.trim().replace(/^@/, '');


  if (!username) {

    return alert(
      'Önce Instagram kullanıcı adını yazın.'
    );

  }


  const old =
    btn.innerHTML;


  btn.disabled = true;

  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Bulunuyor...';


  try {

    const res =
      await fetch(
        `/api/instagram/resolve-user?username=${encodeURIComponent(username)}`,
        {
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );


    const data =
      await safeJson(res);


    if (!res.ok) {

      throw new Error(
        data.error ||
        data.message ||
        'ID bulunamadı.'
      );

    }


    idInput.value =
      data.userId || '';


    status.textContent =
      `✓ @${data.username || username} bulundu`;

    status.className =
      'text-xs text-emerald-400';


  } catch (err) {

    idInput.value = '';

    status.textContent =
      err.message;

    status.className =
      'text-xs text-rose-400';


  } finally {

    btn.disabled = false;

    btn.innerHTML = old;

  }

}


/* =========================================================
   ADD PROFILE
========================================================= */

async function addProfile(e) {

  e.preventDefault();


  const username =
    document
      .getElementById('target-username')
      .value
      .trim()
      .replace(/^@/, '');


  const userId =
    document
      .getElementById('target-userid')
      .value
      .trim();


  if (!userId) {

    return alert(
      'Önce "ID Bul" ile Instagram ID değerini bulun.'
    );

  }


  try {

    const res =
      await fetch('/api/profiles', {

        method: 'POST',

        credentials: 'same-origin',

        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },

        body: JSON.stringify({
          username,
          userId
        })

      });


    const data =
      await safeJson(res);


    if (!res.ok) {

      return alert(
        data.error ||
        data.message ||
        'Profil eklenemedi.'
      );

    }


    e.target.reset();

    document
      .getElementById('resolve-status')
      .textContent = '';


    await loadDashboardData();


  } catch (error) {

    console.error(
      '[ADD PROFILE]',
      error
    );

    alert(
      'Profil eklenirken hata oluştu.'
    );

  }

}


/* =========================================================
   SYNC ALL
========================================================= */

async function syncAll() {

  const btn =
    document.getElementById('btn-sync');


  if (!btn) return;


  const old =
    btn.innerHTML;


  btn.disabled = true;

  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Senkronize ediliyor...';


  try {

    const res =
      await fetch('/api/sync-now', {

        method: 'POST',

        credentials: 'same-origin'

      });


    const data =
      await safeJson(res);


    if (!res.ok) {

      alert(
        data.error ||
        data.message ||
        'Senkronizasyon başarısız.'
      );
    } else {
      alert(data.message || 'Manuel yenileme tamamlandı.');
    }


  } catch (error) {

    console.error(
      '[SYNC]',
      error
    );

    alert(
      'Senkronizasyon sırasında hata oluştu.'
    );

  } finally {

    btn.disabled = false;

    btn.innerHTML = old;

    await loadDashboardData();

  }

}


/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboardData() {

  await Promise.allSettled([

    loadProfiles(),

    loadMedia(),

    loadLogs()

  ]);

}


/* =========================================================
   PROFILES
========================================================= */

async function loadProfiles() {

  try {

    const res =
      await fetch('/api/profiles', {

        credentials: 'same-origin',

        cache: 'no-store'

      });


    const profiles =
      await safeJson(res);


    if (!res.ok) return;


    const count =
      document.getElementById('profile-count');

    const list =
      document.getElementById('profile-list');


    if (!Array.isArray(profiles)) return;


    if (count) {
      count.innerText =
        profiles.length;
    }


    if (!list) return;


    list.innerHTML =
      profiles.map(p => `

        <div class="profile-item">

          <div class="flex items-center justify-between gap-2">

            <div>

              <div class="font-bold">
                @${escapeHtml(p.username)}
              </div>

              <div class="muted">
                ID: ${escapeHtml(p.userId)}
              </div>

            </div>

            <button
              onclick="toggleMute('${escapeAttr(p.id)}')"
              class="icon-btn ${p.muted ? 'warning' : ''}"
            >

              <i class="fa-solid ${
                p.muted
                  ? 'fa-bell-slash'
                  : 'fa-bell'
              }"></i>

            </button>

          </div>

          <button
            onclick="syncProfile500('${escapeAttr(p.id)}', this)"
            class="secondary-btn w-full mt-2"
          >

            <i class="fa-solid fa-box-archive"></i>
            Son 500'ü çek

          </button>

        </div>

      `).join('') ||

      '<div class="empty-state">Henüz profil eklenmedi.</div>';


  } catch (error) {

    console.error(
      '[LOAD PROFILES]',
      error
    );

  }

}


/* =========================================================
   MUTE
========================================================= */

async function toggleMute(id) {

  try {

    await fetch(
      `/api/profiles/${encodeURIComponent(id)}/toggle-mute`,
      {
        method: 'PATCH',
        credentials: 'same-origin'
      }
    );


    await loadProfiles();


  } catch (error) {

    console.error(
      '[TOGGLE MUTE]',
      error
    );

  }

}


window.toggleMute =
  toggleMute;


/* =========================================================
   SYNC PROFILE 500
========================================================= */

window.syncProfile500 =
  async function(id, btn) {

    const old =
      btn.innerHTML;


    btn.disabled = true;

    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Çekiliyor...';


    try {

      const res =
        await fetch(
          `/api/profiles/${encodeURIComponent(id)}/sync-500`,
          {
            method: 'POST',
            credentials: 'same-origin'
          }
        );


      const data =
        await safeJson(res);


      if (!res.ok) {

        alert(
          data.error ||
          data.message ||
          'İşlem başarısız.'
        );

      } else {

        alert(
          `${data.checked || 0} içerik kontrol edildi, ` +
          `${data.added || 0} yeni içerik eklendi.`
        );

      }


      await loadDashboardData();


    } catch (error) {

      console.error(
        '[SYNC 500]',
        error
      );

      alert(
        'İçerikler alınırken hata oluştu.'
      );


    } finally {

      btn.disabled = false;

      btn.innerHTML = old;

    }

  };


/* =========================================================
   MEDIA
========================================================= */

async function loadMedia() {

  try {

    const res =
      await fetch('/api/media', {

        credentials: 'same-origin',

        cache: 'no-store'

      });


    const data =
      await safeJson(res);


    if (!res.ok) return;


    globalMediaList =
      Array.isArray(data)
        ? data
        : [];


    renderMedia(currentTab);


  } catch (error) {

    console.error(
      '[LOAD MEDIA]',
      error
    );

  }

}


/* =========================================================
   TABS
========================================================= */

window.switchTab =
  function(tab) {

    currentTab =
      tab;


    ['post', 'reel', 'story']
      .forEach(t => {

        const element =
          document.getElementById(`tab-${t}`);

        if (!element) return;


        element.classList.toggle(
          'active-tab',
          t === tab
        );

      });


    renderMedia(tab);

  };


/* =========================================================
   RENDER MEDIA
========================================================= */

function renderMedia(type) {

  const container =
    document.getElementById('media-grid');


  if (!container) return;


  const filtered =
    globalMediaList

      .filter(m => m.type === type)

      .sort(
        (a, b) =>
          new Date(
            b.takenAt ||
            b.timestamp ||
            0
          ) -
          new Date(
            a.takenAt ||
            a.timestamp ||
            0
          )
      );


  if (!filtered.length) {

    container.innerHTML =
      '<div class="col-span-3 empty-state py-16">' +
      'Bu kategoride arşivlenmiş içerik yok.' +
      '</div>';

    return;

  }


  container.innerHTML =
    filtered.map(m => `

      <article class="media-card">

        ${
          m.url

            ? `<img
                src="${escapeAttr(m.url)}"
                loading="lazy"
                alt="${escapeAttr(m.accessibilityCaption || m.caption || "Instagram medya")}"
              >`

            : `<div class="media-no-image">
                <i class="fa-regular fa-image"></i>
              </div>`
        }


        ${
          m.type === 'reel'

            ? `<span class="media-type">
                <i class="fa-solid fa-play"></i>
              </span>`

            : m.type === 'story'

              ? `<span class="media-type">
                  <i class="fa-solid fa-circle"></i>
                </span>`

              : ''
        }


        <div class="media-overlay">

          <div class="media-stats">

            <span>
              <i class="fa-solid fa-heart"></i>
              ${m.likes || 0}
            </span>

            <span>
              <i class="fa-solid fa-comment"></i>
              ${m.comments || 0}
            </span>

            ${
              m.viewCount !== null &&
              m.viewCount !== undefined
                ? `<span>
                    <i class="fa-solid fa-eye"></i>
                    ${m.viewCount || 0}
                  </span>`
                : ''
            }

          </div>


          <div class="caption">
            ${escapeHtml(
              m.caption ||
              'Açıklama yok'
            )}
          </div>


          <div class="media-actions">

            <span>
              @${escapeHtml(
                m.profileUsername ||
                ''
              )}
            </span>


            <a
              class="download-btn"
              href="/api/media/${encodeURIComponent(m.id)}/download"
            >

              <i class="fa-solid fa-download"></i>
              İndir

            </a>

          </div>

        </div>

      </article>

    `).join('');

}


/* =========================================================
   LOGS
========================================================= */

async function loadLogs() {

  try {

    const res =
      await fetch('/api/logs', {

        credentials: 'same-origin',

        cache: 'no-store'

      });


    const logs =
      await safeJson(res);


    if (!res.ok || !Array.isArray(logs)) {
      return;
    }


    const container =
      document.getElementById('log-list');


    if (!container) return;


    container.innerHTML =
      logs.map(l => `

        <div class="log-item">

          <div class="flex justify-between text-[10px] muted">

            <span class="text-rose-400">
              [${escapeHtml(l.type)}]
            </span>

            <span>
              ${escapeHtml(l.timestamp)}
            </span>

          </div>

          <div>
            ${escapeHtml(l.message)}
          </div>

        </div>

      `).join('');


  } catch (error) {

    console.error(
      '[LOAD LOGS]',
      error
    );

  }

}


/* =========================================================
   NOTIFICATIONS
========================================================= */

async function updateNotificationButton() {

  const btn =
    document.getElementById(
      'btn-notifications'
    );


  if (
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  ) {

    btn?.classList.add('hidden');

    return;

  }


  btn?.classList.remove('hidden');


  if (!btn) return;


  btn.innerHTML =
    Notification.permission === 'granted'
      ? '<i class="fa-solid fa-bell"></i><span>Bildirim Açık</span>'
      : '<i class="fa-regular fa-bell"></i><span>Bildirim</span>';

}


/* =========================================================
   ENABLE NOTIFICATIONS
========================================================= */

async function enableNotifications() {

  if (
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  ) {

    return alert(
      'Bu tarayıcı bildirimleri desteklemiyor.'
    );

  }


  try {

    if (Notification.permission !== 'granted') {

      const permission =
        await Notification.requestPermission();


      if (permission !== 'granted') {

        return alert(
          'Bildirim izni verilmedi.'
        );

      }

    }


    const keyRes =
      await fetch(
        '/api/push/public-key',
        {
          credentials: 'same-origin'
        }
      );


    const keyData =
      await safeJson(keyRes);


    if (!keyRes.ok) {

      throw new Error(
        keyData.error ||
        'Push anahtarı alınamadı.'
      );

    }


    const registration =
      await navigator.serviceWorker.ready;


    let sub =
      await registration.pushManager.getSubscription();


    if (!sub) {

      sub =
        await registration.pushManager.subscribe({

          userVisibleOnly: true,

          applicationServerKey:
            urlBase64ToUint8Array(
              keyData.publicKey
            )

        });

    }


    const save =
      await fetch(
        '/api/push/subscribe',
        {

          method: 'POST',

          credentials: 'same-origin',

          headers: {
            'Content-Type': 'application/json'
          },

          body: JSON.stringify(sub)

        }
      );


    if (!save.ok) {

      const error =
        await safeJson(save);

      throw new Error(
        error.error ||
        'Abonelik kaydedilemedi.'
      );

    }


    await fetch(
      '/api/push/test',
      {
        method: 'POST',
        credentials: 'same-origin'
      }
    );


    await updateNotificationButton();


    alert(
      'Bildirimler açıldı. Test bildirimi gönderildi.'
    );


  } catch (e) {

    console.error(
      '[NOTIFICATION]',
      e
    );

    alert(
      `Bildirim kurulamadı: ${e.message}`
    );

  }

}


/* =========================================================
   INSTALL APP
========================================================= */


function openInstallModal() {
  document
    .getElementById('install-modal')
    ?.classList.remove('hidden');
}

function closeInstallModal() {
  document
    .getElementById('install-modal')
    ?.classList.add('hidden');
}

async function confirmInstall() {
  closeInstallModal();

  if (!deferredInstallPrompt) {
    return showInstallHelp();
  }

  try {
    deferredInstallPrompt.prompt();

    const choice =
      await deferredInstallPrompt.userChoice;

    if (choice?.outcome !== 'accepted') {
      console.log('[PWA] Kurulum iptal edildi.');
    }

    deferredInstallPrompt = null;
  } catch (error) {
    console.error('[PWA INSTALL]', error);
    showInstallHelp();
  }
}

function showInstallHelp() {
  const isIOS =
    /iphone|ipad|ipod/i.test(
      navigator.userAgent
    );

  if (isIOS) {
    alert(
      'iPhone/iPad: Safari paylaş menüsüne dokunup "Ana Ekrana Ekle" seçeneğini kullanın.'
    );
    return;
  }

  alert(
    'Tarayıcı otomatik kurulum penceresini desteklemiyorsa tarayıcı menüsünden "Ana ekrana ekle" veya "Uygulamayı yükle" seçeneğini kullanabilirsiniz.'
  );
}


/* =========================================================
   API SETTINGS
========================================================= */

async function saveApiSettings() {

  try {

    const body = {

      apiKey:
        document.getElementById(
          'modal-api-key'
        ).value.trim(),

      apiHost:
        document.getElementById(
          'modal-api-host'
        ).value.trim(),

      apiPath:
        document.getElementById(
          'modal-api-path'
        ).value.trim(),

      userLookupPath:
        document.getElementById(
          'modal-user-path'
        ).value.trim(),

      storyPath:
        document.getElementById(
          'modal-story-path'
        ).value.trim(),

      sourcebinUrl:
        document.getElementById(
          'modal-sourcebin-url'
        ).value.trim()

    };


    const res =
      await fetch('/api/settings', {

        method: 'POST',

        credentials: 'same-origin',

        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },

        body: JSON.stringify(body)

      });


    const data =
      await safeJson(res);


    if (!res.ok) {

      return alert(
        data.error ||
        data.message ||
        'Kaydedilemedi.'
      );

    }


    document
      .getElementById('api-modal')
      ?.classList.add('hidden');


    alert(
      'API ayarları kaydedildi.'
    );


  } catch (error) {

    console.error(
      '[API SETTINGS SAVE]',
      error
    );

    alert(
      'API ayarları kaydedilirken hata oluştu.'
    );

  }

}



/* =========================================================
   PAGE NAVIGATION
========================================================= */

function showMainPage(page) {
  const dashboard =
    document.getElementById('dashboard-page');
  const evalPage =
    document.getElementById('eval-page');

  const dashboardBtn =
    document.getElementById('btn-open-dashboard');
  const evalBtn =
    document.getElementById('btn-open-eval');

  const showEval = page === 'eval';

  dashboard?.classList.toggle(
    'hidden',
    showEval
  );

  evalPage?.classList.toggle(
    'hidden',
    !showEval
  );

  dashboardBtn?.classList.toggle(
    'active',
    !showEval
  );

  evalBtn?.classList.toggle(
    'active',
    showEval
  );
}


/* =========================================================
   EVAL
========================================================= */

function getEvalCode() {
  return String(
    document.getElementById('eval-code')?.value || ''
  );
}

function setEvalStatus(message, type = 'muted') {
  const el =
    document.getElementById('eval-status');

  if (!el) return;

  el.textContent = message;
  el.className =
    `eval-status ${
      type === 'success'
        ? 'success'
        : type === 'error'
          ? 'error'
          : 'muted'
    }`;
}

function setEvalOutput(value) {
  const output =
    document.getElementById('eval-output');

  if (output) {
    output.textContent =
      String(value ?? '');
  }
}

async function runEval() {
  const code = getEvalCode();

  if (!code.trim()) {
    return setEvalStatus(
      'Çalıştırmak için kod yazın.',
      'error'
    );
  }

  const btn =
    document.getElementById('btn-eval-run');

  const old = btn?.innerHTML;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Çalışıyor...';
  }

  setEvalStatus(
    'Kod çalıştırılıyor...',
    'muted'
  );

  try {
    const res =
      await fetch('/api/eval', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ code })
      });

    const data =
      await safeJson(res);

    if (!res.ok) {
      setEvalOutput(
        data.error ||
        data.message ||
        'Eval hatası.'
      );

      return setEvalStatus(
        `Hata • ${data.durationMs || 0} ms`,
        'error'
      );
    }

    setEvalOutput(
      data.result ||
      'Kod çalıştı ancak çıktı üretmedi.'
    );

    setEvalStatus(
      `Başarılı • ${data.durationMs || 0} ms`,
      'success'
    );
  } catch (error) {
    console.error('[EVAL]', error);

    setEvalOutput(
      error.message
    );

    setEvalStatus(
      'Sunucuya bağlanılamadı.',
      'error'
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }
}

async function uploadEvalToSourcebin() {
  const code = getEvalCode();

  if (!code.trim()) {
    return setEvalStatus(
      'Sourcebin için önce kod yazın.',
      'error'
    );
  }

  const btn =
    document.getElementById(
      'btn-eval-sourcebin'
    );

  const box =
    document.getElementById(
      'sourcebin-result'
    );

  const old = btn?.innerHTML;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Yükleniyor...';
  }

  box?.classList.add('hidden');

  try {
    const res =
      await fetch('/api/sourcebin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          code,
          title: 'InstaTracker Eval'
        })
      });

    const data =
      await safeJson(res);

    if (!res.ok) {
      throw new Error(
        data.error ||
        data.message ||
        'Sourcebin yükleme başarısız.'
      );
    }

    if (box) {
      box.innerHTML = `
        <div class="sourcebin-success">
          <i class="fa-solid fa-circle-check"></i>
          <div>
            <strong>Sourcebin hazır.</strong>
            <a
              href="${escapeAttr(data.url)}"
              target="_blank"
              rel="noopener noreferrer"
            >${escapeHtml(data.url)}</a>
          </div>
        </div>
      `;
      box.classList.remove('hidden');
    }

    setEvalStatus(
      'Kod Sourcebin’e gönderildi.',
      'success'
    );
  } catch (error) {
    setEvalStatus(
      error.message,
      'error'
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }
}

function downloadEvalTxt() {
  const code = getEvalCode();

  if (!code.trim()) {
    return setEvalStatus(
      'TXT indirmek için önce kod yazın.',
      'error'
    );
  }

  const blob =
    new Blob(
      [code],
      { type: 'text/plain;charset=utf-8' }
    );

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement('a');

  a.href = url;
  a.download =
    `instatracker-eval-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.txt`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);

  setEvalStatus(
    'TXT dosyası hazırlandı.',
    'success'
  );
}

async function copyEvalOutput() {
  const text =
    document.getElementById(
      'eval-output'
    )?.textContent || '';

  if (!text.trim()) return;

  try {
    await navigator.clipboard.writeText(text);

    setEvalStatus(
      'Sonuç panoya kopyalandı.',
      'success'
    );
  } catch (_) {
    alert(
      'Sonuç kopyalanamadı. Metni manuel olarak seçebilirsiniz.'
    );
  }
}

function clearEval() {
  const code =
    document.getElementById('eval-code');

  if (code) code.value = '';

  setEvalOutput(
    'Çıktı burada görünecek...'
  );

  setEvalStatus(
    'Eval alanı temizlendi.',
    'muted'
  );

  document
    .getElementById('sourcebin-result')
    ?.classList.add('hidden');
}

/* =========================================================
   THEME
========================================================= */

function initTheme() {

  const saved =
    localStorage.getItem(
      'themeMode'
    ) || 'auto';


  setTheme(saved);

}


function setTheme(mode) {

  localStorage.setItem(
    'themeMode',
    mode
  );


  const dark =
    mode === 'dark' ||

    (
      mode === 'auto' &&
      window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
    );


  document.documentElement
    .classList
    .toggle(
      'dark',
      dark
    );


  document.documentElement
    .classList
    .toggle(
      'light',
      !dark
    );


  const label =
    document.getElementById(
      'theme-label'
    );


  if (label) {

    label.textContent =
      mode === 'dark'
        ? 'Karanlık'
        : mode === 'light'
          ? 'Aydınlık'
          : 'Otomatik';

  }


  document
    .getElementById('theme-menu')
    ?.classList.add('hidden');

}


/* =========================================================
   SYSTEM THEME CHANGE
========================================================= */

const mediaQuery =
  window.matchMedia?.(
    '(prefers-color-scheme: dark)'
  );


mediaQuery?.addEventListener?.(
  'change',
  () => {

    if (
      (
        localStorage.getItem(
          'themeMode'
        ) || 'auto'
      ) === 'auto'
    ) {

      setTheme('auto');

    }

  }
);


/* =========================================================
   PUSH KEY CONVERSION
========================================================= */

function urlBase64ToUint8Array(s) {

  const padding =
    '='.repeat(
      (4 - s.length % 4) % 4
    );


  const raw =
    atob(
      (
        s +
        padding
      )
        .replace(/-/g, '+')
        .replace(/_/g, '/')
    );


  return Uint8Array.from(
    [...raw].map(
      c => c.charCodeAt(0)
    )
  );

}


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(v) {

  return String(
    v ?? ''
  ).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[c])
  );

}


function escapeAttr(v) {

  return escapeHtml(v);

}
