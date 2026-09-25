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


## 1.2.x değişiklikleri

### Bildirimler
Panelde **Bildirim** butonu tarayıcının yerel bildirim iznini ister, Push aboneliğini kaydeder ve test bildirimi yollar. Yeni içerik geldiğinde sonraki senkronizasyonlarda bildirim gönderilir. İlk 500'lük tarihçe yüklenirken bildirim spam'i yapılmaz.

### Ana ekrana ekleme
**Ana Ekrana Ekle** butonu artık destekleyen tarayıcılarda PWA kurulum penceresini açar. Kurulum API'sini desteklemeyen iPhone/iPad gibi ortamlarda ilgili tarayıcı menüsündeki ana ekrana ekleme adımlarını gösterir.

### Tam Eval
**Tam Eval** menüsünde:
- JavaScript kodu çalıştırma,
- normal metin çıktısını görme,
- sonucu panoya kopyalama,
- kodu `.txt` olarak indirme,
- kodu Sourcebin'e yükleyip bağlantı alma

özellikleri vardır.

Eval alanı sınırlı bir `node:vm` bağlamında çalışır. `require`, `process`, dosya sistemi ve ağ erişimi doğrudan bağlama eklenmez. Bu nedenle tam sunucu yetkili `eval` yerine kontrollü kod çalıştırma yaklaşımı kullanılır.

### Instagram User ID
User ID çözümleme farklı RapidAPI sağlayıcılarının yanıtlarını destekler: doğrudan `{id, username}`, `data.id`, `data.items[].id`, `data.users[].id`, `user.id`, `user.pk` ve benzeri yapılar taranır. Username'i URL'de taşıyan `/user/{username}` gibi endpointler ile `/v2/user/by/username?username=...` ve `/v1/instagram/profile?username=...` biçimleri de otomatik denenir. Arama sonuçlarında ise istenen username ile eşleşme yapılmadan ID kabul edilmez; böylece başka hesabın ID'sinin alınması engellenir.

### Son 500 içerik
Media import tarafında cursor, `next_cursor`, `next_max_id`, `end_cursor`, pagination token ve benzeri yaygın sayfalama alanları desteklenir. Aynı kayıt tekrar dönerse dedupe edilir ve 500 benzersiz içerik hedeflenir.

Önemli: `/user_tagged` bir kullanıcının **kendi gönderileri** için değildir; etiketlendiği içerikleri döndürür. Kendi gönderilerini almak için RapidAPI sağlayıcınızın `/user_medias`, `/user_posts` veya eşdeğer endpointini kullanın.

RapidAPI kimlik doğrulamasında `X-RapidAPI-Host` ve `X-RapidAPI-Key` başlıklarının kullanılması gerektiği RapidAPI dokümantasyonunda belirtiliyor. citeturn769200search12

Sourcebin tarafında güncel açık API istemcisi `https://sourceb.in/api/bins` POST akışını kullanıyor. Projede harici Sourcebin npm paketi eklemek yerine Node 18+ yerleşik `fetch` kullanıldı; böylece mevcut `node >=18` şartı korunuyor. citeturn876112view0turn828364view0


## API response uyumluluğu

İçe aktarıcı, GraphQL/XDT biçimindeki şu yapıyı da destekler:

`data.xdt_api__v1__usertags__user_id__feed_connection.edges[].node`

Bu yanıtta medya için `node.pk`, `node.code`, `node.id`, `node.owner.id`, `node.user.id`, `node.display_uri`,
`node.image_versions2.candidates`, `node.accessibility_caption`, `node.caption.text`,
`node.like_count`, `node.comment_count`, `node.original_width` ve `node.original_height` gibi alanlar korunur.

Önemli ayrım: `node.id` medya kaydı için kullanılan birleşik bir ID olabilir (ör. `mediaPk_ownerId`).
Instagram kullanıcı ID'si çözümlemesinde `user.id`, `user.pk` veya `owner.id` önceliklidir; böylece medya ID'sinin
yanlışlıkla User ID olarak kaydedilmesi engellenir.

GraphQL bağlantısındaki `edges` kayıtları `node` nesnesine dönüştürülür ve `page_info.end_cursor` ile sonraki sayfa
çekilir. Bu nedenle örnek API çıktısındaki `has_next_page: true` durumu da desteklenir.

\n## Günlük API kotası\n\nRapidAPI istekleri UTC gününe göre DB'de sayılır ve günlük 8 istekle sınırlandırılır. Oturum açtıktan sonra `GET /api/usage` endpoint'i kullanılan/kalan kotayı verir. Otomatik kontrol zamanlaması günde bire düşürüldü.\n