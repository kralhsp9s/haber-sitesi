# InstaTracker Enterprise

## Kurulum
1. `npm install`
2. `npm run generate-vapid`
3. Çıkan VAPID public/private değerlerini ortam değişkenlerine koy.
4. `npm start`

Varsayılan geliştirme girişi:
- Kullanıcı: `admin`
- Şifre: `admin123`

Üretimde `ADMIN_PASSWORD`, `SESSION_SECRET` ve VAPID değerlerini mutlaka değiştir.

## Bildirimler
Kullanıcı panelde **Bildirimleri Aç** butonuna basar. Tarayıcı izin verir ve Push Subscription backend'de saklanır. Yeni içerik bulunduğunda Web Push bildirimi gönderilir.

## Ana ekrana ekleme
PWA manifest + service worker hazırdır. Destekleyen tarayıcılarda **Ana Ekrana Ekle** butonu otomatik görünür.

## 500 gönderi
Profil kartındaki **Son 500 Gönderiyi Çek** butonu profil gönderileri endpoint'ine sayfalı istekler yapar ve yerel arşivi profil başına 500 içerikle sınırlar.

Not: RapidAPI sağlayıcısına göre endpoint adı ve response alanları değişebilir. Panelde API Host ve Media API Path alanlarını sağlayıcınızın dokümantasyonuna göre ayarlayın. `user_tagged` bir profilin kendi gönderileri değil, etiketlendiği içerikler içindir.
