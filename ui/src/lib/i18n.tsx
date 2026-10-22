import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * العربية هي اللغة الافتراضية، والإنجليزية بديل كامل البنية. كل نص واجهة يمرّ
 * عبر `t()` حتى يمكن تعريب بقية الشاشات تدريجيًا دون هدم أي شيء.
 *
 * The default language is Arabic and the document direction is set from it, so
 * the whole layout mirrors to RTL. English stays available for engineering and
 * for users who prefer it.
 */
export type Lang = "ar" | "en";

const STORAGE_KEY = "deskvnc.language";

const ar = {
  "app.language": "اللغة",
  "app.arabic": "العربية",
  "app.english": "English",
  "registry.title": "سجل Orax (اختياري)",
  "registry.description":
    "انشر هذه الدعوة كرمز قصير عبر سجلك الخاص. لا يُخزَّن سوى الدعوة، مشفّرة، لدقائق؛ الشاشة والإدخال لا يمرّان عبره.",
  "registry.url": "عنوان السجل",
  "registry.create": "احصل على رمز من السجل",
  "registry.createAnother": "أنشئ رمزًا آخر",
  "registry.copy": "نسخ الرمز",
  "registry.withdraw": "سحب الرمز",
  "registry.ready": "الرمز جاهز، صالح حتى {time}.",
  "registry.withdrawn": "تم سحب الرمز. لا يمكن لأحد استخدامه الآن.",
  "registry.failed": "تعذّر إنشاء الرمز: {reason}",
  "registry.withdrawFailed": "تعذّر سحب الرمز: {reason}",
  "registry.healthy": "السجل يعمل.",
  "registry.degraded": "السجل لا يعمل كما ينبغي (قاعدة البيانات: {db}، مفتاح الإغلاق: {key}).",
  "device.number": "رقم هذا الجهاز — اقرأه لمن يساعدك",
  "device.copyNumber": "نسخ الرقم",
  "device.numberHint": "تسعة أرقام ثابتة لهذا الجهاز. اقرأها على الهاتف لمن يساعدك، أو انسخها.",
  "device.id": "معرّف هذا الجهاز، للوصول دون الحضور",
  "device.copyId": "نسخ المعرّف",

  // شاشة البدء
  "onboarding.scanning": "جارٍ البحث في شبكتك…",
  "onboarding.scanNothing":
    "لم يُعثر على أي جهاز بعد؛ بعض الأجهزة لا تعلن عن نفسها. يمكنك إضافة جهاز يدويًا لاحقًا.",
  "onboarding.scanFailed":
    "تعذّر بدء البحث عن الأجهزة على الشبكة. تحقّق من إعدادات الشبكة ثم أعد المحاولة.",
  "onboarding.scanRetry": "أعد المحاولة",

  // شريط الاتصال السريع
  "quick.placeholder": "اتصل بعنوان، مثل 192.168.1.20:1 أو rdp://frontdesk  ({key}T)",
  "quick.label": "العنوان الذي تريد الاتصال به",
  "quick.connect": "اتصال",
  "quick.savedHost": "مضيف محفوظ",
  "quick.recent": "مؤخّر",
  "quick.viaSaved": "يتصل عبر {name}",
  "quick.remembered": "يتصل الآن — يُحفظ العنوان في هذه القائمة",
  "quick.chipSaved": "محفوظ",
  "quick.chipDisplay": "{protocol} · شاشة {display}",
  "quick.chipSavedTitle": "{name} محفوظ كـ {protocol}. يتصل هذا العنوان عبر ذلك المضيف.",
  "quick.chipTitle": "اتصل بـ {protocol}. انقر لاستخدام {next} بدلًا منها.",
  "quick.connectTo": "اتصل بـ {target}",

  // نوافذ الدعم عن بُعد
  "support.helpSomeone": "ساعد شخصًا",
  "support.helpSomeoneNow": "يساعدني الآن",
  "support.reachComputer": "أصل إلى جهاز",
  "support.yourName": "اسمك، يظهر أمام الشخص",
  "support.theirCode": "رمزه أو دعوته",
  "support.theirCodePlaceholder": "1234 5678 9012، أو boundary1:…",
  "support.registryUrl": "عنوان سجل Orax (اختياري)",
  "support.registryHint":
    "يُبحث عن الرقم في هذا السجل أولًا. اتركه فارغًا لاستخدام خدمة الرموز بالأسفل.",
  "support.codeServiceUrl": "عنوان خدمة الرموز",
  "support.codeServiceHint":
    "الرمز يحتاج إلى خدمة الرموز نفسها التي استخدمها الشخص. وإلا فاطلب منه نص الدعوة.",
  "support.computerId": "معرّف الجهاز أو رقمه",
  "support.computerIdHint": "اطلب منه الرقم التسعيني، أو المعرّف الكامل من «نسخ المعرّف».",
  "support.notAnId":
    "ليس هذا معرّف جهاز ولا رقمًا. اطلب الرقم التسعيني، أو المعرّف الكامل من «نسخ المعرّف».",
  "support.numberNeedsRegistry": "الرقم يحتاج إلى عنوان سجل بالأعلى، أو المعرّف الكامل.",
  "support.libraryName": "الاسم في مكتبتك",
  "support.unattendedPassword": "كلمة المرور، إن لم يكن أحد هناك للموافقة",
  "support.unattendedPasswordHint":
    "كلمة المرور للجهاز غير المزعج، المضبوطة على ذلك الجهاز. تُحفظ في خزنة مفاتيح نظامك، لا في ملف المكتبة.",
  "support.pasted": "منسوخ من الحافظة.",
  "support.cancel": "إلغاء",
  "support.connect": "اتصال",
  "support.saveAndConnect": "احفظ واتصل",
  "support.opening": "جارٍ الفتح…",
  "support.connectMode": "طريقة الاتصال",
  "support.registryUrlRequired": "أدخل عنوان السجل لابحث عن الرقم.",
  "support.defaultMachineName": "حاسوب Boundary",

  // نافذة «احصل على المساعدة»
  "gethelp.button": "احصل على مساعدة",
  "gethelp.sharing": "جارٍ المشاركة",
  "gethelp.title": "احصل على مساعدة",
  "gethelp.intro": "اسمح لشخص تثق به برؤية هذا الجهاز أو التحكم فيه. لا يرى شيئًا حتى توافق عليه.",
  "gethelp.close": "إغلاق",
  "gethelp.settings": "الإعدادات",
  "gethelp.loading": "جارٍ فتح نافذة المساعدة…",
  "gethelp.unavailable": "خدمة الدعم غير متاحة في هذه النسخة.",
  "gethelp.shareTitle": "شارك هذا الجهاز",
  "gethelp.shareIntro": "امنح الشخص الذي يساعدك رمزًا واحدًا لكل جلسة. ينتهي خلال ١٠ دقائق إن لم يتصل أحد.",
  "gethelp.getCode": "احصل على رمز",
  "gethelp.createInvitation": "أنشئ دعوة",
  "gethelp.copyCode": "نسخ الرمز",
  "gethelp.copyInvitation": "نسخ الدعوة كاملة",
  "gethelp.readOut": "اقرأه له أو أرسله. يدخله مساعدك، وأنت توافق عليه هنا.",
  "gethelp.endSession": "إنهاء الجلسة",
  "gethelp.unattended": "الوصول دون حضورك",
  "gethelp.paired": "المساعدون المقبولون",
  "gethelp.passwordsDiffer": "كلمتا المرور غير متطابقتين.",

  // المشاركة والإذونات في «احصل على مساعدة»
  "gethelp.copied": "تم النسخ",
  "gethelp.screenPermission": "يلزم إذن تسجيل الشاشة للمشاركة.",
  "gethelp.allowScreenRecording": "اسمح بتسجيل الشاشة",
  "gethelp.screenPermissionHint": "بعد منح الإذن، أغلق DeskVNC وافتحه من جديد إن فشلت المشاركة.",
  "gethelp.noDisplayToShare": "لم يُعثر على شاشة تُشارَك.",
  "gethelp.shareScreen": "الشاشة المشتركة",
  "gethelp.gettingCode": "جارٍ جلب رمزك…",
  "gethelp.creatingCode": "جارٍ إنشاء رمزك…",
  "gethelp.useFullInvitation": "استخدم الدعوة كاملة بدلًا من الرمز",
  "gethelp.copyInvitationText": "نسخ الدعوة",
  "gethelp.sendPrivately": "أرسله في أي محادثة واحتفظ به خاصًا. صالح لجلسة واحدة.",
  "gethelp.allowRemoteControl": "اسمح بالتحكم عن بُعد",
  "gethelp.giveAccess": "امنح الشخص الذي يساعدك {what}. لا يرى شيئًا حتى توافق عليه.",
  "gethelp.thisCode": "هذا الرمز",
  "gethelp.thisInvitation": "هذه الدعوة",
  "gethelp.on": "مُفعَّل",
  "gethelp.starting": "قيد البدء",
  "gethelp.offInSettings": "مُعطَّل. غيّره من الإعدادات.",
  "gethelp.screenShared": "شاشتك تُشارَك الآن",
  "gethelp.helperSees": "يستطيع المساعد رؤية الشاشة المختارة، بما فيها الإشعارات وهذه النافذة.",
  "gethelp.allowControl": "اسمح للمساعد بالالتحكم بمؤشّر الفأرة ولوحة المفاتيح",
  "gethelp.controlNeedsAccessibility": "التحكم يحتاج إذن إمكانية الوصول. أما المشاهدة فتعمل بدونه.",
  "gethelp.openAccessibility": "افتح إعدادات إمكانية الوصول",
  "gethelp.allowTools": "اسمح لأدوات المساعد بتشغيل الأوامر ونسخ الملفات",
  "gethelp.toolsDid": "ما فعلته أدواتهم",
  "gethelp.pairedHelperNote":
    "يستطيع {name} الاتصال بهذا الجهاز في أي وقت. أزِله من الإعدادات، في «الوصول دون حضورك»، لإيقاف ذلك.",
  "gethelp.pairTitle": "يُتذكَّرون بمفتاح اتصالهم. ويمكنك إزالتهم لاحقًا من الإعدادات.",
  "gethelp.pairButton": "دع {name} يتصل في أي وقت، حتى وأنا غائب",
  "gethelp.screenToShare": "الشاشة التي تُشارَك",
  "gethelp.refresh": "تحديث",
  "gethelp.noDisplay": "لم يُعثر على أي شاشة.",
  "gethelp.accessibilityNeeded":
    "يلزم إذن إمكانية الوصول ليساعد المساعد في التحكم بهذا الجهاز. أما المشاهدة فتعمل بدونه.",

  // الوصول دون حضورك في «احصل على مساعدة»
  "gethelp.unattendedIntro":
    "دع من تثق بهم يتصلون بهذا الجهاز حين لا يكون أحد هنا للموافقة. مُعطَّل حتى تفعّله. ويجب أن يكون DeskVNC يعمل ليعمل.",
  "gethelp.allowUnattended": "اسمح بالوصول دون حضورك إلى هذا الجهاز",
  "gethelp.idReachable": "معرّف هذا الجهاز، يمكن الوصول إليه الآن",
  "gethelp.helperEntersId":
    "يدخله المساعد معرّفًا للجهاز، مع كلمة المرور إن لم يكن مقبولًا هنا من قبل.",
  "gethelp.autostart": "شغّل DeskVNC عند تسجيل دخولي، ليجهز فورًا",
  "gethelp.noPairedYet": "لا أحد بعد. أثناء جلسة دعم، اختر «دعه يتصل في أي وقت» لقبول المساعد.",
  "gethelp.mayControl": "يستطيع التحكم",
  "gethelp.toolsNote":
    "لمساعد تعمل أدواته، مثل وكلاء DeskVNC، على هذا الجهاز أثناء غيابك. والأوامر تعمل باسمك.",
  "gethelp.mayRunTools": "يستطيع تشغيل الأوامر ونسخ الملفات",
  "gethelp.remove": "إزالة",
  "gethelp.unattendedPassword": "كلمة المرور للوصول دون حضورك",
  "gethelp.unattendedPasswordHint":
    "اختيارية. تتيح لم مساعد لم يُقبَل هنا من قبل أن يتصل بمعرّف هذا الجهاز وبكلمة المرور. {min} حرفًا على الأقل. وخمس محاولات خاطئة توقفها ١٥ دقيقة.",
  "gethelp.newPassword": "كلمة مرور جديدة",
  "gethelp.repeatPassword": "أعدّها",
  "gethelp.setPassword": "تعيين كلمة المرور",
  "gethelp.removePassword": "إزالة كلمة المرور",

  // الاتصال والرموز القصيرة في «احصل على مساعدة»
  "gethelp.connection": "الاتصال",
  "gethelp.now": "الآن: {network}",
  "gethelp.automatic": "تلقائي (موصى به لمكالمة دعم)",
  "gethelp.provider": "جهّز شبكتي على Tailscale أو Cloudflare",
  "gethelp.private": "استخدم شبكة خاصة أخرى موجودة",
  "gethelp.relay": "استخدم خادم الترحيل المتوافق عندي",
  "gethelp.automaticHint":
    "يجرّب اتصالًا مباشرًا، ويتراجع إلى ترحيل مشفَّر إن تعذّر. ولا حاجة إلى حساب لدى مزوّد. أما الترحيلات العامة فحدود سعتها محدودة ولا تضمن استمرار عملها.",
  "gethelp.providerIntro":
    "ثبّت هذا الجهاز واربطه بحسابك لدى المزوّد. وشغّل الإعداد على جهاز المساعد أيضًا.",
  "gethelp.addressOnNetwork": "عنوان هذا الجهاز على تلك الشبكة: {address}",
  "gethelp.localIp": "عنوان IP للواجهة المحلية",
  "gethelp.localIpHint":
    "لشبكة Headscale أو WireGuard أو Cloudflare خاصة موجودة، أو أي شبكة موجَّهة أخرى. ويحتاج الجهازان مسارًا مسموحًا. وإدخال عنوان IP لا يسجّل أيًا من الجهازين.",
  "gethelp.relayUrl": "عنوان الترحيل",
  "gethelp.relayUrlHint": "ترحيل iroh متوافق. تحمل الدعوة عنوانه إلى مساعدك.",
  "gethelp.privateWarning":
    "إن تعذّرت هذه الشبكة أو تغيّر العنوان، فشل الاتصال بدلًا من استخدام ترحيل عام.",
  "gethelp.saveConnection": "احفظ إعدادات الاتصال",
  "gethelp.endSessionToChange": "أنهِ الجلسة لتغيير هذا.",
  "gethelp.saved": "حُفظ",
  "gethelp.savedTry": "حُفظ. احصل على رمز لتجربه مع مساعدك.",
  "gethelp.save": "حفظ",
  "gethelp.shortCodes": "الرموز القصيرة",
  "gethelp.shortCodesHint":
    "الرمز القصير أسهل في القراءة من الدعوة كاملة. ويجب أن يستخدم الشخصان خدمة الرموز نفسها، وهي تستطيع قراءة الدعوات التي تُعطى لها، فاختر خدمة تثق بها.",
  "gethelp.codeServiceHint":
    "اتركه فارغًا لاستخدام خدمة Boundary المشتركة. أما البنية التحتية الخاصة فتحتاج خدمتها هنا.",

  // شاشة «عن»
  "about.title": "عن DeskVNCViewer",
  "about.sectionsLabel": "أقسام «عن»",
  "about.tabAbout": "عن",
  "about.tabHelp": "مساعدة",
  "about.tagline": "عارض سطح مكتب بعيد سريع وطبيعي الأصل لـ macOS وWindows وLinux.",
  "about.version": "الإصدار {version}",
  "about.buildLabel": "تفاصيل البناء",
  "about.build": "البناء",
  "about.copied": "تم النسخ",
  "about.copyReport": "انسخ التقرير لتذكرة عطل",
  "about.commit": "الالتزام",
  "about.locallyModified": "مُعدَّل محليًا",
  "about.branch": "الفرع",
  "about.branchDetail": "{branch}، بتاريخ {date}",
  "about.toolchain": "أدوات البناء",
  "about.toolchainDetail": "بنية {profile}، tauri {tauri}، {rustc}",
  "about.system": "النظام",
  "about.systemDetail": "{os} {version} ({arch})، webview {webview}",
  "about.includeBlock":
    "أرفق الكتلة المنسوخة عند الإبلاغ عن مشكلة؛ فهي تحدّد هذه النسخة بالضبط.",
  "about.developedBy": "طوّره",
  "about.contact": "للتواصل",
  "about.license": "الترخيص",
  "about.copyright":
    "© {year} {author}. يدعم RFB 3.3-3.8 مع مصادقة VNC وVeNCrypt وRA2 وApple Diffie-Hellman وMS-Logon، وRDP مع المصادقة على مستوى الشبكة.",
  "about.projectPage": "صفحة المشروع",
  "about.contactDeveloper": "تواصل مع المطوّر",
  "about.close": "إغلاق",

  // قائمة البداية في شاشة «عن»
  "about.gettingStarted": "البداية السريعة",
  "about.startUse": "استخدم",
  "about.startFind": "للعثور على أجهزة قريبة، أو",
  "about.startAdd": "لإضافة جهاز بعنوانه.",
  "about.scanNetwork": "فحص الشبكة",
  "about.newHost": "مضيف جديد",
  "about.startConnect":
    "انقر نقرًا مزدوجًا على بطاقة للاتصال. وتُحفظ كلمات المرور في خزنة مفاتيح النظام أول مرة.",
  "about.startOrganise":
    "جمّع المضيفين وضع عليهم الوسوم من الشريط الجانبي، لتبقى مكتبة كبيرة قابلة للتنقّل.",
  "about.shortcuts": "اختصارات لوحة المفاتيح",
  "about.troubleshooting": "حل المشكلات",
  "about.documentation": "التوثيق الكامل",

  // اختصارات لوحة المفاتيح
  "about.shortcut.palette": "لوحة الأوامر",
  "about.shortcut.newHost": "مضيف جديد",
  "about.shortcut.quickConnect": "انتقل إلى شريط العنوان في «الاتصال السريع»",
  "about.shortcut.search": "ابحث في المكتبة",
  "about.shortcut.preferences": "التفضيلات",
  "about.shortcut.disconnect": "افصل الجلسة",
  "about.shortcut.toolbar": "أظهر أو أخفِ شريط الجلسة",
  "about.shortcut.fullscreen": "بدّل ملء الشاشة",
  "about.shortcut.tabs": "علامة التبويب التالية / السابقة",
  "about.shortcut.jumpTab": "انتقل إلى علامة تبويب (١ هي المكتبة)",
  "about.shortcut.closeTab": "أغلق علامة التبويب الحالية",
  "about.shortcut.backToLibrary": "عد إلى المكتبة",
  "about.shortcut.splitRight": "قسّم اللوحة إلى اليمين",
  "about.shortcut.splitDown": "قسّم اللوحة إلى الأسفل",
  "about.shortcut.movePane": "انتقل إلى اللوحة في ذلك الاتجاه",
  "about.shortcut.prevPane": "اللوحة السابقة / التالية",
  "about.shortcut.maximise": "كبّر اللوحة الحالية أو استعدّها",
  "about.shortcut.equal": "امنح كل لوحة حصة متساوية",
  "about.shortcut.closePane": "أغلق اللوحة الحالية",

  // المشكلات الشائعة
  "about.issue.scanMissing": "مضيف لا يظهر في «فحص الشبكة»",
  "about.issue.scanMissingFix":
    "يستخدم الاكتشاف mDNS ومسحًا لشبكة فرعية، فلا يرى إلا المضيفين في المقطع نفسه من الشبكة. أضِفه بعنوان IP من «مضيف جديد» بدلًا من ذلك.",
  "about.issue.retry": "ينقطع الاتصال ويواصل إعادة المحاولة",
  "about.issue.retryFix":
    "إعادة الاتصال تلقائية افتراضيًا. أوقفها، أو فعّل «الإيقاظ عبر الشبكة» أثناء إعادة المحاولة، من «التفضيلات» في قسم «الاتصالات».",
  "about.issue.keyboard": "لا تصل كتابة لوحة المفاتيح إلى الجهاز البعيد",
  "about.issue.keyboardFix":
    "تأكّد أن «للقراءة فقط» مطفأة في قائمة «الجلسة». وعلى macOS يحتاج التقاط الإدخال أيضًا إذن «إمكانية الوصول».",
  "about.issue.passwords": "تُطلب كلمات المرور المحفوظة مع كل تشغيل جديد",
  "about.issue.passwordsFix":
    "يحفظ التطبيق بيانات الاعتماد في خزنة مفاتيح النظام. وتعرض «التفضيلات» في قسم «الأمان» أيّ مخزَّن مُفعَّل وهل هو مفتوح.",

  // جدار الوكلاء
  "wall.idle": "يمسك الإيجار، ولا شيء قيد التنفيذ",
  "wall.stopAll": "أوقفهم كلهم",
  "wall.stopAllTitle": "تسحب الإيجار من كل وكيل على كل جهاز دفعة واحدة",
  "wall.stopAllAskOne": "إيقاف الوكيل على الجهاز الوحيد؟ سيحتاج أن يطلب من جديد.",
  "wall.stopAllAskMany": "إيقاف كل الوكلاء على {count} أجهزة؟ سيحتاجون أن يطلبوا من جديد.",
  "wall.stopAllConfirm": "أوقفهم كلهم",
  "wall.cancel": "إلغاء",
  "wall.explain":
    "وكيل ذكي يقود هذه الأجهزة. كل بطاقة تقول ما يفعله، والمربع يأخذ جهازًا واحدًا. يبقى الشريط هنا حتى حين لا تنظر إليه.",
  "wall.explainHide": "إخفاء هذا الشرح",
  "wall.stopAllDialog": "إيقاف كل الوكلاء",
  "wall.yoursNow": "التحكم لك، وأُوقف الوكيل",
  "wall.tookWheel": "أخذت التحكم من {agent}",
  "wall.doing": "ينفّذ",
  "wall.sent": "أُرسل",
  "wall.refused": "رُفض",
  "wall.failed": "فشل",
  "wall.unread": "غير مقروء",
  "wall.title": "نشاط الوكلاء",
  "wall.planeNone": "لا وكيل متصل",
  "wall.planeIdleOne": "وكيل واحد متصل، لا شيء يقود",
  "wall.planeIdleMany": "{agents} وكلاء متصلون، لا شيء يقاد",
  "wall.planeDrivingOne": "وكيل واحد يقود {driving}",
  "wall.planeDrivingMany": "{agents} وكلاء يقودون {driving}",
  "wall.planeDrivingOneOf": "وكيل واحد يقود {driving} من {sessions}",
  "wall.planeDrivingManyOf": "{agents} وكلاء يقودون {driving} من {sessions}",
  "wall.holderNone": "لا أحد",
  "wall.holderAgent": "وكيل {name}",
  "wall.holderService": "خدمة {name}",
  "wall.holderDriver": "سائق {name}",
  "wall.remoteTerminal": "طرفية البعيد",
  "wall.remoteScreen": "شاشة البعيد",
  "wall.showMachine": "اعرض هذا الجهاز",
  "wall.stopAgent": "أوقف الوكيل الذي يقود {name}، واستعد التحكم",
  "wall.revokeFailed":
    "تعذّر إيقاف الوكيل {name}. لم تستعد التحكّم، وما زال يقود هذا الجهاز.",
  "wall.unitSecond": "ث",
  "wall.unitMinute": "د",
  "wall.unitHour": "س",

  "wall.detailNone": "لا وكيل متصل بهذا الجهاز.",
  "wall.detailSessionsOne": "جلسة حيّة واحدة في المجموع.",
  "wall.detailSessionsMany": "{sessions} جلسات حيّة في المجموع.",
  "wall.detailHeldNone": "لا واحد منهم يمسك الإيجار، فلا شيء يُقاد",
  "wall.detailHeldOne": "جهاز واحد يُقاد",
  "wall.detailHeldMany": "{machines} أجهزة تُقاد",
  "wall.detailAttachedOne": "وكيل واحد متصل.",
  "wall.detailAttachedMany": "{agents} وكلاء متصلون.",
  "wall.detailTail":
    "القيادة تعني أن الوكيل يمسك الإيجار؛ والوكيل المتصل الذي لا يمسك شيئًا لا يقود شيئًا",

  // ما يفعله الوكيل، بصيغة إنسان
  "act.click": "ينقر",
  "act.move": "يحرّك المؤشر",
  "act.drag": "يسحب",
  "act.scroll": "يمرّر",
  "act.press": "يضغط مفتاحًا",
  "act.type": "يكتب",
  "act.wait": "ينتظر",
  "act.capture": "يلتقط الشاشة",
  "act.exec": "يشغّل أمرًا",
  "act.declare": "يصرّح",
  "act.sendBytes": "يرسل بيانات",
  "act.tune": "يضبط الاتصال",
  "act.cancel": "يلغي",
  "act.readScreen": "يقرأ الشاشة",
  "act.readClipboard": "يقرأ الحافظة",
  "act.writeClipboard": "يكتب في الحافظة",
  "act.readFile": "يقرأ ملفًا",
  "act.writeFile": "يكتب ملفًا",

  // حقول النموذج
  "field.optional": "(اختياري)",

  // رفض العناوين
  "address.needHost": "اكتب عنوانًا",
  "address.beforeColon": "اكتب العنوان قبل النقطتين",
  "address.afterColon": "اكتب منفذًا أو رقم شاشة بعد النقطتين",
  "address.portRange": "المنفذ يجب أن يكون بين 1 و65535",
  "address.noSpaces": "لا يمكن أن يحتوي العنوان على مسافات",
  "address.badChars": "لا يمكن أن يحتوي العنوان على / أو ? أو # أو @",
  "address.ipv6": "اكتب عنوان IPv6 هكذا: [::1] أو [::1]:5901",
  "address.ipv6Invalid": "{address} ليس عنوان IPv6 صالحًا",
  "address.needComputerId":
    "اكتب المعرّف المكوّن من 64 حرفًا الموجود تحت «الوصول دون حضورك» في DeskVNC Support",

  // المكتبة
  "library.wakeNeedsMac": "لا يوجد عنوان MAC محفوظ لهذا الجهاز، فلا يمكن إيقاظه.",
  "library.rowSelected": "محدَّد",
  "files.allowFolder": "اسمح بمجلد",

  // نافذة المضيف
  "host.new": "مضيف جديد",
  "host.edit": "تعديل المضيف",
  "host.name": "الاسم",
  "host.nameHint": "كيف يظهر هذا الجهاز في مكتبتك. اتركه فارغًا ليُستخدم عنوانه.",
  "host.namePlaceholder": "حاسوب غرفة المعيشة",
  "host.connectUsing": "الاتصال باستخدام",
  "host.protocolAria": "بروتوكول الاتصال",
  "host.computerId": "معرّف الجهاز",
  "host.address": "العنوان",
  "host.addressHint":
    "192.168.1.42، أو اسم مثل office. والرقم بعد النقطتين إن كان أقل من 100 هو رقم شاشة، فـ :1 هي الشاشة 1 على المنفذ 5901؛ أما 100 فما فوقه فهو منفذ.",
  "host.computerIdHint":
    "يظهر تحت «الوصول دون حضورك» في DeskVNC Support على ذلك الجهاز. وإن لم تكن مقترنًا، يوافقك الشخص هناك، أو تستخدم كلمة المرور أدناه.",
  "host.computerIdPlaceholder": "معرّف جهاز من 64 حرفًا",
  "host.addressPlaceholder": "192.168.1.42 أو اسم المضيف",
  "host.port": "المنفذ",
  "host.portRange": "المنفذ يجب أن يكون بين 1 و65535",
  "host.userName": "اسم المستخدم",
  "host.keepSaved": "اتركه فارغًا للإبقاء على المحفوظ.",
  "host.askedAtConnect": "اتركه فارغًا لتُسأل عند الاتصال",
  "host.unchanged": "(بدون تغيير)",
  "host.passwordUnchanged": "••••••••  (بدون تغيير)",
  "host.macAccount": "حسابك على جهاز Mac",
  "host.optional": "اختياري",
  "host.accountToSignIn": "الحساب الذي تدخل به",
  "host.administrator": "المسؤول",
  "host.domain": "النطاق",
  "host.domainHint":
    "اتركه فارغًا لحساب محلي، أو إذا كان اسم المستخدم لديك بصيغة بريد مثل you@company.com.",
  "host.sameUserAsComputer": "اتركه فارغًا للدخول بالحساب نفسه المستخدَم على هذا الجهاز",
  "host.sameAsThisComputer": "نفس حساب هذا الجهاز",
  "host.signInWith": "الدخول بـ",
  "host.sshAuthAria": "مصادقة SSH",
  "host.group": "المجموعة",
  "host.noGroup": "بلا مجموعة",
  "host.os": "نظام التشغيل",
  "host.osUnknown": "غير معروف",
  "host.osQemu": "QEMU / جهاز افتراضي",
  "host.tags": "الوسوم",
  "host.cancel": "إلغاء",
  "host.saving": "جارٍ الحفظ…",
  "host.add": "إضافة مضيف",
  "host.saveChanges": "حفظ التغييرات",

  // نافذة المضيف: خيارات العرض
  "host.advanced": "إعدادات متقدمة",
  "host.securityType": "نوع الأمان",
  "host.securityTypeHint": "«تلقائي» يفاوض على أقوى نوع مدعوم",
  "host.auto": "تلقائي",
  "host.securityAppleDh": "مشاركة شاشة Apple",
  "host.securityVncPassword": "كلمة مرور VNC فقط",
  "host.none": "لا شيء",
  "host.quality": "الجودة",
  "host.qualityRdpHint":
    "«تلقائي» يتكيّف مع حالة الشبكة. والإعدادات الأدنى تُطفئ الخلفية والمؤثرات على سطح المكتب البعيد.",
  "host.qualityHint": "مدى حدّة الصورة مقابل سرعة استجابة الشاشة.",
  "host.qualitySharp": "حادّة",
  "host.qualityBalanced": "متوازنة",
  "host.qualityResponsive": "سريعة الاستجابة",
  "host.qualityBw": "أبيض وأسود",
  "host.scaling": "التحجيم",
  "host.scalingHint":
    "كيف تلائم الشاشة البعيدة النافذة. هذه نقطة البداية؛ ويمكن أن يغيّرها شريط الأدوات أثناء الجلسة.",
  "host.scalingAspectFit": "ملاءمة النسبة",
  "host.scalingFit": "ملاءمة النافذة",
  "host.scalingActual": "الحجم الحقيقي (1:1)",
  "host.scalingRemoteResize": "تغيير الحجم من البعيد",
  "host.macLabel": "عنوان MAC (للإيقاظ عبر الشبكة)",
  "host.macFoundHint":
    "مُملأ تلقائيًا، وهذا العنوان الذي رأيناه حين عثرنا على هذا الجهاز على شبكتك. يتيح لك إيقاظه من المكتبة.",
  "host.macAutoHint":
    "يُملأ تلقائيًا حين يُكتشف الجهاز على شبكتك. يتيح لك إيقاظ هذا الجهاز من المكتبة.",
  "host.macAria": "عنوان MAC للإيقاظ عبر الشبكة",
  "host.captureShortcuts": "التقاط اختصارات النظام افتراضيًا",
  "host.captureShortcutsRdp": "يرسل اختصارات مثل Alt+Tab ومفتاح ويندوز إلى الجهاز البعيد",
  "host.captureShortcutsOther": "يرسل اختصارات مثل Cmd+Tab / Alt+Tab إلى الجهاز البعيد",

  // نافذة المضيف: خيارات RDP
  "host.colourDepth": "عمق الألوان",
  "host.colourDepthHint": "«تلقائي» يتبع إعداد الجودة",
  "host.bits32": "32 بت",
  "host.bits24": "24 بت",
  "host.bits16": "16 بت",
  "host.bits15": "15 بت",
  "host.sound": "الصوت",
  "host.soundHere": "تشغيل هنا",
  "host.soundThere": "تشغيل هناك",
  "host.soundOff": "بدون تشغيل",
  "host.allMonitors": "استخدام كل شاشاتي",
  "host.allMonitorsHint": "يجعل قائمة «الشاشات» تسرد شاشات الجهاز البعيد بدل شاشة واحدة.",
  "host.shareClipboard": "مشاركة حافظتي",
  "host.consoleSession": "الاتصال بجلسة وحدة التحكم",
  "host.codecs": "المرمّزات",
  "host.codecsHint":
    "أطفئ واحدًا من هذه فقط للتعامل مع خادم صورته معطوبة. فكلها تجعل الاتصال أسرع.",

  // نافذة المضيف: خيارات SSH
  "host.sshAuthPassword": "كلمة المرور",
  "host.sshAuthKeyFile": "ملف مفتاح",
  "host.sshAuthAgent": "وكيل SSH",
  "host.sshAuthPasswordHint": "كلمة مرور حسابك على ذلك الجهاز، تُحفظ في خزنة مفاتيح نظامك.",
  "host.sshAuthKeyFileHint":
    "مفتاح خاص على هذا الجهاز. يُقرأ عند الاتصال ولا يغادر هذا الجهاز أبدًا.",
  "host.sshAuthAgentHint":
    "يستخدم وكيل ssh-agent أو Pageant العامل لديك، أو أنبوب OpenSSH في ويندوز. ولا يخزّن شيئًا.",
  "host.keyPassphrase": "عبارة مرور المفتاح",
  "host.password": "كلمة المرور",
  "host.secretSavedHint":
    "هناك سر محفوظ في خزنة مفاتيح نظامك. اتركه فارغًا للإبقاء عليه.",
  "host.keyPassphraseHint":
    "مطلوبة فقط إذا كان المفتاح نفسه محميًا. تُحفظ في خزنة مفاتيح نظامك، لا في ملف.",
  "host.boundaryPasswordHint":
    "كلمة المرور التي تستخدمها للوصول إلى هذا الجهاز حين لا يكون هناك من يوافق لك. وهي المضبوطة على ذلك الجهاز تحت «الوصول دون حضورك». تُحفظ في خزنة مفاتيح نظامك، لا في ملف.",
  "host.storedInKeychain": "تُحفظ في خزنة مفاتيح نظامك، لا في ملف",
  "host.wsl": "الاتصال داخل WSL",
  "host.wslHint":
    "على جهاز ويندوز، ينزل الاتصال إلى النظام الفرعي للويندوز للينكس بدل PowerShell، ويُبحث عن المُضاعِف هناك بدل ويندوز.",
  "host.distribution": "التوزيعة",
  "host.distrosUnreadable":
    "تعذّرت قراءة قائمة التوزيعات المثبّتة، فاكتب اسمًا بدلًا منها. واتركه فارغًا للتوزيعة الافتراضية.",
  "host.defaultDistribution": "اتركه فارغًا للتوزيعة الافتراضية.",
  "host.defaultDistributionOption": "التوزيعة الافتراضية",
  "host.detecting": "جارٍ الفحص…",
  "host.detect": "فحص",
  "host.multiplexer": "مُضاعِف الطرفية",
  "host.multiplexerHint":
    "«تلقائي» يجد tmux أو psmux على الجهاز البعيد، فيبقى عملك قائمًا عند انقطاع الاتصال. وبدونه، ينتهي جلستك بانقطاعه.",
  "host.multiplexerAuto": "تلقائي (مُستحسن)",
  "host.multiplexerNone": "لا شيء، صدفة عادية دائمًا",
  "host.sessionName": "اسم الجلسة",
  "host.sessionNameHint":
    "يوضع هذا على سطر الأوامر البعيد لإرفاق الجلسة أو إنشائها، فلا يُقبل إلا الحروف والأرقام والشرطة السفلية والشرطة العادية، حتى 64 حرفًا.",
  "host.customCommand": "أمر مخصّص",
  "host.customCommandHint":
    "يُنفَّذ على الجهاز البعيد بدل الارتباط بـ tmux أو psmux أو مُضاعِف آخر. ويُستبدل {session} باسم الجلسة أعلاه.",
  "host.startupCommand": "أمر بدء التشغيل",
  "host.startupCommandHint":
    "يُنفَّذ بعد الاتصال مرة واحدة، بدل صدفة الدخول. اتركه فارغًا للدخول المعتاد.",
  "host.fallbackShell": "الرجوع إلى صدفة عادية",
  "host.fallbackShellHint":
    "إن لم يكن المُضاعِف المختار مثبّتًا على الجهاز البعيد، اتصل بصدفة عادية بدل رفض الاتصال.",
  "host.fontSize": "حجم الخط",
  "host.scrollback": "التمرير إلى الخلف",
  "host.scrollbackHint": "الأسطر المحفوظة للتمرير إلى الخلف",

  // نافذة المضيف: الأمان
  "host.security": "الأمان",
  "host.allowNoNla": "السماح بالاتصال دون مصادقة مستوى الشبكة",
  "host.allowNoNlaHint":
    "بعض الخوادم القديمة أو المضبوطة خطأً ترفض مصادقة مستوى الشبكة. وبدونها تُرسل كلمة مرورك إلى جهاز لم يُتحقّق من هويته بعد.",
  "host.allowLegacyTls": "السماح بـ TLS القديم (1.0 و1.1)",
  "host.allowLegacyTlsHint":
    "لأجهزة ويندوز 7 وServer 2008 R2 التي لم تُحدَّث أبدًا. توفّر تلك الأجهزة TLS 1.0 أو 1.1 فقط، وهذا التطبيق يرفضها عادةً. فاترك هذا الخيار مغلقًا إلا إذا فشل اتصال بسببه من قبل.",
  "host.legacyTlsWarning":
    "TLS 1.0 و1.1 قديمان وضعيفان. من يستطيع الوقوف بينك وبين هذا الجهاز تكون فرصته في قراءة البيانات أو تغييرها أكبر من فرصته فوق TLS 1.2. وما يبقى يحميك هو الشهادة التي ثبّتها هذا التطبيق أول مرة اتصلت، وهي تُفحص في كل اتصال مهما كان الإصدار المستخدَم، ومصادقة مستوى الشبكة، التي تثبت أن هذا الجهاز هو نفسه الجهاز الذي دخلت إليه من قبل أن تُرسل كلمة مرورك. فعّل هذا الخيار لجهاز واحد في كل مرة، لا كعادة.",

  // نافذة المضيف: المفتاح الخاص
  "host.privateKey": "المفتاح الخاص",
  "host.keyProtectedHint":
    "هذا المفتاح محمي بعبارة مرور. ضعها في الصندوق أدناه فتُحفظ في خزنة مفاتيح نظامك.",
  "host.keyOnDiskHint": "مفتاح خاص من OpenSSH أو PuTTY (.ppk) على هذا الجهاز.",
  "host.keysFoundHint": "مفاتيح وُجدت في مجلد ‎.ssh، أو ابحث عن مفتاح في مكان آخر.",
  "host.chooseKey": "اختر مفتاحًا…",
  "host.anotherFile": "ملف آخر…",
  "host.browse": "استعراض…",
  "host.privateKeyPathAria": "مسار المفتاح الخاص",

  // نافذة المضيف: نفق SSH
  "host.tunnelOverSsh": "نفق عبر SSH",
  "host.tunnelHint":
    "يمرّر الاتصال عبر دخول SSH، فيصل إلى الخوادم التي تستمع على العنوان المحلي للجهاز البعيد فقط، ويكون مشفّرًا من طرف إلى طرف",
  "host.sshHost": "مضيف SSH",
  "host.sshHostHint": "اتركه فارغًا للاتصال بـ SSH على العنوان أعلاه",
  "host.sameAsAddress": "نفس العنوان أعلاه",
  "host.sshPort": "منفذ SSH",
  "host.user": "المستخدم",
  "host.userHint": "اتركه فارغًا لاستخدام اسم المستخدم المحلي لديك",
  "host.authentication": "المصادقة",
  "host.authHint": "تبقى الأسرار في خزنة مفاتيحك أو وكيلك",
  "host.authStored": "عبارة المرور المحفوظة (أو الوكيل)",
  "host.authKeyFile": "ملف المفتاح الخاص",
  "host.sshPassword": "كلمة مرور SSH",
  "host.tunnelSecretHint":
    "تُحفظ في خزنة مفاتيح نظامك، وهي مشتركة مع لوحة «الملفات». اتركه فارغًا للإبقاء على المحفوظ.",

  // نافذة المضيف: الدقة
  "host.resolution": "الدقة",
  "host.resolutionFollowHint":
    "يتغيّر حجم سطح المكتب البعيد مع تغيّر حجم هذه النافذة. ويعيد ويندوز ترتيب أيقوناته في كل مرة.",
  "host.resolutionAtConnectHint":
    "يُضبط حجم سطح المكتب البعيد على هذه النافذة عند الاتصال، ثم يُترك كما هو.",
  "host.resolutionFixedHint":
    "يبقى سطح المكتب البعيد بهذا الحجم دائمًا، وتُحجّمه هذه النافذة لتلائمها.",
  "host.resolutionAtConnect": "مطابقة هذه النافذة عند الاتصال",
  "host.resolutionFollow": "مطابقة هذه النافذة، ومتابعة المطابقة",
  "host.resolutionCustom": "مخصّص…",
  "host.widthPixels": "العرض بالبكسل",
  "host.heightPixels": "الارتفاع بالبكسل",

  // نافذة المضيف: الأخطاء
  "host.required": "مطلوب",
  "host.max64": "64 حرفًا أو أقل",
  "host.sessionNameChars": "حروف وأرقام وشرطة سفلية وشرطة عادية فقط",
  "host.distroNameChars": "حروف وأرقام ونقطة وشرطة سفلية وشرطة عادية فقط",
  "host.macFormat": "عنوان MAC اثنا عشر رقمًا ست عشريًا، مثل aa:bb:cc:dd:ee:ff",

  // نافذة المضيف: أسماء البروتوكولات
  "host.protocolBoundary": "الدعم",
  "host.protocolRdp": "سطح المكتب البعيد",
  "host.protocolSsh": "الطرفية",
  "host.protocolVnc": "مشاركة الشاشة",
  "host.protocolNameBoundary": "DeskVNC Support (مساعدة عن بُعد)",
  "host.protocolNameRdp": "سطح المكتب البعيد (RDP)",
  "host.protocolNameSsh": "الطرفية (SSH)",
  "host.protocolNameVnc": "مشاركة الشاشة (VNC)",

  // الأوقات
  "util.never": "أبدًا",
} as const;

const en: Record<keyof typeof ar, string> = {
  "app.language": "Language",
  "app.arabic": "العربية",
  "app.english": "English",
  "registry.title": "Orax registry (optional)",
  "registry.description":
    "Publish this invitation as a short code through your own registry. Only the invitation is stored, sealed, for minutes; screen and input never go through it.",
  "registry.url": "Registry URL",
  "registry.create": "Get a code from the registry",
  "registry.createAnother": "Create another code",
  "registry.copy": "Copy code",
  "registry.withdraw": "Withdraw",
  "registry.ready": "Code ready, valid until {time}.",
  "registry.withdrawn": "Code withdrawn. Nobody can use it now.",
  "registry.failed": "The code could not be created: {reason}",
  "registry.withdrawFailed": "The code could not be withdrawn: {reason}",
  "registry.healthy": "The registry is working.",
  "registry.degraded": "The registry is not in good shape (database: {db}, sealing key: {key}).",
  "device.number": "This computer's number — read it out",
  "device.copyNumber": "Copy number",
  "device.numberHint":
    "Nine digits that never change for this computer. Read them down the phone to whoever is helping you, or copy them.",
  "device.id": "This computer's ID, for reaching it unattended",
  "device.copyId": "Copy ID",

  // The onboarding screen
  "onboarding.scanning": "Scanning your network…",
  "onboarding.scanNothing":
    "Nothing found yet; some computers do not advertise themselves. You can add one manually later.",
  "onboarding.scanFailed":
    "The network scan could not be started. Check your network settings and try again.",
  "onboarding.scanRetry": "Try again",

  // The quick connect bar
  "quick.placeholder": "Connect to an address, e.g. 192.168.1.20:1 or rdp://frontdesk  ({key}T)",
  "quick.label": "Address to connect to",
  "quick.connect": "Connect",
  "quick.savedHost": "saved host",
  "quick.recent": "recent",
  "quick.viaSaved": "Connects through {name}",
  "quick.remembered": "Connects now — the address is remembered in this list",
  "quick.chipSaved": "saved",
  "quick.chipDisplay": "{protocol} · display {display}",
  "quick.chipSavedTitle": "{name} is saved as {protocol}. This address connects through that profile.",
  "quick.chipTitle": "Connect with {protocol}. Click to use {next} instead.",
  "quick.connectTo": "Connect to {target}",

  // The remote support dialogs
  "support.helpSomeone": "Help someone",
  "support.helpSomeoneNow": "Someone asked me for help",
  "support.reachComputer": "A computer I can reach",
  "support.yourName": "Your name, shown to the person",
  "support.theirCode": "Their code or invitation",
  "support.theirCodePlaceholder": "1234 5678 9012, or boundary1:…",
  "support.registryUrl": "Orax registry URL (optional)",
  "support.registryHint":
    "A number is looked up through this registry first. Leave it empty to use the code service below.",
  "support.codeServiceUrl": "Code service URL",
  "support.codeServiceHint":
    "A number needs the same code service the person used. Otherwise ask them for the invitation text.",
  "support.computerId": "Computer ID or number",
  "support.computerIdHint": "Ask them for the number they can read out, or for the full ID from Copy ID.",
  "support.notAnId":
    "That is not a computer ID or a number. Ask for the nine-digit number, or for the full ID from Copy ID.",
  "support.numberNeedsRegistry": "A number needs a registry URL above, or the full ID.",
  "support.libraryName": "Name in your Library",
  "support.unattendedPassword": "Password, if nobody is there to approve you",
  "support.unattendedPasswordHint":
    "The unattended password set on that computer. Kept in your system keychain, never in the Library file.",
  "support.pasted": "Pasted from your clipboard.",
  "support.cancel": "Cancel",
  "support.connect": "Connect",
  "support.saveAndConnect": "Save and connect",
  "support.opening": "Opening…",
  "support.connectMode": "How to connect",
  "support.registryUrlRequired": "Enter the registry URL to look up a number.",
  "support.defaultMachineName": "Boundary computer",

  // The "Get help" window
  "gethelp.button": "Get help",
  "gethelp.sharing": "Sharing",
  "gethelp.title": "Get help",
  "gethelp.intro":
    "Let someone you trust see or control this computer. They see nothing until you approve them.",
  "gethelp.close": "Close",
  "gethelp.settings": "Settings",
  "gethelp.loading": "Opening the support window…",
  "gethelp.unavailable": "The support service is not available in this build.",
  "gethelp.shareTitle": "Share this computer",
  "gethelp.shareIntro":
    "One code per session. It expires after 10 minutes if nobody connects.",
  "gethelp.getCode": "Get a code",
  "gethelp.createInvitation": "Create invitation",
  "gethelp.copyCode": "Copy code",
  "gethelp.copyInvitation": "Copy the full invitation instead",
  "gethelp.readOut": "Read it out or send it. Your helper enters it, and you approve them here.",
  "gethelp.endSession": "End session",
  "gethelp.unattended": "Unattended access",
  "gethelp.paired": "Paired helpers",
  "gethelp.passwordsDiffer": "The two passwords do not match.",

  // Sharing and permissions in "Get help"
  "gethelp.copied": "Copied",
  "gethelp.screenPermission": "Screen Recording permission is needed to share.",
  "gethelp.allowScreenRecording": "Allow screen recording",
  "gethelp.screenPermissionHint":
    "After granting it, quit and reopen DeskVNC if sharing still fails.",
  "gethelp.noDisplayToShare": "No display found to share.",
  "gethelp.shareScreen": "Shared screen",
  "gethelp.gettingCode": "Getting your code…",
  "gethelp.creatingCode": "Creating your code…",
  "gethelp.useFullInvitation": "Use the full invitation instead",
  "gethelp.copyInvitationText": "Copy invitation",
  "gethelp.sendPrivately":
    "Send it in any chat and keep it private. It is valid for one session.",
  "gethelp.allowRemoteControl": "Allow remote control",
  "gethelp.giveAccess":
    "Give the person helping you {what}. They see nothing until you approve them.",
  "gethelp.thisCode": "this code",
  "gethelp.thisInvitation": "this invitation",
  "gethelp.on": "On",
  "gethelp.starting": "Starting",
  "gethelp.offInSettings": "Off. Change it under Settings.",
  "gethelp.screenShared": "Your screen is being shared",
  "gethelp.helperSees":
    "The helper can see the selected display, including notifications and this window.",
  "gethelp.allowControl": "Allow the helper to control my mouse and keyboard",
  "gethelp.controlNeedsAccessibility":
    "Control needs Accessibility permission. Viewing works without it.",
  "gethelp.openAccessibility": "Open Accessibility settings",
  "gethelp.allowTools": "Allow the helper's tools to run commands and copy files",
  "gethelp.toolsDid": "What their tools did",
  "gethelp.pairedHelperNote":
    "{name} can connect to this computer any time. Remove them under Settings, Unattended access, to stop it.",
  "gethelp.pairTitle":
    "They are remembered by their connection's key. You can remove them later under Settings.",
  "gethelp.pairButton": "Let {name} connect any time, even when I am away",
  "gethelp.screenToShare": "Screen to share",
  "gethelp.refresh": "Refresh",
  "gethelp.noDisplay": "No display found.",
  "gethelp.accessibilityNeeded":
    "Accessibility permission is needed for a helper to control this computer. Viewing works without it.",

  // Unattended access in "Get help"
  "gethelp.unattendedIntro":
    "Let people you trust connect to this computer when nobody is here to approve. Off unless you switch it on. DeskVNC must be running for it to work.",
  "gethelp.allowUnattended": "Allow unattended access to this computer",
  "gethelp.idReachable": "This computer's ID, reachable now",
  "gethelp.helperEntersId":
    "A helper enters it as the computer ID, with the unattended password unless they were paired here.",
  "gethelp.autostart": "Start DeskVNC when I sign in, so it is ready",
  "gethelp.noPairedYet":
    "None yet. During a support session, choose Let them connect any time to pair the helper.",
  "gethelp.mayControl": "may control",
  "gethelp.toolsNote":
    "For a helper whose tools, such as DeskVNC's agents, work on this computer while you are away. Commands run as you.",
  "gethelp.mayRunTools": "may run commands and copy files",
  "gethelp.remove": "Remove",
  "gethelp.unattendedPassword": "Unattended password",
  "gethelp.unattendedPasswordHint":
    "Optional. Lets a helper who was never paired connect with this computer's ID and the password. At least {min} characters. Five wrong tries pause it for 15 minutes.",
  "gethelp.newPassword": "New password",
  "gethelp.repeatPassword": "Repeat it",
  "gethelp.setPassword": "Set password",
  "gethelp.removePassword": "Remove the password",

  // Connection and short codes in "Get help"
  "gethelp.connection": "Connection",
  "gethelp.now": "Now: {network}",
  "gethelp.automatic": "Automatic (recommended for a support call)",
  "gethelp.provider": "Set up my Tailscale or Cloudflare network",
  "gethelp.private": "Use another existing private network",
  "gethelp.relay": "Use my compatible relay server",
  "gethelp.automaticHint":
    "Tries a direct connection with encrypted relay fallback. No provider account is needed. Public relays have capacity limits and no uptime guarantee.",
  "gethelp.providerIntro":
    "Install and connect this computer to your own provider account. Run setup on the helper's device too.",
  "gethelp.addressOnNetwork": "This computer's address on that network: {address}",
  "gethelp.localIp": "Local interface IP address",
  "gethelp.localIpHint":
    "For an existing Headscale, WireGuard, Cloudflare private network or other routed network. Both machines need a permitted route. Entering an IP does not enroll either device.",
  "gethelp.relayUrl": "Relay URL",
  "gethelp.relayUrlHint": "A compatible iroh relay. The invitation carries it to your helper.",
  "gethelp.privateWarning":
    "If this network is unavailable or the address changes, connecting fails instead of using a public relay.",
  "gethelp.saveConnection": "Save connection settings",
  "gethelp.endSessionToChange": "End the session to change this.",
  "gethelp.saved": "Saved",
  "gethelp.savedTry": "Saved. Get a code to try it with your helper.",
  "gethelp.save": "Save",
  "gethelp.shortCodes": "Short codes",
  "gethelp.shortCodesHint":
    "A short code is easier to read out than a full invitation. Both people must use the same code service, and it can read the invitations it is given, so use one you trust.",
  "gethelp.codeServiceHint":
    "Leave empty for the shared Boundary service. Private infrastructure needs its own service here.",

  // The About screen
  "about.title": "About DeskVNCViewer",
  "about.sectionsLabel": "About sections",
  "about.tabAbout": "About",
  "about.tabHelp": "Help",
  "about.tagline": "A fast, native remote desktop viewer for macOS, Windows and Linux.",
  "about.version": "Version {version}",
  "about.buildLabel": "Build details",
  "about.build": "Build",
  "about.copied": "Copied",
  "about.copyReport": "Copy report for a bug ticket",
  "about.commit": "Commit",
  "about.locallyModified": "locally modified",
  "about.branch": "Branch",
  "about.branchDetail": "{branch}, committed {date}",
  "about.toolchain": "Toolchain",
  "about.toolchainDetail": "{profile} profile, tauri {tauri}, {rustc}",
  "about.system": "System",
  "about.systemDetail": "{os} {version} ({arch}), webview {webview}",
  "about.includeBlock":
    "Please include the copied block when reporting an issue; it identifies this exact build.",
  "about.developedBy": "Developed by",
  "about.contact": "Contact",
  "about.license": "License",
  "about.copyright":
    "© {year} {author}. Supports RFB 3.3-3.8 with VNC, VeNCrypt, RA2, Apple Diffie-Hellman and MS-Logon authentication, and RDP with network level authentication.",
  "about.projectPage": "Project page",
  "about.contactDeveloper": "Contact developer",
  "about.close": "Close",

  // The getting started list in About
  "about.gettingStarted": "Getting started",
  "about.startUse": "Use",
  "about.startFind": "to find computers nearby, or",
  "about.startAdd": "to add one by address.",
  "about.scanNetwork": "Scan network",
  "about.newHost": "New Host",
  "about.startConnect":
    "Double-click a tile to connect. Passwords are saved to the OS keychain on first use.",
  "about.startOrganise":
    "Group and tag hosts from the sidebar to keep a large library navigable.",
  "about.shortcuts": "Keyboard shortcuts",
  "about.troubleshooting": "Troubleshooting",
  "about.documentation": "Full documentation",

  // The keyboard shortcuts
  "about.shortcut.palette": "Command palette",
  "about.shortcut.newHost": "New host",
  "about.shortcut.quickConnect": "Jump to the QuickConnect address bar",
  "about.shortcut.search": "Search the library",
  "about.shortcut.preferences": "Preferences",
  "about.shortcut.disconnect": "Disconnect session",
  "about.shortcut.toolbar": "Show/hide session toolbar",
  "about.shortcut.fullscreen": "Toggle fullscreen",
  "about.shortcut.tabs": "Next / previous tab",
  "about.shortcut.jumpTab": "Jump to a tab (1 is the library)",
  "about.shortcut.closeTab": "Close the current tab",
  "about.shortcut.backToLibrary": "Back to the library",
  "about.shortcut.splitRight": "Split the pane to the right",
  "about.shortcut.splitDown": "Split the pane downwards",
  "about.shortcut.movePane": "Move to the pane in that direction",
  "about.shortcut.prevPane": "Previous / next pane",
  "about.shortcut.maximise": "Maximise the current pane, or restore it",
  "about.shortcut.equal": "Give every pane an equal share",
  "about.shortcut.closePane": "Close the current pane",

  // The common problems
  "about.issue.scanMissing": "A host is not showing up in Scan network",
  "about.issue.scanMissingFix":
    "Discovery uses mDNS and a subnet sweep, so it only sees hosts on the same network segment. Add it by IP with New Host instead.",
  "about.issue.retry": "The connection drops and keeps retrying",
  "about.issue.retryFix":
    "Reconnect is automatic by default. Turn it off, or enable Wake-on-LAN during retry, in Preferences → Connections.",
  "about.issue.keyboard": "Keyboard input is not reaching the remote machine",
  "about.issue.keyboardFix":
    "Check that View Only is off in the Session menu. On macOS, input capture also needs Accessibility permission.",
  "about.issue.passwords": "Saved passwords are requested again every launch",
  "about.issue.passwordsFix":
    "The app stores credentials in the OS keychain. Preferences → Security shows which backend is active and whether it is unlocked.",

  // The agent wall
  "wall.idle": "Holding the lease, nothing in flight",
  "wall.stopAll": "Stop all",
  "wall.stopAllTitle": "Take every lease back from every agent, at once",
  "wall.stopAllAskOne": "Stop the agent on the one machine? They will have to ask again.",
  "wall.stopAllAskMany": "Stop every agent on all {count} machines? They will have to ask again.",
  "wall.stopAllConfirm": "Stop them all",
  "wall.cancel": "Cancel",
  "wall.explain":
    "An AI agent is driving these computers. Each card says what it is doing; the square button takes one machine back. The bar stays here even when you are not looking at it.",
  "wall.explainHide": "Hide this explanation",
  "wall.stopAllDialog": "Stop every agent",
  "wall.yoursNow": "Input is yours, the agent was stopped",
  "wall.tookWheel": "You took the wheel from {agent}",
  "wall.doing": "doing",
  "wall.sent": "sent",
  "wall.refused": "refused",
  "wall.failed": "failed",
  "wall.unread": "unread",
  "wall.title": "Agent activity",
  "wall.planeNone": "No agent connected",
  "wall.planeIdleOne": "1 agent connected, none driving",
  "wall.planeIdleMany": "{agents} agents connected, none driving",
  "wall.planeDrivingOne": "1 agent driving {driving}",
  "wall.planeDrivingMany": "{agents} agents driving {driving}",
  "wall.planeDrivingOneOf": "1 agent driving {driving} of {sessions}",
  "wall.planeDrivingManyOf": "{agents} agents driving {driving} of {sessions}",
  "wall.holderNone": "Nobody",
  "wall.holderAgent": "Agent {name}",
  "wall.holderService": "Service {name}",
  "wall.holderDriver": "Driver {name}",
  "wall.remoteTerminal": "remote terminal",
  "wall.remoteScreen": "remote screen",
  "wall.showMachine": "Show this machine",
  "wall.stopAgent": "Stop the agent driving {name}, and take control",
  "wall.revokeFailed":
    "Could not stop the agent {name}. You did not get the machine back, and the agent is still driving it.",
  "wall.unitSecond": "s",
  "wall.unitMinute": "m",
  "wall.unitHour": "h",
  "wall.detailNone": "No agent is attached to this computer.",
  "wall.detailSessionsOne": "1 session is live in all.",
  "wall.detailSessionsMany": "{sessions} sessions are live in all.",
  "wall.detailHeldNone": "None of them holds a lease, so nothing is being driven",
  "wall.detailHeldOne": "1 machine is being driven",
  "wall.detailHeldMany": "{machines} machines are being driven",
  "wall.detailAttachedOne": "1 agent attached.",
  "wall.detailAttachedMany": "{agents} agents attached.",
  "wall.detailTail":
    "Driving means an agent holds the lease; an attached agent that holds none is driving nothing.",

  // What the agent is doing, in a person's words
  "act.click": "clicking",
  "act.move": "moving the mouse",
  "act.drag": "dragging",
  "act.scroll": "scrolling",
  "act.press": "pressing a key",
  "act.type": "typing",
  "act.wait": "waiting",
  "act.capture": "capturing the screen",
  "act.exec": "running a command",
  "act.declare": "declaring",
  "act.sendBytes": "sending data",
  "act.tune": "tuning the connection",
  "act.cancel": "cancelling",
  "act.readScreen": "reading the screen",
  "act.readClipboard": "reading the clipboard",
  "act.writeClipboard": "writing the clipboard",
  "act.readFile": "reading a file",
  "act.writeFile": "writing a file",

  // Form fields
  "field.optional": "(optional)",

  // Refusing an address
  "address.needHost": "Enter an address",
  "address.beforeColon": "Enter an address before the colon",
  "address.afterColon": "Add a port or display number after the colon",
  "address.portRange": "Port must be between 1 and 65535",
  "address.noSpaces": "An address cannot contain spaces",
  "address.badChars": "An address cannot contain / ? # or @",
  "address.ipv6": "Write an IPv6 address as [::1] or [::1]:5901",
  "address.ipv6Invalid": "{address} is not a valid IPv6 address",
  "address.needComputerId":
    "Enter the 64 character ID shown under Unattended access in DeskVNC Support",

  // The library
  "library.wakeNeedsMac": "This computer has no MAC address saved, so it cannot be woken.",
  "library.rowSelected": "selected",
  "files.allowFolder": "Allow a folder",

  // The host dialog
  "host.new": "New Host",
  "host.edit": "Edit Host",
  "host.name": "Name",
  "host.nameHint": "How this computer appears in your library. Leave blank to use its address.",
  "host.namePlaceholder": "Living Room Mac",
  "host.connectUsing": "Connect using",
  "host.protocolAria": "Connection protocol",
  "host.computerId": "Computer ID",
  "host.address": "Address",
  "host.addressHint":
    "192.168.1.42, or a name like office. A number after the colon under 100 is a screen number, so :1 is screen 1 on port 5901; 100 and above is a port.",
  "host.computerIdHint":
    "Shown under Unattended access in DeskVNC Support on that computer. If you are not paired, the person there approves you, or you use the password below.",
  "host.computerIdPlaceholder": "64 character computer ID",
  "host.addressPlaceholder": "192.168.1.42 or hostname",
  "host.port": "Port",
  "host.portRange": "The port must be between 1 and 65535",
  "host.userName": "User name",
  "host.keepSaved": "Leave blank to keep the saved one.",
  "host.askedAtConnect": "Leave blank to be asked when you connect",
  "host.unchanged": "(unchanged)",
  "host.passwordUnchanged": "••••••••  (unchanged)",
  "host.macAccount": "Your account on that Mac",
  "host.optional": "Optional",
  "host.accountToSignIn": "The account to sign in with",
  "host.administrator": "Administrator",
  "host.domain": "Domain",
  "host.domainHint":
    "Leave blank for a local account, or if your user name is already an email-style name like you@company.com.",
  "host.sameUserAsComputer": "Leave blank to sign in as the same user as this computer",
  "host.sameAsThisComputer": "Same as this computer",
  "host.signInWith": "Sign in with",
  "host.sshAuthAria": "SSH authentication",
  "host.group": "Group",
  "host.noGroup": "No group",
  "host.os": "Operating system",
  "host.osUnknown": "Unknown",
  "host.osQemu": "QEMU / VM",
  "host.tags": "Tags",
  "host.cancel": "Cancel",
  "host.saving": "Saving…",
  "host.add": "Add Host",
  "host.saveChanges": "Save Changes",

  // The host dialog: display options
  "host.advanced": "Advanced",
  "host.securityType": "Security type",
  "host.securityTypeHint": "Auto negotiates the strongest supported",
  "host.auto": "Auto",
  "host.securityAppleDh": "Apple Screen Sharing",
  "host.securityVncPassword": "VNC password only",
  "host.none": "None",
  "host.quality": "Quality",
  "host.qualityRdpHint":
    "Auto adapts to network conditions. Lower settings turn off wallpaper and effects on the remote desktop.",
  "host.qualityHint": "How sharp the picture is against how quickly the screen answers you.",
  "host.qualitySharp": "Sharp",
  "host.qualityBalanced": "Balanced",
  "host.qualityResponsive": "Responsive",
  "host.qualityBw": "Black & White",
  "host.scaling": "Scaling",
  "host.scalingHint":
    "How the remote screen fits the window. This is the starting point; the toolbar can change it during a session.",
  "host.scalingAspectFit": "Aspect fit",
  "host.scalingFit": "Fit to window",
  "host.scalingActual": "Actual size (1:1)",
  "host.scalingRemoteResize": "Remote resize",
  "host.macLabel": "MAC address (for Wake-on-LAN)",
  "host.macFoundHint":
    "Filled in automatically, this is the address we saw when we found this machine on your network. Lets you wake it from the library.",
  "host.macAutoHint":
    "Filled in automatically when the machine was discovered on your network. Lets you wake this computer from the library.",
  "host.macAria": "MAC address for Wake-on-LAN",
  "host.captureShortcuts": "Capture system shortcuts by default",
  "host.captureShortcutsRdp": "Sends shortcuts like Alt+Tab and the Windows key to the remote computer",
  "host.captureShortcutsOther": "Sends shortcuts like Cmd+Tab / Alt+Tab to the remote computer",

  // The host dialog: RDP options
  "host.colourDepth": "Colour depth",
  "host.colourDepthHint": "Auto follows the quality setting",
  "host.bits32": "32-bit",
  "host.bits24": "24-bit",
  "host.bits16": "16-bit",
  "host.bits15": "15-bit",
  "host.sound": "Sound",
  "host.soundHere": "Play here",
  "host.soundThere": "Play there",
  "host.soundOff": "Do not play",
  "host.allMonitors": "Use all of my monitors",
  "host.allMonitorsHint": "Makes the Displays menu list the remote monitors instead of just the one.",
  "host.shareClipboard": "Share my clipboard",
  "host.consoleSession": "Connect to the console session",
  "host.codecs": "Codecs",
  "host.codecsHint":
    "Turn one of these off only to work around a server whose picture is wrong. They all make the connection faster.",

  // The host dialog: SSH options
  "host.sshAuthPassword": "Password",
  "host.sshAuthKeyFile": "Key file",
  "host.sshAuthAgent": "SSH agent",
  "host.sshAuthPasswordHint": "The password for your account on that computer, kept in your system keychain.",
  "host.sshAuthKeyFileHint":
    "A private key on this computer. It is read when you connect and never leaves this machine.",
  "host.sshAuthAgentHint":
    "Uses your running ssh-agent, Pageant, or the Windows OpenSSH pipe. Stores nothing.",
  "host.keyPassphrase": "Key passphrase",
  "host.password": "Password",
  "host.secretSavedHint":
    "A secret is saved in your system keychain. Leave blank to keep it.",
  "host.keyPassphraseHint":
    "Only needed if the key itself is protected. Stored in your system keychain, never in a file.",
  "host.boundaryPasswordHint":
    "The password you use to reach this computer when nobody is there to approve you. It is the one set on that computer under Unattended access. Stored in your system keychain, never in a file.",
  "host.storedInKeychain": "Stored in your system keychain, never in a file",
  "host.wsl": "Connect inside WSL",
  "host.wslHint":
    "On a Windows host, land inside the Windows Subsystem for Linux instead of PowerShell, and look for the multiplexer there instead of on Windows.",
  "host.distribution": "Distribution",
  "host.distrosUnreadable":
    "The list of installed distributions could not be read, so type a name instead. Leave blank for the default distribution.",
  "host.defaultDistribution": "Leave blank for the default distribution.",
  "host.defaultDistributionOption": "Default distribution",
  "host.detecting": "Detecting…",
  "host.detect": "Detect",
  "host.multiplexer": "Terminal multiplexer",
  "host.multiplexerHint":
    "Auto finds tmux or psmux on the remote machine, so your work survives a dropped connection. Without one, a disconnect ends your session.",
  "host.multiplexerAuto": "Auto (recommended)",
  "host.multiplexerNone": "None, always a plain shell",
  "host.sessionName": "Session name",
  "host.sessionNameHint":
    "This is placed on the remote command line to attach or create the session, so only letters, numbers, underscore and hyphen are accepted, up to 64 characters.",
  "host.customCommand": "Custom command",
  "host.customCommandHint":
    "Runs on the remote machine instead of attaching to tmux, psmux or another multiplexer. {session} is replaced with the session name above.",
  "host.startupCommand": "Startup command",
  "host.startupCommandHint":
    "Runs once connected, instead of your login shell. Leave blank to sign in normally.",
  "host.fallbackShell": "Fall back to a plain shell",
  "host.fallbackShellHint":
    "If the chosen multiplexer is not installed on the remote machine, connect with an ordinary shell instead of refusing to connect.",
  "host.fontSize": "Font size",
  "host.scrollback": "Scrollback",
  "host.scrollbackHint": "Lines kept for scrolling back",

  // The host dialog: security
  "host.security": "Security",
  "host.allowNoNla": "Allow connecting without network level authentication",
  "host.allowNoNlaHint":
    "Some older or misconfigured servers refuse network level authentication. Without it your password is sent to a computer whose identity has not been checked yet.",
  "host.allowLegacyTls": "Allow legacy TLS (1.0 and 1.1)",
  "host.allowLegacyTlsHint":
    "For Windows 7 and Server 2008 R2 era computers that were never updated. Those machines offer only TLS 1.0 or 1.1, which this app normally refuses. Leave this off unless a connection has already failed for that reason.",
  "host.legacyTlsWarning":
    "TLS 1.0 and 1.1 are old and weak. Someone who can sit between you and this computer has a better chance of reading or changing the traffic than they would over TLS 1.2. What still protects you is the certificate this app pinned the first time you connected, which is checked on every connection whichever version is used, and network level authentication, which proves the computer is the one you signed in to before your password is sent. Turn this on for one computer at a time, not as a habit.",

  // The host dialog: the private key
  "host.privateKey": "Private key",
  "host.keyProtectedHint":
    "This key is protected by a passphrase. Put the passphrase in the box below and it is kept in your system keychain.",
  "host.keyOnDiskHint": "An OpenSSH or PuTTY (.ppk) private key on this computer.",
  "host.keysFoundHint": "Keys found in your .ssh folder, or browse for one somewhere else.",
  "host.chooseKey": "Choose a key...",
  "host.anotherFile": "Another file...",
  "host.browse": "Browse...",
  "host.privateKeyPathAria": "Private key path",

  // The host dialog: the SSH tunnel
  "host.tunnelOverSsh": "Tunnel over SSH",
  "host.tunnelHint":
    "Runs the connection through an SSH login, so it works for servers that only listen on the remote computer's own loopback, and is encrypted end to end",
  "host.sshHost": "SSH host",
  "host.sshHostHint": "Leave blank to SSH to the address above",
  "host.sameAsAddress": "Same as the address above",
  "host.sshPort": "SSH port",
  "host.user": "User",
  "host.userHint": "Leave blank to use your local username",
  "host.authentication": "Authentication",
  "host.authHint": "Secrets stay in your keychain / agent",
  "host.authStored": "Saved passphrase (or agent)",
  "host.authKeyFile": "Private key file",
  "host.sshPassword": "SSH password",
  "host.tunnelSecretHint":
    "Stored in your system keychain, shared with the Files panel. Leave blank to keep what is already saved.",

  // The host dialog: resolution
  "host.resolution": "Resolution",
  "host.resolutionFollowHint":
    "The remote desktop resizes as you resize this window. Windows rearranges its icons each time.",
  "host.resolutionAtConnectHint":
    "The remote desktop is sized to this window when you connect, then left alone.",
  "host.resolutionFixedHint":
    "The remote desktop is always this size. This window scales it to fit.",
  "host.resolutionAtConnect": "Match this window when connecting",
  "host.resolutionFollow": "Match this window, and keep matching",
  "host.resolutionCustom": "Custom...",
  "host.widthPixels": "Width in pixels",
  "host.heightPixels": "Height in pixels",

  // The host dialog: errors
  "host.required": "Required",
  "host.max64": "64 characters or fewer",
  "host.sessionNameChars": "Only letters, numbers, underscore and hyphen",
  "host.distroNameChars": "Only letters, numbers, dot, underscore and hyphen",
  "host.macFormat": "A MAC address is twelve hex digits, like aa:bb:cc:dd:ee:ff",

  // The host dialog: protocol names
  "host.protocolBoundary": "Support",
  "host.protocolRdp": "Remote Desktop",
  "host.protocolSsh": "Terminal",
  "host.protocolVnc": "Screen sharing",
  "host.protocolNameBoundary": "DeskVNC Support (remote help)",
  "host.protocolNameRdp": "Remote Desktop (RDP)",
  "host.protocolNameSsh": "Terminal (SSH)",
  "host.protocolNameVnc": "Screen sharing (VNC)",

  // Times
  "util.never": "never",
};

export type MessageKey = keyof typeof ar;

/**
 * Every key the catalogue holds.
 *
 * Exported so a test can walk the whole catalogue rather than a hand kept
 * list of it. A list that has to be updated by hand is a list that will be
 * forgotten, and a forgotten key is a key nobody checked.
 */
export const MESSAGE_KEYS = Object.keys(ar) as MessageKey[];

/**
 * The translator, as a value.
 *
 * `t` is a function of the key and its substitutions, so it can be passed
 * down to a helper that is not a component. The keys are checked at the type
 * level: a helper that asks for a key the catalogue does not have will not
 * compile.
 */
export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | boolean>,
) => string;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ar, en };

export interface I18n {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Record<string, string | number | boolean>) => string;
  setLang: (lang: Lang) => void;
}


const Context = createContext<I18n | null>(null);

/**
 * The translator for one language, as a plain function.
 *
 * It lives here rather than inside the provider so that a helper which is not
 * a component can be given one, and so that a test can ask for the English
 * sentence without mounting a provider and a React tree. One implementation,
 * so the interpolation cannot drift between the app and its tests.
 */
export function translatorFor(lang: Lang): Translate {
  const table = dictionaries[lang];
  return (key, vars) => {
    let text = table[key] ?? key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return text;
  };
}

/**
 * The language the person chose, or `null` when they have not chosen one.
 *
 * `null` and the default are different answers, and the two callers want
 * different ones. The app starts in Arabic when nothing has been chosen; a
 * component rendered with no provider at all has no app language to go on, so
 * it is answered in the language the source strings are written in.
 */
function rememberedLanguage(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // Blocked storage: nothing is remembered.
  }
  return null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => rememberedLanguage() ?? "ar");

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const value = useMemo<I18n>(() => {
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      t: translatorFor(lang),
      setLang: (next) => {
        setLangState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // The choice lasts until the app quits.
        }
      },
    };
  }, [lang]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(Context);
  if (context === null) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

/**
 * Shortcut for components that only format text.
 *
 * It does not throw when there is no provider. `useI18n` does, because a
 * component that wants to CHANGE the language has nowhere to put the change
 * without one, and failing loudly is right. A component that only wants to
 * format a string has a perfectly good answer without one.
 *
 * That matters because a component rendered on its own, in a test or in a
 * preview, would otherwise crash on a missing provider rather than on
 * anything to do with the component.
 *
 * The answer without a provider is the language the person chose, if they
 * chose one, and English otherwise. The app's own default is Arabic, and that
 * is the provider's business, not this function's: with no provider there is
 * no app to have a default, and the English table is the one the source
 * strings are written in, so it is the one a component on its own is answered
 * from.
 */
export function useT(): I18n["t"] {
  const context = useContext(Context);
  const fallback = useMemo(() => translatorFor(rememberedLanguage() ?? "ar"), []);
  return context?.t ?? fallback;
}
