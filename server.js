const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const webpush = require('web-push');
const vm = require('vm');

const { readDB, writeDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================================================
   EXPRESS
========================================================= */

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   SESSION
========================================================= */

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      'instatracker-super-secret-change-this',

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   VAPID / PUSH
========================================================= */

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject =
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey
  );
}

/* =========================================================
   AUTH GUARD
========================================================= */

function authGuard(req, res, next) {
  if (req.session?.authenticated === true) {
    return next();
  }

  return res.status(401).json({
    error: 'Yetkisiz erişim. Lütfen giriş yapın.'
  });
}

/* =========================================================
   LOGIN
========================================================= */

app.post('/api/login', async (req, res) => {
  try {
    const username = String(
      req.body?.username || ''
    ).trim();

    const password = String(
      req.body?.password || ''
    );

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Kullanıcı adı ve şifre zorunludur.'
      });
    }

    const db = readDB();

    const adminUser = String(
      process.env.ADMIN_USER ||
      db.settings?.adminUser ||
      'admin'
    ).trim();

    const adminPassword = String(
      process.env.ADMIN_PASSWORD || ''
    );

    let validPassword = false;

    /*
      Öncelik:
      1. ADMIN_PASSWORD
      2. database bcrypt hash
    */

    if (adminPassword) {
      validPassword = password === adminPassword;
    } else {
      const storedHash = String(
        db.settings?.adminPassHash || ''
      );

      if (storedHash) {
        validPassword = await bcrypt.compare(
          password,
          storedHash
        );
      }
    }

    if (
      username !== adminUser ||
      !validPassword
    ) {
      console.log(
        `[LOGIN] Başarısız giriş: ${username}`
      );

      return res.status(401).json({
        success: false,
        message: 'Kullanıcı adı veya şifre hatalı!'
      });
    }

    /*
      Eski session'ı temizleyip yeni session oluşturuyoruz.
      Bu, session fixation problemlerini de önler.
    */

    req.session.regenerate(err => {
      if (err) {
        console.error(
          '[SESSION] Regenerate error:',
          err
        );

        return res.status(500).json({
          success: false,
          message: 'Oturum oluşturulamadı.'
        });
      }

      req.session.authenticated = true;
      req.session.user = username;

      req.session.save(saveError => {
        if (saveError) {
          console.error(
            '[SESSION] Save error:',
            saveError
          );

          return res.status(500).json({
            success: false,
            message: 'Oturum kaydedilemedi.'
          });
        }

        console.log(
          `[LOGIN] Başarılı giriş: ${username}`
        );

        console.log(
          `[SESSION] ID: ${req.sessionID}`
        );

        return res.json({
          success: true,
          message: 'Giriş başarılı.',
          user: username
        });
      });
    });
  } catch (error) {
    console.error(
      '[LOGIN] Error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Giriş sırasında sunucu hatası oluştu.'
    });
  }
});

/* =========================================================
   AUTH CHECK
========================================================= */

app.get('/api/auth-check', (req, res) => {
  const authenticated =
    req.session?.authenticated === true;

  console.log(
    '[AUTH CHECK]',
    'sessionID:',
    req.sessionID,
    'authenticated:',
    authenticated,
    'user:',
    req.session?.user || null
  );

  return res.json({
    authenticated,
    user: req.session?.user || null
  });
});

/* =========================================================
   LOGOUT
========================================================= */

app.post('/api/logout', (req, res) => {
  const sessionId = req.sessionID;

  req.session.destroy(err => {
    if (err) {
      console.error(
        '[LOGOUT] Session destroy error:',
        err
      );

      return res.status(500).json({
        success: false,
        message: 'Çıkış yapılamadı.'
      });
    }

    res.clearCookie('connect.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    console.log(
      `[LOGOUT] Session kapatıldı: ${sessionId}`
    );

    return res.json({
      success: true,
      message: 'Çıkış yapıldı.'
    });
  });
});

/* =========================================================
   LOG SYSTEM
========================================================= */

function logEvent(
  type,
  message,
  profileUsername = ''
) {
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

/* =========================================================
   PUSH NOTIFICATION
========================================================= */

async function sendPushNotification(
  title,
  body,
  url = '/'
) {
  if (
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return;
  }

  const db = readDB();

  const subscriptions =
    db.pushSubscriptions || [];

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
      await webpush.sendNotification(
        subscription,
        payload
      );

      remaining.push(subscription);
    } catch (err) {
      if (
        err.statusCode !== 404 &&
        err.statusCode !== 410
      ) {
        remaining.push(subscription);
      }
    }
  }

  db.pushSubscriptions = remaining;

  writeDB(db);
}

/* =========================================================
   SETTINGS
========================================================= */

app.post(
  '/api/settings',
  authGuard,
  (req, res) => {
    const {
      apiKey,
      apiHost,
      apiPath,
      userLookupPath,
      storyPath,
      sourcebinUrl
    } = req.body;

    const db = readDB();

    if (typeof apiKey === 'string') {
      db.settings.apiKey =
        apiKey.trim();
    }

    if (
      typeof apiHost === 'string' &&
      apiHost.trim()
    ) {
      db.settings.apiHost =
        apiHost.trim();
    }

    if (
      typeof apiPath === 'string' &&
      apiPath.trim()
    ) {
      db.settings.apiPath =
        apiPath.trim();
    }

    if (
      typeof userLookupPath === 'string'
    ) {
      db.settings.userLookupPath =
        userLookupPath.trim();
    }

    if (
      typeof storyPath === 'string'
    ) {
      db.settings.storyPath =
        storyPath.trim();
    }

    if (
      typeof sourcebinUrl === 'string' &&
      sourcebinUrl.trim()
    ) {
      db.settings.sourcebinUrl =
        sourcebinUrl.trim().replace(/\/$/, '');
    }

    writeDB(db);

    return res.json({
      success: true,
      message: 'Ayarlar kaydedildi.'
    });
  }
);

app.get(
  '/api/settings',
  authGuard,
  (req, res) => {
    const db = readDB();

    return res.json({
      apiKey: db.settings.apiKey,
      apiHost: db.settings.apiHost,
      apiPath: db.settings.apiPath,
      userLookupPath:
        db.settings.userLookupPath,
      storyPath: db.settings.storyPath,
      sourcebinUrl:
        db.settings.sourcebinUrl ||
        'https://sourceb.in/api',
      vapidConfigured: Boolean(
        vapidPublicKey &&
        vapidPrivateKey
      )
    });
  }
);

/* =========================================================
   PUSH API
========================================================= */

app.get(
  '/api/push/public-key',
  authGuard,
  (req, res) => {
    if (!vapidPublicKey) {
      return res.status(503).json({
        error:
          'VAPID anahtarları yapılandırılmamış.'
      });
    }

    return res.json({
      publicKey: vapidPublicKey
    });
  }
);

app.post(
  '/api/push/subscribe',
  authGuard,
  (req, res) => {
    const subscription = req.body;

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return res.status(400).json({
        error:
          'Geçersiz push aboneliği.'
      });
    }

    const db = readDB();

    db.pushSubscriptions ||= [];

    const exists =
      db.pushSubscriptions.some(
        s =>
          s.endpoint ===
          subscription.endpoint
      );

    if (!exists) {
      db.pushSubscriptions.push(
        subscription
      );
    }

    writeDB(db);

    return res.json({
      success: true
    });
  }
);

app.delete(
  '/api/push/subscribe',
  authGuard,
  (req, res) => {
    const endpoint =
      req.body?.endpoint;

    const db = readDB();

    db.pushSubscriptions =
      (
        db.pushSubscriptions || []
      ).filter(
        s => s.endpoint !== endpoint
      );

    writeDB(db);

    return res.json({
      success: true
    });
  }
);

app.post(
  '/api/push/test',
  authGuard,
  async (req, res) => {
    if (
      !vapidPublicKey ||
      !vapidPrivateKey
    ) {
      return res.status(503).json({
        error:
          'VAPID anahtarları yapılandırılmamış.'
      });
    }

    await sendPushNotification(
      'Bildirimler aktif 🔔',
      'Bildirim sistemi başarıyla çalışıyor.',
      '/'
    );

    return res.json({
      success: true
    });
  }
);

/* =========================================================
   INSTAGRAM USER ID
========================================================= */


function findFirstValueDeep(value, keys = new Set(), depth = 0, seen = new Set()) {
  if (depth > 7 || value == null) return '';
  if (typeof value !== 'object') return '';

  if (seen.has(value)) return '';
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValueDeep(item, keys, depth + 1, seen);
      if (found) return found;
    }
    return '';
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      value[key] !== undefined &&
      value[key] !== null &&
      String(value[key]).trim()
    ) {
      return String(value[key]).trim();
    }
  }

  for (const child of Object.values(value)) {
    const found = findFirstValueDeep(child, keys, depth + 1, seen);
    if (found) return found;
  }

  return '';
}

function extractUserId(body, expectedUsername = '') {
  const normalizedExpected = String(expectedUsername || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();

  const asId = value => {
    if (value === undefined || value === null) return '';
    const text = String(value).trim();
    if (!text) return '';

    // Instagram media IDs can be returned as "mediaPk_ownerId".
    if (/^\d+_\d+$/.test(text)) return text.split('_').pop();
    if (/^\d+$/.test(text)) return text;
    return '';
  };

  const getUsername = value => {
    if (!value || typeof value !== 'object') return '';
    for (const key of ['username', 'user_name', 'handle', 'userName']) {
      const candidate = String(value[key] ?? '').trim();
      if (candidate) return candidate.replace(/^@/, '');
    }
    return '';
  };

  const getDirectId = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

    // Profile/user containers have priority over a bare `id`, because a media
    // object may also contain its own (composite) `id`.
    for (const container of [
      value.user,
      value.profile,
      value.owner,
      value.author,
      value.account,
      value.user_info,
      value.userInfo
    ]) {
      if (!container || typeof container !== 'object') continue;
      for (const key of ['id', 'pk', 'user_id', 'userId', 'instagram_user_id', 'pk_id']) {
        const id = asId(container[key]);
        if (id) return id;
      }
    }

    for (const key of ['user_id', 'userId', 'instagram_user_id', 'pk_id', 'uid']) {
      const id = asId(value[key]);
      if (id) return id;
    }

    return asId(value.id) || asId(value.pk);
  };

  const isExpectedUser = value => {
    if (!normalizedExpected) return true;
    const usernames = [
      getUsername(value),
      getUsername(value?.user),
      getUsername(value?.profile),
      getUsername(value?.owner),
      getUsername(value?.author),
      getUsername(value?.account),
      getUsername(value?.user_info),
      getUsername(value?.userInfo)
    ].filter(Boolean);

    return usernames.some(name =>
      name.toLowerCase() === normalizedExpected
    );
  };

  // First inspect the common direct profile response shapes. This is important
  // for providers that return {data:{id,username}} instead of a search array.
  const directCandidates = [
    body?.user,
    body?.profile,
    body?.data?.user,
    body?.data?.profile,
    body?.result?.user,
    body?.result?.profile,
    body?.data,
    body?.result
  ];

  for (const candidate of directCandidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (isExpectedUser(candidate)) {
        const id = getDirectId(candidate);
        if (id) return id;
      }
    }
  }

  // Search endpoints commonly return data/items/users/results arrays.
  const collections = [
    body?.data,
    body?.data?.items,
    body?.data?.users,
    body?.data?.results,
    body?.users,
    body?.items,
    body?.results,
    body?.profiles,
    body?.user_results,
    body?.data?.user_results
  ];

  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!item || typeof item !== 'object') continue;
      if (!isExpectedUser(item)) continue;
      const id = getDirectId(item);
      if (id) return id;
    }
  }

  // Some providers wrap the result one or more levels deeper. Keep a bounded
  // recursive fallback, but only accept an ID when it belongs to the requested
  // username. This prevents media IDs from being mistaken for user IDs.
  const seen = new Set();
  function findMatching(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return '';
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findMatching(item, depth + 1);
        if (found) return found;
      }
      return '';
    }

    if (isExpectedUser(value)) {
      const id = getDirectId(value);
      if (id) return id;
    }

    for (const [key, child] of Object.entries(value)) {
      if (['image_versions2', 'carousel_media', 'caption', 'thumbnail_resources'].includes(key)) continue;
      const found = findMatching(child, depth + 1);
      if (found) return found;
    }
    return '';
  }

  return findMatching(body);
}

function extractUsername(body, fallback = '') {
  const keys = new Set([
    'username',
    'user_name',
    'handle'
  ]);

  return (
    findFirstValueDeep(body?.user, keys) ||
    findFirstValueDeep(body?.profile, keys) ||
    findFirstValueDeep(body?.result, keys) ||
    findFirstValueDeep(body?.data, keys) ||
    findFirstValueDeep(body, keys) ||
    fallback
  );
}


function buildRapidApiUrl(host, pathValue, username) {
  const raw = String(pathValue || '').trim();
  const encoded = encodeURIComponent(username);
  const resolved = raw
    .replace(/\{(?:username|user_name|user|name)\}/ig, encoded)
    .replace(/:username|:user|:user_name/ig, encoded);

  if (/^https?:\/\//i.test(resolved)) return resolved;
  return `https://${host}${resolved.startsWith('/') ? resolved : `/${resolved}`}`;
}

function extractUsersFromResponse(body) {
  const candidates = [
    body?.users, body?.data?.users, body?.data?.items, body?.data?.results,
    body?.items, body?.results, body?.profiles, body?.data?.profiles,
    body?.user_results, body?.data?.user_results, body?.data?.users?.items
  ];
  return candidates.find(Array.isArray) || [];
}

function responseLooksLikeUserLookup(body, username) {
  const wanted = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!wanted) return false;
  const candidates = [
    body?.user, body?.profile, body?.data?.user, body?.data?.profile,
    body?.result?.user, body?.result?.profile, body?.data, body?.result,
    ...extractUsersFromResponse(body)
  ];
  return candidates.some(value => {
    if (!value || typeof value !== 'object') return false;
    const name = String(value.username || value.user_name || value.handle || '').replace(/^@/, '').toLowerCase();
    return name === wanted;
  });
}

app.get(
  '/api/instagram/resolve-user',
  authGuard,
  async (req, res) => {
    const username =
      String(req.query?.username || '')
        .trim()
        .replace(/^@/, '');

    const db = readDB();

    if (!username) {
      return res.status(400).json({
        error: 'Kullanıcı adı girin.'
      });
    }

    if (!db.settings.apiKey) {
      return res.status(400).json({
        error: 'Önce RapidAPI anahtarını kaydedin.'
      });
    }

    const host = String(db.settings.apiHost || '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');

    const configuredPath =
      String(db.settings.userLookupPath || '/search_user').trim();

    // user_tagged profil araması için uygun değildir; kendi gönderileri/tagged
    // ayrımını netleştirmek için otomatik olarak kullanıcı arama endpoint'ine döneriz.
    // instagram-scraper2'nin herkese açık olarak indekslenmiş dokümanlarında
    // tek bir username->id endpoint sözleşmesi bulunmadığı için, panelde
    // ayarlanan yolu ilk tercih olarak kullanıp yaygın kullanıcı/profil yollarını
    // fallback olarak deniyoruz.
    const paths = [
      configuredPath,
      '/search_user',
      '/search_users',
      '/user_search',
      '/user_info',
      '/user_info_by_username',
      '/userinfo',
      '/user_by_username',
      '/users/search',
      '/search',
      '/user/{username}',
      '/users/{username}',
      '/profile/{username}',
      '/user_info/{username}'
    ].filter((p, i, arr) => p && arr.indexOf(p) === i);

    const queryVariants = [
      { username },
      { user_name: username },
      { user: username },
      { handle: username },
      { query: username },
      { q: username },
      { search: username },
      { keyword: username },
      { name: username }
    ];

    const errors = [];

    for (const pathValue of paths) {
      const hasUsernamePlaceholder = /\{(?:username|user_name|user|name)\}|:username|:user|:user_name/i.test(pathValue);
      const requests = hasUsernamePlaceholder ? [{}] : queryVariants;

      for (const params of requests) {
        try {
          const url = buildRapidApiUrl(host, pathValue, username);
          const response = await axios.get(url, {
            params,
            headers: {
              'x-rapidapi-key': db.settings.apiKey,
              'x-rapidapi-host': host,
              Accept: 'application/json',
              'User-Agent': 'InstaTracker/1.2'
            },
            timeout: 30000,
            validateStatus: status => status >= 200 && status < 300
          });

          const userId = extractUserId(response.data, username);

          if (userId) {
            return res.json({
              success: true,
              username: extractUsername(response.data, username).replace(/^@/, ''),
              userId,
              source: pathValue
            });
          }

          const shape = Array.isArray(response.data)
            ? 'array'
            : (response.data && typeof response.data === 'object' ? Object.keys(response.data).slice(0, 8).join(',') : typeof response.data);

          errors.push(`${pathValue} (${JSON.stringify(params)}): ID bulunamadı [${shape}]`);
        } catch (error) {
          const detail =
            error.response?.data?.message ||
            error.response?.data?.error ||
            error.response?.data?.detail ||
            error.response?.statusText ||
            error.message;
          errors.push(`${pathValue}: ${detail}`);
        }
      }
    }

    return res.status(404).json({
      error:
        'Kullanıcı ID çözümlenemedi. RapidAPI sağlayıcısındaki kullanıcı arama endpointini ve dönen JSON yapısını kontrol edin.',
      details: errors.slice(-12),
      tried: paths,
      hint: 'RapidAPI marketplace sayfasındaki endpoint adını INSTAGRAM_USER_LOOKUP_PATH ile açıkça ayarlayabilirsiniz.'
    });
  }
);

/* =========================================================
   PROFILES
========================================================= */

app.get(
  '/api/profiles',
  authGuard,
  (req, res) => {
    return res.json(
      readDB().profiles
    );
  }
);

app.post(
  '/api/profiles',
  authGuard,
  (req, res) => {
    const username =
      String(
        req.body?.username || ''
      )
        .toLowerCase()
        .trim()
        .replace(/^@/, '');

    const userId =
      String(
        req.body?.userId || ''
      ).trim();

    if (!username || !userId) {
      return res.status(400).json({
        error:
          'Kullanıcı adı ve User ID zorunludur.'
      });
    }

    const db = readDB();

    const exists =
      db.profiles.find(
        p =>
          p.userId === userId ||
          p.username === username
      );

    if (exists) {
      return res.status(400).json({
        error:
          'Bu profil zaten eklenmiş.'
      });
    }

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
      timestamp:
        new Date().toLocaleString(
          'tr-TR'
        ),
      type: 'SYSTEM',
      message:
        `@${newProfile.username} takibe alındı (User ID: ${newProfile.userId}).`,
      profileUsername:
        newProfile.username
    });

    db.logs =
      db.logs.slice(0, 500);

    writeDB(db);

    return res.json({
      success: true,
      profile: newProfile
    });
  }
);

app.patch(
  '/api/profiles/:id/toggle-mute',
  authGuard,
  (req, res) => {
    const db = readDB();

    const profile =
      db.profiles.find(
        p =>
          p.id === req.params.id
      );

    if (!profile) {
      return res.status(404).json({
        error:
          'Profil bulunamadı.'
      });
    }

    profile.muted =
      !profile.muted;

    writeDB(db);

    return res.json({
      success: true,
      muted: profile.muted
    });
  }
);

/* =========================================================
   MEDIA DOWNLOAD
========================================================= */

app.get(
  '/api/media/:id/download',
  authGuard,
  async (req, res) => {
    const db = readDB();

    const media =
      db.media.find(
        m =>
          String(m.id) ===
          String(req.params.id)
      );

    if (!media) {
      return res
        .status(404)
        .send('Medya bulunamadı.');
    }

    const target =
      media.videoUrl ||
      media.url;

    if (
      !target ||
      !/^https?:\/\//i.test(
        target
      )
    ) {
      return res
        .status(404)
        .send(
          'İndirilebilir medya URLsi bulunamadı.'
        );
    }

    try {
      const response =
        await axios.get(
          target,
          {
            responseType: 'stream',
            timeout: 60000,
            maxRedirects: 5
          }
        );

      const contentType =
        response.headers[
          'content-type'
        ] ||
        'application/octet-stream';

      let ext = 'jpg';

      if (
        contentType.includes('mp4')
      ) {
        ext = 'mp4';
      } else if (
        contentType.includes('webp')
      ) {
        ext = 'webp';
      } else if (
        contentType.includes('png')
      ) {
        ext = 'png';
      }

      const safeName =
        `${media.profileUsername || 'instagram'}-${String(
          media.id
        ).replace(
          /[^a-zA-Z0-9_-]/g,
          ''
        )}.${ext}`;

      res.setHeader(
        'Content-Type',
        contentType
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeName}"`
      );

      response.data.pipe(res);
    } catch (error) {
      console.error(
        '[MEDIA DOWNLOAD]',
        error.message
      );

      return res
        .status(502)
        .send(
          'Medya indirilemedi. Kaynak URL artık geçerli olmayabilir.'
        );
    }
  }
);

/* =========================================================
   MEDIA / LOGS
========================================================= */

app.get(
  '/api/media',
  authGuard,
  (req, res) => {
    return res.json(
      readDB().media
    );
  }
);

app.get(
  '/api/logs',
  authGuard,
  (req, res) => {
    return res.json(
      readDB().logs
    );
  }
);


/* =========================================================
   EVAL
========================================================= */

function safeEvalContext() {
  const output = [];

  const safeConsole = {
    log: (...args) =>
      output.push(
        args.map(formatEvalValue).join(' ')
      ),
    info: (...args) =>
      output.push(
        args.map(formatEvalValue).join(' ')
      ),
    warn: (...args) =>
      output.push(
        `WARN: ${args.map(formatEvalValue).join(' ')}`
      ),
    error: (...args) =>
      output.push(
        `ERROR: ${args.map(formatEvalValue).join(' ')}`
      )
  };

  return {
    context: vm.createContext({
      console: safeConsole,
      JSON,
      Math,
      Date,
      RegExp,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite
    }),
    output
  };
}

function formatEvalValue(value) {
  if (typeof value === 'string') return value;

  try {
    const json = JSON.stringify(value);
    return json === undefined
      ? String(value)
      : json;
  } catch (_) {
    return String(value);
  }
}

app.post(
  '/api/eval',
  authGuard,
  async (req, res) => {
    const code = String(
      req.body?.code || ''
    );

    if (!code.trim()) {
      return res.status(400).json({
        error: 'Çalıştırılacak kodu yazın.'
      });
    }

    if (code.length > 100000) {
      return res.status(413).json({
        error: 'Kod en fazla 100.000 karakter olabilir.'
      });
    }

    const { context, output } =
      safeEvalContext();

    const wrappedCode = `
      (async () => {
        ${code}
      })()
    `;

    const startedAt = Date.now();

    try {
      const result =
        await vm.runInContext(
          wrappedCode,
          context,
          {
            timeout: 5000,
            displayErrors: true
          }
        );

      if (result !== undefined) {
        output.push(formatEvalValue(result));
      }

      return res.json({
        success: true,
        result: output.join('\\n') || 'Kod başarıyla çalıştırıldı. (Çıktı yok)',
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error:
          error?.stack ||
          error?.message ||
          String(error),
        durationMs: Date.now() - startedAt
      });
    }
  }
);

/* =========================================================
   SOURCEBIN
========================================================= */

app.post(
  '/api/sourcebin',
  authGuard,
  async (req, res) => {
    const code = String(
      req.body?.code || ''
    );

    if (!code.trim()) {
      return res.status(400).json({
        error: 'Sourcebin için kod gerekli.'
      });
    }

    if (code.length > 500000) {
      return res.status(413).json({
        error: 'Sourcebin gönderisi çok büyük.'
      });
    }

    const db = readDB();
    const baseUrl = String(
      db.settings.sourcebinUrl ||
      'https://sourceb.in/api'
    ).replace(/\/+$/, '');

    try {
      const response = await fetch(
        `${baseUrl}/bins`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'InstaTracker-Eval/2.0'
          },
          body: JSON.stringify({
            title:
              String(req.body?.title || 'InstaTracker Eval').slice(0, 100),
            description:
              'InstaTracker Eval tarafından oluşturuldu.',
            files: [
              {
                name: 'eval.js',
                // JavaScript için Sourcebin Linguist ID.
                // Sağlayıcı ID değiştirirse servis yine link üretmeye çalışır.
                languageId: 372,
                content: code
              }
            ]
          })
        }
      );

      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body?.key) {
        return res.status(502).json({
          error:
            body?.message ||
            body?.error ||
            `Sourcebin HTTP ${response.status}`
        });
      }

      return res.json({
        success: true,
        key: body.key,
        url: `https://sourceb.in/${body.key}`,
        rawUrl: `https://sourceb.in/raw/${body.key}/0`
      });
    } catch (error) {
      console.error(
        '[SOURCEBIN]',
        error
      );

      return res.status(502).json({
        error:
          'Sourcebin bağlantısı kurulamadı: ' +
          error.message
      });
    }
  }
);

/* =========================================================
   INSTAGRAM MEDIA IMPORT
========================================================= */


function pickArray(body) {
  const candidates = [
    body?.items,
    body?.medias,
    body?.posts,
    body?.media,
    body?.results,
    body?.data?.items,
    body?.data?.medias,
    body?.data?.posts,
    body?.data?.media,
    body?.data?.results,
    body?.data?.xdt_api__v1__usertags__user_id__feed_connection?.edges,
    body?.xdt_api__v1__usertags__user_id__feed_connection?.edges,
    body?.data?.xdt_api__v1__feed_connection?.edges,
    body?.data?.feed_connection?.edges,
    body?.data
  ];

  return candidates.find(Array.isArray) || [];
}

function pickNextCursor(body) {
  const candidates = [
    body?.next_cursor,
    body?.nextCursor,
    body?.cursor?.next,
    body?.pagination?.next_cursor,
    body?.pagination?.nextCursor,
    body?.pagination?.next_page_token,
    body?.pagination?.nextPageToken,
    body?.pagination?.next_page,
    body?.data?.next_page,
    body?.data?.pagination?.next_page,
    body?.data?.next_cursor,
    body?.data?.nextCursor,
    body?.data?.pagination?.next_cursor,
    body?.data?.pagination?.next_page_token,
    body?.next_max_id,
    body?.data?.next_max_id,
    body?.end_cursor,
    body?.page_info?.end_cursor,
    body?.page_info?.has_next_page
      ? body?.page_info?.end_cursor
      : null,
    body?.data?.xdt_api__v1__usertags__user_id__feed_connection?.page_info?.end_cursor,
    body?.data?.xdt_api__v1__feed_connection?.page_info?.end_cursor,
    body?.data?.feed_connection?.page_info?.end_cursor
  ];

  return (
    candidates.find(
      value =>
        value !== undefined &&
        value !== null &&
        String(value).trim()
    ) ?? null
  );
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    // Instagram zaman damgaları çoğunlukla saniye cinsindedir.
    return new Date(
      value < 100000000000
        ? value * 1000
        : value
    ).toISOString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).length >= 8) {
    return new Date(
      numeric < 100000000000
        ? numeric * 1000
        : numeric
    ).toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

async function fetchInstagramDataForProfile(
  profile,
  targetCount = 500
) {
  const db = readDB();

  const apiKey = db.settings.apiKey;
  const apiHost = String(db.settings.apiHost || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const configuredPath =
    String(db.settings.apiPath || '/user_medias').trim();

  if (!apiKey) {
    throw new Error(
      'RapidAPI anahtarı ayarlanmamış.'
    );
  }

  if (
    /user_tagged|tagged/i.test(
      configuredPath
    )
  ) {
    throw new Error(
      'Seçilen Media API Path "user_tagged". Bu endpoint profilin kendi gönderilerini değil, etiketlendiği içerikleri döndürür. Kendi gönderileri için sağlayıcının /user_medias veya /user_posts benzeri endpointini kullanın.'
    );
  }

  const collected = [];
  const knownIds = new Set();

  let cursor = null;
  let previousCursor = null;
  let page = 0;

  while (
    collected.length < targetCount &&
    page < 40
  ) {
    const remaining = targetCount - collected.length;
    const count = Math.min(50, remaining);

    const params = {
      user_id: profile.userId,
      username: profile.username,
      count,
      limit: count,
      page_size: count
    };

    if (cursor) {
      params.cursor = cursor;
      params.max_id = cursor;
      params.next_max_id = cursor;
      params.next_cursor = cursor;
    }

    // Bazı sağlayıcılar sayfa numarası bekliyor.
    if (!cursor && page > 0) {
      params.page = page + 1;
    }

    const response = await axios.get(
      `https://${apiHost}${configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`}`,
      {
        params,
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': apiHost,
          Accept: 'application/json'
        },
        timeout: 45000
      }
    );

    let items = pickArray(response.data);

    // GraphQL-style Instagram connections return { edges: [{ node, cursor }] }.
    // The rest of the importer expects the actual media object.
    if (
      Array.isArray(items) &&
      items.some(item => item && item.node)
    ) {
      items = items
        .map(item => item?.node || item)
        .filter(Boolean);
    }

    if (!items.length) {
      break;
    }

    let newItems = 0;

    for (const item of items) {
      const id =
        String(
          item?.id ||
          item?.pk ||
          item?.media_id ||
          item?.code ||
          ''
        ).trim();

      const key =
        id ||
        JSON.stringify({
          taken_at:
            item?.taken_at ||
            item?.timestamp ||
            item?.created_at,
          caption:
            item?.caption?.text ||
            item?.caption ||
            '',
          url:
            item?.image_url ||
            item?.display_url ||
            item?.thumbnail_url ||
            ''
        });

      if (!knownIds.has(key)) {
        knownIds.add(key);
        collected.push(item);
        newItems++;
      }

      if (collected.length >= targetCount) break;
    }

    const nextCursor = pickNextCursor(response.data);
    previousCursor = cursor;
    cursor =
      nextCursor !== null
        ? String(nextCursor)
        : null;

    page++;

    // Sağlayıcı cursor yerine sadece page parametresi kullanıyorsa,
    // dolu bir sayfadan sonra bir sonraki sayfayı dene.
    const hasPagePagination =
      !cursor &&
      items.length >= count &&
      newItems > 0;

    if (
      collected.length >= targetCount ||
      (!cursor && !hasPagePagination) ||
      cursor === previousCursor ||
      newItems === 0
    ) {
      break;
    }
  }

  return collected.slice(0, targetCount);
}

/* =========================================================
   NORMALIZE MEDIA
========================================================= */


function normalizeMedia(
  item,
  profile
) {
  const mediaId =
    String(
      item?.id ||
      item?.pk ||
      item?.media_id ||
      item?.code ||
      `${profile.id}-${Date.now()}-${Math.random()}`
    );

  const ownerId =
    String(
      item?.owner?.id ||
      item?.user?.id ||
      item?.user?.pk ||
      item?.owner_id ||
      profile.userId ||
      ''
    ).trim();

  const mediaTypeRaw =
    item?.media_type ??
    item?.type;

  const mediaType =
    item?.is_reel ||
    item?.product_type === 'clips' ||
    mediaTypeRaw === 2 ||
    mediaTypeRaw === 'reel' ||
    mediaTypeRaw === 'clips'
      ? 'reel'
      : item?.story_type ||
        item?.is_story
        ? 'story'
        : 'post';

  const firstImage =
    item?.image_versions2?.candidates?.[0] ||
    item?.carousel_media?.[0]?.image_versions2?.candidates?.[0];

  const imageUrl =
    firstImage?.url ||
    item?.display_uri ||
    item?.thumbnail_url ||
    item?.display_url ||
    item?.image_url ||
    item?.url ||
    '';

  const videoUrl =
    item?.video_versions?.[0]?.url ||
    item?.video_url ||
    item?.carousel_media?.[0]?.video_versions?.[0]?.url ||
    '';

  const caption =
    item?.caption?.text ||
    item?.caption ||
    item?.title ||
    '';

  const user =
    item?.user ||
    item?.owner ||
    {};

  const takenAt = normalizeTimestamp(
    item?.taken_at ||
    item?.timestamp ||
    item?.created_at ||
    item?.created_time ||
    null
  );

  return {
    id: mediaId,
    pk: String(item?.pk || mediaId),
    code: String(item?.code || ''),
    ownerId,
    profileId: profile.id,
    profileUsername:
      String(
        user?.username ||
        profile.username ||
        ''
      ).replace(/^@/, ''),
    username:
      String(user?.username || profile.username || '').replace(/^@/, ''),
    type: mediaType,
    productType: item?.product_type || 'feed',
    url: imageUrl || videoUrl || '',
    videoUrl,
    displayUri: item?.display_uri || imageUrl || '',
    caption: caption || 'Açıklama yok',
    accessibilityCaption:
      item?.accessibility_caption ||
      '',
    likes: Number(
      item?.like_count ??
      item?.likes ??
      0
    ),
    comments: Number(
      item?.comment_count ??
      item?.comments ??
      0
    ),
    viewCount:
      item?.view_count == null
        ? null
        : Number(item.view_count),
    commentsDisabled:
      item?.comments_disabled ?? null,
    likeAndViewCountsDisabled:
      Boolean(item?.like_and_view_counts_disabled),
    audience:
      item?.audience ?? null,
    carouselMediaCount:
      item?.carousel_media_count ?? null,
    originalHeight:
      Number(item?.original_height || firstImage?.height || 0) || null,
    originalWidth:
      Number(item?.original_width || firstImage?.width || 0) || null,
    imageWidth:
      Number(firstImage?.width || 0) || null,
    imageHeight:
      Number(firstImage?.height || 0) || null,
    takenAt,
    timestamp: new Date().toISOString()
  };
}

/* =========================================================
   STORIES
========================================================= */

async function fetchInstagramStoriesForProfile(
  profile,
  targetCount = 50
) {
  const db = readDB();

  if (
    !db.settings.storyPath ||
    !db.settings.apiKey
  ) {
    return [];
  }

  const response =
    await axios.get(
      `https://${db.settings.apiHost}${db.settings.storyPath}`,
      {
        params: {
          user_id:
            profile.userId,
          username:
            profile.username,
          count: targetCount
        },

        headers: {
          'x-rapidapi-key':
            db.settings.apiKey,

          'x-rapidapi-host':
            db.settings.apiHost
        },

        timeout: 30000
      }
    );

  const body =
    response.data;

  return (
    body?.items ||
    body?.data?.items ||
    body?.data?.stories ||
    body?.stories ||
    []
  );
}

/* =========================================================
   SYNC PROFILE
========================================================= */


async function syncProfile(
  profile,
  targetCount = 500
) {
  const startedAt = new Date().toISOString();

  let items =
    await fetchInstagramDataForProfile(
      profile,
      targetCount
    );

  try {
    const stories =
      await fetchInstagramStoriesForProfile(
        profile,
        50
      );

    items =
      items.concat(
        stories.map(x => ({
          ...x,
          is_story: true,
          story_type: 'story'
        }))
      );
  } catch (storyError) {
    logEvent(
      'WARN',
      `@${profile.username}: Hikâyeler alınamadı: ${storyError.message}`,
      profile.username
    );
  }

  const db = readDB();

  const existedBeforeSync =
    Boolean(profile.initialized);

  let added = 0;
  let newForNotification = 0;

  for (const item of items) {
    const media =
      normalizeMedia(
        item,
        profile
      );

    const existing =
      db.media.find(
        m =>
          String(m.id) ===
          String(media.id)
      );

    if (!existing) {
      db.media.push(media);
      added++;

      if (
        existedBeforeSync &&
        !profile.muted
      ) {
        newForNotification++;
      }
    } else {
      existing.likes =
        Math.max(
          Number(existing.likes || 0),
          media.likes
        );

      existing.comments =
        Math.max(
          Number(existing.comments || 0),
          media.comments
        );

      if (media.url) existing.url = media.url;
      if (media.videoUrl) existing.videoUrl = media.videoUrl;
      if (media.takenAt) existing.takenAt = media.takenAt;
      if (!existing.caption && media.caption) {
        existing.caption = media.caption;
      }
    }
  }

  const profileMedia =
    db.media
      .filter(
        m =>
          m.profileId ===
          profile.id
      )
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

  const keepIds =
    new Set(
      profileMedia
        .slice(0, 500)
        .map(m => String(m.id))
    );

  db.media =
    db.media.filter(
      m =>
        m.profileId !== profile.id ||
        keepIds.has(String(m.id))
    );

  const dbProfile =
    db.profiles.find(
      p => p.id === profile.id
    );

  if (dbProfile) {
    dbProfile.initialized = true;
    dbProfile.lastSyncAt = startedAt;
  }

  db.logs.unshift({
    id: `${Date.now()}-${Math.random()}`,
    timestamp: new Date().toLocaleString('tr-TR'),
    type: 'SYNC',
    message:
      `@${profile.username}: ${items.length} içerik kontrol edildi, ${added} yeni içerik eklendi.`,
    profileUsername: profile.username
  });

  db.logs = db.logs.slice(0, 500);

  writeDB(db);

  if (
    existedBeforeSync &&
    newForNotification > 0 &&
    !profile.muted
  ) {
    await sendPushNotification(
      `@${profile.username} yeni içerik yayınladı`,
      `${newForNotification} yeni Instagram içeriği bulundu.`,
      '/'
    );
  }

  return {
    checked: items.length,
    added
  };
}

/* =========================================================
   AUTO SYNC
========================================================= */

async function runDailyScraperQueue() {
  const db = readDB();

  if (!db.profiles.length) {
    return;
  }

  for (const profile of db.profiles) {
    try {
      await syncProfile(
        profile,
        500
      );
    } catch (error) {
      console.error(
        `[API ERROR] @${profile.username}:`,
        error.message
      );

      logEvent(
        'ERROR',
        `@${profile.username}: ${error.message}`,
        profile.username
      );
    }
  }
}

/* =========================================================
   PROFILE SYNC API
========================================================= */

app.post(
  '/api/profiles/:id/sync-500',
  authGuard,
  async (req, res) => {
    const db = readDB();

    const profile =
      db.profiles.find(
        p =>
          p.id ===
          req.params.id
      );

    if (!profile) {
      return res.status(404).json({
        error:
          'Profil bulunamadı.'
      });
    }

    try {
      const result =
        await syncProfile(
          profile,
          500
        );

      return res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error(
        '[SYNC ERROR]',
        error
      );

      return res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   SYNC ALL
========================================================= */

app.post(
  '/api/sync-now',
  authGuard,
  async (req, res) => {
    try {
      await runDailyScraperQueue();

      return res.json({
        success: true,
        message:
          'Instagram verileri güncellendi.'
      });
    } catch (error) {
      console.error(
        '[SYNC NOW ERROR]',
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   CRON
========================================================= */

cron.schedule(
  '0 */3 * * *',
  () => {
    console.log(
      '[CRON] Otomatik Instagram kontrolü başladı.'
    );

    runDailyScraperQueue()
      .then(() => {
        console.log(
          '[CRON] Otomatik kontrol tamamlandı.'
        );
      })
      .catch(error => {
        console.error(
          '[CRON ERROR]',
          error
        );
      });
  }
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      '===================================================='
    );

    console.log(
      '🚀 Instagram Enterprise Tracker aktif'
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `PUSH: ${
        vapidPublicKey
          ? 'aktif'
          : 'VAPID ayarı bekleniyor'
      }`
    );

    console.log(
      `ADMIN USER: ${
        process.env.ADMIN_USER ||
        'database/default'
      }`
    );

    console.log(
      '===================================================='
    );
  }
);
