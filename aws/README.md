# AWS Lambda yayını

Kişisel kullanım için aynı arayüz Lambda Node.js 24 üzerinde çalışır. HTML, JavaScript, CSS ve API tek pakettedir. Varsayılan bölge Frankfurt (`eu-central-1`). Lambda `/tmp` alanı veri deposu olarak kullanılmaz; kişisel defter şifreli, herkese kapalı ve sürüm geçmişi açık bir S3 nesnesindedir.

## Giriş ve veriler

CloudFormation bir uygulama kullanıcı adı ve 32 karakterlik rastgele parola içeren Secrets Manager kaydı oluşturur. Tarayıcı HTTPS üzerinden kullanıcı adı/parola ister. Giriş bilgisi olmadan arayüz veya defter API'si açılmaz. Bu, ChatGPT oturumundan ayrı, tek kişilik uygulama girişidir. Parolayı AWS konsolunda stack çıktısındaki `LoginSecretArn` kaydından görüntüle; GitHub'a veya kaynak koduna koyma. Parola değişiklikleri en geç 60 saniyede uygulanır.

`GET /health` yalnız hizmet durumunu herkese açık verir. İstek gövdeleri, Authorization başlıkları, defter verileri ve parola hata günlüklerine yazılmaz. Lambda rolü yalnız bu uygulamanın defter nesnesini okuyup yazabilir, kendi giriş kaydını okuyabilir ve kendi günlüklerine yazabilir. S3 üzerinde genel erişim kapalıdır. Başarılı yazıma kadar eski defter korunur; ETag koşullu yazımı ve istemci sürümü, aynı anda yazan cihazlardan birine 409 döndürür. Boş veya eski cihaz yeni kayıtları silemez.

Bu ilk Lambda sürümünde toplam defterin eşitleme sınırı 3,5 MB'dir; uzun pasaj arşivi ve çok sayıda kalem görseli için ileride kayıt başına depolamaya geçilmelidir. S3 önceki nesne sürümlerini 30 gün saklar. Stack silinse bile defter bucket'ı ve giriş kaydı korunur; bu kaynaklar ayrıca silinene kadar AWS hesabında kalır. Mevcut Sites veritabanı otomatik taşınmaz: eski uygulamadan JSON yedeği indirip yeni adreste içe aktar. İki adres bundan sonra ayrı defterlere eşitlenir.

## Yerel doğrulama

```sh
npm ci
npm run build:aws
npm test
npm run test:aws
```

`.aws-build/`, giriş dosyası `index.mjs` ve kilitli AWS SDK bağımlılıkları dahil hazır Lambda klasörüdür. `.aws-build/` ve `.aws-output/` Git'e eklenmez. `aws/template.json` CloudFormation paketleme işleminde bu klasörü yükler.

## İlk yayın

Yetkili bir AWS CLI oturumu ve Frankfurt'ta özel bir derleme bucket'ı gerekir. İlk yayın komutları:

```sh
mkdir -p .aws-output
aws cloudformation package --template-file aws/template.json --s3-bucket YOUR_PRIVATE_ARTIFACT_BUCKET --s3-prefix kelime-personal --output-template-file .aws-output/packaged.json --region eu-central-1
aws cloudformation validate-template --template-body file://.aws-output/packaged.json --region eu-central-1
aws cloudformation deploy --template-file .aws-output/packaged.json --stack-name kelime-personal --capabilities CAPABILITY_IAM --parameter-overrides LoginName=sertac --region eu-central-1
aws cloudformation describe-stacks --stack-name kelime-personal --query 'Stacks[0].Outputs' --region eu-central-1
```

`ApplicationUrl` ile uygulama açılır. AWS hesabına göre Lambda, S3, Secrets Manager, günlük ve varsa CloudFront kullanımı ücret doğurabilir; sabit bir ücretsiz kullanım garantisi yoktur.

## GitHub Actions ile sonraki yayınlar

`Deploy to AWS Lambda` akışı, `main` üzerindeki başarılı `Build and test` çalışmasından sonra veya elle başlatılır. Önce AWS hesabında yalnız bu depoya ait `repo:isilozgedurmus/sertacwebsite:ref:refs/heads/main` ve `aud: sts.amazonaws.com` koşullarına güvenen GitHub OIDC deployment rolü oluşturulur. Uzun ömürlü AWS access key kullanılmaz. Deployment rolünün CloudFormation, uygulamanın Lambda/IAM/S3/Secrets Manager/günlük kaynakları ve varsa CloudFront kaynakları için gerekli yetkileri olmalıdır; bir Lambda çalışma rolü deployment rolü olarak kullanılmamalıdır.

Depo **Settings → Secrets and variables → Actions → Variables** bölümünde:

| Değişken | Değer |
| --- | --- |
| `AWS_ROLE_ARN` | GitHub OIDC deployment rolü ARN'si |
| `AWS_ARTIFACT_BUCKET` | Özel derleme bucket'ı adı |
| `AWS_REGION` | `eu-central-1` |
| `AWS_STACK_NAME` | `kelime-personal` |
| `AWS_LOGIN_NAME` | `sertac` veya seçilen kullanıcı adı |
| `AWS_DOMAIN_NAME` | İlk yayında boş; sonra doğrulanmış alan adı |
| `AWS_CERTIFICATE_ARN` | Alan adı kullanılacaksa us-east-1 ACM sertifikası |

İlk iki değişken eksikken deployment işi çalışmaz. Dolayısıyla yalnız akış dosyasının GitHub'da görünmesi canlı yayın yapıldığı anlamına gelmez. Lambda çalışma rolüyle deployment rolü ayrıdır. Akış, AWS erişiminden önce kodu derleyip test eder.

## Kendi alan adı

İlk yayın Lambda'nın HTTPS adresinden yapılabilir. Kendi alan adı için alan adını kapsayan, **us-east-1** bölgesinde verilmiş bir ACM sertifikası ve DNS yönetimine erişim gerekir. `DomainName` ve `CertificateArn` parametreleri verilince CloudFront dağıtımı oluşturulur. HTTP, HTTPS'e yönlenir; kişisel yanıtlar önbelleğe alınmaz ve Authorization başlığı Lambda'ya iletilir. `DomainDnsTarget` çıktısı DNS hedefidir. Kök alan adı için DNS sağlayıcısında ALIAS/ANAME/CNAME flattening desteği ya da Route 53 alias kaydı gerekir; normal kök CNAME kaydı diğer kayıtlarla çakışabilir. Mevcut e-posta DNS kayıtları korunmalıdır.

Alan adının sahipliği ve DNS doğrulaması tamamlanmadan `seris.online` üzerinde yayında olduğu söylenemez. AWS kaynakları hesabında yayımlanmadan önce CloudFormation doğrulaması ve gerçek HTTPS/senkronizasyon kontrolü tamamlanmalıdır.
