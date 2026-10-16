# retro-kanban-app

[retro-kanban](https://github.com/einaruk/retro-kanban) ödev panosunun telefon uygulaması. Ana
ekrana eklenen bir web uygulamasıdır (PWA); App Store, Mac ya da geliştirici hesabı gerekmez.

**Adres:** https://einaruk.github.io/retro-kanban-app/ (GitHub Pages, `main` dalının kökü)

Bu depoda yalnız statik kod vardır, ödev verisi yoktur. Uygulama kartları telefondaki token ile
doğrudan retro-kanban deposunun GitHub issue'larından okur ve yazar; bilgisayardaki sunucuya
bağlanmaz. Sütun değiştirme, düzenleme, elle kart ekleme ve silme yapılır; silme masaüstündeki
gibi "not planned" kapatmadır.

## Telefona kurulum

1. Adresi Safari'de aç → Paylaş → **Ana Ekrana Ekle**.
2. Ana ekrandaki **Ödevler** simgesinden aç (Safari ile ana ekran uygulaması ayar paylaşmaz).
3. Ayarlar'a depo adını (`einaruk/retro-kanban`) ve bir
   [fine-grained token](https://github.com/settings/personal-access-tokens/new) gir: yalnız o
   depo, **Issues: Read and write**. Token yalnız telefonda saklanır, yalnız api.github.com'a gider.
4. **Bildirimleri aç** (iOS 16.4+). Bildirimleri bilgisayardaki retro-kanban gönderir; kurulum
   orada `npm run notify -- setup` ile yapılır.

## Geliştirme

```bash
npm start                # http://127.0.0.1:4174 (localhost'ta service worker da çalışır)
npm run sync-issues      # issues.js'i ../retro-kanban/src/issues.js ile eşitle
git push                 # yayın: Pages main'i 1-2 dakikada sunar
```

| Dosya | |
|---|---|
| `index.html` | arayüz (Win98 görünümü, sekmeli sütunlar) |
| `app.js` | pano, düzenleme, ayarlar, bildirim aboneliği |
| `github.js` | tarayıcıdan GitHub REST çağrıları |
| `issues.js` | kart ↔ issue eşlemesi; retro-kanban'daki `src/issues.js`'in **kopyası**, elle değiştirilmez |
| `sw.js` | çevrimdışı açılış (önce ağ) ve push bildirimlerini gösterme |

Bildirim aboneliği: uygulama retro-kanban'daki `bildirim-abonelik` etiketli kapalı issue'nun
gövdesinden VAPID açık anahtarını okur, aboneliğini o issue'ya yorum olarak yazar.
