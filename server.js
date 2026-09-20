const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const { Readable } = require('stream');
const webpush = require('web-push');
const { readDB, writeDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function authGuard(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
}

function logEvent(type, message, profileUsername = '') {
  const db = readDB();
  db.logs.unshift({
    id: `${Date.now()}-${Math.random()}`,
    timestamp: new Date().toLocaleString('tr-TR'),
    type,
    message,
    profileUsername
  });
  db.logs = db.logs.slice(0, 500);
  writeDB(db);
}

async function sendPushNotification(title, body, url = '/') {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  const db = readDB();
  const subscriptions = db.pushSubscriptions || [];

  const payload = JSON.stringify({
    title,
    body,
    url,
    icon: '/icon-192.png',
    badge: '/icon-192.png'
  });

  const remaining = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      remaining.push(subscription);
    } catch (err) {
      if (err.statusCode !== 404 && err.statusCode !== 410) remaining.push(subscription);
    }
  }

  db.pushSubscriptions = remaining;
  writeDB(db);
}

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const db = readDB();

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Kullanıcı adı ve şifre zorunludur.' });
    }

    const validUser = username === String(db.settings.adminUser || '');
    const validPassword = validUser && await bcrypt.compare(password, String(db.settings.adminPassHash || ''));

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Kullanıcı adı veya şifre hatalı!' });
    }

    req.session.authenticated = true;
    req.session.user = username;
    return res.json({ success: true, message: 'Giriş başarılı.' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Giriş sırasında sunucu hatası oluştu.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// SETTINGS
app.post('/api/settings', authGuard, (req, res) => {
  const { apiKey, apiHost, apiPath, userLookupPath, storyPath } = req.body;
  const db = readDB();

  if (typeof apiKey === 'string') db.settings.apiKey = apiKey.trim();
  if (typeof apiHost === 'string' && apiHost.trim()) db.settings.apiHost = apiHost.trim();
  if (typeof apiPath === 'string' && apiPath.trim()) db.settings.apiPath = apiPath.trim();
  if (typeof userLookupPath === 'string') db.settings.userLookupPath = userLookupPath.trim();
  if (typeof storyPath === 'string') db.settings.storyPath = storyPath.trim();

  writeDB(db);
  res.json({ success: true, message: 'Ayarlar kaydedildi.' });
});

app.get('/api/settings', authGuard, (req, res) => {
  const db = readDB();
  res.json({
    apiKey: db.settings.apiKey,
    apiHost: db.settings.apiHost,
    apiPath: db.settings.apiPath,
    userLookupPath: db.settings.userLookupPath,
    storyPath: db.settings.storyPath,
    vapidConfigured: Boolean(vapidPublicKey && vapidPrivateKey)
  });
});

// PUSH
app.get('/api/push/public-key', authGuard, (req, res) => {
  if (!vapidPublicKey) {
    return res.status(503).json({ error: 'VAPID anahtarları yapılandırılmamış.' });
  }
  res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', authGuard, (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Geçersiz push aboneliği.' });
  }

  const db = readDB();
  db.pushSubscriptions ||= [];

  const exists = db.pushSubscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!exists) db.pushSubscriptions.push(subscription);

  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/push/subscribe', authGuard, (req, res) => {
  const endpoint = req.body?.endpoint;
  const db = readDB();
  db.pushSubscriptions = (db.pushSubscriptions || []).filter(s => s.endpoint !== endpoint);
  writeDB(db);
  res.json({ success: true });
});

app.post('/api/push/test', authGuard, async (req, res) => {
  if (!vapidPublicKey || !vapidPrivateKey) {
    return res.status(503).json({ error: 'VAPID anahtarları yapılandırılmamış.' });
  }
  await sendPushNotification('Bildirimler aktif 🔔', 'Bildirim sistemi başarıyla çalışıyor.', '/');
  res.json({ success: true });
});

// INSTAGRAM USER RESOLVER
function extractUserId(body) {
  const candidates = [
    body?.id, body?.user_id, body?.pk,
    body?.user?.id, body?.user?.pk,
    body?.data?.id, body?.data?.user_id, body?.data?.pk,
    body?.data?.user?.id, body?.data?.user?.pk,
    body?.result?.id, body?.result?.user_id, body?.result?.pk,
    body?.results?.[0]?.id, body?.results?.[0]?.pk,
    body?.users?.[0]?.id, body?.users?.[0]?.pk,
    body?.data?.users?.[0]?.id, body?.data?.users?.[0]?.pk
  ];
  const found = candidates.find(v => v !== undefined && v !== null && String(v).trim());
  return found ? String(found) : '';
}

app.get('/api/instagram/resolve-user', authGuard, async (req, res) => {
  const username = String(req.query?.username || '').trim().replace(/^@/, '');
  const db = readDB();
  if (!username) return res.status(400).json({ error: 'Kullanıcı adı girin.' });
  if (!db.settings.apiKey) return res.status(400).json({ error: 'Önce RapidAPI anahtarını kaydedin.' });
  if (!db.settings.userLookupPath) return res.status(400).json({ error: 'User ID bulma API Path ayarlanmamış.' });

  try {
    const response = await axios.get(`https://${db.settings.apiHost}${db.settings.userLookupPath}`, {
      params: { username, user_name: username, query: username },
      headers: { 'x-rapidapi-key': db.settings.apiKey, 'x-rapidapi-host': db.settings.apiHost },
      timeout: 30000
    });
    const userId = extractUserId(response.data);
    if (!userId) return res.status(404).json({ error: "API kullanıcı ID'sini bulamadı. User ID API Path ve sağlayıcının yanıt formatını kontrol edin." });
    res.json({ success: true, username, userId });
  } catch (error) {
    const detail = error.response?.data?.message || error.response?.data?.error || error.message;
    res.status(error.response?.status || 502).json({ error: `Kullanıcı ID bulunamadı: ${detail}` });
  }
});

// PROFILES
app.get('/api/profiles', authGuard, (req, res) => {
  res.json(readDB().profiles);
});

app.post('/api/profiles', authGuard, (req, res) => {
  const username = String(req.body?.username || '').toLowerCase().trim().replace(/^@/, '');
  const userId = String(req.body?.userId || '').trim();
  if (!username || !userId) return res.status(400).json({ error: 'Kullanıcı adı ve User ID zorunludur.' });

  const db = readDB();
  const exists = db.profiles.find(p => p.userId === userId || p.username === username);
  if (exists) return res.status(400).json({ error: 'Bu profil zaten eklenmiş.' });

  const newProfile = {
    id: Date.now().toString(),
    username,
    userId,
    muted: false,
    addedAt: new Date().toISOString()
  };

  db.profiles.push(newProfile);
  db.logs.unshift({
    id: Date.now().toString(),
    timestamp: new Date().toLocaleString('tr-TR'),
    type: 'SYSTEM',
    message: `@${newProfile.username} takibe alındı (User ID: ${newProfile.userId}).`,
    profileUsername: newProfile.username
  });
  writeDB(db);

  res.json({ success: true, profile: newProfile });
});

app.patch('/api/profiles/:id/toggle-mute', authGuard, (req, res) => {
  const db = readDB();
  const profile = db.profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profil bulunamadı.' });

  profile.muted = !profile.muted;
  writeDB(db);
  res.json({ success: true, muted: profile.muted });
});

// MEDIA DOWNLOAD
app.get('/api/media/:id/download', authGuard, async (req, res) => {
  const db = readDB();
  const media = db.media.find(m => String(m.id) === String(req.params.id));
  if (!media) return res.status(404).send('Medya bulunamadı.');
  const target = media.videoUrl || media.url;
  if (!target || !/^https?:\/\//i.test(target)) return res.status(404).send('İndirilebilir medya URLsi bulunamadı.');

  try {
    const response = await axios.get(target, { responseType: 'stream', timeout: 60000, maxRedirects: 5 });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
    const safeName = `${media.profileUsername || 'instagram'}-${String(media.id).replace(/[^a-zA-Z0-9_-]/g, '')}.${ext}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    response.data.pipe(res);
  } catch (error) {
    res.status(502).send('Medya indirilemedi. Kaynak URL artık geçerli olmayabilir.');
  }
});

// MEDIA / LOGS
app.get('/api/media', authGuard, (req, res) => {
  res.json(readDB().media);
});

app.get('/api/logs', authGuard, (req, res) => {
  res.json(readDB().logs);
});

// ---------------- INSTAGRAM MEDIA IMPORT ----------------
// Bu endpoint profil akışını (user media) hedefler.
// Mevcut RapidAPI sağlayıcınız farklı bir path kullanıyorsa
// INSTAGRAM_API_PATH veya paneldeki API Path alanını değiştirin.
async function fetchInstagramDataForProfile(profile, targetCount = 500) {
  const db = readDB();
  const apiKey = db.settings.apiKey;
  const apiHost = db.settings.apiHost;
  const apiPath = db.settings.apiPath || '/user_medias';

  if (!apiKey) throw new Error('RapidAPI anahtarı ayarlanmamış.');

  const collected = [];
  let cursor = undefined;
  let page = 0;

  while (collected.length < targetCount && page < 20) {
    const params = {
      user_id: profile.userId,
      username: profile.username,
      count: Math.min(50, targetCount - collected.length)
    };

    if (cursor) {
      params.cursor = cursor;
      params.max_id = cursor;
      params.next_max_id = cursor;
    }

    const response = await axios.get(`https://${apiHost}${apiPath}`, {
      params,
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': apiHost,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const body = response.data;
    const items =
      body?.items ||
      body?.data?.items ||
      body?.data?.medias ||
      body?.data?.media ||
      body?.data ||
      body?.results ||
      [];

    if (!Array.isArray(items) || items.length === 0) break;

    collected.push(...items);

    cursor =
      body?.next_cursor ||
      body?.pagination?.next_cursor ||
      body?.data?.next_cursor ||
      body?.data?.pagination?.next_cursor ||
      body?.next_max_id ||
      body?.data?.next_max_id ||
      null;

    page++;

    if (!cursor || items.length < 2) break;
  }

  return collected.slice(0, targetCount);
}

function normalizeMedia(item, profile) {
  const mediaId = String(item.id || item.pk || item.media_id || item.code || `${profile.id}-${Date.now()}-${Math.random()}`);

  const mediaTypeRaw = item.media_type ?? item.type;
  const mediaType =
    item.is_reel || item.product_type === 'clips' || mediaTypeRaw === 2 || mediaTypeRaw === 'reel'
      ? 'reel'
      : item.story_type || item.is_story
        ? 'story'
        : 'post';

  const imageUrl =
    item.image_versions2?.candidates?.[0]?.url ||
    item.thumbnail_url ||
    item.display_url ||
    item.image_url ||
    item.url ||
    '';

  const videoUrl =
    item.video_versions?.[0]?.url ||
    item.video_url ||
    '';

  return {
    id: mediaId,
    profileId: profile.id,
    profileUsername: profile.username,
    type: mediaType,
    url: imageUrl || videoUrl || '',
    videoUrl,
    caption: item.caption?.text || item.caption || item.title || 'Açıklama yok',
    likes: Number(item.like_count ?? item.likes ?? 0),
    comments: Number(item.comment_count ?? item.comments ?? 0),
    takenAt: item.taken_at || item.timestamp || item.created_at || null,
    timestamp: new Date().toISOString()
  };
}

async function fetchInstagramStoriesForProfile(profile, targetCount = 50) {
  const db = readDB();
  if (!db.settings.storyPath || !db.settings.apiKey) return [];
  const response = await axios.get(`https://${db.settings.apiHost}${db.settings.storyPath}`, {
    params: { user_id: profile.userId, username: profile.username, count: targetCount },
    headers: { 'x-rapidapi-key': db.settings.apiKey, 'x-rapidapi-host': db.settings.apiHost },
    timeout: 30000
  });
  const body = response.data;
  return body?.items || body?.data?.items || body?.data?.stories || body?.stories || [];
}

async function syncProfile(profile, targetCount = 500) {
  let items = await fetchInstagramDataForProfile(profile, targetCount);
  try {
    const stories = await fetchInstagramStoriesForProfile(profile, 50);
    items = items.concat(stories.map(x => ({ ...x, is_story: true, story_type: 'story' })));
  } catch (storyError) {
    logEvent('WARN', `@${profile.username}: Hikâyeler alınamadı: ${storyError.message}`, profile.username);
  }
  const db = readDB();

  const beforeIds = new Set(db.media.filter(m => m.profileId === profile.id).map(m => String(m.id)));
  let added = 0;

  for (const item of items) {
    const media = normalizeMedia(item, profile);
    const existing = db.media.find(m => String(m.id) === String(media.id));

    if (!existing) {
      db.media.push(media);
      added++;

      if (!beforeIds.has(media.id) && !profile.muted) {
        await sendPushNotification(
          `@${profile.username} yeni paylaşım yaptı`,
          media.caption?.slice(0, 120) || 'Yeni bir Instagram içeriği yayınlandı.',
          '/'
        );
      }
    } else {
      existing.likes = Math.max(Number(existing.likes || 0), media.likes);
      existing.comments = Math.max(Number(existing.comments || 0), media.comments);
      if (media.url) existing.url = media.url;
      if (media.videoUrl) existing.videoUrl = media.videoUrl;
      if (media.takenAt) existing.takenAt = media.takenAt;
    }
  }

  // Son 500 kayıtla sınırla; eski arşiv kayıtlarını sonsuza kadar büyütmez.
  const profileMedia = db.media
    .filter(m => m.profileId === profile.id)
    .sort((a, b) => new Date(b.takenAt || b.timestamp) - new Date(a.takenAt || a.timestamp));

  const keepIds = new Set(profileMedia.slice(0, 500).map(m => String(m.id)));
  db.media = db.media.filter(m => m.profileId !== profile.id || keepIds.has(String(m.id)));

  db.logs.unshift({
    id: `${Date.now()}-${Math.random()}`,
    timestamp: new Date().toLocaleString('tr-TR'),
    type: 'SYNC',
    message: `@${profile.username}: ${items.length} içerik kontrol edildi, ${added} yeni içerik eklendi.`,
    profileUsername: profile.username
  });
  db.logs = db.logs.slice(0, 500);

  writeDB(db);
  return { checked: items.length, added };
}

async function runDailyScraperQueue() {
  const db = readDB();
  if (!db.profiles.length) return;

  for (const profile of db.profiles) {
    try {
      await syncProfile(profile, 500);
    } catch (error) {
      console.error(`[API ERROR] @${profile.username}:`, error.message);
      logEvent('ERROR', `@${profile.username}: ${error.message}`, profile.username);
    }
  }
}

app.post('/api/profiles/:id/sync-500', authGuard, async (req, res) => {
  const db = readDB();
  const profile = db.profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profil bulunamadı.' });

  try {
    const result = await syncProfile(profile, 500);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync-now', authGuard, async (req, res) => {
  await runDailyScraperQueue();
  res.json({ success: true, message: 'Instagram verileri güncellendi.' });
});

// 3 saatte bir otomatik kontrol
cron.schedule('0 */3 * * *', () => {
  runDailyScraperQueue().catch(console.error);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('🚀 Instagram Enterprise Tracker aktif');
  console.log(`PORT: ${PORT}`);
  console.log(`PUSH: ${vapidPublicKey ? 'aktif' : 'VAPID ayarı bekleniyor'}`);
  console.log('====================================================');
});
