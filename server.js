const express = require('express');
// 1. DEĞİŞİKLİK: Sadece 'haber' fonksiyonunu modülden çekiyoruz (Destructuring)
const { haber } = require('haberler'); 
const path = require('path');

const app = express();
const PORT = process.env.PORT ||10000|| 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/haberler', async (req, res) => {
    try {
        // 2. DEĞİŞİKLİK: Sahibinin örneğindeki gibi doğrudan haber() fonksiyonunu çalıştırıyoruz
        const haberListesi = await haber(); 
        console.log(haberListesi)
        // Başarılı olursa veriyi JSON olarak frontend'e gönder
        res.status(200).json(haberListesi);
    } catch (error) {
        console.error("Haberler çekilirken bir hata oluştu:", error);
        res.status(500).json({ mesaj: "Haberler şu anda yüklenemiyor." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Sunucu http://localhost:${PORT} adresinde başarıyla çalışıyor.`);
});
