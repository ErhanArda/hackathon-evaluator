# Yeni Hackathon Açılış Checklist

Proje bir hackathon'dan diğerine yeniden kullanılır. Sıfırlama ve hazırlık adımları.

Canlı: <https://hackathon-evaluator-eta.vercel.app>

---

## Geç teslim saati — `EVAL_LATE_CUTOFF`

> **Vercel env'ine YAZMA — orada işe yaramaz.** Değişkeni okuyan tek yer
> `scripts/eval-deterministic.mjs` ve o script **lokalde** çalışıyor.
> `apps/web/` altında bu değişkeni okuyan hiçbir kod yok; Vercel'e eklenirse
> sessizce yok sayılır ve geç teslim kontrolü yapılmadan puanlama devam eder.

Doğru yer `apps/web/.env.local` — skill'lerin Adım 0'ı bu dosyayı zaten
source ediyor, `.gitignore`'daki `.env*` ile de korunuyor:

```bash
cat >> apps/web/.env.local <<'ENV'
EVAL_LATE_CUTOFF=2026-09-16T17:30:00+03:00
ENV
```

> Tarih formatı ISO-8601 **+ timezone** olmalı. `+03:00` yazmazsan UTC sayılır
> ve 3 saat kayar.

Doğrula — `cutoff` dolu görünmeli:

```bash
set -a; . apps/web/.env.local; set +a
node scripts/eval-deterministic.mjs <bir-repo> | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['latePenalty'])"
```

**Tanımlı değilse ne olur:** geç commit cezası hiç uygulanmaz. Yani saati
vermeden değerlendirme yaparsan yanlış ceza uygulanmaz, sadece kontrol atlanır.
Eskiden bu tarih script'in içine gömülüydü ve tarih geçtiği için **her** aktif
repo "geç" işaretleniyordu — o yüzden env'e taşındı.

---

## 1) Önceki hackathon'u arşivle

Silmeden önce **mutlaka** tam yedek al:

```bash
D=~/Desktop/hackathon-arsiv-$(date +%Y-%m)
mkdir -p "$D"
B=https://hackathon-evaluator-eta.vercel.app

curl -sS "$B/api/export.json" -o "$D/full-export.json"   # 5 tablonun tamamı
curl -sS "$B/api/export.xlsx" -o "$D/leaderboard.xlsx"   # jüri formatı
```

Doğrula — satır sayıları tutmalı ve eksik gerekçe olmamalı:

```bash
python3 -c "
import json; d=json.load(open('$D/full-export.json'))
print(d['counts'])
t=d['tables']
assert len(t['criterionScores'])==len(t['aiRationales']), 'gerekçesi olmayan puan var'
print('takım:', len(t['teams']), '| değerlendirme:', len(t['evaluations']))
"
```

> `export.xlsx` tek başına **yetmez** — yalnız her takımın *son*
> değerlendirmesinin gerekçelerini içerir. Geçmiş değerlendirmelerin kriter
> puanları sadece `export.json`'da.

## 2) Veritabanını sıfırla

Takımı silmek cascade ile o takımın değerlendirmelerini, kriter puanlarını,
gerekçelerini ve kuyruk kayıtlarını da siler.

```bash
B=https://hackathon-evaluator-eta.vercel.app

curl -s "$B/api/teams" | python3 -c "
import json,sys
for t in json.load(sys.stdin)['teams']: print(t['id'])
" > /tmp/ids.txt

# printf kullan: 'while read' son satırı newline yoksa atlar
while IFS= read -r id || [ -n "$id" ]; do
  curl -s -o /dev/null -w "$id -> %{http_code}\n" -X DELETE "$B/api/teams/$id"
done < /tmp/ids.txt
```

Boşaldığını doğrula (hepsi 0 olmalı):

```bash
curl -s "$B/api/export.json" | python3 -c "import json,sys;print(json.load(sys.stdin)['counts'])"
```

## 3) Yeni takımları ekle

`/admin` → Takım Ekle (ad, repo URL, üyeler virgülle).

> Repo URL'ini yapıştırırken dikkat: geçmiş arşivde bir takımın URL'i iki
> adresin birleşmiş hali olarak kaydedilmişti (`.../java-backend-https://github.com/...`).
> Sunucu henüz URL doğrulaması yapmıyor.

## 4) Değerlendirmeyi başlat

**Otomatik worker YOK** — cron tanımlı değil. Butona basmak işi yalnız
*kuyruğa alır*; çalıştıran Claude Code'dur.

**Tek takım:**
```
/evaluate https://github.com/takim/repo team-id=<id>
```
Takım detay sayfasındaki kutu bu komutu hazır gösterir.

**Toplu:** Takım sayfalarında "🤖 Değerlendir"e bas, sonra:
```
/process-queue base=https://hackathon-evaluator-eta.vercel.app
```
batch=4 paralel işler.

### Otomatik mod (sunum günü için önerilen)

Takımlar repoyu sunuma başlarken veriyorsa, her seferinde terminale komut
yazmak istemezsin. Ayrı bir terminalde bir kez başlat:

```bash
./scripts/watch-queue.sh
```

Kuyruğu 10 saniyede bir yoklar, bekleyen request görünce Claude Code'u
headless modda çalıştırıp `/process-queue`'yu koşturur. Sen sadece `/admin`'den
takımı ekleyip **Değerlendir**'e basıyorsun; skor 2-3 dakika içinde
leaderboard'a düşüyor. Loglar `.watch-logs/` altında.

```bash
INTERVAL=5 ./scripts/watch-queue.sh    # daha sık yokla
BASE=http://localhost:3000 ./scripts/watch-queue.sh
```

> Headless mod izin soramadığı için `--permission-mode bypassPermissions` ile
> koşar. Değerlendirilen repo'nun kodu **çalıştırılmaz** — agent prompt'larındaki
> komut politikası install/run/docker'ı yasaklıyor. Yine de yalnız güvendiğin
> repoları kuyruğa al.

## 5) (Opsiyonel) Yazma korumasını aç

Varsayılan: yazma endpoint'leri **açık**, token gerekmez. Güvenilir iç ortam
için kasıtlı tercih — terminalden tetikleme kurulum gerektirmiyor.

Kapatmak istersen Vercel'e iki değişken ekle:

```
EVALUATOR_REQUIRE_AUTH=1
INGEST_TOKEN=<openssl rand -hex 16>
```

O anda takım ekle/sil, sıralama, değerlendirme tetikleme ve skor POST'u
`Authorization: Bearer <INGEST_TOKEN>` ister. Okuma endpoint'leri (leaderboard,
takım detayı, xlsx) her iki durumda da public kalır — jüri etkilenmez.

Terminal akışı için token'ı `apps/web/.env.local`'a yaz; skill'ler onu
otomatik yükler.
