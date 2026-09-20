const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

const initialData = {
  settings: {
    apiKey: '518c91728cmsh00a32464782b771p1a05a7jsn9e58a595c3e4',
    apiHost: 'instagram-scraper2.p.rapidapi.com',
    adminUser: 'admin',
    // Varsayılan şifre: 'admin123' (Girişte değiştirebilirsiniz)
    adminPassHash: '$2a$10$E2.3N1ZzY48P4W/.k42P2O5uB7YpZ71m3L5yMvQ2g2f3Y7Wq6mHkW' 
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
