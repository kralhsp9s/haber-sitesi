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


## Yeni sürüm

- Giriş sistemi mevcut `data.json` ile uyumlu şekilde migrate edilir.
- Instagram kullanıcı adı girilip **ID Bul** ile numeric User ID çözümlenir. User ID endpoint'i RapidAPI sağlayıcısına göre `.env` veya API Ayarları ekranından değiştirilebilir.
- Post/Reels/Hikâye kartlarında **İndir** butonu bulunur. Yalnızca API'nin sağladığı erişilebilir medya URL'leri indirilir.
- Karanlık / Aydınlık / Otomatik tema seçimi ve cihaz tercihi desteği eklendi.
- Bildirim ve PWA özellikleri korunmuştur.

### Varsayılan giriş

İlk çalıştırmada `.env` içindeki `ADMIN_USER` ve `ADMIN_PASSWORD` kullanılır. Mevcut `data.json` varsa ayarları silmeden eksik alanlar tamamlanır.

### Instagram API

API sağlayıcıları endpoint ve JSON alanlarını değiştirebildiği için `INSTAGRAM_API_PATH`, `INSTAGRAM_USER_LOOKUP_PATH` ve `INSTAGRAM_STORY_PATH` değerlerini kullandığınız RapidAPI dokümantasyonuna göre ayarlayın.
