let currentTab = 'post';
let globalMediaList = [];
let deferredInstallPrompt = null;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkAuth();

  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('add-profile-form')?.addEventListener('submit', addProfile);
  document.getElementById('btn-resolve-user')?.addEventListener('click', resolveInstagramUser);
  document.getElementById('btn-sync')?.addEventListener('click', syncAll);
  document.getElementById('btn-notifications')?.addEventListener('click', enableNotifications);
  document.getElementById('btn-install')?.addEventListener('click', installApp);
  document.getElementById('btn-theme')?.addEventListener('click', () => document.getElementById('theme-menu')?.classList.toggle('hidden'));
  document.querySelectorAll('[data-theme]').forEach(btn => btn.addEventListener('click', () => setTheme(btn.dataset.theme)));

  const modal = document.getElementById('api-modal');
  document.getElementById('btn-api-key')?.addEventListener('click', async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Ayarlar alınamadı.');
    document.getElementById('modal-api-key').value = data.apiKey || '';
    document.getElementById('modal-api-host').value = data.apiHost || '';
    document.getElementById('modal-api-path').value = data.apiPath || '/user_medias';
    document.getElementById('modal-user-path').value = data.userLookupPath || '/search_user';
    document.getElementById('modal-story-path').value = data.storyPath || '';
    modal.classList.remove('hidden');
  });
  document.getElementById('close-modal')?.addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('save-api-key')?.addEventListener('click', saveApiSettings);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstallPrompt = e;
    document.getElementById('btn-install')?.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('btn-install')?.classList.add('hidden');
  });
});

async function safeJson(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return { error: text || `HTTP ${res.status}` }; }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = e.submitter || document.querySelector('#login-form button[type="submit"]');
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Giriş yapılıyor...';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      })
    });
    const data = await safeJson(res);
    if (!res.ok || !data.success) throw new Error(data.message || data.error || 'Giriş başarısız.');
    await checkAuth();
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

async function checkAuth() {
  const res = await fetch('/api/auth-check');
  const data = await safeJson(res);
  document.getElementById('login-screen').classList.toggle('hidden', !!data.authenticated);
  document.getElementById('app-dashboard').classList.toggle('hidden', !data.authenticated);
  if (data.authenticated) { await loadDashboardData(); updateNotificationButton(); }
}

async function logout() { await fetch('/api/logout', { method: 'POST' }); await checkAuth(); }

async function resolveInstagramUser() {
  const input = document.getElementById('target-username');
  const idInput = document.getElementById('target-userid');
  const btn = document.getElementById('btn-resolve-user');
  const username = input.value.trim().replace(/^@/, '');
  if (!username) return alert('Önce Instagram kullanıcı adını yazın.');
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Bulunuyor...';
  try {
    const res = await fetch(`/api/instagram/resolve-user?username=${encodeURIComponent(username)}`);
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'ID bulunamadı.');
    idInput.value = data.userId;
    document.getElementById('resolve-status').textContent = `✓ @${data.username} bulundu`;
    document.getElementById('resolve-status').className = 'text-xs text-emerald-400';
  } catch (err) {
    idInput.value = ''; document.getElementById('resolve-status').textContent = err.message;
    document.getElementById('resolve-status').className = 'text-xs text-rose-400';
  } finally { btn.disabled = false; btn.innerHTML = old; }
}

async function addProfile(e) {
  e.preventDefault();
  const username = document.getElementById('target-username').value.trim();
  const userId = document.getElementById('target-userid').value.trim();
  if (!userId) return alert('Önce "ID Bul" ile Instagram ID değerini bulun.');
  const res = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, userId }) });
  const data = await safeJson(res);
  if (!res.ok) return alert(data.error || 'Profil eklenemedi.');
  e.target.reset(); document.getElementById('resolve-status').textContent = ''; await loadDashboardData();
}

async function syncAll() {
  const btn = document.getElementById('btn-sync'); const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Senkronize ediliyor...';
  try { const res = await fetch('/api/sync-now', { method: 'POST' }); const data = await safeJson(res); if (!res.ok) alert(data.error || data.message); }
  finally { btn.disabled = false; btn.innerHTML = old; loadDashboardData(); }
}

async function loadDashboardData() { await Promise.all([loadProfiles(), loadMedia(), loadLogs()]); }

async function loadProfiles() {
  const res = await fetch('/api/profiles'); const profiles = await safeJson(res);
  if (!res.ok) return;
  document.getElementById('profile-count').innerText = profiles.length;
  document.getElementById('profile-list').innerHTML = profiles.map(p => `
    <div class="profile-item">
      <div class="flex items-center justify-between gap-2">
        <div><div class="font-bold">@${escapeHtml(p.username)}</div><div class="muted">ID: ${escapeHtml(p.userId)}</div></div>
        <button onclick="toggleMute('${p.id}')" class="icon-btn ${p.muted ? 'warning' : ''}"><i class="fa-solid ${p.muted ? 'fa-bell-slash' : 'fa-bell'}"></i></button>
      </div>
      <button onclick="syncProfile500('${p.id}', this)" class="secondary-btn w-full mt-2"><i class="fa-solid fa-box-archive"></i> Son 500'ü çek</button>
    </div>`).join('') || '<div class="empty-state">Henüz profil eklenmedi.</div>';
}

async function toggleMute(id) { await fetch(`/api/profiles/${id}/toggle-mute`, { method: 'PATCH' }); loadProfiles(); }
window.toggleMute = toggleMute;
window.syncProfile500 = async function(id, btn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Çekiliyor...';
  try { const res = await fetch(`/api/profiles/${id}/sync-500`, { method: 'POST' }); const data = await safeJson(res); if (!res.ok) alert(data.error); else alert(`${data.checked} içerik kontrol edildi, ${data.added} yeni içerik eklendi.`); await loadDashboardData(); }
  finally { btn.disabled = false; btn.innerHTML = old; }
};

async function loadMedia() { const res = await fetch('/api/media'); globalMediaList = await safeJson(res); if (res.ok) renderMedia(currentTab); }
window.switchTab = function(tab) { currentTab = tab; ['post','reel','story'].forEach(t => document.getElementById(`tab-${t}`)?.classList.toggle('active-tab', t === tab)); renderMedia(tab); };

function renderMedia(type) {
  const container = document.getElementById('media-grid');
  const filtered = globalMediaList.filter(m => m.type === type).sort((a,b) => new Date(b.takenAt || b.timestamp) - new Date(a.takenAt || a.timestamp));
  if (!filtered.length) { container.innerHTML = '<div class="col-span-3 empty-state py-16">Bu kategoride arşivlenmiş içerik yok.</div>'; return; }
  container.innerHTML = filtered.map(m => `
    <article class="media-card">
      ${m.url ? `<img src="${escapeAttr(m.url)}" loading="lazy" alt="Instagram medya">` : '<div class="media-no-image"><i class="fa-regular fa-image"></i></div>'}
      ${m.type === 'reel' ? '<span class="media-type"><i class="fa-solid fa-play"></i></span>' : m.type === 'story' ? '<span class="media-type"><i class="fa-solid fa-circle"></i></span>' : ''}
      <div class="media-overlay">
        <div class="media-stats"><span><i class="fa-solid fa-heart"></i> ${m.likes || 0}</span><span><i class="fa-solid fa-comment"></i> ${m.comments || 0}</span></div>
        <div class="caption">${escapeHtml(m.caption || 'Açıklama yok')}</div>
        <div class="media-actions"><span>@${escapeHtml(m.profileUsername)}</span><a class="download-btn" href="/api/media/${encodeURIComponent(m.id)}/download"><i class="fa-solid fa-download"></i> İndir</a></div>
      </div>
    </article>`).join('');
}

async function loadLogs() { const res = await fetch('/api/logs'); const logs = await safeJson(res); if (!res.ok) return; document.getElementById('log-list').innerHTML = logs.map(l => `<div class="log-item"><div class="flex justify-between text-[10px] muted"><span class="text-rose-400">[${escapeHtml(l.type)}]</span><span>${escapeHtml(l.timestamp)}</span></div><div>${escapeHtml(l.message)}</div></div>`).join(''); }

async function updateNotificationButton() {
  const btn = document.getElementById('btn-notifications');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return btn?.classList.add('hidden');
  btn.classList.remove('hidden');
  btn.innerHTML = Notification.permission === 'granted' ? '<i class="fa-solid fa-bell"></i> Bildirimler Açık' : '<i class="fa-regular fa-bell"></i> Bildirimleri Aç';
}
async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return alert('Bu tarayıcı bildirimleri desteklemiyor.');
  if (Notification.permission !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') return alert('Bildirim izni verilmedi.'); }
  try {
    const keyRes = await fetch('/api/push/public-key'); const keyData = await safeJson(keyRes); if (!keyRes.ok) throw new Error(keyData.error);
    const registration = await navigator.serviceWorker.ready; let sub = await registration.pushManager.getSubscription();
    if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) });
    const save = await fetch('/api/push/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(sub) });
    if (!save.ok) throw new Error((await safeJson(save)).error || 'Abonelik kaydedilemedi.');
    await fetch('/api/push/test', { method:'POST' }); updateNotificationButton(); alert('Bildirimler açıldı. Test bildirimi gönderildi.');
  } catch (e) { alert(`Bildirim kurulamadı: ${e.message}`); }
}
async function installApp() { if (!deferredInstallPrompt) return alert('Tarayıcınız otomatik kurulum penceresini desteklemiyor.'); deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; }
async function saveApiSettings() {
  const body = { apiKey: document.getElementById('modal-api-key').value, apiHost: document.getElementById('modal-api-host').value, apiPath: document.getElementById('modal-api-path').value, userLookupPath: document.getElementById('modal-user-path').value, storyPath: document.getElementById('modal-story-path').value };
  const res = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); const data = await safeJson(res); if (!res.ok) return alert(data.error || 'Kaydedilemedi.'); document.getElementById('api-modal').classList.add('hidden'); alert('API ayarları kaydedildi.');
}

function initTheme() { const saved = localStorage.getItem('themeMode') || 'auto'; setTheme(saved); }
function setTheme(mode) {
  localStorage.setItem('themeMode', mode);
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark);
  document.getElementById('theme-label').textContent = mode === 'dark' ? 'Karanlık' : mode === 'light' ? 'Aydınlık' : 'Otomatik';
  document.getElementById('theme-menu')?.classList.add('hidden');
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if ((localStorage.getItem('themeMode') || 'auto') === 'auto') setTheme('auto'); });
function urlBase64ToUint8Array(s) { const padding='='.repeat((4-s.length%4)%4); const raw=atob((s+padding).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0))); }
function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function escapeAttr(v) { return escapeHtml(v); }
