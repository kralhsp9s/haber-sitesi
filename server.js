const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();

  if (username === db.settings.adminUser && bcrypt.compareSync(password, db.settings.adminPassHash)) {
    req.session.authenticated = true;
    req.session.user = username;
    return res.json({ success: true, message: 'Giriş başarılı.' });
  }

  return res.status(400).json({ success: false, message: 'Kullanıcı adı veya şifre hatalı!' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// SETTINGS
app.post('/api/settings', authGuard, (req, res) => {
  const { apiKey, apiHost, apiPath } = req.body;
  const db = readDB();

  if (typeof apiKey === 'string') db.settings.apiKey = apiKey.trim();
  if (typeof apiHost === 'string' && apiHost.trim()) db.settings.apiHost = apiHost.trim();
  if (typeof apiPath === 'string' && apiPath.trim()) db.settings.apiPath = apiPath.trim();

  writeDB(db);
  res.json({ success: true, message: 'Ayarlar kaydedildi.' });
});

app.get('/api/settings', authGuard, (req, res) => {
  const db = readDB();
  res.json({
    apiKey: db.settings.apiKey,
    apiHost: db.settings.apiHost,
    apiPath: db.settings.apiPath,
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

// PROFILES
app.get('/api/profiles', authGuard, (req, res) => {
  res.json(readDB().profiles);
});

app.post('/api/profiles', authGuard, (req, res) => {
  const { username, userId } = req.body;
  if (!username || !userId) {
    return res.status(400).json({ error: 'Kullanıcı adı ve User ID zorunludur.' });
  }

  const db = readDB();
  const exists = db.profiles.find(p => p.userId === userId.trim());
  if (exists) return res.status(400).json({ error: 'Bu profil zaten eklenmiş.' });

  const newProfile = {
    id: Date.now().toString(),
    username: username.toLowerCase().trim().replace(/^@/, ''),
    userId: userId.trim(),
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

async function syncProfile(profile, targetCount = 500) {
  const items = await fetchInstagramDataForProfile(profile, targetCount);
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
