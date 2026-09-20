// PWA Service Worker Kaydı
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => console.log('PWA Service Worker Aktif.'));
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Theme Toggle
  const btnTheme = document.getElementById('btn-theme');
  btnTheme.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
  });

  // Login Form
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
    if (data.success) {
      checkAuth();
    } else {
      alert(data.message);
    }
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    checkAuth();
  });

  // Add Profile
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
      document.getElementById('target-username').value = '';
      document.getElementById('target-userid').value = '';
      loadDashboardData();
    } else {
      const err = await res.json();
      alert(err.error);
    }
  });

  // Sync Now Button
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Tarama Yapılıyor...`;
    await fetch('/api/sync-now', { method: 'POST' });
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-rotate"></i> Şimdi Senkronize Et`;
    loadDashboardData();
  });

  // Modal İşlemleri
  const modal = document.getElementById('api-modal');
  document.getElementById('btn-api-key').addEventListener('click', async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('modal-api-key').value = data.apiKey || '';
    modal.classList.remove('hidden');
  });

  document.getElementById('close-modal').addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('save-api-key').addEventListener('click', async () => {
    const apiKey = document.getElementById('modal-api-key').value;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    modal.classList.add('hidden');
    alert('API Key kaydedildi.');
  });
});

async function checkAuth() {
  const res = await fetch('/api/auth-check');
  const data = await res.json();
  const loginScreen = document.getElementById('login-screen');
  const appDashboard = document.getElementById('app-dashboard');

  if (data.authenticated) {
    loginScreen.classList.add('hidden');
    appDashboard.classList.remove('hidden');
    loadDashboardData();
  } else {
    loginScreen.classList.remove('hidden');
    appDashboard.classList.add('hidden');
  }
}

async function loadDashboardData() {
  loadProfiles();
  loadMedia();
  loadLogs();
}

async function loadProfiles() {
  const res = await fetch('/api/profiles');
  const profiles = await res.json();
  const container = document.getElementById('profile-list');
  document.getElementById('profile-count').innerText = profiles.length;

  container.innerHTML = profiles.map(p => `
    <div class="flex items-center justify-between p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs">
      <div>
        <div class="font-bold text-slate-200">@${p.username}</div>
        <div class="text-slate-500 text-[10px]">ID: ${p.userId}</div>
      </div>
      <button onclick="toggleMute('${p.id}')" class="px-2 py-1 rounded text-[11px] ${p.muted ? 'bg-amber-900/40 text-amber-400 border border-amber-700' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
        <i class="fa-solid ${p.muted ? 'fa-bell-slash' : 'fa-bell'}"></i> ${p.muted ? 'Sessiz' : 'Bildirim Açık'}
      </button>
    </div>
  `).join('');
}

async function toggleMute(profileId) {
  await fetch(`/api/profiles/${profileId}/toggle-mute`, { method: 'PATCH' });
  loadProfiles();
}

// --- YENİ INSTAGRAM SEKME VE MEDYA YÖNETİMİ ---
let currentTab = 'post';
let globalMediaList = [];

async function loadMedia() {
  const res = await fetch('/api/media');
  globalMediaList = await res.json();
  renderMedia(currentTab);
}

// HTML'den çağrılabilmesi için global window nesnesine ekliyoruz
window.switchTab = function(tabName) {
  currentTab = tabName;
  
  // Sekme renk ve çizgi animasyonları
  ['post', 'reel', 'story'].forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    if(t === tabName) {
      btn.classList.add('text-rose-400', 'border-rose-500');
      btn.classList.remove('text-slate-500', 'border-transparent', 'hover:text-slate-300');
    } else {
      btn.classList.remove('text-rose-400', 'border-rose-500');
      btn.classList.add('text-slate-500', 'border-transparent', 'hover:text-slate-300');
    }
  });

  renderMedia(currentTab);
}

function renderMedia(type) {
  const container = document.getElementById('media-grid');
  // Yeni eklenen geçmiş paylaşımların sıralamasını tersine çevirerek (en yeni en üstte) göster
  const filteredMedia = globalMediaList.filter(m => m.type === type).sort((a, b) => b.id - a.id);

  if (filteredMedia.length === 0) {
    container.innerHTML = `<div class="col-span-3 text-center text-slate-500 py-16 text-sm">Bu kategoride henüz arşivlenmiş içerik yok.</div>`;
    return;
  }

  container.innerHTML = filteredMedia.map(m => `
    <div onclick="const o = this.querySelector('.info-overlay'); o.classList.toggle('opacity-0'); o.classList.toggle('opacity-100');" 
         class="group relative bg-slate-900 aspect-square overflow-hidden cursor-pointer border border-slate-800">
      
      ${m.url ? `<img src="${m.url}" class="w-full h-full object-cover sm:group-hover:scale-110 transition-transform duration-500" loading="lazy" alt="Media">` : `<div class="w-full h-full flex items-center justify-center text-[10px] text-slate-600">Önizleme Yok</div>`}
      
      ${m.type === 'reel' ? `<div class="absolute top-1 right-1 sm:top-2 sm:right-2 text-white drop-shadow-md text-xs sm:text-base"><i class="fa-solid fa-play"></i></div>` : ''}
      
      <!-- Mobilde Tıklama ile, Masaüstünde Hover ile açılan Bilgi Katmanı -->
      <div class="info-overlay absolute inset-0 bg-black/75 opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-center items-center text-white p-1 sm:p-2 text-center">
        
        <div class="flex gap-2 sm:gap-4 font-bold text-[10px] sm:text-sm mb-1 sm:mb-3">
          <span><i class="fa-solid fa-heart"></i> ${m.likes}</span>
          <span><i class="fa-solid fa-comment"></i> ${m.comments}</span>
        </div>
        
        <p class="text-[8px] sm:text-[10px] line-clamp-2 sm:line-clamp-3 mb-1 sm:mb-3 text-slate-200 hidden sm:block">${m.caption}</p>
        
        <div class="flex gap-1 sm:gap-2 flex-col sm:flex-row w-full px-2 items-center justify-center">
          <span class="bg-rose-600/80 px-1 sm:px-2 py-0.5 sm:py-1 rounded text-[8px] sm:text-[10px] font-mono truncate max-w-[80%]">@${m.profileUsername}</span>
          <a href="${m.url}" target="_blank" download class="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-[10px] flex items-center gap-1 transition">
            <i class="fa-solid fa-download text-[8px] sm:text-xs"></i> <span class="hidden sm:inline">İndir</span>
          </a>
        </div>
        
      </div>
    </div>
  `).join('');


  // Instagram profilindeki kare (aspect-square) görünümlü render
  container.innerHTML = filteredMedia.map(m => `
    <div class="group relative bg-slate-900 aspect-square overflow-hidden rounded-md border border-slate-700 cursor-pointer">
      
      <!-- Arka Plan Medyası -->
      ${m.url ? `<img src="${m.url}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy" alt="Media">` : `<div class="w-full h-full flex items-center justify-center text-xs text-slate-600">Önizleme Yok</div>`}
      
      <!-- Video / Reel İkonu Belirteci -->
      ${m.type === 'reel' ? `<div class="absolute top-2 right-2 text-white drop-shadow-md"><i class="fa-solid fa-play"></i></div>` : ''}
      
      <!-- Hover Durumunda Çıkan Bilgi Katmanı (Overlay) -->
      <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-center items-center text-white p-2 text-center">
        <div class="flex gap-4 font-bold text-sm mb-3">
          <span title="Beğeni"><i class="fa-solid fa-heart"></i> ${m.likes}</span>
          <span title="Yorum"><i class="fa-solid fa-comment"></i> ${m.comments}</span>
        </div>
        <p class="text-[10px] line-clamp-3 mb-3 text-slate-200">${m.caption}</p>
        
        <div class="flex gap-2">
          <span class="bg-rose-600 px-2 py-1 rounded text-[10px] font-mono">@${m.profileUsername}</span>
          <a href="${m.url}" target="_blank" download class="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-[10px] flex items-center gap-1 transition">
            <i class="fa-solid fa-download"></i> İndir
          </a>
        </div>
      </div>

    </div>
  `).join('');
    

  container.innerHTML = mediaList.map(m => `
    <div class="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex flex-col shadow-md">
      <div class="p-3 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center text-xs">
        <span class="font-bold text-rose-400">@${m.profileUsername}</span>
        <span class="uppercase text-[10px] bg-slate-700 px-2 py-0.5 rounded text-slate-300 font-mono">${m.type}</span>
      </div>
      <div class="relative bg-black flex items-center justify-center min-h-[200px]">
        ${m.url ? `<img src="${m.url}" class="max-h-72 object-contain w-full" loading="lazy" alt="Media">` : `<div class="text-xs text-slate-500">Medya Önizlemesi Yok</div>`}
      </div>
      <div class="p-3 flex-1 flex flex-col justify-between space-y-3">
        <p class="text-xs text-slate-300 line-clamp-2">${m.caption}</p>
        <div class="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-700/50">
          <div class="flex gap-3">
            <span><i class="fa-solid fa-heart text-rose-500"></i> ${m.likes}</span>
            <span><i class="fa-solid fa-comment text-sky-400"></i> ${m.comments}</span>
          </div>
          <a href="${m.url}" target="_blank" download class="bg-slate-700 hover:bg-slate-600 text-white px-2.5 py-1 rounded text-xs flex items-center gap-1">
            <i class="fa-solid fa-download"></i> İndir
          </a>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadLogs() {
  const res = await fetch('/api/logs');
  const logs = await res.json();
  const container = document.getElementById('log-list');

  container.innerHTML = logs.map(l => `
    <div class="p-2 rounded bg-slate-900/80 border border-slate-800 text-[11px] space-y-0.5">
      <div class="flex justify-between text-[10px] text-slate-500">
        <span class="text-rose-400 font-semibold">[${l.type}]</span>
        <span>${l.timestamp}</span>
      </div>
      <div class="text-slate-300">${l.message}</div>
    </div>
  `).join('');
}
