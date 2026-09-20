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
      storyPath
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

function extractUserId(body) {
  const candidates = [
    body?.id,
    body?.user_id,
    body?.pk,

    body?.user?.id,
    body?.user?.pk,

    body?.data?.id,
    body?.data?.user_id,
    body?.data?.pk,

    body?.data?.user?.id,
    body?.data?.user?.pk,

    body?.result?.id,
    body?.result?.user_id,
    body?.result?.pk,

    body?.results?.[0]?.id,
    body?.results?.[0]?.pk,

    body?.users?.[0]?.id,
    body?.users?.[0]?.pk,

    body?.data?.users?.[0]?.id,
    body?.data?.users?.[0]?.pk
  ];

  const found =
    candidates.find(
      value =>
        value !== undefined &&
        value !== null &&
        String(value).trim()
    );

  return found
    ? String(found)
    : '';
}

app.get(
  '/api/instagram/resolve-user',
  authGuard,
  async (req, res) => {
    const username =
      String(
        req.query?.username || ''
      )
        .trim()
        .replace(/^@/, '');

    const db = readDB();

    if (!username) {
      return res.status(400).json({
        error:
          'Kullanıcı adı girin.'
      });
    }

    if (!db.settings.apiKey) {
      return res.status(400).json({
        error:
          'Önce RapidAPI anahtarını kaydedin.'
      });
    }

    if (!db.settings.userLookupPath) {
      return res.status(400).json({
        error:
          'User ID bulma API Path ayarlanmamış.'
      });
    }

    try {
      const response =
        await axios.get(
          `https://${db.settings.apiHost}${db.settings.userLookupPath}`,
          {
            params: {
              username,
              user_name: username,
              query: username
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

      const userId =
        extractUserId(response.data);

      if (!userId) {
        return res.status(404).json({
          error:
            "API kullanıcı ID'sini bulamadı. User ID API Path ve sağlayıcının yanıt formatını kontrol edin."
        });
      }

      return res.json({
        success: true,
        username,
        userId
      });
    } catch (error) {
      const detail =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;

      return res
        .status(
          error.response?.status || 502
        )
        .json({
          error:
            `Kullanıcı ID bulunamadı: ${detail}`
        });
    }
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
   INSTAGRAM MEDIA IMPORT
========================================================= */

async function fetchInstagramDataForProfile(
  profile,
  targetCount = 500
) {
  const db = readDB();

  const apiKey =
    db.settings.apiKey;

  const apiHost =
    db.settings.apiHost;

  const apiPath =
    db.settings.apiPath ||
    '/user_medias';

  if (!apiKey) {
    throw new Error(
      'RapidAPI anahtarı ayarlanmamış.'
    );
  }

  const collected = [];

  let cursor;
  let page = 0;

  while (
    collected.length <
      targetCount &&
    page < 20
  ) {
    const params = {
      user_id: profile.userId,
      username: profile.username,
      count: Math.min(
        50,
        targetCount -
          collected.length
      )
    };

    if (cursor) {
      params.cursor = cursor;
      params.max_id = cursor;
      params.next_max_id =
        cursor;
    }

    const response =
      await axios.get(
        `https://${apiHost}${apiPath}`,
        {
          params,

          headers: {
            'x-rapidapi-key':
              apiKey,
            'x-rapidapi-host':
              apiHost,
            'Content-Type':
              'application/json'
          },

          timeout: 30000
        }
      );

    const body =
      response.data;

    const items =
      body?.items ||
      body?.data?.items ||
      body?.data?.medias ||
      body?.data?.media ||
      body?.data ||
      body?.results ||
      [];

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      break;
    }

    collected.push(
      ...items
    );

    cursor =
      body?.next_cursor ||
      body?.pagination
        ?.next_cursor ||
      body?.data
        ?.next_cursor ||
      body?.data
        ?.pagination
        ?.next_cursor ||
      body?.next_max_id ||
      body?.data
        ?.next_max_id ||
      null;

    page++;

    if (
      !cursor ||
      items.length < 2
    ) {
      break;
    }
  }

  return collected.slice(
    0,
    targetCount
  );
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
      item.id ||
        item.pk ||
        item.media_id ||
        item.code ||
        `${profile.id}-${Date.now()}-${Math.random()}`
    );

  const mediaTypeRaw =
    item.media_type ??
    item.type;

  const mediaType =
    item.is_reel ||
    item.product_type ===
      'clips' ||
    mediaTypeRaw === 2 ||
    mediaTypeRaw ===
      'reel'
      ? 'reel'
      : item.story_type ||
          item.is_story
        ? 'story'
        : 'post';

  const imageUrl =
    item.image_versions2
      ?.candidates?.[0]
      ?.url ||
    item.thumbnail_url ||
    item.display_url ||
    item.image_url ||
    item.url ||
    '';

  const videoUrl =
    item.video_versions
      ?.[0]?.url ||
    item.video_url ||
    '';

  return {
    id: mediaId,

    profileId:
      profile.id,

    profileUsername:
      profile.username,

    type: mediaType,

    url:
      imageUrl ||
      videoUrl ||
      '',

    videoUrl,

    caption:
      item.caption?.text ||
      item.caption ||
      item.title ||
      'Açıklama yok',

    likes: Number(
      item.like_count ??
        item.likes ??
        0
    ),

    comments: Number(
      item.comment_count ??
        item.comments ??
        0
    ),

    takenAt:
      item.taken_at ||
      item.timestamp ||
      item.created_at ||
      null,

    timestamp:
      new Date().toISOString()
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

  const beforeIds =
    new Set(
      db.media
        .filter(
          m =>
            m.profileId ===
            profile.id
        )
        .map(m =>
          String(m.id)
        )
    );

  let added = 0;

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
        !beforeIds.has(
          media.id
        ) &&
        !profile.muted
      ) {
        await sendPushNotification(
          `@${profile.username} yeni paylaşım yaptı`,
          media.caption?.slice(
            0,
            120
          ) ||
            'Yeni bir Instagram içeriği yayınlandı.',
          '/'
        );
      }
    } else {
      existing.likes =
        Math.max(
          Number(
            existing.likes || 0
          ),
          media.likes
        );

      existing.comments =
        Math.max(
          Number(
            existing.comments ||
              0
          ),
          media.comments
        );

      if (media.url) {
        existing.url =
          media.url;
      }

      if (media.videoUrl) {
        existing.videoUrl =
          media.videoUrl;
      }

      if (media.takenAt) {
        existing.takenAt =
          media.takenAt;
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
              b.timestamp
          ) -
          new Date(
            a.takenAt ||
              a.timestamp
          )
      );

  const keepIds =
    new Set(
      profileMedia
        .slice(0, 500)
        .map(m =>
          String(m.id)
        )
    );

  db.media =
    db.media.filter(
      m =>
        m.profileId !==
          profile.id ||
        keepIds.has(
          String(m.id)
        )
    );

  db.logs.unshift({
    id: `${Date.now()}-${Math.random()}`,

    timestamp:
      new Date().toLocaleString(
        'tr-TR'
      ),

    type: 'SYNC',

    message:
      `@${profile.username}: ${items.length} içerik kontrol edildi, ${added} yeni içerik eklendi.`,

    profileUsername:
      profile.username
  });

  db.logs =
    db.logs.slice(0, 500);

  writeDB(db);

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
