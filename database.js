const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

function buildDefaults() {
  const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
  return {
    apiKey: '',
    apiHost: process.env.INSTAGRAM_API_HOST || 'instagram-scraper2.p.rapidapi.com',
    apiPath: process.env.INSTAGRAM_API_PATH || '/user_medias',
    userLookupPath: process.env.INSTAGRAM_USER_LOOKUP_PATH || '/search_user',
    storyPath: process.env.INSTAGRAM_STORY_PATH || '',
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPassHash: bcrypt.hashSync(defaultPassword, 10)
  };
}

function createInitialData() {
  return {
    settings: buildDefaults(),
    profiles: [],
    media: [],
    logs: [],
    pushSubscriptions: []
  };
}

function readDB() {
  const defaults = createInitialData();
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    data.settings = { ...defaults.settings, ...(data.settings || {}) };
    data.profiles = Array.isArray(data.profiles) ? data.profiles : [];
    data.media = Array.isArray(data.media) ? data.media : [];
    data.logs = Array.isArray(data.logs) ? data.logs : [];
    data.pushSubscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];

    // Eski sürümlerde parola hash'i eksik/bozuksa güvenli varsayılanı kullan.
    if (!data.settings.adminPassHash || typeof data.settings.adminPassHash !== 'string') {
      data.settings.adminPassHash = defaults.adminPassHash;
    }
    if (!data.settings.adminUser) data.settings.adminUser = defaults.adminUser;

    return data;
  } catch (err) {
    console.error('DB okuma hatası, yeni DB oluşturuluyor:', err.message);
    fs.writeFileSync(DB_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function writeDB(data) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

module.exports = { readDB, writeDB };
