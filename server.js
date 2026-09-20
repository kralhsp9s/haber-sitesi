const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const { readDB, writeDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session Yapılandırması
app.use(session({
  secret: 'enterprise-insta-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 saat
}));

// Auth Middleware (Giriş Yapılmamışsa Erişimi Engeller)
function authGuard(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
}

// ---------------- API ENDPOINTS ----------------

// 1. LOGIN
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

// 2. LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 3. AUTH STATUS
app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// 4. API KEY & SETTINGS UPDATE
app.post('/api/settings', authGuard, (req, res) => {
  const { apiKey } = req.body;
  const db = readDB();
  if (apiKey) db.settings.apiKey = apiKey.trim();
  writeDB(db);
  res.json({ success: true, message: 'API Anahtarı başarıyla güncellendi.' });
});

app.get('/api/settings', authGuard, (req, res) => {
  const db = readDB();
  res.json({ apiKey: db.settings.apiKey, apiHost: db.settings.apiHost });
});

// 5. PROFILLERI GETIR VE EKLE
app.get('/api/profiles', authGuard, (req, res) => {
  const db = readDB();
  res.json(db.profiles);
});

app.post('/api/profiles', authGuard, (req, res) => {
  const { username, userId } = req.body;
  if (!username || !userId) {
    return res.status(400).json({ error: 'Kullanıcı adı ve User ID zorunludur.' });
  }

  const db = readDB();
  const exists = db.profiles.find(p => p.userId === userId);
  if (exists) {
    return res.status(400).json({ error: 'Bu profil zaten eklenmiş.' });
  }

  const newProfile = {
    id: Date.now().toString(),
    username: username.toLowerCase().trim(),
    userId: userId.trim(),
    muted: false,
    addedAt: new Date().toISOString()
  };

  db.profiles.push(newProfile);
  db.logs.unshift({
    id: Date.now().toString(),
    timestamp: new Date().toLocaleString('tr-TR'),
    type: 'SYSTEM',
    message: `@${newProfile.username} takibe alındı (User ID: ${userId}).`,
    profileUsername: newProfile.username
  });

  writeDB(db);
  res.json({ success: true, profile: newProfile });
});

// 6. PROFIL AYARI GÜNCELLE (Sessize Al / Bildirim Aç)
app.patch('/api/profiles/:id/toggle-mute', authGuard, (req, res) => {
  const db = readDB();
  const profile = db.profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profil bulunamadı' });

  profile.muted = !profile.muted;
  writeDB(db);
  res.json({ success: true, muted: profile.muted });
});

// 7. MEDYALARI LİSTELE
app.get('/api/media', authGuard, (req, res) => {
  const db = readDB();
  res.json(db.media);
});

// 8. CANLI SISTEM LOGLARI
app.get('/api/logs', authGuard, (req, res) => {
  const db = readDB();
  res.json(db.logs);
});

// ---------------- INSTAGRAM DATA SCRAPER ----------------
async function fetchInstagramDataForProfile(profile) {
  const db = readDB();
  const apiKey = db.settings.apiKey;
  const apiHost = db.settings.apiHost;

  if (!apiKey) return;

  try {
    const options = {
      method: 'GET',
      url: `https://${apiHost}/user_tagged`,
      params: { user_id: profile.userId, count: 50 },
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': apiHost,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.request(options);
    const apiData = response.data;

    if (apiData && (apiData.items || apiData.data)) {
      const items = apiData.items || apiData.data || [];
      
      const isFirstSync = !db.media.some(m => m.profileId === profile.id);

      items.forEach(item => {
        const mediaId = item.id || item.pk;
        const currentLikes = item.like_count || 0;
        const currentComments = item.comment_count || 0;
        const mediaType = item.media_type === 2 ? 'reel' : (item.story_type ? 'story' : 'post');
        const mediaUrl = item.image_versions2?.candidates?.[0]?.url || item.video_versions?.[0]?.url || '';
        const caption = item.caption?.text || 'Açıklama yok';

        const existingMedia = db.media.find(m => m.id === mediaId);

        if (!existingMedia) {
          db.media.push({
            id: mediaId,
            profileId: profile.id,
            profileUsername: profile.username,
            type: mediaType,
            url: mediaUrl,
            caption: caption,
            likes: currentLikes,
            comments: currentComments,
            timestamp: new Date().toLocaleString('tr-TR')
          });

          if (!isFirstSync && !profile.muted) {
            db.logs.unshift({
              id: Date.now().toString() + Math.random(),
              timestamp: new Date().toLocaleString('tr-TR'),
              type: 'NEW_POST',
              message: `@${profile.username} yeni bir ${mediaType.toUpperCase()} paylaştı!`,
              profileUsername: profile.username
            });
          }
        } else {
          if (currentLikes > existingMedia.likes) {
            existingMedia.likes = currentLikes;
          }
          if (currentComments > existingMedia.comments) {
            existingMedia.comments = currentComments;
          }
        }
      });
      
      if (isFirstSync) {
        db.logs.unshift({
          id: Date.now().toString(),
          timestamp: new Date().toLocaleString('tr-TR'),
          type: 'SYSTEM',
          message: `@${profile.username} için geçmiş arşiv başarıyla çekildi. (${items.length} içerik)`,
          profileUsername: profile.username
        });
      }

      writeDB(db);
    }
  } catch (error) {
    console.error(`[API ERROR] @${profile.username}:`, error.message);
  }
} // <-- EKSİK OLAN PARANTEZ BURAYA EKLENDİ

// MANÜEL TETİKLEME / CRON ORTAK METODU
async function runDailyScraperQueue() {
  const db = readDB();
  if (db.profiles.length === 0) {
    console.log('[CRON] Takip edilen profil yok. Tarama pas geçildi.');
    return;
  }
  console.log(`[CRON LOG] Günde 8 istek hakkından biri çalıştırılıyor. Toplam Profil: ${db.profiles.length}`);
  
  for (const profile of db.profiles) {
    await fetchInstagramDataForProfile(profile);
  }
}

// MANÜEL SENKRONİZASYON API
app.post('/api/sync-now', authGuard, async (req, res) => {
  await runDailyScraperQueue();
  res.json({ success: true, message: 'Instagram verileri başarıyla güncellendi.' });
});

// CRON ZAMANLAYICI: Her 3 saatte bir çalışır (Günde tam 8 İstek)
cron.schedule('0 */3 * * *', () => {
  console.log('[CRON OTO] 3 Saatlik periyot tetiklendi.');
  runDailyScraperQueue();
});

// Static Dosya Sunumu
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Instagram Enterprise System Render'da Aktif!`);
  console.log(`PORT: ${PORT}`);
  console.log(`====================================================`);
});
