const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
const hashedPassword = bcrypt.hashSync(defaultPassword, 10);

const initialData = {
  settings: {
    apiKey: '',
    apiHost: process.env.INSTAGRAM_API_HOST || 'instagram-scraper2.p.rapidapi.com',
    apiPath: process.env.INSTAGRAM_API_PATH || '/user_medias',
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPassHash: hashedPassword
  },
  profiles: [],
  media: [],
  logs: [],
  pushSubscriptions: []
};

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    data.settings ||= initialData.settings;
    data.profiles ||= [];
    data.media ||= [];
    data.logs ||= [];
    data.pushSubscriptions ||= [];
    return data;
  } catch (err) {
    console.error('DB Okuma Hatası, sıfırlanıyor:', err);
    return initialData;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { readDB, writeDB };
