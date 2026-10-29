# نشر سجل Orax وتسغيله

يغطي هذا المستند الـ Worker في `cloudflare/` وقاعدة D1. **لا يشمل** نشر تطبيق
OraxDesk نفسه. كل الأوامر تُنفَّذ من `cloudflare/`، ومع PowerShell على ويندوز
استخدم `npx.cmd` إن كانت سياسة التنفيذ تمنع `npx.ps1`.

## 1. التهيئة مرة واحدة

```powershell
npx.cmd wrangler login
npx.cmd wrangler d1 create oraxdesk-db        # إن لم تكن موجودة
```

ضع `database_name` و`database_id` في `wrangler.jsonc` (الربط اسمه `DB`).

```powershell
# تحقّق أن القاعدة في حسابك وأنها فارغة
npx.cmd wrangler d1 execute oraxdesk-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

# طبّق المخطط
npx.cmd wrangler d1 migrations apply oraxdesk-db --remote

# مفتاح ختم الدعوات: 32 بايت base64. الأسرار لا تُسترجع لاحقًا.
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b) | npx.cmd wrangler secret put INVITATION_KEY

# (اختياري) سحب جهاز من طرف المشغّل. بدونه لا يوجد مسار الإدارة إطلاقًا (404).
npx.cmd wrangler secret put OPERATOR_TOKEN

npx.cmd wrangler deploy
```

> ⚠️ لا تنشر بمفتاح `.dev.vars` التجريبي. إن نسخته، سيعيد `/v1/signals` الرمز 503
> ويعرض `/healthz` القيمة `invitation_key: "development"` مع `status: "degraded"`.
> `ALLOW_TEST_KEY=1` للتطوير المحلي فقط.

## 2. التحقق بعد النشر

```powershell
curl https://<worker>/healthz
node scripts\smoke.mjs https://<worker>
```

`/healthz` يجب أن يعيد `{"status":"ok","db":"ok","invitation_key":"ok"}`.
إن ظهر `invitation_key: "missing"` فكل مسارات الرموز ستفشل بـ 503: أعد
`wrangler secret put INVITATION_KEY`. سكربت الدخان ينشئ جهازًا ويبطله ثم
يحذف بياناته، فلا يترك أثرًا.

## 3. التشغيل اليومي

- **المنطقة الزمنية للتوقيع**: انحراف الساعة بين العميل والخادم يجب أن يبقى
  أقل من دقيقتين. أجهزة بساعة منحرفة سترى 401؛ صحّح NTP على الجهاز.
- **التنظيف**: مضبوط عبر Cron Trigger كل 15 دقيقة (`*/15 * * * *`) في
  `wrangler.jsonc`، وينفّذ `src/cleanup.ts`: يحذف حتى 500 صفًا منتهيًا أو
  مستهلكًا (بعد ساعة سماح)، وnonces المنتهية، وأحداث تدقيق أقدم من 30 يومًا.
- **تدوير المفتاح**: كل صف يحمل `key_id`. انشر مفتاحًا جديدًا مع
  `INVITATION_KEY_ID` (مثل k2) وأبقِ القديم في `INVITATION_KEY_PREVIOUS` مع
  `INVITATION_KEY_ID_PREVIOUS=k1` حتى انتهاء الرموز القائمة (≤ 10 دقائق)، ثم
  احذف المتغيّرين.
- **الحدود المجانية**: الطلبات 100 ألف/يوم، كتابات D1 100 ألف صف/يوم. راقب
  لوحة Workers وD1؛ تجاوز الكتابات يوقف الاستعلامات حتى منتصف الليل UTC.
- **الترقية**: Workers Paid عند الحاجة، دون تغيير كود.

## 4. استدراك الأخطاء

| العرض | السبب | العلاج |
|---|---|---|
| 503 على كل شيء | D1 غير مربوط أو المخطط غير مطبّق | `wrangler d1 migrations apply --remote` |
| 503 على `/v1/signals` فقط | `INVITATION_KEY` ناقص/خاطئ | أعد رفع السرّ |
| 401 دائمًا | ساعة الجهاز أو توقيع لا يطابق | راجع `canonicalString` والترويسات |
| 409 عند التسجيل | `X-Orax-Device` لا يطابق المفتاح | أرسل hex للمفتاح نفسه |
| 429 | سقف 20 رمزًا/ساعة، أو 20 محاولة حل/دقيقة | انتظر `Retry-After` |

## 5. العودة للخلف (Rollback)

`npx.cmd wrangler versions list` ثم `wrangler versions deploy <version-id>`.
تغييرات D1 لا تتراجع تلقائيًا؛ استخدم `wrangler d1 time-travel` من لوحة D1
إن لزم، بعد أخذ نسخة.

## 6. التطوير والاختبار محليًا

```powershell
npm install --legacy-peer-deps
npm test                 # 12 اختبار مخطط + 30 اختبار Worker في workerd
npx tsc --noEmit
npx.cmd wrangler dev     # محليًا مع D1 محلي
```

لا يحتاج أي من ذلك حساب Cloudflare. CI يشغّل نفس الخطوات في وظيفة
`Registry Worker (D1)`.
