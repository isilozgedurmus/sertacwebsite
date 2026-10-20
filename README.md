# Kelime

Telefon ve tablet için Türkçe arayüzlü kişisel İngilizce kelime defteri. HTML, CSS ve JavaScript arayüzü; hesapla korunan Sites Worker ve D1 veritabanı.

## Yerel önizleme

`npm install`, `npm run db:generate` (yalnız şema değiştiğinde), `npm run build` ve `node scripts/preview.mjs` çalıştır. Önizleme http://127.0.0.1:4174 adresinde açılır. Bu adres yalnız yerel test hesabını ve `.sites-runtime/preview.sqlite` dosyasını kullanır; üretim kayıtlarına erişmez.

## İlk sürüm

- 5 günde 35 kelimelik açıkça işaretli örnek defter; günlük 5 hedef ve birikimli 35 hedef içeren iki özgün pasaj.
- Kelime ekleme/düzenleme, tarihe göre günlük listeler, alfabetik arama ve filtreleme.
- Metin içi kelime kartları: Türkçe anlam, İngilizce eş/zıt anlam ve örnek cümle. Diğer kelimeler deftere eklenebilir.
- Çoktan seçmeli, True/False/Not Given ve boşluk doldurma soruları; cevap kontrolü, Türkçe açıklamalar, sonuç kaydı.
- Yalnızca İngilizce kelime yazarak otomatik Türkçe anlam, İngilizce eş/zıt anlam, kelime türü ve kaynakta varsa örnek cümle. Yazma durduğunda otomatik sorgu, iptal edilebilir istekler, eski yanıtları ayıklama ve 30 günlük yerel önbellek.
- iPad’in yerleşik Scribble / Karalama özelliğine uygun metin alanları; ayrıca Pointer Events ile kalem alanı. Yazma bittikten sonra TrOCR el yazısını cihazda tanır, sonucu düzenlenebilir kelime kutusuna aktarır ve anlam sorgusunu başlatır. Kelime yalnız kullanıcı kaydettiğinde deftere eklenir.
- Kelime sayısı, çalışma serisi, 7 günlük grafik ve çalışma sonuçları.
- JSON yedek indirme ve birleştirerek yükleme; çalışma paketlerini hedef kelime kapsaması kontrolüyle içe aktarma.

Kişisel defter ChatGPT oturumuna bağlı D1 kayıtlarıyla otomatik eşitlenir. Tarayıcıdaki `localStorage` cihaz kopyası ve çevrim dışı bekleyen değişiklikler içindir. İlk bulut aktarımından önce `kelime-sync-migration-backup-v1` anahtarına yerel yedek alınır. Kullanıcıya göre sunucu yetkilendirmesi uygulanır; hesabın değişmesi halinde eski hesabın cihaz kayıtlarının yeni hesaba yüklenmesi durdurulur. Günler Europe/Istanbul saat dilimine göre belirlenir.

Yeni yapay zekâ pasajları otomatik üretilmez: “Çalışma paketi hazırla” iki kelime listesini ve JSON şemasını içeren sohbet isteğini oluşturur. Sohbette hazırlanan JSON dosyası Okuma çalışmaları ekranına yüklenir. API anahtarı istemciye konulmamıştır. Bu çalışmalar resmî IELTS/TOEFL sınav materyali değildir.

Sıradaki geliştirme: sunucu taraflı otomatik pasaj üretimi.

## Otomatik sözlük ve el yazısı

`web/lookup.js`, [Free Dictionary API](https://dictionaryapi.dev/) ile İngilizce tanımı, [MyMemory](https://mymemory.translated.net/doc/spec.php) ile Türkçe çeviriyi ve [Datamuse API](https://www.datamuse.com/api/) ile WordNet eş/zıt anlam ilişkilerini sorgular. Tanım servisi erişilemezse Datamuse'un tam kelime eşleşmeli tanım ve kelime türü bilgileri kullanılır. Yalnız sorgulanan kelime ve servis için gereken sabit parametreler gönderilir; bütün defter veya hesap bilgileri gönderilmez. 12 temel kişi zamirinin temel kullanımı gözden geçirilmiş yerel kayıtlarla önceliklendirilir; böylece `they` gibi kelimelerde nadir fiil anlamları veya yanlış önbellek sonuçları kullanılmaz. Diğer kelimelerde nadir/eski tanımlar varsa önce güncel etiketlenmemiş tanım seçilir; örnek cümle ve tanıma bağlı ilişkiler başka bir anlamdan karıştırılmaz. Türkçe çeviri ayrı hizmetten gelir ve İngilizce tanımla aynı anlamı seçtiği doğrulanamaz; bu nedenle arayüz çeviriyi öneri olarak gösterir. Birden fazla anlam varsa bağlam kontrolü istenir. Bilgiler elle düzenlenebilir. Çeviri seçiminde yalnız aynı İngilizce kelimeye ait en→tr etiketli, en az 0.8 eşleşmeli ve 60 kalite puanlı alternatifler değerlendirilir. Sayılar, karışık sayı/metin, HTML, URL, servis mesajları ve Latin dışı metinler elenir; ilk sonuç bozuksa geçerli alternatif kullanılır, hepsi bozuksa anlam boş bırakılır. Bu biçim/kaynak denetimi anlamsal doğruluk garantisi değildir. Çok anlamlı kayıtlarda tanıma bağlı eş/zıt anlam yoksa genel kelime ilişkilerinden rastgele bir karşılık seçilmez; bağlama bağlı olduğu belirtilir. `-ing` biçimlerinde olası kökler Datamuse üzerinde tam kelime ve fiil kaydıyla doğrulanır; girilen kelime korunur ve kök, tanım ile ilişkilerin köke ait olduğu açıklamasıyla gösterilir. İsim/sıfat kullanımı cümleye bağlıdır. Eski v2/v3 çeviri önbelleği kullanılmaz; daha önce deftere kaydedilen yanlış kayıtlar kelime kartındaki “Anlamları yeniden bul” ile yeniden sorgulanıp kaydedilebilir. Servis hatası, kota veya bulunamayan kelime kullanıcıya açıkça gösterilir. Gerçek bir zıt anlam ilişkisi bulunmazsa yeni bir karşılık uydurulmaz. İnternet yokken önceki önbellek ve örnek sözlük çalışır; yeni kelime anlamı bekleniyor olarak da kaydedilebilir.

Datamuse dokümanı 2027 başında API anahtarı gereksinimine geçileceğini duyuruyor; bu tarihten önce sunucu taraflı anahtar veya başka sözlük sağlayıcısına geçilmelidir. MyMemory'nin ücretsiz sorgu kotası vardır.

`web/handwriting-worker.js`, sabit sürümlü [Transformers.js 2.17.2](https://github.com/huggingface/transformers.js) ve [TrOCR small handwritten](https://huggingface.co/Xenova/trocr-small-handwritten) kullanır. Model revizyonu `2432e24d184b1d964d07ed04f5d9e21d31a59141` olarak sabitlenmiştir. Model ve WASM dosyaları ilk kullanımda indirilir ve tarayıcı önbelleğinden tekrar kullanılabilir. Tek WASM iş parçacığı kullanılır; COOP/COEP veya WebGPU gerekmez. Çizim sunucuya gönderilmez. El yazısı tek satır olarak kırpılır, beyaz zeminle hazırlanır ve ayrı Web Worker'da işlenir. İlk indirme süresi, tarayıcının OffscreenCanvas/WebAssembly desteği, cihaz belleği ve el yazısının okunaklılığı sonucu etkiler. Hatalı okuma elle düzeltilebilir. Gerçek iPad/Apple Pencil donanımı üzerinde doğrulama henüz yapılmamıştır.

Sözlük tanımı/örnekleri kaynak lisanslarıyla (çoğunlukla Wiktionary CC BY-SA) gösterilir; Datamuse ve MyMemory bağlantıları sonuçta yer alır. Transformers.js ve model lisansları için `web/vendor/NOTICE.md` dosyasına bakın.

## Doğrulama

`node tests/lookup.test.cjs` hata/kota, önbellek, iptal ve kelime türü filtresi kontrollerini çalıştırır. `node tests/lookup.test.cjs --live` gerçek servisleri de sorgular. `tests/handwriting.html` üretim arayüz dizininin dışındaki tarayıcı doğrulama sayfasıdır; kendi kelime defterine test kaydı eklememek için farklı bir yerel portta çalıştırılır.


## Cihazlar arası otomatik eşitleme

Aynı yayımlanmış Site URL'si ve aynı ChatGPT hesabı kullanılmalıdır. Farklı cihazlar açılışta, uygulamaya geri dönüldüğünde, internet yeniden geldiğinde ve görünür ekranlarda 25 saniyede bir eşitlenir. Yerel değişiklikler 500 ms duraklama sonrası gönderilir. Üst çubuk gerçek eşitleme durumunu gösterir; ayrıntı penceresinde manuel yeniden deneme ve dışa aktarma bulunur.

- `web/sync.js`: değişiklikleri zaman damgasıyla izler, aynı kelimenin farklı cihazlardaki kopyalarını birleştirir, aynı kimlikle yeniden adlandırılan kelimeyi korur. Eşit zaman damgalarında istemci ve sunucu aynı ASCII kanonik JSON sıralamasını kullanır. Devam eden istek sırasında eklenen kayıtlar yeniden okunur. Çakışmada en fazla altı sürüm denemesi yapılır, ardından geri çekilerek yeniden denenir.
- `worker/index.js`: `oai-authenticated-user-id` Sites kimliğini zorunlu tutan `GET/PUT /api/sync`; istemciden kullanıcı kimliği kabul etmez. Kaynak kontrolü ve JSON istek şartı uygulanır. Her sorgu kullanıcı kimliğiyle sınırlandırılır. Sürüm kontrolü ve istek başına yazma belirteciyle D1 atomik batch işlemi aynı anda yazan eski bir istemcinin kayıtları ezmesini önler. İsteklerde bulunmayan kayıtlar silinmez.
- `db/schema.ts` ve `drizzle/`: kullanıcı sürümleri ve kelime/pasaj/sonuç/not kayıtları. SQL şema geçişleri yayımlanırken Sites tarafından uygulanır; istek işleyicisinde tablo oluşturulmaz.
- `.openai/hosting.json`: aynı Site kimliği, `d1: "DB"`, değişmeyen özel erişim. Yeni bir harici veritabanı hesabı veya kullanıcıya verilmiş veritabanı anahtarı gerektirmez.
- `scripts/build.mjs`: `web/` içindeki tüm kaynakları tek Worker'ın içine gömer ve `dist/server/index.js` üretir. Üretim paketi bağımlılık veya yerel test verisi içermez. Kaynaklar `web/` altında, üretilmiş çıktılar `dist/` altındadır.

Örnek defter buluta gönderilmez. Kendi defterini başlatmış bir cihazdaki eski kayıtlar ilk bağlantıda birleştirilir. Çevrim dışı kayıtlar yalnız o cihazın saklama alanındaysa tarayıcı verileri silindiğinde kaybolabilir; buluta ulaşmış kayıtlar başka cihazdan geri alınabilir. Sayfanın ilk yüklemesi için bağlantı gerekir; bu sürümde tam çevrim dışı açılış için service worker yoktur. Silme özelliği eklenirse eski cihazların silinen kayıtları geri getirmemesi için ayrıca tombstone kayıtları tasarlanmalıdır.

Testler: `node tests/sync.test.cjs` iki cihaz, çevrim dışı yeniden bağlanma, istek sırasında düzenleme, sürüm çakışması, hesap ayrımı ve Unicode sıra eşitliğini; `node tests/worker.test.mjs` gerçek SQLite şemasıyla kimlik, kaynak, sürüm ve atomik yazma korumasını; `node tests/artifact.test.mjs` paketlenen Worker'daki arayüzün kaynaklarla birebir aynı kalmasını doğrular. Tarayıcı kontrolünde `127.0.0.1:4174` ve `localhost:4174` ayrı cihaz kopyaları olarak kullanılır, aynı yerel veritabanına bağlanırlar.
