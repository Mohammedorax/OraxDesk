# تشغيل سجل Orax Remote (Operations)

نطاق هذا المستند: الواجهة السحابية في `cloudflare/` وقاعدتها `oraxdesk-db`. التطبيق نفسه يملك
دليل تشغيل مستقلًا. الأوامر تُنفَّذ من `cloudflare/` (استخدم `npx.cmd` على PowerShell عند منع السكربتات).

## 1. الفحوص اليومية (دقيقتان)

```powershell
npx.cmd wrangler deployments status --name orax-registry
curl.exe https://<worker>/healthz
node scripts\smoke.mjs https://<worker>
```

- `healthz` يجب أن يعيد `{"status":"ok","db":"ok","invitation_key":"ok"}`.
- أي `missing/invalid` لمفتاح الختم ⇒ كل مسارات الرموز تفشل بـ 503؛ أعد
  `wrangler secret put INVITATION_KEY` فورًا.
- سكربت الدخان ينشئ جهازًا ويبطله ويحذف رموزه، فلا يترك أثرًا.

## 2. المراقبة والحدود

| المقياس | المصدر | عتبة تنبيه |
|---|---|---|
| الطلبات/يوم | لوحة Workers → Metrics | 60% و80% من 100k |
| صفوف D1 مكتوبة/مقروءة | D1 → Metrics | 60% و80% من 100k/5M |
| أخطاء 5xx | Workers → Invocation statuses | > 1% لمدة 5 دقائق |
| 429 | سجلات الـ Worker | ارتفاع مفاجئ = تخمين أو إساءة |
| زمن الاستجابة | `wrangler tail` → wallTime/cpuTime | P95 > 300 ms |

**تجاوز الحد اليومي لـ D1 يوقف الاستعلامات حتى منتصف الليل UTC** (ليس فوترة). خطة الترقية:
Workers Paid + D1 مدفوع، دون أي تغيير في الكود.

## 3. السجلات

```powershell
npx.cmd wrangler tail orax-registry --format pretty
```
- لا تُسجَّل الأجسام ولا الترويسات ولا الرموز؛ ما يظهر هو الطلبات والأخطاء وأسماء الاستثناءات.
- لتشخيص 503 متكرر: تحقّق أولًا من `/healthz` (سرّ/DB)، ثم من `d1 migrations list`.
- لا تُلصق مخرجات tail في قنوات عامة: قد تحوي معرّفات أجهزة (بيانات وصفية).

## 4. المهام المجدولة

- Cron: `*/15 * * * *` (في `wrangler.jsonc`) → `src/cleanup.ts`: يحذف ≤ 500 صفًا/تشغيل من
  الرموز المنتهية/المستهلكة (بعد ساعة سماح)، وnonces المنتهية، وتدقيق > 30 يومًا.
- التحقق: `wrangler deployments status` يعرض `schedule`، و`wrangler tail` يظهر تنفيذًا كل ربع ساعة.
- إن تراكمت المهام: شغّل التنظيف يدويًا عبر D1 SQL بنفس الاستعلامات المحدودة.

## 5. تدوير مفتاح الختم

1. ولّد 32 بايت جديدة (base64) واحفظها في مدير أسرار.
2. `wrangler secret put INVITATION_KEY_ID` = `k2` (متغيّر عادي عبر `vars` أو سرّ).
3. `wrangler secret put INVITATION_KEY` = المفتاح الجديد.
4. `wrangler secret put INVITATION_KEY_PREVIOUS` = القديم، و`INVITATION_KEY_ID_PREVIOUS` = `k1`.
5. بعد 15 دقيقة (أقصى عمر رمز) احذف `INVITATION_KEY_PREVIOUS` و`INVITATION_KEY_ID_PREVIOUS`.

الرموز القائمة تبقى قابلة للفك أثناء النافذة؛ بعدها تفشل مغلقة (404) لا 500.

## 6. النسخ الاحتياطي والاستعادة

- D1 Time Travel: من لوحة D1 → Backups/Time Travel، لقطة لنقطة زمنية (حتى 30 يومًا حسب الخطة).
- قبل أي migration: صدّر نسخة `wrangler d1 export oraxdesk-db --remote --output backup.sql`.
- استعادة: استورد إلى قاعدة جديدة، ثم بدّل `database_id` في `wrangler.jsonc` وانشر.

## 7. استدراك الأعطال

| العرض | التشخيص | الإجراء |
|---|---|---|
| 503 على كل المسارات | DB غير مربوط / migrations ناقصة | `wrangler d1 migrations apply --remote` |
| 503 على `/v1/signals` فقط | `INVITATION_KEY` ناقص/خاطئ | أعد رفع السرّ |
| 401 متتالية | ساعة جهاز منحرفة أو توقيع لا يطابق | راجع NTP و`canonicalString` |
| 409 عند التسجيل | ترويسة الجهاز لا تطابق المفتاح | العميل يرسل hex للمفتاح نفسه |
| 429 | سقف 20/ساعة للجهاز أو 20/دقيقة/IP | انتظر `Retry-After` |
| الموقع لا يُحل DNS | `workers.dev` غير متاح من الشبكة | اختبر من شبكة أخرى، وفكّر في نطاق مخصص للإنتاج |

## 8. التراجع

```powershell
npx.cmd wrangler versions list
npx.cmd wrangler versions deploy <version-id>
```
تغييرات D1 لا تتراجع تلقائيًا؛ استخدم Time Travel بعد أخذ نسخة. الأسرار تبقى كما هي عند التراجع.

## 9. مراقبة السجل

السجل صار **العمود الفقري** لنشر آلة: هو الذي يجعل «الرقم التسعيمي» قابلًا للبحث، وهو ما يربط النشر الخاص بالبحث الخاص. لا يكفي أن يعمل: يجب أن يُعرف **أنه لا يعمل**.

### 9.1 ما يجب مراقبته

| المؤشر | أين | ماذا يعني |
|---|---|---|
| **الصحة** | `GET /healthz` | `ok` يعني أن الإعداد سليم؛ `missing` يعني أن `INVITATION_KEY` غير مضبوط، و`invalid` يعني أنه ليس 32 بايت |
| **أخطاء 5xx** | سجلات الـ Worker | أي 5xx يعني خطأً في الخادم. السجل يقدّم `method/path/status/ms` فقط، بلا أجسام ولا أسرار |
| **الأجهزة الحيّة** | D1 | `SELECT count(*) FROM devices WHERE last_seen_at > unixepoch() - 3600` |
| **الطلبات** | Cloudflare Analytics | القفزة أو الانهيار في عدد التسجيلات يعني مشكلة في الإصدار الجديد |

### 9.2 الأوامر

```powershell
# السجلات الحيّة
npx.cmd wrangler tail orax-registry --format pretty

# هل يرى السجل الأجهزة؟
npx.cmd wrangler d1 execute oraxdesk-db --remote --command "SELECT count(*) AS live FROM devices WHERE last_seen_at > unixepoch() - 3600"

# هل تُنظَّف الجداول؟
npx.cmd wrangler d1 execute oraxdesk-db --remote --command "SELECT (SELECT count(*) FROM signal_codes) AS codes, (SELECT count(*) FROM auth_nonces) AS nonces, (SELECT count(*) FROM audit_events) AS audit"
```

### 9.3 ما لا يوجد، بصراحة

**لا توجد تنبيهات آلية.** السجلات موجودة (`observability` مفعّل) ولا يوجد فوقها جرس: التنبيه يحتاج مزوّدًا خارج هذا المستودع، وإعداده قرارٌ تشغيلي يخصّ من يملك الحساب.

ما يبقى على المشغّل هو أن يفحص health على جدول، أو يراقب الـ 5xx من Cloudflare، أو يضع فحصًا خارجيًّا على `/healthz`. أي واحد منها يحوّل «السجل سقط» من شيء يكتشفه المستخدم — على شاشة لا يفهمها — إلى شيء يعرفه المشغّل أولًا.

الواجهة نفسها تعرض الحالة: لوحة السجل في التطبيق تعرض سبب التعطّل (`missing` / `invalid`) بدل زرّ ميّت.


## 10. أدلة التشغيل

- النشر والتحقق: [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md)
- نموذج الأمان: [SECURITY_MODEL.md](SECURITY_MODEL.md)
- خطة الاختبار: [TEST_PLAN.md](TEST_PLAN.md)
- العقد: [openapi.yaml](openapi.yaml)
