let currentTab = 'post';
let globalMediaList = [];
let deferredInstallPrompt = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  document.getElementById('btn-theme')?.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (data.success) checkAuth();
    else alert(data.message);
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    checkAuth();
  });

  document.getElementById('add-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('target-username').value;
    const userId = document.getElementById('target-userid').value;

    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, userId })
    });

    if (res.ok) {
      e.target.reset();
      loadDashboardData();
    } else {
      const err = await res.json();
      alert(err.error);
    }
  });

  document.getElementById('btn-sync')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Tarama Yapılıyor...';

    try {
      const res = await fetch('/api/sync-now', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || data.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Şimdi Senkronize Et';
      loadDashboardData();
    }
  });

  document.getElementById('btn-notifications')?.addEventListener('click', enableNotifications);
  document.getElementById('btn-install')?.addEventListener('click', installApp);

  const modal = document.getElementById('api-modal');
  document.getElementById('btn-api-key')?.addEventListener('click', async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('modal-api-key').value = data.apiKey || '';
    document.getElementById('modal-api-host').value = data.apiHost || '';
    document.getElementById('modal-api-path').value = data.apiPath || '/user_medias';
    modal.classList.remove('hidden');
  });

  document.getElementById('close-modal')?.addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('save-api-key')?.addEventListener('click', async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: document.getElementById('modal-api-key').value,
        apiHost: document.getElementById('modal-api-host').value,
        apiPath: document.getElementById('modal-api-path').value
      })
    });
    modal.classList.add('hidden');
    alert('API ayarları kaydedildi.');
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('btn-install')?.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('btn-install')?.classList.add('hidden');
  });
});

async function checkAuth() {
  const res = await fetch('/api/auth-check');
  const data = await res.json();
  const loginScreen = document.getElementById('login-screen');
  const dashboard = document.getElementById('app-dashboard');

  if (data.authenticated) {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadDashboardData();
    updateNotificationButton();
  } else {
    loginScreen.classList.remove('hidden');
    dashboard.classList.add('hidden');
  }
}

async function loadDashboardData() {
  await Promise.all([loadProfiles(), loadMedia(), loadLogs()]);
}

async function loadProfiles() {
  const res = await fetch('/api/profiles');
  const profiles = await res.json();
  const container = document.getElementById('profile-list');
  document.getElementById('profile-count').innerText = profiles.length;

  container.innerHTML = profiles.map(p => `
    <div class="p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs space-y-2">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-bold text-slate-200">@${escapeHtml(p.username)}</div>
          <div class="text-slate-500 text-[10px]">ID: ${escapeHtml(p.userId)}</div>
        </div>
        <button onclick="toggleMute('${p.id}')" class="px-2 py-1 rounded text-[11px] ${p.muted ? 'bg-amber-900/40 text-amber-400 border border-amber-700' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
          <i class="fa-solid ${p.muted ? 'fa-bell-slash' : 'fa-bell'}"></i> ${p.muted ? 'Sessiz' : 'Bildirim Açık'}
        </button>
      </div>
      <button onclick="syncProfile500('${p.id}', this)" class="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded py-1.5 text-[11px] text-slate-300">
        <i class="fa-solid fa-box-archive"></i> Son 500 Gönderiyi Çek
      </button>
    </div>
  `).join('');
}

async function toggleMute(profileId) {
  await fetch(`/api/profiles/${profileId}/toggle-mute`, { method: 'PATCH' });
  loadProfiles();
}

window.syncProfile500 = async function(id, btn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 500 gönderi kontrol ediliyor...';
  try {
    const res = await fetch(`/api/profiles/${id}/sync-500`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'İçe aktarma başarısız.');
    else alert(`${data.checked} içerik kontrol edildi, ${data.added} yeni içerik eklendi.`);
    loadDashboardData();
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
};

async function loadMedia() {
  const res = await fetch('/api/media');
  globalMediaList = await res.json();
  renderMedia(currentTab);
}

window.switchTab = function(tabName) {
  currentTab = tabName;
  ['post', 'reel', 'story'].forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    if (!btn) return;
    const active = t === tabName;
    btn.classList.toggle('text-rose-400', active);
    btn.classList.toggle('border-rose-500', active);
    btn.classList.toggle('text-slate-500', !active);
    btn.classList.toggle('border-transparent', !active);
  });
  renderMedia(currentTab);
};

function renderMedia(type) {
  const container = document.getElementById('media-grid');
  const filtered = globalMediaList
    .filter(m => m.type === type)
    .sort((a, b) => new Date(b.takenAt || b.timestamp) - new Date(a.takenAt || a.timestamp));

  if (!filtered.length) {
    container.innerHTML = '<div class="col-span-3 text-center text-slate-500 py-16 text-sm">Bu kategoride henüz arşivlenmiş içerik yok.</div>';
    return;
  }

  container.innerHTML = filtered.map(m => `
    <div class="group relative bg-slate-900 aspect-square overflow-hidden rounded-md border border-slate-700">
      ${m.url ? `<img src="${escapeAttr(m.url)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy" alt="Media">`
        : '<div class="w-full h-full flex items-center justify-center text-xs text-slate-600">Önizleme Yok</div>'}
      ${m.type === 'reel' ? '<div class="absolute top-2 right-2 text-white"><i class="fa-solid fa-play"></i></div>' : ''}
      <div class="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-center items-center text-white p-2 text-center">
        <div class="flex gap-4 font-bold text-sm mb-3">
          <span><i class="fa-solid fa-heart"></i> ${m.likes || 0}</span>
          <span><i class="fa-solid fa-comment"></i> ${m.comments || 0}</span>
        </div>
        <p class="text-[10px] line-clamp-3 mb-3 text-slate-200">${escapeHtml(m.caption || '')}</p>
        <span class="bg-rose-600 px-2 py-1 rounded text-[10px] font-mono">@${escapeHtml(m.profileUsername)}</span>
      </div>
    </div>
  `).join('');
}

async function loadLogs() {
  const res = await fetch('/api/logs');
  const logs = await res.json();
  document.getElementById('log-list').innerHTML = logs.map(l => `
    <div class="p-2 rounded bg-slate-900/80 border border-slate-800 text-[11px] space-y-0.5">
      <div class="flex justify-between text-[10px] text-slate-500">
        <span class="text-rose-400 font-semibold">[${escapeHtml(l.type)}]</span>
        <span>${escapeHtml(l.timestamp)}</span>
      </div>
      <div class="text-slate-300">${escapeHtml(l.message)}</div>
    </div>
  `).join('');
}

async function updateNotificationButton() {
  const btn = document.getElementById('btn-notifications');
  if (!btn) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    btn.classList.add('hidden');
    return;
  }

  if (Notification.permission === 'granted') {
    btn.innerHTML = '<i class="fa-solid fa-bell"></i> Bildirimler Açık';
  } else {
    btn.innerHTML = '<i class="fa-regular fa-bell"></i> Bildirimleri Aç';
  }
}

async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    alert('Bu tarayıcı bildirimleri desteklemiyor.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Bildirim izni verilmedi.');
    return;
  }

  try {
    const keyRes = await fetch('/api/push/public-key');
    const keyData = await keyRes.json();
    if (!keyRes.ok) throw new Error(keyData.error || 'VAPID ayarları eksik.');

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    await fetch('/api/push/test', { method: 'POST' });
    updateNotificationButton();
    alert('Bildirimler açıldı. Test bildirimi gönderildi.');
  } catch (err) {
    alert(`Bildirim kurulamadı: ${err.message}`);
  }
}

async function installApp() {
  if (!deferredInstallPrompt) {
    alert('Bu tarayıcı şu anda otomatik ana ekrana ekleme penceresini desteklemiyor. Android Chrome gibi desteklenen bir tarayıcıda tekrar deneyin.');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function escapeAttr(value) { return escapeHtml(value); }
