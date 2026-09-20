const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

// Varsayılan şifreyi otomatik hash'liyoruz
const defaultPassword = 'admin123';
const salt = bcrypt.genSaltSync(10);
const hashedPassword = bcrypt.hashSync(defaultPassword, salt);

const initialData = {
  settings: {
    apiKey: '518c91728cmsh00a32464782b771p1a05a7jsn9e58a595c3e4',
    apiHost: 'instagram-scraper2.p.rapidapi.com',
    adminUser: 'admin',
    adminPassHash: hashedPassword 
  },
  profiles: [], // { id, username, userId, muted: false, addedAt }
  media: [],    // { id, profileId, type: 'reel'|'story'|'post', url, caption, likes, comments, timestamp }
  logs: []      // { id, timestamp, type: 'LIKE'|'COMMENT'|'NEW_POST'|'SYSTEM', message, profileUsername }
};

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("DB Okuma Hatası, sıfırlanıyor:", err);
    return initialData;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { readDB, writeDB };
