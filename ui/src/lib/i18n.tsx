import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { safeInvoke } from "./tauri";

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
  "registry.title": "رمز المساعدة",
  "registry.description":
    "أرسل هذا الرمز إلى من يساعدك. تنتهي صلاحيته خلال دقائق، ولا تمرّ الشاشة أو لوحة المفاتيح عبر السجل.",
  "registry.url": "عنوان السجل",
  "registry.create": "أنشئ رمز المساعدة",
  "registry.createAnother": "أنشئ رمزًا آخر",
  "registry.copy": "نسخ الرمز",
  "registry.withdraw": "سحب الرمز",
  "registry.ready": "الرمز جاهز، صالح حتى {time}.",
  "registry.withdrawn": "تم سحب الرمز. لا يمكن لأحد استخدامه الآن.",
  "registry.failed": "تعذّر إنشاء الرمز: {reason}",
  "registry.withdrawFailed": "تعذّر سحب الرمز: {reason}",
  "registry.healthy": "السجل يعمل.",
  "registry.degraded": "السجل لا يعمل كما ينبغي (قاعدة البيانات: {db}، مفتاح الإغلاق: {key}).",
  "registry.autoCreating": "جارٍ إنشاء رمز المساعدة…",
  "registry.copyMessage": "نسخ رسالة المشاركة",
  "registry.shareMessage": "أحتاج مساعدة على جهازي عبر OraxDesk.\nافتح OraxDesk ثم «ساعد شخصًا» وأدخل الرمز: {code}",
  "registry.readOut": "أرسل هذا الرمز إلى من يساعدك. لا تشاركه مع أي شخص آخر.",
  "registry.advanced": "إعدادات السجل المتقدمة",
  "registry.link": "نسخ رابط المساعدة",
  "device.number": "رقم هذا الجهاز — اقرأه لمن يساعدك",
  "device.copyNumber": "نسخ الرقم",
  "device.copied": "نُسخ الرقم",
  "device.numberHint": "تسعة أرقام ثابتة لهذا الجهاز. اقرأها على الهاتف لمن يساعدك، أو انسخها.",
  "device.registering": "جارٍ تسجيل رقم هذا الجهاز…",
  "device.registered": "الرقم مسجل وجاهز للبحث.",
  "device.registerFailed": "تعذّر تسجيل رقم هذا الجهاز.",
  "device.registerNotReady": "الرقم غير مفعّل بعد — لن يتمكن الطرف الآخر من العثور على هذا الجهاز.",
  "device.registerReason": "التفاصيل: {reason}",
  "device.registerClock": "ساعة هذا الجهاز غير مضبوطة. اضبط الوقت تلقائيًا ثم أعد المحاولة.",
  "device.registerNetwork": "تعذّر الوصول إلى خدمة Orax. تحقّق من الإنترنت ثم أعد المحاولة.",
  "device.registerRetry": "أعد المحاولة",
  "device.fixTime": "اضبط الوقت",
  "device.retrying": "ستتم إعادة المحاولة تلقائيًا…",
  "device.autoRegister": "تسجيل هذا الجهاز تلقائيًا في سجل OraxDesk",
  "device.autoRegisterHint": "يمنع التسجيل مستقبلًا. لا يحذف الرقم المسجل بالفعل.",
  "device.autoRegisterOff": "التسجيل التلقائي متوقف.",
  "device.id": "معرّف هذا الجهاز، للوصول دون الحضور",
  "device.copyId": "نسخ المعرّف",

  // شاشة البدء


  "onboarding.welcome": "مرحبًا بك في OraxDesk",
  "onboarding.tagline":
    "شاهد أجهزتك الأخرى وتحكّم فيها: سريع، وآمن، وملكك وحدك. بلا حساب، أبدًا.",
  "onboarding.appearance": "المظهر",
  "onboarding.themeAria": "السمة",
  "onboarding.themeSystem": "تابع النظام",
  "onboarding.findComputers": "ابحث عن أجهزتك",
  "onboarding.saveFirst": "احفظ جهازك الأول",
  "onboarding.save": "احفظ.",
  "onboarding.scanHint":
    "يستمع OraxDesk إلى الأجهزة التي تعلن مشاركة الشاشة على شبكتك المحلية. قد يطلب نظامك إذن الوصول إلى الشبكة المحلية، وهذا هو سبب الطلب.",
  "onboarding.saveHint":
    "أعطه اسمًا مألوفًا، وإذا حفظت كلمة مرور فستُخزَّن في سلسلة مفاتيح نظامك، لا في ملف.",
  "onboarding.skip": "تخطّي",
  "onboarding.back": "رجوع",
  "onboarding.continue": "متابعة",
  "onboarding.openLibrary": "افتح مكتبتي",
  "onboarding.stepAria": "الخطوة {step} من {total}",
  "session.captureUnsupported": "تمرير الاختصارات غير متاح هنا",
  "session.captureUnsupportedBody":
    "كل ما يراه محرك المتصفح يصل إلى الطرف البعيد. للاختصارات التي لا يستطيع تمريرها، استخدم «أرسل إلى البعيد» من قائمة لوحة المفاتيح؛ يمكن إرسال Ctrl+Alt+Del وCmd/Alt+Tab ومفتاح Windows بهذه الطريقة.",
  "session.captureGotIt": "فهمت",
  "session.captureOpenSettings": "افتح إعدادات النظام",
  "session.captureTurnOn": "شغّل تمرير الاختصارات",
  "session.captureAllow": "اسمح.",
  "session.captureAlreadyAllowed":
    "مُنح الإذن ولا يزال لا يعمل؟ تحديث macOS أو بناء جديد قد يبطل الإذن بصمت؛ أزل التطبيق من قائمة «إمكانية الوصول» ثم أضفه من جديد.",
  "session.shortcutsDialogTitle": "دع هذا التطبيق يلتقط اختصارات النظام",
  "session.shortcutsIntro":
    "لإرسال {keys} إلى الجهاز البعيد بدل هذا الجهاز، على {system} أن تسمح لهذا التطبيق برؤية المفاتيح قبل {server}.",
  "session.shortcutsRelease":
    "يمكنك تحرير لوحة المفاتيح في أي وقت بـ {chord}، وتتحرر تلقائيًا عند فقدان النافذة للتركيز أو إغلاقها.",
  "session.shortcutsNotNow": "ليس الآن",
  "ssh.closed": "أُغلق الاتصال.",
  "session.accessibilityNote":
    "يسمّيها macOS ‏Accessibility. تُستعمل فقط أثناء وجود جلسة، حتى لا تلتقط مفاتيح الجهاز وأنت تكتب فيه.",
  "ssh.connecting": "جارٍ الاتصال.",
  "ssh.connected": "متصل",
  "ssh.reconnecting": "جارٍ إعادة الاتصال (المحاولة {attempt})",
  "ssh.disconnected": "منقطع",
  "ssh.connectingTo": "جارٍ الاتصال بـ {endpoint}",
  "ssh.failed": "فشل الاتصال",
  "ssh.verifyingHostKey": "التحقق من مفتاح المضيف",
  "ssh.hostKeyChanged": "تغيّر مفتاح المضيف",
  "onboarding.scanning": "جارٍ البحث في شبكتك…",
  "onboarding.scanNothing":
    "لم يُعثر على أي جهاز بعد؛ بعض الأجهزة لا تعلن عن نفسها. يمكنك إضافة جهاز يدويًا لاحقًا.",
  "onboarding.scanFailed":
    "تعذّر بدء البحث عن الأجهزة على الشبكة. تحقّق من إعدادات الشبكة ثم أعد المحاولة.",
  "onboarding.scanRetry": "أعد المحاولة",

  // شريط الاتصال السريع
  "quick.placeholder": "اتصل بعنوان، مثل 192.168.1.20:1 أو rdp://frontdesk  ({key}T)",
  "quick.label": "العنوان الذي تريد الاتصال به",
  "quick.modeSearch": "بحث",
  "quick.modeConnect": "اتصال",
  "quick.switchToSearch": "بدّل إلى البحث",
  "quick.switchToConnect": "بدّل إلى الاتصال",
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
  "quick.port": "المنفذ {port}",
  "quick.suggestions": "اقتراحات الاتصال",
  "quick.groupTyped": "هذا العنوان",
  "quick.groupHosts": "أجهزتك",
  "quick.groupNearby": "على هذه الشبكة",
  "quick.groupRecent": "الأخيرة",

  // نوافذ الدعم عن بُعد
  "support.helpSomeone": "ساعد شخصًا",
  "support.helpSomeoneNow": "يساعدني الآن",
  "support.reachComputer": "أصل إلى جهاز",
  "support.yourName": "اسمك، يظهر أمام الشخص",
  "support.theirCode": "رمز المساعدة",
  "support.theirCodePlaceholder": "1234 5678 9012 أو رابط المساعدة",
  "support.codeHint": "الصق الرمز الذي أرسله لك الشخص. ويمكنك لصق رابط المساعدة بدلًا منه.",
  "support.codeInvalid": "هذا الرمز غير صحيح أو انتهت صلاحيته. اطلب من الشخص رمزًا جديدًا.",
  "support.hostClock": "ساعة الجهاز الآخر غير مضبوطة. اطلب منه ضبط الوقت ثم إنشاء رمز جديد.",
  "support.defaultHelperName": "مساعد",
  "support.advanced": "إعدادات متقدمة",
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
  "support.helpSomeoneTitle": "اتصل بمن طلب منك المساعدة",
  "support.helpOverInternet": "ساعد شخصًا عبر الإنترنت، دون أن تُعدّ شيئًا في أي من الشبكتين.",
  "support.stepInstallLead": "في OraxDesk يضغطون",
  "support.stepInstallTail":
    ". ومن دون OraxDesk ينزّلون OraxDesk Support من صفحة إصدارات OraxDesk ويفتحونه. ولا يُثبَّت شيء.",
  "support.stepCodeLead": "يضغطون",
  "support.stepCodeMid": "أو",
  "support.stepCodeTail": "ثم يرسلون لك ما يظهر.",
  "support.stepUse": "تنسخه وتفتح هذه النافذة. ويُلصق لك تلقائيًا. فيوافقون عليك على شاشتهم.",
  "support.duringSession":
    "أثناء الجلسة يمكنهم أن يسمحوا لك بالاتصال في أي وقت. عندئذٍ يُحفظ الجهاز في مكتبتك ويفتح دون حضورك.",
  "support.machineIntro":
    "لجهاز فُعّل فيه الوصول دون حضورك في OraxDesk أو OraxDesk Support. أما الجهاز الذي قبلّاك من قبل فهو في مكتبتك أصلًا. وإلا فيوافقك الشخص الموجود هناك على شاشته، ويمكنه أن يقبلك لتتصل في المرة القادمة دون سؤال.",
  "support.computerIdPlaceholder": "الرقم التسعيني، أو المعرّف المكوّن من 64 حرفًا",
  "support.registryNumberHint":
    "يُبحث عن الرقم التسعيني في هذا السجل أولًا، فالطرفين يحتاجان السجل نفسه. واتركه فارغًا لاستعمال المعرّف الكامل بدلًا منه.",
  "support.libraryNamePlaceholder": "حاسوب أمي",
  "support.numberNotRegistered":
    "لا يوجد في هذا السجل جهاز بهذا الرقم. على الجهاز الآخر فتح OraxDesk وتحديثه وتسجيل رقمه، أو إعطاؤك معرّفه الكامل.",
  "support.saveMachineFailed": "تعذّر حفظ الجهاز في المكتبة",

  // طبقة الدعم: الموافقة واللافتات
  "support.approveTitle": "توافق على هذا المساعد؟",
  "support.wantsToSee": "{name} يريد رؤية شاشتك.",
  "support.approveSafety": "لن يرى شيئًا حتى تختار. يمكنك إيقاف التحكم أو إنهاء الجلسة في أي وقت.",
  "support.connectionIdentity": "هوية اتصال المساعد",
  "support.showIdentity": "اعرض هوية الاتصال",
  "support.noteInvited":
    "الاسم يقدّمه المساعد. أكّده مع الشخص الذي دعوته.",
  "support.noteUnpaired":
    "يتصلون بمعرّف هذا الجهاز دون أن يكونوا مقبولين فيه. والاسم يقدّمه المساعد، فلا تسمح إلا لمن تنتظره.",
  "support.toolsExplain":
    "أدواتهم تعمل باسمك، خارج ما تراه على الشاشة. اترك هذا مغلقًا إلا إن طلبتَه. ويمكنك إطفاؤه في أي وقت، وكل أمر يظهر هنا أثناء تشغيله.",
  "support.pairAnyTime": "دعه يتصل في أي وقت دون أن يسألني من جديد",
  "support.allowControl": "السماح بالمشاهدة والتحكم",
  "support.allowView": "السماح بالمشاهدة",
  "support.decline": "رفض",
  "support.controlNeedsAccessibility":
    "يلزم إذن إمكانية الوصول للتحكم. ويمكنك السماح بالمشاهدة الآن.",
  "support.yourHelper": "مساعدك",
  "support.canSeeScreen": "{name} يرى شاشتك.",
  "support.canSeeAndControl": "{name} يرى شاشتك ويستخدم فأرتك ولوحة مفاتيحك.",
  "support.stopControl": "أوقف التحكم",
  "support.stopCommands": "أوقف أوامرهم",
  "support.toolsCanAct": "يمكن لأدواتهم تشغيل الأوامر ونسخ الملفات على هذا الجهاز.",
  "support.isConnectedControl": "{name} متصل بهذا الجهاز ويستخدم الفأرة ولوحة المفاتيح",
  "support.isConnectedWatching": "{name} متصل بهذا الجهاز، يراقب",
  "support.endTheirSession": "أنهِ جلستهم",

  // صندوق طلبات الدعم: الأرقام التي يرسلها العملاء
  "inbox.button": "صندوق الطلبات",
  "inbox.buttonTitle": "أرقام الأجهزة التي أرسلها إليك العملاء",
  "inbox.title": "صندوق الطلبات",
  "inbox.intro":
    "أرقام الأجهزة التي أرسلها إليك العملاء، ومع كل رقم ملاحظتك أنت. الملاحظات تبقى على هذا الجهاز ولا تصل إلى السجل، ولا يُسأل السجل إلا حين تضغط «تحقّق من السجل» أو «اتصال».",
  "inbox.number": "رقم الجهاز",
  "inbox.numberPlaceholder": "250739098",
  "inbox.numberHint": "تسعة أرقام، كما يقرؤها العميل.",
  "inbox.note": "ملاحظتك (لا يراها أحد سواك)",
  "inbox.notePlaceholder": "اسم العميل، أو ما طلب",
  "inbox.add": "أضف الرقم",
  "inbox.invalidNumber": "رقم الجهاز تسعة أرقام.",
  "inbox.alreadyThere": "هذا الرقم في القائمة بالفعل، وملاحظته لم تتغير.",
  "inbox.empty": "لا أرقام بعد. أضف أول رقم أرسله إليك أحد.",
  "inbox.remove": "إزالة",
  "inbox.removeTitle": "أزل هذا الرقم من القائمة",
  "inbox.refresh": "تحقّق من السجل",
  "inbox.refreshing": "جارٍ التحقق…",
  "inbox.checkedAt": "آخر تحقّق: {when}",
  "inbox.neverChecked": "لم يُفحص بعد",
  "inbox.connect": "اتصال",
  "inbox.connecting": "جارٍ الاتصال…",
  "inbox.connectFailed": "تعذّر الاتصال: {reason}",
  "inbox.saveFailed": "تعذّر حفظ الجهاز في المكتبة",
  "inbox.numberNotRegistered": "لا يوجد في السجل جهاز بهذا الرقم.",
  "inbox.addFailed": "تعذّرت إضافة الرقم: {reason}",
  "inbox.removeFailed": "تعذّرت الإزالة: {reason}",
  "inbox.refreshFailed": "تعذّر سؤال السجل: {reason}",
  "inbox.noRegistry":
    "لم يُضبط عنوان السجل بعد. اضبطه من «ساعد شخصًا» ← «أصل إلى جهاز» أولًا.",
  "inbox.state.unknown": "لم يُسأل بعد",
  "inbox.state.reachable": "قابل للوصول",
  "inbox.state.noAddress": "بلا عنوان",
  "inbox.state.revoked": "مُسحب",
  "inbox.state.error": "تعذّر السؤال",
  "inbox.detail.unknown": "لم يُبحث عن هذا الرقم في السجل بعد.",
  "inbox.detail.reachable": "نشر عنوانًا، فيستطيع المساعد الاتصال به.",
  "inbox.detail.noAddress":
    "مسجَّل في السجل لكنه لم ينشر عنوانًا. شغّل «الوصول دون حضورك» هناك.",
  "inbox.detail.revoked": "سحب المشغّل هذا الجهاز، فلا يُستدعى.",
  "inbox.detail.error": "تعذّر سؤال السجل عن هذا الرقم.",

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
  "gethelp.statusReady": "جاهز للمساعدة",
  "gethelp.statusWaiting": "بانتظار المساعد…",
  "gethelp.statusConnected": "المساعد متصل",
  "gethelp.statusError": "تعذّر تجهيز المشاركة",
  "gethelp.statusDetails": "تفاصيل الاتصال",
  "gethelp.getCode": "احصل على رمز",
  "gethelp.createInvitation": "أنشئ دعوة",
  "gethelp.copyCode": "نسخ الرمز",
  "gethelp.copyMessage": "نسخ رسالة المشاركة",
  "gethelp.copyInvitation": "نسخ الدعوة كاملة",
  "gethelp.fallbackInvitation": "أو استخدم الدعوة الكاملة",
  "gethelp.readOut": "اقرأه له أو أرسله. يدخله مساعدك، وأنت توافق عليه هنا.",
  "gethelp.endSession": "إنهاء الجلسة",
  "gethelp.unattended": "الوصول دون حضورك",
  "gethelp.paired": "المساعدون المقبولون",
  "gethelp.passwordsDiffer": "كلمتا المرور غير متطابقتين.",

  // المشاركة والإذونات في «احصل على مساعدة»
  "gethelp.copied": "تم النسخ",
  "gethelp.screenPermission": "يلزم إذن تسجيل الشاشة للمشاركة.",
  "gethelp.allowScreenRecording": "اسمح بتسجيل الشاشة",
  "gethelp.screenPermissionHint": "بعد منح الإذن، أغلق OraxDesk وافتحه من جديد إن فشلت المشاركة.",
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
    "دع من تثق بهم يتصلون بهذا الجهاز حين لا يكون أحد هنا للموافقة. مُعطَّل حتى تفعّله. ويجب أن يكون OraxDesk يعمل ليعمل.",
  "gethelp.allowUnattended": "اسمح بالوصول دون حضورك إلى هذا الجهاز",
  "gethelp.idReachable": "معرّف هذا الجهاز، يمكن الوصول إليه الآن",
  "gethelp.helperEntersId":
    "يدخله المساعد معرّفًا للجهاز، مع كلمة المرور إن لم يكن مقبولًا هنا من قبل.",
  "gethelp.autostart": "شغّل OraxDesk عند تسجيل دخولي، ليجهز فورًا",
  "gethelp.noPairedYet": "لا أحد بعد. أثناء جلسة دعم، اختر «دعه يتصل في أي وقت» لقبول المساعد.",
  "gethelp.mayControl": "يستطيع التحكم",
  "gethelp.toolsNote":
    "لمساعد تعمل أدواته، مثل وكلاء OraxDesk، على هذا الجهاز أثناء غيابك. والأوامر تعمل باسمك.",
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
  "brand.tagline": "اتصال وتحكم على الأجهزة عن بعد",
  "about.title": "عن OraxDesk",
  "about.sectionsLabel": "أقسام «عن»",
  "about.tabAbout": "عن",
  "about.tabHelp": "مساعدة",
  "about.tagline": "عارض سطح مكتب بعيد سريع وطبيعي الأصل لـ macOS وWindows وLinux.",
  "about.version": "الإصدار {version}",
  "about.buildLabel": "تفاصيل البناء",
  "about.build": "البناء",
  "about.copied": "تم النسخ",
  "about.copyReport": "انسخ التقرير لتذكرة عطل",
  "about.openFailed": "تعذّر فتح الرابط في المتصفح.",
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

  // شريط الجلسة
  "session.controls": "أدوات التحكم في الجلسة",
  "session.showToolbar": "أظهر شريط الجلسة ({chord})، واسحبه لتحريكه",
  "session.dragToolbar": "اسحب الشريط لتحريكه",
  "session.fullscreen": "ملء الشاشة ({hint})",
  "session.sendCtrlAltDel": "أرسل {combo} إلى الجهاز البعيد",
  "session.connectionStatus": "حالة الاتصال",
  "session.displays": "الشاشات",
  "session.pointers": "المؤشرات",
  "session.sendClipboard": "أرسل الحافظة إلى الجهاز البعيد",
  "session.fileTransfer": "نقل الملفات (SFTP)",
  "session.checkingSsh": "جارٍ التحقق من توفّر SSH على هذا الجهاز…",
  "session.filesNeedSsh": "نقل الملفات يحتاج SSH على الجهاز البعيد، وهو غير متاح على هذا الجهاز",
  "session.terminal": "الطرفية (SSH)",
  "session.terminalNeedSsh": "الطرفية تحتاج SSH على الجهاز البعيد، وهو غير متاح على هذا الجهاز",
  "session.viewOnlyOn": "للقراءة فقط: مفعّلة، انقر للسماح بالإدخال",
  "session.viewOnlyOff": "للقراءة فقط: معطّلة، انقر لمنع الإدخال",
  "session.saveScreenshot": "احفظ لقطة الشاشة",
  "session.requestRefresh": "اطلب تحديث الشاشة كاملة",
  "session.unpin": "ألغِ تثبيت الشريط (يسمح باختفائه)",
  "session.pin": "ثبّت الشريط (يبقى ظاهرًا)",
  "session.collapseToolbar": "أخفِ الشريط ({chord})",
  "session.disconnect": "افصل (يبقى الجهاز البعيد يعمل)",
  "session.customZoom": "تكبير مخصّص",
  "session.zoomPercent": "نسبة التكبير",
  "session.zoom": "تكبير",
  "session.remoteResize": "تغيير الحجم من البعيد (مطابقًا للنافذة)",
  "session.rdpFixedSize": "و«العرض» ثم «الدقة» يضبطان سطح المكتب البعيد على حجم ثابت أيضًا.",
  "session.lockZoom": "ثبّت التكبير (تجاهل حركة القرص)",
  "session.panByEdges": "حرّك بالاقتراب من الحواف",
  "session.remotePointer": "مؤشر البعيد",
  "session.showRemotePointer": "أظهر مؤشر البعيد",
  "session.myPointer": "مؤشّري",
  "session.cursorStandard": "سهم عادي",
  "session.cursorDot": "نقطة",
  "session.cursorHidden": "مخفيّ",
  "session.allDisplays": "كل الشاشات",
  "session.splitThisDesktop": "قسّم هذا سطح المكتب",
  "session.singleDisplay":
    "هذه الجلسة تستخدم شاشة واحدة. فعّل «استخدام كل شاشاتي» في إعدادات هذا الجهاز لتستخدم المزيد.",
  "session.detectDisplays": "اكتشف الشاشات من جديد",
  "session.displaysUnknown":
    "لا يخبر هذا الخادم أين تلتقي شاشاته: الكشف يقرأ الصورة، أما التقسيمات الأخرى فتخمين بالعرض.",
  "session.displaysUndescribed": "لم يصف هذا الخادم شاشاته، فسطح المكتب كله شاشة واحدة.",
  "session.displayRow": "الشاشة {n} ({w}×{h})",
  "session.pictureVsResponse": "الصورة مقابل الاستجابة",
  "session.qualityAuto": "تلقائي — حادّ في الخمول، أسرع تحت الضغط",
  "session.qualitySharp": "حادّ — أفضل صورة، ولا يتكيّف أبدًا",
  "session.qualityResponsive": "سريعة الاستجابة — أنعم صورة، وأقل تأخير",
  "session.alwaysFresh": "اطلب إطارات جديدة دائمًا",
  "session.alwaysFreshHint":
    "يعيد جلب الشاشة كاملة كل ثانية بدل الوثوق بالخادم في الإخبار بما تغيّر. يصلح صورة تبقى قديمة أو مشوّهة، ويستهلك عرض نطاق أكبر.",
  "session.grayLevels": "مستويات الرمادي",
  "session.oneBit": "بت واحد (مُرَشَّح)",
  "session.levels": "{n} مستويات",
  "session.passShortcuts": "مرّر اختصارات النظام إلى الجهاز البعيد",
  "session.sendToRemote": "أرسل إلى الجهاز البعيد",
  "session.keyWindows": "مفتاح Windows/Super",
  "session.captureBadge": "اختصارات النظام تذهب إلى الجهاز البعيد. اضغط {chord} لتحريرها.",
  "session.captured": "مُلتقط",
  "session.keyboard": "لوحة المفاتيح",
  "session.keyboardCaptured":
    "لوحة المفاتيح ملتقطة، واختصارات النظام تذهب إلى البعيد (للتحرير: {chord})",
  "session.keyboardNeedsPermission": "لوحة المفاتيح: التمرير يحتاج إذنًا",
  "session.keyboardUnavailable": "لوحة المفاتيح: التمرير غير متاح، {reason}",
  "session.keyboardWaitingFocus": "لوحة المفاتيح: التمرير في انتظار التركيز",
  "session.capturedNote": "مُلتقط. اضغط {chord} لتحريره.",
  "session.needsAccessibility": "يلزم إذن إمكانية الوصول لاعتراض اختصارات النظام.",
  "session.howToEnable": "كيف تفعّله",
  "session.activeWhileFocused": "يعمل فقط ما دامت هذه النافذة نشطة.",
  "session.sendsShortcutsMac":
    "يرسل Cmd+Tab وCmd+Space واختصارات النظام الأخرى إلى الجهاز البعيد بدل هذا الجهاز.",
  "session.sendsShortcuts":
    "يرسل Alt+Tab ومفتاح ويندوز واختصارات النظام الأخرى إلى الجهاز البعيد بدل هذا الجهاز.",
  "session.latency": "زمن الاستجابة",
  "session.throughput": "الإنتاجية",
  "session.frameRate": "معدّل الإطارات",
  "session.decode": "فك الترميز",
  "session.encoding": "الترميز",
  "session.received": "المستلَم",
  "session.shed": "مُهمَل",
  "session.shedCounts": "{rects} مستطيل، {updates} تحديث",
  "session.statsLater": "تصل الإحصاءات حين ترد بها الجلسة.",

  // طبقة حالة الجلسة
  "overlay.stageResolving": "يحلّ العنوان",
  "overlay.stageConnecting": "يتصل",
  "overlay.stageAuthenticating": "مصادقة",
  "overlay.stageNegotiating": "تفاوض",
  "overlay.stagePreparing": "يستعدّ",
  "overlay.stillTrying":
    "ما زال يحاول. إن كان ذلك الجهاز مطفأً أو نائمًا أو على شبكة أخرى، فسيواصل الفشل. تأكّد أنه مستيقظ، ثم أعد الاتصال.",
  "overlay.reconnectingTo": "جارٍ إعادة الاتصال بـ {name}… المحاولة {attempt}",
  "overlay.retryingIn": " · إعادة المحاولة بعد {secs} ثانية",
  "overlay.retryingNow": " · يعيد المحاولة الآن",
  "overlay.disconnect": "افصل",
  "overlay.retryNow": "أعد المحاولة الآن",
  "overlay.disconnectedFrom": "انقطع الاتصال بـ {name}",
  "overlay.reconnectAsksPassword": "إعادة الاتصال تطلب كلمة المرور من جديد، بدلًا من استعمال المحفوظة.",
  "overlay.openSecurity": "افتح إعدادات أمان هذا الجهاز",
  "overlay.saveFirst": "احفظ هذا الجهاز في مكتبتك أولًا، ثم غيّر هذا الإعداد من إعداداته.",
  "overlay.reconnect": "أعد الاتصال",
  "overlay.pressEsc": "اضغط Esc لإغلاق هذه النافذة",

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

  // نافذة ربط الوكلاء
  "agent.title": "وكلاء الذكاء الاصطناعي",
  "agent.copy": "نسخ",
  "agent.copied": "تم النسخ",
  "agent.blocked": "ممنوع",
  "agent.copyLine": "نسخ هذا السطر",
  "agent.connectClaude": "اربط Claude Code",
  "agent.registerNote": "يسجّل هذا الخادم نيابةً عنك. بلا طرفية، وبلا شيء تنسخه.",
  "agent.connecting": "جارٍ الربط…",
  "agent.tryAgain": "أعد المحاولة",
  "agent.connect": "اربط",
  "agent.setupTitle": "OpenCode وPi وClaude Code وCodex",
  "agent.setupNote":
    "يتصل تلقائيًا في كل مرة يبدأ فيها OraxDesk. هل ثبّتت وكيلًا جديدًا الآن؟ اربطه من غير إعادة تشغيل.",
  "agent.connectNow": "اربط الآن",
  "agent.setupFailed": "لا تستطيع هذه النسخة تشغيل الإعداد. شغّل dvv setup في طرفية بدلًا من ذلك.",
  "agent.canDo": "ما يستطيع الوكيل أن يفعله",
  "agent.byHand": "افعلها بيدك، أو اربط وكيلًا آخر",
  "agent.stepRegister": "سجّله بنفسك",
  "agent.stepHttp": "أو بلوغه عبر HTTP",
  "agent.stepCheck": "تحقّق منه",
  "agent.httpNoteLead": "يشغّل مستمعًا على",
  "agent.httpNoteTail":
    " ويطبع السطر التالي وفيه رمزك. على العنوان المحلي وحده، ويحتاج الرمز حتى هناك، لأن أي صفحة مفتوحة في متصفحك تصل إلى منفذ على هذا الجهاز.",
  "agent.doctorNote":
    "يطبع مسار المقبس وهل هو موجود. الموجود يعني أن هذا التطبيق يعمل ومنصّة الوكلاء مفعّلة، وهذا ما يحتاجه الوكيل.",
  "agent.thenAsk":
    "ثم اطلب من وكيلك أن يفتح أحد أجهزتك باسمه. يقرأ المكتبة نفسها التي تراها هنا.",
  "agent.planeOn": "منصّة الوكلاء مفعّلة.",
  "agent.canOpen": "افتح أحد أجهزتك المحفوظة. بيانات الاعتماد تأتي من خزنة المفاتيح، والوكيل لا يقدّمها ولا يراها.",
  "agent.canDrive": "قُد الجهاز وشاهده وهو يعمل: المؤشّر ولوحة المفاتيح والحافظة والشاشة.",
  "agent.canRun": "نفّذ أمرًا عبر SSH واقرأ ناتجه، برمز الخروج الحقيقي الذي بلغه.",
  "agent.canHandBack": "أعد التحكم في الحال متى أردت. النقر على لوحة، أو الضغط على إيقاف، يأخذ الإيجار.",
  "agent.cannotAnswer": "أجب عن طلب كلمة مرور أو شهادة. تبقى لك.",
  "agent.boundaryWhy": "هذا قرار متعمد ولن يتغيّر. وكيل يستطيع كتابة سرّ قرأه من شاشة يترك سجلًّا يقول إنك وافقت عليه، وسجلٌ يقول الشيء الخطأ أسوأ من لا سجل.",
  "diagnose.cancelled": "أُلغي تسجيل الدخول. أعد الاتصال لتجرّب من جديد.",
  "diagnose.ntlmRefused": "نطاق هذا الجهاز لا يقبل طريقة الدخول التي يستعملها هذا الإصدار. ضبط أحد المسؤولين «تقييد حركة NTLM الواردة» أو رفع «مستوى مصادقة Lan Manager» على الجهاز البعيد، فلم يبقَ إلا Kerberos.sign-in قادم في إصدار لاحق. حتى ذلك الحين يمكن بلوغ هذا الجهاز من عميل يتكلّم Kerberos، أو يمكن لأحد المسؤولين السماح بـ NTLM له.",
  "diagnose.nlaRefused": "رفض الجهاز مصادقة مستوى الشبكة. إن كان خادمًا قديمني أو ليس من ويندوز، فعّل «السماح بالاتصال دون مصادقة مستوى الشبكة» في إعدادات هذا الجهاز.",
  "diagnose.legacyTlsRequired": "يعرض هذا الجهاز TLS 1.0 أو 1.1 فقط لتشفير الاتصال، وهذا التطبيق لا يستعمل هذين الإصدارين إلا بإذن منك. وهو أمر طبيعي لجهاز ويندوز 7 أو Server 2008 R2 لم يُحدَّث قط. لتتصل على أي حال، عدّل هذا الجهاز، وافتح «متقدم» ثم «الأمان»، وضع علامة «السماح بـ TLS القديم (1.0 و1.1)». اقرأ ما هو مكتوب هناك أولًا: تلك الإصدارات ضعيفة، ولهذا reason مُطفأة افتراضيًا.",
  "diagnose.legacyTlsUnavailable": "يعرض هذا الجهاز TLS 1.0 أو 1.1 فقط، وهذه النسخة من التطبيق بُنيت دون دعم لهما، فالإعداد الذي فعّلته لا يمكن استعماله. النسخة التي فيها دعم TLS القديم ستتصل. لا شيء تغيّره هنا سيفي، ولا خطأ في الجهاز الذي تتصل به.",
  "diagnose.unknownHostKey": "لم تُوثَّق هذه الآلة بعد، فتوقف الاتصال بدل أن تُوثَّق في صمت. أعد الاتصال لترى بصمتها وتقرّر.",
  "diagnose.hostKeyChanged": "تعرض هذه الآلة هوية SSH مختلفة عن التي وثقتها من قبل. قد يعني ذلك أنها أُعيد تثبيتها، أو أن شيئًا بينك وبينها، ولا سبيل للتمييز من هنا، فرُفض الاتصال. إن كنت تعرف أن المفتاح تغيّر على نحو مشروع، فأنسِ المفتاح المحفوظ لهذه الآلة واتصل من جديد.",
  "diagnose.securityRefused": "أجاب الجهاز، لكنه لم يستعمل طريقة أمان يتكلّمها هذا الإصدار. قد يكون خادمًا قديمني، أو واحدًا سياسته يمنع الدخول الذي يقدّمه هذا التطبيق.",
  "diagnose.refused": "رُفض الاتصال، ولا شيء يستمع على ذلك المنفذ.",
  "diagnose.timedOut": "لم يستجب الجهاز، فقد يكون نائمًا أو مطفأً أو بعيدًا عن هذه الشبكة.",
  "diagnose.badPassword": "كلمة المرور غير صحيحة، لم يقبلها الخادم.",
  "diagnose.tlsUnverified": "تعذّر التحقق من الاتصال الآمن.",
  "diagnose.reset": "أغلق الطرف الآخر الاتصال.",
  "diagnose.ended": "انتهى الاتصال.",
  "diagnose.endedWith": "{reason}",
  "agent.binaryMissing": "هذه النسخة لا تخبر أين يوجد dvv. المسار يأتي من داخل حزمة التطبيق، وبناء التطوير لا حزمة له. شغّل dvv doctor على نسخة لها، فيطبع هذه الأسطر بالمسار الحقيقي فيها.",
  "agent.turnOff": "أطفئها",
  "agent.turnOffTitle": "يغلق المقبس ويفصله، فيفقد كل وكيل اتصاله في الحال.",
  "agent.offIntro":
    "يستطيع الوكيل فتح أجهزتك وقيادتها وقراءة الشاشة، وأنت تشاهد وتستعيد التحكم متى شئت.",
  "agent.offWhy":
    "إنها مطفأة لأنها أُطفئت على هذا الجهاز. وما دامت مطفأة فلا مقبس ولا شيء يستمع، ولا يستطيع وكلاؤك بلوغ أجهزتك.",
  "agent.startFailed": "أخفقت آخر محاولة لبدءها: {reason}",
  "agent.turnBackOn": "أعد تشغيلها",
  "agent.oneSocket": "مقبس واحد، على هذا الجهاز وحده. لا شيء يُفتح على الشبكة.",

  // نافذة الشهادة
  "cert.changedTitle": "تغيّرت هوية الخادم",
  "cert.changedBody":
    "يقدّم شهادة مختلفة عن التي وثقتها من قبل. قد يعني هذا أن الخادم أُعيد تثبيته، أو أن أحدًا يعترض على اتصالك.",
  "cert.changedWarning": "لا تواصل إلا إن كنت تعرف سبب هذا التغيّر.",
  "cert.changedRdp":
    "إعادة تثبيت ويندوز، أو شهادة جهاز جديدة بعد تغيير النطاق، يبدو كلٌّ منها هكذا تمامًا. وكذلك المهاجم. لا تواصل إلا إن كنت تعرف أيّهما هي.",
  "cert.typeToProceed": "للمتابعة رغم ذلك، اكتب",
  "cert.trustNewIdentity": "وثق الهوية الجديدة",
  "cert.cancelRecommended": "إلغاء (مُستحسن)",
  "cert.verifyTitle": "تحقّق من {host}",
  "cert.firstTimeRdp":
    "سطح المكتب البعيد على ويندوز يعرف نفسه عادةً بشهادة يولّدها لنفسه، فلا على جهاز جديد ما تقارنها به. وتذكّرها الآن يعني أن تُخبَر إن تغيّرت يومًا.",
  "cert.firstTime":
    "هذه أول مرة يعرف فيها هذا الجهاز نفسه بالمفتاح أدناه. تحقّق من أن البصمة تطابق المعروضة على الخادم، ثم اختر مقدار الثقة به.",
  "cert.connectOnce": "اتصل مرة واحدة",
  "cert.trustComputer": "وثّق هذا الجهاز",
  "cert.fingerprintWords": "كلمات البصمة:",
  "cert.fingerprintAria": "بصمة شهادة SHA-256",

  // نافذة بيانات الاعتماد
  "cred.title": "يلزم تسجيل الدخول",
  "cred.needsWindowsSignIn": "يحتاج تسجيل دخول ويندوز قبل أن يسمح لك الدخول.",
  "cred.needsUserAndPassword": "يحتاج اسم مستخدم وكلمة مرور قبل أن يسمح لك الدخول.",
  "cred.needsPassword": "يحتاج كلمة مرور قبل أن يسمح لك الدخول.",
  "cred.wrongPassword": "كلمة المرور غير صحيحة. حاول من جديد.",
  "cred.attempt": "المحاولة {attempt}",
  "cred.vncTruncation":
    "يستخدم هذا الخادم مصادقة VNC قديمة، ولا يُؤخذ من كلمة المرور سوى أول {count} حرفًا.",
  "cred.remember": "تذكّره لهذا الجهاز",
  "cred.rememberSavedOnly": "يُحفظ فقط إن نجحت كلمة المرور هذه.",

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
    "اكتب المعرّف المكوّن من 64 حرفًا الموجود تحت «الوصول دون حضورك» في OraxDesk Support",

  // المكتبة
  "library.wakeNeedsMac": "لا يوجد عنوان MAC محفوظ لهذا الجهاز، فلا يمكن إيقاظه.",
  "library.rowSelected": "محدَّد",

  // المكتبة: شريط الأدوات أعلى الشاشة
  "library.searchPlaceholder": "ابحث أو اضغط {chord}K",
  "library.searchAria": "ابحث في المضيفين",
  "library.sort": "ترتيب",
  "library.sortAria": "ترتيب المضيفين",
  "library.sortLastConnected": "آخر اتصال",
  "library.sortMostUsed": "الأكثر استعمالًا",
  "library.viewMode": "طريقة العرض",
  "library.gridView": "عرض شبكي",
  "library.listView": "عرض قائمة",
  "library.sessionsWhere": "أين تُفتح الجلسات",
  "library.sessionsInWindows": "افتح الجلسات في نوافذ منفصلة",
  "library.sessionOwnWindow": "افتح كل جلسة في نافذة منفصلة",
  "library.sessionsAsTabs": "افتح الجلسات علامات تبويب في هذه النافذة",
  "library.livePreviews": "معاينات حيّة",
  "library.livePreviewsHint":
    "معاينات حيّة: البطاقات ذات الجلسة النشطة تعرض صورة حيّة بدل الصورة المحفوظة",
  "library.scanning": "جارٍ الفحص…",
  "library.aboutAndHelp": "عن البرنامج والمساعدة",

  // المكتبة: الحالة الفارغة وما حولها
  "library.emptyTitle": "كيف تريد أن تبدأ؟",
  "library.emptyBody":
    "هل تحتاج مساعدة على هذا الجهاز، أم تساعد شخصًا آخر؟ أو ابحث عن أجهزتك على الشبكة وأضفها.",
  "library.findOnNetwork": "ابحث عن الأجهزة على شبكتي",
  "library.addComputerManually": "أضف جهازًا يدويًا",
  "library.noMatch": "لا يوجد جهاز يطابق «{search}»",
  "library.addAsHost": "أضف «{search}» كمضيف جديد",
  "library.nearbyHeading": "قريب منك، ولم يُحفظ بعد",
  "library.nothingDiscovered": "لم يُعثر على شيء بعد",
  "library.nothingDiscoveredBody":
    "بعض الأجهزة لا تعلن عن نفسها على الشبكة. يمكنك فحص هذا المقطع على الشبكة بنشاط، أو إضافة جهاز بعنوانه.",
  "library.scanThisNetwork": "افحص هذه الشبكة",
  "library.addManually": "أضف يدويًا",

  // المكتبة: شريط التحديد
  "library.selectedCount": "{count} مضيف محدَّد",
  "library.dragHint": "اسحب إلى مجموعة أو وسم في الشريط الجانبي، أو:",
  "library.moveToGroupAria": "انقل المضيفين المحدَّدين إلى مجموعة",
  "library.moveTo": "انقل إلى…",
  "library.addTagAria": "أضف وسمًا إلى المضيفين المحدَّدين",
  "library.addTag": "أضف وسمًا…",
  "library.clearSelection": "امسح التحديد",
  "library.hostsCount": "{count} مضيف",
  "library.hostWord": "مضيف",

  // المكتبة: قائمة العرض
  "library.hosts": "المضيفون",
  "library.colProtocol": "البروتوكول",
  "library.online": "متصل",
  "library.offline": "غير متصل أو غير معروف",

  // المكتبة: إنشاء مجموعة أو وسم
  "library.newGroup": "مجموعة جديدة",
  "library.newTag": "وسم جديد",
  "library.groupPlaceholder": "مكتب",
  "library.tagPlaceholder": "إنتاج",
  "library.groupNameAria": "اسم المجموعة",
  "library.tagNameAria": "اسم الوسم",
  "library.tagColorAria": "لون الوسم",
  "library.colorAria": "اللون {color}",
  "library.create": "إنشاء",

  // المكتبة: قوائم السياق
  "library.menuEdit": "تعديل…",
  "library.menuConnectNewTab": "اتصل في علامة تبويب جديدة",
  "library.menuConnectNewWindow": "اتصل في نافذة جديدة",
  "library.menuAddFavorite": "أضف إلى المفضّلة",
  "library.menuRemoveFavorite": "أزل من المفضّلة",
  "library.copyName": "{name} (نسخة)",
  "library.menuDuplicate": "نسخة",
  "library.menuWake": "إيقاظ (Wake-on-LAN)",
  "library.menuReloadThumbnail": "أعد تحميل الصورة المصغّرة",
  "library.menuForgetKey": "أنسِ المفتاح المحفوظ…",
  "library.menuDelete": "احذف…",
  "library.menuOpenGrid": "افتح كشبكة",
  "library.menuOpenGridSaved": "افتح كشبكة (بترتيب محفوظ)",
  "library.menuSaveLayout": "احفظ هذا الترتيب في المجموعة",
  "library.menuForgetLayout": "أنسِ الترتيب المحفوظ",
  "library.menuRemoveFromGroup": "أزل {count} مضيفًا من مجموعتها",
  "library.menuMoveTo": "انقل إلى {group}",
  "library.menuTagWith": "وسم بـ {tag}",
  "library.menuDeleteMany": "احذف {count} مضيفًا…",

  // المكتبة: لوحة الأوامر
  "library.paletteGoTo": "انتقل إلى {title}",
  "library.paletteConnectAddress": "اتصل بعنوان…",
  "library.paletteSwitchList": "انتقل إلى عرض القائمة",
  "library.paletteSwitchGrid": "انتقل إلى العرض الشبكي",
  "library.paletteRefresh": "حدّث المكتبة",
  "library.paletteHelp": "المساعدة واختصارات لوحة المفاتيح",

  // المكتبة: ما يقوله التطبيق
  "library.connectFailed": "تعذّر الاتصال بـ {name}: {reason}",
  "library.alreadyOpen": "{name} مفتوح أصلًا، وأُحضر إلى الأمام",
  "library.connectingTo": "جارٍ الاتصال بـ {address}",
  "library.connectingToPort": "جارٍ الاتصال بـ {address} على المنفذ {port}",
  "library.lookingUpNumber": "جارٍ البحث عن الرقم {number}…",
  "library.numberNeedsRegistry": "الرقم التسعيني يحتاج سجل OraxDesk. اضبط عنوان السجل من «ساعد شخصًا» ← «أصل إلى جهاز» أولًا.",
  "library.numberLookupFailed": "تعذّر البحث عن الرقم {number}. تحقّق من اتصالك بالسجل ثم أعد المحاولة.",
  "library.numberNotRegistered": "لا يوجد جهاز بهذا الرقم في السجل. اطلب من الشخص الموجود هناك فتح OraxDesk وتحديثه، ثم أعد المحاولة.",
  "library.groupEmpty": "لا يوجد في «{group}» أي مضيف بعد",
  "library.groupLayoutChanged":
    "تغيّرت «{group}» منذ حفظ ترتيبها؛ فُتح ما لا يزال مطابقًا",
  "library.openGridFirst": "افتح مجموعة كشبكة أولًا، ثم احفظ ترتيبك لها",
  "library.layoutSaved": "حُفظ هذا الترتيب في «{group}»",
  "library.layoutForgotten": "ستُفتح «{group}» كشبكة عادية من الآن فصاعدًا",
  "library.undoFailed": "تعذّر التراجع: {reason}",
  "library.notInGroupOne": "«{hosts}» ليس في أي مجموعة",
  "library.notInGroupMany": "«{hosts}» ليست في أي مجموعة",
  "library.removedFromGroup": "أُزيل {hosts} من مجموعته",
  "library.moveFailed": "تعذّر نقل المضيفين: {reason}",
  "library.alreadyInGroup": "«{hosts}» في «{group}» بالفعل",
  "library.movedToGroup": "نُقل {hosts} إلى «{group}»",
  "library.alreadyTagged": "«{hosts}» موسوم بـ «{tag}» بالفعل",
  "library.taggedWith": "وُسم {hosts} بـ «{tag}»",
  "library.tagFailed": "تعذّر وسم المضيفين: {reason}",
  "library.added": "أُضيف {name}",
  "library.removeFailed": "تعذّرت الإزالة: {reason}",
  "library.saveFailed": "تعذّر حفظ {name}: {reason}",
  "library.savedWithoutPassword": "حُفظ {name}، لكن كلمة مروره لم تُحفظ: {reason}",
  "library.hostUpdated": "حُدِّث المضيف",
  "library.deleteFailed": "تعذّر حذف {name}: {reason}",
  "library.deletedMany": "حُذف {count} مضيف. وكلمات المرور المحفوظة لم تعد موجودة.",
  "library.restoreFailed": "تعذّر استعادة المضيفين: {reason}",
  "library.duplicateFailed": "تعذّرت نسخة {name}: {reason}",
  "library.magicPacketSent": "أُرسلت حزمة سحرية إلى {name}",
  "library.wakeFailed": "تعذّر إيقاظ {name}: {reason}",
  "library.forgotKey":
    "نُسي المفتاح المحفوظ لـ {name}. وسيُطلب منك التحقق منه عند الاتصال التالي.",
  "library.forgetKeyFailed": "تعذّر نسيان المفتاح المحفوظ لـ {name}: {reason}",
  "library.alreadyInLibrary": "هذا الجهاز محفوظ بالفعل باسم {name}.",
  "library.selectOneToConnect": "اختر جهازًا واحدًا للاتصال به.",
  "library.selectOneToWake": "اختر جهازًا واحدًا لإيقاظه.",
  "library.hostGone": "هذا الجهاز لم يعد في المكتبة.",
  "library.deleted": "حُذف {name}",
  "library.groupCreated": "أُنشئت المجموعة «{name}»",
  "library.tagCreated": "أُنشئ الوسم «{name}»",
  "library.groupCreateFailed": "تعذّر إنشاء المجموعة: {reason}",
  "library.tagCreateFailed": "تعذّر إنشاء الوسم: {reason}",
  "library.undo": "تراجع",
  "library.add": "إضافة",
  "library.edit": "تعديل",

  "files.allowFolder": "اسمح بمجلد",
  "files.title": "الملفات، {host}",
  "files.close": "أغلق الملفات",
  "files.localPane": "المحلي",
  "files.remotePane": "البعيد، {host}",
  "files.upload": "رفع ←",
  "files.uploadTitle": "ارفع الملفات المحلية المحددة (أو اختر ملفات) إلى المجلد البعيد",
  "files.uploadTitleDisconnected": "وصّل قناة نقل الملفات أولًا",
  "files.download": "→ تنزيل",
  "files.downloadTitle": "نزّل الملفات البعيدة المحددة إلى المجلد المحلي",
  "files.newFolder": "مجلد جديد",
  "files.renameF2": "إعادة تسمية (F2)",
  "files.delete": "حذف",
  "files.keysHint":
    "Enter يفتح · Backspace يصعد · Ctrl/⌘+A يحدد الكل · F2 يعيد التسمية · Del يحذف",
  "files.newFolderLocal": "مجلد جديد في المجلد المحلي",
  "files.newFolderRemote": "مجلد جديد في المجلد البعيد",
  "files.rename": "إعادة تسمية",
  "files.badName": "لا يمكن أن يكون الاسم فارغًا، أو يحتوي على شرطة مائلة، أو يكون «.» أو «..».",
  "files.deleteOne": "حذف عنصر واحد على {where}؟",
  "files.deleteMany": "حذف {count} عناصر على {where}؟",
  "files.deleteWhereLocal": "هذا الجهاز",
  "files.deleteWarn": "تُحذف المجلدات بما فيها من محتويات. ولا يمكن التراجع عن ذلك.",
  "files.colName": "الاسم",
  "files.colSize": "الحجم",
  "files.colModified": "آخر تعديل",
  "files.showHidden": "أظهر الملفات المخفية",
  "files.hideHidden": "أخفِ الملفات المخفية",
  "files.locationAria": "موضع {pane}",
  "files.filesAria": "ملفات {pane}",
  "files.notConnected": "قناة نقل الملفات غير متصلة.",
  "files.loading": "جارٍ التحميل…",
  "files.emptyFolder": "هذا المجلد فارغ.",
  "files.itemOne": "عنصر واحد",
  "files.itemMany": "{count} عناصر",
  "files.selectedCount": "{count} محدَّد",
  "files.transfers": "النقل",
  "files.activeCount": " ({count} نشط)",
  "files.clearCompleted": "امسح المكتملة",
  "files.noTransfers":
    "لا نقل بعد. اسحب الملفات إلى نافذة الجلسة، أو استعمل الرفع والتنزيل.",
  "files.cancelTransfer": "ألغِ نقل {name}",
  "files.done": "تم · {size}",
  "files.cancelled": "أُلغي",
  "files.firstConnection": "أول اتصال إلى {host}:{port}",
  "files.sshUnknown":
    "لم تُرَ هوية SSH لهذا الجهاز من قبل. تحقّق من البصمة مقابل الخادم قبل أن تثق بها.",
  "files.trustAndConnect": "وثّق واتصل",
  "files.identityChanged": "تغيّرت هوية SSH لـ {host}:{port}",
  "files.transferBlocked":
    "نقل الملفات موقوف. إما أن الخادم أُعيد تثبيته أو أن أحدًا يعترض على الاتصال، ولا يوجد «متابعة رغم ذلك». تحقّق من المفتاح الجديد خارج الاتصال، واحذف المحفوظ قبل أن تعيد الاتصال.",
  "files.expected": "المتوقَّع",
  "files.dropOne": "أفلت لإرسال ملف واحد إلى {host}",
  "files.dropMany": "أفلت لإرسال {count} ملفات إلى {host}",

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
    "يظهر تحت «الوصول دون حضورك» في OraxDesk Support على ذلك الجهاز. وإن لم تكن مقترنًا، يوافقك الشخص هناك، أو تستخدم كلمة المرور أدناه.",
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
  "host.protocolNameBoundary": "OraxDesk Support (مساعدة عن بُعد)",
  "host.protocolNameRdp": "سطح المكتب البعيد (RDP)",
  "host.protocolNameSsh": "الطرفية (SSH)",
  "host.protocolNameVnc": "مشاركة الشاشة (VNC)",

  // التفضيلات
  "prefs.title": "التفضيلات",
  "prefs.sectionsAria": "أقسام التفضيلات",
  "prefs.closeAria": "أغلق التفضيلات",
  "prefs.tabGeneral": "عام",
  "prefs.tabAppearance": "المظهر",
  "prefs.tabConnections": "الاتصالات",
  "prefs.tabSession": "الجلسة",
  "prefs.tabInput": "الإدخال",
  "prefs.tabClipboard": "الحافظة",
  "prefs.tabFiles": "الملفات",
  "prefs.tabSecurity": "الأمان",
  "prefs.tabNetwork": "الشبكة",
  "prefs.tabAgents": "الوكلاء",

  // التفضيلات: عام
  "prefs.confirmDisconnect": "أكّد قبل الفصل",
  "prefs.confirmDisconnectHint": "اسأل قبل إنهاء جلسة من شريط الأدوات",
  "prefs.captureThumbs": "التقط صورًا مصغّرة",
  "prefs.livePreviewsHint":
    "أثناء وجود جلسة متصلة، تعرض بطاقتها في المكتبة صورة حيّة (نحو إطارين في الثانية) بدل الصورة المحفوظة",
  "prefs.captureThumbsHint":
    "احفظ لقطة صغيرة لكل مضيف بعد الاتصال، لتظهر في شبكة المكتبة",
  "prefs.compactDensity": "كثافة مضغوطة للمكتبة",
  "prefs.compactDensityHint": "بطاقات أصغر وتباعد أقرب، للمكتبات الكبيرة",

  // التفضيلات: المظهر
  "prefs.theme": "المظهر",
  "prefs.themeHint": "خيار «تابع النظام» يتبدّل تلقائيًا مع نظامك",
  "prefs.themeSystem": "تابع النظام",
  "prefs.themeLight": "فاتح",
  "prefs.themeDark": "داكن",

  // التفضيلات: الاتصالات
  "prefs.tabsInOneWindow": "أظهر الجلسات علامات تبويب في نافذة واحدة",
  "prefs.tabsInOneWindowHint":
    "تصبح الأجهزة المتصلة علامات تبويب أعلى هذه النافذة، فتنتقل بينها كعلامات المتصفح، بدل أن يفتح كلٌّ منها نافذة. أما الجلسات القائمة فتبقى حيث هي؛ وهذا يحدّد أين تذهب الجلسة التالية.",
  "prefs.multipleTabs": "اسمح بأكثر من علامة تبويب لكل جهاز",
  "prefs.multipleWindows": "اسمح بأكثر من نافذة لكل جهاز",
  "prefs.multipleTabsHint":
    "عادةً، الاتصال بجهاز متصل به يختار علامة التبويب التي هو فيها، بدل جلسة ثانية. فعّل هذا لفتح علامة تبويب منفصلة في كل مرة.",
  "prefs.multipleWindowsHint":
    "عادةً، الاتصال بجهاز متصل به يُحضر نافذته إلى الأمام، بدل جلسة ثانية. فعّل هذا لفتح نافذة منفصلة في كل مرة.",
  "prefs.sharpenOnStop": "شذّب الصورة حين تتوقف الحركة",
  "prefs.sharpenOnStopHint":
    "أثناء الحركة تُضغط الصورة بشدة ليبقى العرض فوريًا، وبعد لحظة من السكون تُعاد رسم المنطقة المتأثرة بجودة كاملة. أطفئ هذا على اتصال محدود الاستهلاك لتوفير عرض النطاق المحفوظ.",
  "prefs.rdpDefaults": "الافتراضيات لسطح المكتب البعيد",
  "prefs.allMonitors": "استخدم كل شاشاتي لاتصالات سطح المكتب البعيد الجديدة",
  "prefs.allMonitorsHint":
    "تبدأ الأجهزة الجديدة بكل شاشة محلية متصلة. أما الأجهزة القائمة فتحتفظ بما ضبطته عليها.",
  "prefs.resolutionForNew": "الدقة لأجهزة سطح المكتب البعيد الجديدة",
  "prefs.resolutionForNewHint":
    "مطابقة النافذة عند الاتصال هو ما يفعله برنامج ويندوز نفسه. أما الاستمرار في المطابقة فيغيّر حجم سطح المكتب البعيد كلما غيّرت حجم هذه النافذة، وما يعيد ترتيب أيقونات ذلك الجهاز.",
  "prefs.playRemoteSound": "شغّل صوت الجهاز البعيد على هذا الجهاز",
  "prefs.playRemoteSoundHint": "يُحوَّل صوت الجهاز البعيد إلى هنا بدل أن يبقى يُشغَّل هناك.",
  "prefs.shareClipboardRdp": "شارك حافظتي مع اتصالات سطح المكتب البعيد",
  "prefs.shareClipboardRdpHint": "انسخ النص والصقه في الاتجاهين.",
  "prefs.reconnectForever": "أعد الاتصال حتى أُغلق النافذة",
  "prefs.reconnectForeverHint": "واصل إعادة محاولة الجلسات المنقطعة بتباعد متصاعد",
  "prefs.wolDuringRetry": "أرسل Wake-on-LAN أثناء المحاولات",
  "prefs.wolDuringRetryHint":
    "إن بدا مضيف بعنوان MAC محفوظ متوقفًا، فأرسل حزمة سحرية أثناء إعادة الاتصال",

  // التفضيلات: الجلسة
  "prefs.hideToolbar": "أخفِ شريط الأدوات الطائر",
  "prefs.hideToolbarHint":
    "لا شيء فوق سطح المكتب البعيد. وكل ما يفعله الشريط يبقى متاحًا من قوائم العرض والجلسة، وهي تبيّن إعداد كل جلسة.",
  "prefs.newDefaults": "الافتراضيات للأجهزة الجديدة",
  "prefs.newDefaultsHint":
    "من أين يبدأ الجهاز قبل أن تبدّل شيئًا فيه. غيّر أحد هذه وأنت متصل، من شريط الأدوات أو القوائم، فيُحفَظ على ذلك الجهاز منذ ذلك الحين، بما في ذلك الشاشة التي اخترتها.",
  "prefs.scalingHint": "كيف يلائم سطح المكتب البعيد النافذة",
  "prefs.qualityHint":
    "يستنتج «تلقائي» نوع الوصلة من الإنتاجية؛ والخيارات الأخرى تصف الوصلة وتوقف التكيّف",
  "prefs.qualityHigh": "عالية",
  "prefs.qualityMedium": "متوسطة",
  "prefs.qualityLow": "منخفضة",
  "prefs.grayLevelsHint": "كم درجة رمادية يبقيها الإعداد الأسود والأبيض",
  "prefs.zoomLockedHint":
    "تجاهل التكبير بإصبعين، فهو سهل الحدوث بالخطأ أثناء التمرير على لوحة التتبع. وأدوات التكبير تبقى تعمل.",
  "prefs.edgePanHint":
    "مرّر العرض حين يبلغ المؤشر حافة الشاشة، لسطح مكتب أكبر من النافذة. ومع إطفائه لا يمكن بلوغ ما بعد الحافة إلا بالسحب مع ضغط المسافة.",
  "prefs.passShortcutsHint":
    "أرسل Cmd/Alt+Tab وCmd+Space ومفتاح ويندوز إلى الجهاز البعيد بدل هذا الجهاز. يلزم إذن إمكانية الوصول على macOS، ويحجز لوحة مفاتيحك ما دامت جلسة ما نشطة؛ وأفلتها في أي وقت بـ Ctrl+Alt+Shift+Esc.",
  "prefs.viewOnly": "ابدأ في وضع القراءة فقط",
  "prefs.showRemotePointerHint":
    "ارسم مؤشر فأرة الجهاز البعيد نفسه. أطفئه إن بدا مؤشّران مشتّتان، فإدخالك يُرسَل في الحالين.",
  "prefs.viewOnlyHint":
    "شاهد دون إرسال أي إدخال. فلا يصل إلى الجهاز البعيد ما تكتبه أو تنقره حتى تطفئ هذا.",
  "prefs.pointerHint":
    "سهم النظام يغطي البكسلات تحت رأسه نفسه، وهناك يجلس مؤشر البعيد، فإذا رُسما معًا ازدحما. أما «نقطة» فحلقة في مركز نقطة الاستجابة، و«مخفيّ» يترك مؤشر البعيد وحده.",

  // التفضيلات: الإدخال
  "prefs.matchScroll": "طابق اتجاه التمرير لدي",
  "prefs.matchScrollHint":
    "مرّر سطح المكتب البعيد كما يمرّر هذا الجهاز، أيًّا كان إعداد لوحة التتبع أو الفأرة. أطفئه لعكس الاتجاه على البعيد وحده.",
  "prefs.matchKeyboard": "طابق تخطيط لوحة مفاتيحي المحلية",
  "prefs.matchKeyboardHint":
    "تكتب المفاتيح ما تكتبه على هذه اللوحة، بدل ما يقرّره تخطيط الجهاز البعيد للمفتاح نفسه. ولا يهم إلا حين يختلف التخطيطان.",
  "prefs.typeDictation": "اكتب النص الذي تُدخله أدوات الإملاء",
  "prefs.typeDictationHint":
    "يُكتب في سطح المكتب البعيد النص الذي تُدخله برامج الإملاء والأتمتة دون ضغط مفاتيح. أما علامات التمييز وطرق الإدخال الصينية فتعمل في الحالين، لأنها من كتابتك أنت.",
  "prefs.typeLocalPaste": "اكتب في البعيد ما نسخته من هذا الماك",
  "prefs.typeLocalPasteHint":
    "حين يُترك Cmd+V لنظام macOS، أي حين لا تُمرَّر اختصارات النظام، أو حين تختار «تحرير ▸ لصق»، يُكتب نص الحافظة في سطح المكتب البعيد مفتاحًا مفتاحًا. وأدوات الإملاء التي تلصق، مثل Wispr Flow، تحتاج هذا مفعّلًا.",

  // التفضيلات: الحافظة
  "prefs.clipboardSync": "زامن الحافظة تلقائيًا",
  "prefs.clipboardSyncHint": "النص المنسوخ في أي جهة متاح في الأخرى",
  "prefs.clipboardOnFocus": "أرسل الحافظة حين تستعيد الجلسة التركيز",
  "prefs.clipboardOnFocusHint": "أرسل حافظتك المحلية إلى البعيد حين تعود إلى الجلسة",
  "prefs.clipboardOnPaste": "أرسل الحافظة عند اللصق في البعيد",
  "prefs.clipboardOnPasteHint":
    "يُرسل Cmd/Ctrl+V حافظتك المحلية أولًا، فيلصق البعيد ما نسخته أخيرًا",

  // التفضيلات: الملفات
  "prefs.confirmOverwrite": "أكّد قبل الكتابة فوق الملفات",
  "prefs.confirmOverwriteHint": "اسأل حين يستبدل النقل ملفًا موجودًا",

  // التفضيلات: الأمان
  "prefs.credentialStorage": "تخزين بيانات الاعتماد",
  "prefs.credentialsIn": "تُحفظ كلمات المرور في: {backend}",
  "prefs.credentialsKeychain":
    "تُحفظ كلمات المرور في خزنة مفاتيح نظامك، لا في ملف.",
  "prefs.strictPinning": "تثبيت صارم للشهادات",
  "prefs.strictPinningHint":
    "ارفض الاتصال حين تتغير شهادة الخادم، حتى تعيد الوثوق بها صراحةً",

  // التفضيلات: الشبكة
  "prefs.deepNames": "ابحث عن الأسماء في خدمات أخرى",
  "prefs.deepNamesHint":
    "بعض أجهزة ويندوز تحجب كل خدمات الأسماء. وقراءة الاسم الذي ينشره الجهاز على RDP أو RPC تسمّيه على أي حال، لكنها تعني اتصالًا قصيرًا بمنافذ لا تمرّ عبرها، وقد ينبّه إليه مراقبة الشبكة الصارمة. أطفئها لتستخدم خدمات الأسماء وحدها.",
  "prefs.probeRdp": "ابحث عن سطح المكتب البعيد أثناء الفحص",
  "prefs.probeRdpHint":
    "يجرّب المنفذ 3389 على كل عنوان أيضًا، فيظهر جهاز ويندوز الذي لا يشغّل خادم VNC. واتصال إضافي واحد لكل عنوان، بالمعدل اللطيف نفسه.",
  "prefs.mdns": "اكتشف الأجهزة تلقائيًا (mDNS/Bonjour)",
  "prefs.mdnsHint": "استمع لخوادم VNC التي تعلن عن نفسها على شبكتك المحلية",
  "prefs.probeOnline": "افحص المضيفين المحفوظين لمعرفة حالتهم",
  "prefs.probeOnlineHint":
    "فحص TCP خفيف ومنظَّم يسند النقطة الخضراء على البطاقات",

  // التفضيلات: الوكلاء
  "prefs.hideAgentCounts": "أخفِ أعداد الوكلاء",
  "prefs.hideAgentCountsHint":
    "أزل من شريط النشاط سطر عدد الوكلاء المتصلين، ومقدار ما يقودون من هذا الجهاز. ويبقى الشريط نفسه يظهر أثناء قيادة وكيل لجهاز ما، ببطاقة لكل جهاز، وهذا الخيار يبقى هنا.",
  "prefs.rightNow": "الآن",
  "prefs.rightNowHint":
    "القيادة تعني أن الوكيل يمسك الإيجار على ذلك الجهاز. والوكيل المتصل الذي لا يمسك شيئًا لا يقود شيئًا، ولا يُحسب إلا في الرقم الأول.",
  "prefs.agentsSidebarNote":
    "في «الوكلاء» بالشريط الجانبي للمكتبة الأسطر التي تنسخها، والفحص الذي تجريه، والخيار الذي يطفئ كل ذلك من جديد.",

  // إعداد المزوّد: Tailscale وCloudflare
  "provider.summary": "جهّز بنيتي التحتية الخاصة",
  "provider.intro":
    "ثبّت هذا جهاز المساعد واربطه بحسابك لدى المزوّد. وشغّل الإعداد في Boundary على جهاز المتلقّي أيضًا، ثم أنشئ دعوة جديدة.",
  "provider.label": "المزوّد",
  "provider.cloudflareTeam": "اسم فريق Cloudflare",
  "provider.configureAccount": "اضبط حسابي عبر واجهة Cloudflare API",
  "provider.accountId": "معرّف الحساب",
  "provider.enrollmentEmails": "رسائل التسجيل، مفصولة بفواصل",
  "provider.configureBody":
    "ينشئ سياسة تسجيل بالبريد وملف جهاز Mesh خاصًا، ويفعّل اتصال الأجهزة للحساب. وتبقى سياسات الوصول القائمة سارية.",
  "provider.tailscaleAuthKey":
    "مفتاح تفويض الجهاز (اختياري، اتركه فارغًا للدخول من المتصفح)",
  "provider.cloudflareToken": "رمز Cloudflare API محدود الصلاحية",
  "provider.installNote":
    "يُثبَّت البرنامج الرسمي إن لم يكن موجودًا. أكمل دخول المزوّد وطلبات إذن نظام التشغيل حين تظهر. وإعداد ويندوز يضيف قاعدة في جدار الحماية لـ UDP محصورة في هذا التطبيق وشبكة المزوّد الخاصة.",
  "provider.consent": "ثبّت البرنامج وطبّق الإعداد الموصوف أعلاه",
  "provider.installAndConnect": "ثبّت واتصل",
  "provider.removePolicy":
    "أزل سياسة تسجيل Cloudflare وملف جهاز هذا النشر. وقد يقطع ذلك الوصول.",
  "provider.removeResources": "أزل موارد حساب Boundary",
  "provider.cancelSetup": "ألغِ الإعداد",
  "provider.statusFailed":
    "تعذّرت قراءة حالة الإعداد. أعد فتح هذه النافذة للاتصال من جديد.",
  "provider.verifyNote":
    "يتبع فحص اتصال محلي جلسة Boundary فعلية للتحقق من المسار كاملًا. والدعوات الخاصة تعطّل الترحيل العام.",
  "common.done": "تم",
  "common.close": "إغلاق",
  "common.tryAgain": "أعد المحاولة",
  "common.dismiss": "إغلاق الإشعار",
  "common.closeDialog": "إغلاق النافذة",
  "common.closeTerminal": "إغلاق الطرفية",
  "common.closePane": "إغلاق هذه اللوحة",
  "common.resizePanes": "تغيير حجم اللوحات",
  "common.restorePane": "استعادة اللوحة: {title}",
  "common.maximisePane": "تكبير اللوحة: {title}",
  "common.connecting": "جارٍ الاتصال",
  "common.reconnecting": "جارٍ إعادة الاتصال",
  "common.openSessions": "الجلسات المفتوحة",
  "common.passwordSaved": "كلمة المرور محفوظة",
  "common.moveSessionHere": "نقل جلسة متصلة إلى هنا",
  "common.choosePane": "اختر ما يُعرض في هذه اللوحة",
  "common.searchHosts": "ابحث عن مضيف، أو اكتب عنوانًا",
  "common.commandPalette": "لوحة الأوامر",
  "common.commandPalettePlaceholder": "اتصل بمضيف أو نفّذ أمرًا…",
  "common.noPaletteMatch": "لا توجد نتائج مطابقة لـ«{query}»",
  "common.librarySections": "أقسام المكتبة",
  "common.nearby": "بالقرب",
  "common.allHosts": "كل المضيفين",
  "common.favorites": "المفضلة",
  "common.recents": "الأخيرة",
  "common.groups": "المجموعات",
  "common.tags": "الوسوم",
  "common.newGroup": "مجموعة جديدة",
  "common.newTag": "وسم جديد",
  "common.noGroups": "لا مجموعات بعد",
  "common.noTags": "لا وسوم بعد",
  "common.makeGroupFirst": "أنشئ مجموعة أولًا، ثم أفلت المضيفين عليها",
  "common.makeTagFirst": "أنشئ وسمًا أولًا، ثم أفلت المضيفين عليه",
  "common.dropToUngroup": "أفلت هنا لإزالة هؤلاء المضيفين من مجموعتهم",
  "common.dropToTag": "أفلت هنا لوسمهم بـ «{tag}»",
  "common.tagFilterMode": "وضع تصفية الوسوم: {mode}. انقر للتبديل.",
  "common.tagFilterTitle": "بدّل بين مطابقة المضيفين كل الوسوم المحددة (AND) أو أي وسم منها (OR)",
  "common.aiAgents": "وكلاء الذكاء الاصطناعي",
  "common.preferences": "التفضيلات",
  "common.alreadyOpenWindow": "«{name}» مفتوح أصلًا في نافذة مستقلة",
  "common.tabDriven": "{status}، وكيل يقود",
  "common.online": "متصل",
  "common.unreachable": "غير قابل للوصول",
  "common.statusUnknown": "الحالة غير معروفة",
  "common.osUnknown": "نظام التشغيل غير معروف",
  "host.osWindowsResolved": "Windows، الاسم من {via}، ولا يجيب عليه إلا جهاز Windows",
  "host.osInferred": "{os}، مستنتج من استجابته على الشبكة",
  "common.library": "المكتبة",
  "common.nothingMatches": "لا شيء يطابق. اضغط Enter للاتصال به كعنوان.",
  "common.noSavedHosts": "لا مضيفين محفوظين بعد.",
  "common.closePaneTitle": "إغلاق هذا الجزء",
  "common.closePaneAria": "إغلاق الجزء: {title}",
  "onboarding.saveLabel": "حفظ…",
  "onboarding.noDiscovered": "لا أجهزة مكتشفة للتعبئة. استخدم «+ مضيف جديد» في المكتبة بدلًا من ذلك.",
  "session.reconnected": "أُعيد الاتصال",
  "session.screenshotSaved": "حُفظت لقطة الشاشة",
  "session.clipboardUnreadable": "تعذّرت قراءة الحافظة المحلية",
  "session.clipboardSent": "أُرسلت الحافظة إلى الطرف البعيد",
  "session.connectionInfo": "معلومات الاتصال",
  "session.bell": "جرس",
  "session.sendingFiles": "جارٍ إرسال الملفات ({count}) إلى {target}",
  "pane.connectFailed": "تعذّر الاتصال بـ {label}: {reason}",
  "pane.connectFailedGeneric": "تعذّر الاتصال: {reason}",
  "ssh.reattached": "أُعيد الربط بجلسة {multiplexer}",
  "sshHostKey.previouslyTrusted": "موثوق سابقًا",
  "sshHostKey.presentedNow": "المعروض الآن",
  "sshHostKey.changedTitleGateway": "تغيّرت هوية بوابة SSH",
  "sshHostKey.changedTitle": "تغيّرت هوية هذا الجهاز",
  "sshHostKey.changedBody": "يقدّم خادم SSH عند {endpoint} مفتاحًا مختلفًا عن الذي وثقت به سابقًا. قد يعني ذلك إعادة تثبيت الجهاز، أو أن أحدًا يعترض اتصالك. رُفض الاتصال. إذا كنت تعرف أن المفتاح تغيّر بشكل مشروع، فأزل المفتاح المحفوظ لهذا الجهاز ثم اتصل مجددًا.",
  "sshHostKey.verifyGatewayTitle": "تحقق من بوابة SSH {host}",
  "sshHostKey.verifyTitle": "تحقق من {host}",
  "sshHostKey.gatewayBody": "سيُمرَّر اتصالك عبر خادم SSH عند {endpoint}، وهذه أول مرة يعرّف نفسه.",
  "sshHostKey.firstBody": "هذه أول مرة يعرّف فيها {endpoint} نفسه، لذا لا يوجد شيء محفوظ للمقارنة بعد.",
  "sshHostKey.verifyHint": "تحقق من أن البصمة أدناه تطابق بصمة الخادم ({command}) قبل الوثوق بها.",
  "sshHostKey.hostKey": "مفتاح المضيف",
  "sshHostKey.trust": "ثِق واتصل",
  "sshHostKey.fingerprintAria": "بصمة {label}",
  "session.problemTitle": "واجهت هذه الجلسة مشكلة",
  "session.problemBody": "أُغلق الاتصال. لم يُحفظ شيء من هذه الجلسة.",
  "session.closeTab": "إغلاق التبويب",
  "session.remoteDesktopAria": "سطح المكتب البعيد: {name}",
  "session.closeTabAria": "إغلاق {title}",
  "ssh.disconnect": "افصل",
  "tabs.newPane": "جزء جديد",
  "pane.session": "جلسة",
  "pane.noSession": "لا جلسة",
  "pane.empty": "جزء فارغ",
  "session.closeWindow": "إغلاق النافذة",
  "ssh.authenticating": "جارٍ المصادقة ({method})",

  // الأوقات
  "util.never": "أبدًا",
} as const;

const en: Record<keyof typeof ar, string> = {
  "app.language": "Language",
  "app.arabic": "العربية",
  "app.english": "English",
  "registry.title": "Help code",
  "registry.description":
    "Send this code to the person helping you. It expires in minutes, and the screen and keyboard never go through the registry.",
  "registry.url": "Registry URL",
  "registry.create": "Create a help code",
  "registry.createAnother": "Create another code",
  "registry.copy": "Copy code",
  "registry.withdraw": "Withdraw",
  "registry.ready": "Code ready, valid until {time}.",
  "registry.withdrawn": "Code withdrawn. Nobody can use it now.",
  "registry.failed": "The code could not be created: {reason}",
  "registry.withdrawFailed": "The code could not be withdrawn: {reason}",
  "registry.healthy": "The registry is working.",
  "registry.degraded": "The registry is not in good shape (database: {db}, sealing key: {key}).",
  "registry.autoCreating": "Creating your help code…",
  "registry.copyMessage": "Copy share message",
  "registry.shareMessage": "I need help with my computer through OraxDesk.\nOpen OraxDesk, choose \"Help someone\", and enter this code: {code}",
  "registry.readOut": "Send this code to the person helping you. Do not share it with anyone else.",
  "registry.advanced": "Advanced registry settings",
  "registry.link": "Copy help link",
  "device.number": "This computer's number - read it out",
  "device.copyNumber": "Copy number",
  "device.copied": "Number copied",
  "device.numberHint":
    "Nine digits that never change for this computer. Read them down the phone to whoever is helping you, or copy them.",
  "device.registering": "Registering this computer's number…",
  "device.registered": "The number is registered and ready to look up.",
  "device.registerFailed": "Could not register this computer's number.",
  "device.registerNotReady":
    "This number is not active yet — the other person will not be able to find this computer.",
  "device.registerReason": "Details: {reason}",
  "device.registerClock":
    "This computer's clock is not set correctly. Set the time automatically, then try again.",
  "device.registerNetwork":
    "The Orax service could not be reached. Check the internet connection, then try again.",
  "device.registerRetry": "Try again",
  "device.fixTime": "Set the time",
  "device.retrying": "Trying again automatically…",
  "device.autoRegister": "Register this computer automatically in the OraxDesk registry",
  "device.autoRegisterHint": "Prevents future registration. It does not delete a number already registered.",
  "device.autoRegisterOff": "Automatic registration is off.",
  "device.id": "This computer's ID, for reaching it unattended",
  "device.copyId": "Copy ID",

  // The onboarding screen
  "onboarding.welcome": "Welcome to OraxDesk",
  "onboarding.tagline":
    "See and control your other computers, fast, secure, and entirely yours. No account, ever.",
  "onboarding.appearance": "Appearance",
  "onboarding.themeAria": "Theme",
  "onboarding.themeSystem": "Follow System",
  "onboarding.findComputers": "Find your computers",
  "onboarding.saveFirst": "Save your first computer",
  "onboarding.save": "Save.",
  "onboarding.scanHint":
    "OraxDesk listens for computers advertising screen sharing on your local network. Your OS may ask permission to access the local network, that's this feature.",
  "onboarding.saveHint":
    "Give it a friendly name and, if you save a password, it's stored in your system keychain, never in a file.",
  "onboarding.skip": "Skip",
  "onboarding.back": "Back",
  "onboarding.continue": "Continue",
  "onboarding.openLibrary": "Open my library",
  "onboarding.stepAria": "Step {step} of {total}",
  "session.shortcutsDialogTitle": "Let this app capture system shortcuts",
  "session.shortcutsIntro":
    "To send {keys} to the remote computer instead of this one, {system} has to let this app see keys before the {server} does.",
  "session.shortcutsRelease":
    "You can release the keyboard at any time with {chord}, and it releases automatically when this window loses focus or closes.",
  "session.shortcutsNotNow": "Not now",
  "ssh.closed": "The connection was closed.",
  "session.captureUnsupported": "Shortcut pass-through isn't available here",
  "session.captureUnsupportedBody":
    "Everything the browser engine can see still reaches the remote. For the shortcuts it can't, use Send to remote in the keyboard menu; Ctrl+Alt+Del, Cmd/Alt+Tab and the Windows key are all deliverable that way.",
  "session.captureGotIt": "Got it",
  "session.captureOpenSettings": "Open System Settings",
  "session.captureTurnOn": "Turn pass-through on",
  "session.captureAllow": "Allow.",
  "session.captureAlreadyAllowed":
    "Already allowed but still not working? A macOS update or a new build can silently invalidate the grant, remove the app from the Accessibility list and add it again.",
  "session.accessibilityNote":
    "macOS calls this Accessibility. It is only used while a session is open, so it does not take the keys while you are typing.",
  "ssh.connecting": "Connecting.",
  "ssh.connected": "Connected",
  "ssh.reconnecting": "Reconnecting (attempt {attempt})",
  "ssh.disconnected": "Disconnected",
  "ssh.connectingTo": "Connecting to {endpoint}",
  "ssh.failed": "Connection failed",
  "ssh.verifyingHostKey": "Verifying host key",
  "ssh.hostKeyChanged": "Host key changed",
  "onboarding.scanning": "Scanning your network…",
  "onboarding.scanNothing":
    "Nothing found yet; some computers do not advertise themselves. You can add one manually later.",
  "onboarding.scanFailed":
    "The network scan could not be started. Check your network settings and try again.",
  "onboarding.scanRetry": "Try again",

  // The quick connect bar
  "quick.placeholder": "Connect to an address, e.g. 192.168.1.20:1 or rdp://frontdesk  ({key}T)",
  "quick.label": "Address to connect to",
  "quick.modeSearch": "Search",
  "quick.modeConnect": "Connect",
  "quick.switchToSearch": "Switch to search",
  "quick.switchToConnect": "Switch to connect",
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
  "quick.port": "port {port}",
  "quick.suggestions": "Connection suggestions",
  "quick.groupTyped": "This address",
  "quick.groupHosts": "Your computers",
  "quick.groupNearby": "On this network",
  "quick.groupRecent": "Recent",

  // The remote support dialogs
  "support.helpSomeone": "Help someone",
  "support.helpSomeoneNow": "Someone asked me for help",
  "support.reachComputer": "A computer I can reach",
  "support.yourName": "Your name, shown to the person",
  "support.theirCode": "Help code",
  "support.theirCodePlaceholder": "1234 5678 9012 or a help link",
  "support.codeHint": "Paste the code the person sent you. You can paste a help link instead.",
  "support.codeInvalid": "That code is incorrect or has expired. Ask the person for a new code.",
  "support.hostClock":
    "The other computer's clock is not set correctly. Ask them to set the time and create a new code.",
  "support.defaultHelperName": "Helper",
  "support.advanced": "Advanced settings",
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
  "support.helpSomeoneTitle": "Connect to someone who asked you for help",
  "support.helpOverInternet":
    "Help someone over the internet, with nothing to set up on either network.",
  "support.stepInstallLead": "In OraxDesk they press",
  "support.stepInstallTail":
    ". Without OraxDesk, they download OraxDesk Support from the OraxDesk releases page and open it. Nothing is installed.",
  "support.stepCodeLead": "They press",
  "support.stepCodeMid": "or",
  "support.stepCodeTail": "and send you what it shows.",
  "support.stepUse":
    "You copy it and open this window. It is pasted for you. They approve you on their screen.",
  "support.duringSession":
    "During the session they can choose to let you connect any time. The computer is then saved to your Library and opens unattended.",
  "support.machineIntro":
    "For a computer with unattended access switched on in OraxDesk or OraxDesk Support. A computer that paired you is already in your Library. Otherwise the person there approves you on their screen, and can pair you so you connect without asking next time.",
  "support.computerIdPlaceholder": "Their nine-digit number, or the 64-character ID",
  "support.registryNumberHint":
    "A nine-digit number is looked up through this registry, so both of you need the same one. Leave it empty to use a full ID instead.",
  "support.libraryNamePlaceholder": "Mum's laptop",
  "support.numberNotRegistered":
    "No computer with that number is registered at this registry. Open and update OraxDesk on the other computer so it registers, or use its full ID.",
  "support.saveMachineFailed": "The computer could not be saved to the Library",

  // The support overlay: the approval dialog and the banners
  "support.approveTitle": "Approve this helper?",
  "support.wantsToSee": "{name} wants to see your screen.",
  "support.approveSafety":
    "They see nothing until you choose. You can stop control or end the session at any time.",
  "support.connectionIdentity": "Helper connection identity",
  "support.showIdentity": "Show connection identity",
  "support.noteInvited":
    "The name is supplied by the helper. Confirm it with the person you invited.",
  "support.noteUnpaired":
    "They are connecting with this computer's ID and are not paired with it. The name is supplied by the helper, so only allow someone you expect.",
  "support.toolsExplain":
    "Their tools act as you, outside what the screen shows. Leave this off unless you asked for it. You can turn it off at any time, and each command shows here as it runs.",
  "support.pairAnyTime": "Let them connect any time without asking me again",
  "support.allowControl": "Allow viewing and control",
  "support.allowView": "Allow viewing",
  "support.decline": "Decline",
  "support.controlNeedsAccessibility":
    "Accessibility permission is needed for control. You can allow viewing now.",
  "support.yourHelper": "Your helper",
  "support.canSeeScreen": "{name} can see your screen.",
  "support.canSeeAndControl": "{name} can see your screen and use your mouse and keyboard.",
  "support.stopControl": "Stop control",
  "support.stopCommands": "Stop their commands",
  "support.toolsCanAct": "Their tools can run commands and copy files on this computer.",
  "support.isConnectedControl":
    "{name} is connected to this computer and can use the mouse and keyboard",
  "support.isConnectedWatching": "{name} is connected to this computer, watching",
  "support.endTheirSession": "End their session",

  // The support inbox: the numbers clients send
  "inbox.button": "Support inbox",
  "inbox.buttonTitle": "The device numbers your clients sent you",
  "inbox.title": "Support inbox",
  "inbox.intro":
    "The device numbers your clients sent you, with your own note beside each. The notes stay on this computer and never reach the registry, and the registry is only asked when you press Check the registry or Connect.",
  "inbox.number": "Device number",
  "inbox.numberPlaceholder": "250739098",
  "inbox.numberHint": "Nine digits, the way a client reads them out.",
  "inbox.note": "Your note (only you see this)",
  "inbox.notePlaceholder": "The client's name, or what they asked for",
  "inbox.add": "Add the number",
  "inbox.invalidNumber": "A device number is nine digits.",
  "inbox.alreadyThere": "That number is already in the list, and its note was not changed.",
  "inbox.empty": "No numbers yet. Add the first one somebody sent you.",
  "inbox.remove": "Remove",
  "inbox.removeTitle": "Remove this number from the list",
  "inbox.refresh": "Check the registry",
  "inbox.refreshing": "Checking…",
  "inbox.checkedAt": "Last checked: {when}",
  "inbox.neverChecked": "Not checked yet",
  "inbox.connect": "Connect",
  "inbox.connecting": "Connecting…",
  "inbox.connectFailed": "Could not connect: {reason}",
  "inbox.saveFailed": "The computer could not be saved to the Library",
  "inbox.numberNotRegistered": "No computer with that number is in the registry.",
  "inbox.addFailed": "Could not add the number: {reason}",
  "inbox.removeFailed": "Could not remove that: {reason}",
  "inbox.refreshFailed": "The registry could not be asked: {reason}",
  "inbox.noRegistry":
    "The registry URL is not set yet. Set it under Help someone → A computer I can reach first.",
  "inbox.state.unknown": "Not asked yet",
  "inbox.state.reachable": "Reachable",
  "inbox.state.noAddress": "No address",
  "inbox.state.revoked": "Revoked",
  "inbox.state.error": "Could not ask",
  "inbox.detail.unknown": "This number has not been looked up in the registry yet.",
  "inbox.detail.reachable": "It published an address, so a helper can dial it.",
  "inbox.detail.noAddress":
    "It is registered but has published no address. Switch on unattended access there.",
  "inbox.detail.revoked": "The operator revoked this device, so it will not answer.",
  "inbox.detail.error": "The registry could not be asked about this number.",

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
  "gethelp.statusReady": "Ready to help",
  "gethelp.statusWaiting": "Waiting for your helper…",
  "gethelp.statusConnected": "Your helper is connected",
  "gethelp.statusError": "Sharing could not be prepared",
  "gethelp.statusDetails": "Connection details",
  "gethelp.getCode": "Get a code",
  "gethelp.createInvitation": "Create invitation",
  "gethelp.copyCode": "Copy code",
  "gethelp.copyMessage": "Copy share message",
  "gethelp.copyInvitation": "Copy the full invitation instead",
  "gethelp.fallbackInvitation": "Or use the full invitation",
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
    "After granting it, quit and reopen OraxDesk if sharing still fails.",
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
    "Let people you trust connect to this computer when nobody is here to approve. Off unless you switch it on. OraxDesk must be running for it to work.",
  "gethelp.allowUnattended": "Allow unattended access to this computer",
  "gethelp.idReachable": "This computer's ID, reachable now",
  "gethelp.helperEntersId":
    "A helper enters it as the computer ID, with the unattended password unless they were paired here.",
  "gethelp.autostart": "Start OraxDesk when I sign in, so it is ready",
  "gethelp.noPairedYet":
    "None yet. During a support session, choose Let them connect any time to pair the helper.",
  "gethelp.mayControl": "may control",
  "gethelp.toolsNote":
    "For a helper whose tools, such as OraxDesk's agents, work on this computer while you are away. Commands run as you.",
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
  "brand.tagline": "Connect. Control. Support.",
  "about.title": "About OraxDesk",
  "about.sectionsLabel": "About sections",
  "about.tabAbout": "About",
  "about.tabHelp": "Help",
  "about.tagline": "A fast, native remote desktop viewer for macOS, Windows and Linux.",
  "about.version": "Version {version}",
  "about.buildLabel": "Build details",
  "about.build": "Build",
  "about.copied": "Copied",
  "about.copyReport": "Copy report for a bug ticket",
  "about.openFailed": "Could not open the link in your browser.",
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

  // The session toolbar
  "session.controls": "Session controls",
  "session.showToolbar": "Show session toolbar ({chord}), drag to move",
  "session.dragToolbar": "Drag to move toolbar",
  "session.fullscreen": "Fullscreen ({hint})",
  "session.sendCtrlAltDel": "Send {combo} to the remote computer",
  "session.connectionStatus": "Connection status",
  "session.displays": "Displays",
  "session.pointers": "Pointers",
  "session.sendClipboard": "Send clipboard to remote",
  "session.fileTransfer": "File transfer (SFTP)",
  "session.checkingSsh": "Checking whether SSH is available on this computer…",
  "session.filesNeedSsh":
    "File transfer needs SSH on the remote computer, and it isn't reachable on this one",
  "session.terminal": "Terminal (SSH)",
  "session.terminalNeedSsh":
    "Terminal needs SSH on the remote computer, and it isn't reachable on this one",
  "session.viewOnlyOn": "View only: on, click to allow input",
  "session.viewOnlyOff": "View only: off, click to block input",
  "session.saveScreenshot": "Save screenshot",
  "session.requestRefresh": "Request full screen refresh",
  "session.unpin": "Unpin toolbar (allow auto-hide)",
  "session.pin": "Pin toolbar (stay visible)",
  "session.collapseToolbar": "Collapse toolbar ({chord})",
  "session.disconnect": "Disconnect (leaves the remote machine running)",
  "session.customZoom": "Custom zoom",
  "session.zoomPercent": "Zoom percentage",
  "session.zoom": "Zoom",
  "session.remoteResize": "Remote resize (match the window)",
  "session.rdpFixedSize":
    "View, then Resolution, also sets the remote desktop to a fixed size.",
  "session.lockZoom": "Lock zoom (ignore pinch)",
  "session.panByEdges": "Pan by moving to the edges",
  "session.remotePointer": "Remote pointer",
  "session.showRemotePointer": "Show the remote pointer",
  "session.myPointer": "My pointer",
  "session.cursorStandard": "Standard arrow",
  "session.cursorDot": "Dot",
  "session.cursorHidden": "Hidden",
  "session.allDisplays": "All displays",
  "session.splitThisDesktop": "Split this desktop",
  "session.singleDisplay":
    "This session is using a single display. Turn on “Use all of my monitors” in this computer's settings to use more.",
  "session.detectDisplays": "Detect displays again",
  "session.displaysUnknown":
    "This server does not say where its monitors meet: detection reads the picture, the other cuts are guesses by width.",
  "session.displaysUndescribed":
    "This server has not described its monitors, so the whole desktop is one display.",
  "session.displayRow": "Display {n} ({w}×{h})",
  "session.pictureVsResponse": "Picture vs response",
  "session.qualityAuto": "Auto — sharp when idle, faster under load",
  "session.qualitySharp": "Sharp — best picture, never adapts",
  "session.qualityResponsive": "Responsive — softer picture, lowest lag",
  "session.alwaysFresh": "Always request fresh frames",
  "session.alwaysFreshHint":
    "Re-fetches the whole screen every second instead of trusting the server to report what changed. Fixes a picture that stays stale or smeared; uses more bandwidth.",
  "session.grayLevels": "Gray levels",
  "session.oneBit": "1-bit (dithered)",
  "session.levels": "{n} levels",
  "session.passShortcuts": "Pass system shortcuts to remote",
  "session.sendToRemote": "Send to remote",
  "session.keyWindows": "Windows/Super key",
  "session.captureBadge": "System shortcuts are going to the remote. Press {chord} to release.",
  "session.captured": "Captured",
  "session.keyboard": "Keyboard",
  "session.keyboardCaptured":
    "Keyboard captured, system shortcuts go to the remote (release: {chord})",
  "session.keyboardNeedsPermission": "Keyboard: pass-through needs permission",
  "session.keyboardUnavailable": "Keyboard: pass-through unavailable, {reason}",
  "session.keyboardWaitingFocus": "Keyboard: pass-through waiting for focus",
  "session.capturedNote": "Captured. Press {chord} to release.",
  "session.needsAccessibility":
    "Needs Accessibility permission to intercept system shortcuts.",
  "session.howToEnable": "How to enable it",
  "session.activeWhileFocused": "Active only while this window is focused.",
  "session.sendsShortcutsMac":
    "Sends Cmd+Tab, Cmd+Space and other system shortcuts to the remote instead of this computer.",
  "session.sendsShortcuts":
    "Sends Alt+Tab, the Windows key and other system shortcuts to the remote instead of this computer.",
  "session.latency": "Latency",
  "session.throughput": "Throughput",
  "session.frameRate": "Frame rate",
  "session.decode": "Decode",
  "session.encoding": "Encoding",
  "session.received": "Received",
  "session.shed": "Shed",
  "session.shedCounts": "{rects} rects, {updates} updates",
  "session.statsLater": "Statistics arrive once the session reports them.",

  // The session state overlays
  "overlay.stageResolving": "Resolving",
  "overlay.stageConnecting": "Connecting",
  "overlay.stageAuthenticating": "Authenticating",
  "overlay.stageNegotiating": "Negotiating",
  "overlay.stagePreparing": "Preparing",
  "overlay.stillTrying":
    "Still trying. If that computer is off, asleep, or on a different network, this will keep failing. Check that it is awake, then reconnect.",
  "overlay.reconnectingTo": "Reconnecting to {name}… attempt {attempt}",
  "overlay.retryingIn": " · retrying in {secs}s",
  "overlay.retryingNow": " · retrying now",
  "overlay.disconnect": "Disconnect",
  "overlay.retryNow": "Retry now",
  "overlay.disconnectedFrom": "Disconnected from {name}",
  "overlay.reconnectAsksPassword":
    "Reconnecting asks for the password again instead of reusing the saved one.",
  "overlay.openSecurity": "Open this computer's security settings",
  "overlay.saveFirst":
    "Save this computer to your library first, then change the setting in its settings.",
  "overlay.reconnect": "Reconnect",
  "overlay.pressEsc": "Press Esc to close this window",

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

  // The agent connect window
  "agent.title": "AI agents",
  "agent.copy": "Copy",
  "agent.copied": "Copied",
  "agent.blocked": "Blocked",
  "agent.copyLine": "Copy this line",
  "agent.connectClaude": "Connect Claude Code",
  "agent.registerNote": "This registers the server for you. No terminal, nothing to copy.",
  "agent.connecting": "Connecting…",
  "agent.tryAgain": "Try again",
  "agent.connect": "Connect",
  "agent.setupTitle": "OpenCode, Pi, Claude Code and Codex",
  "agent.setupNote":
    "Connected automatically each time OraxDesk starts. Installed a new agent just now? Connect it without restarting.",
  "agent.connectNow": "Connect now",
  "agent.setupFailed":
    "This build cannot run setup. Run dvv setup in a terminal instead.",
  "agent.canDo": "What an agent can do",
  "agent.byHand": "Do it by hand, or connect a different agent",
  "agent.stepRegister": "Register it yourself",
  "agent.stepHttp": "Or reach it over HTTP",
  "agent.stepCheck": "Check it",
  "agent.httpNoteLead": "Starts a listener on",
  "agent.httpNoteTail":
    " and prints the line below with your token already in it. Loopback only, and it needs the token even there, because any page your browser has open can reach a port on this machine.",
  "agent.doctorNote":
    "It prints the socket path and whether it is present. Present means this application is running with the plane on, which is what an agent needs.",
  "agent.thenAsk":
    "Then ask your agent to open one of your machines by name. It reads the same library you see here.",
  "agent.planeOn": "The plane is on.",
  "agent.canOpen": "Open one of your saved machines. The credential comes from the keychain, and the agent neither supplies it nor sees it.",
  "agent.canDrive": "Drive it and watch itself work: pointer, keyboard, clipboard, and the screen.",
  "agent.canRun": "Run a command over SSH and read the output back, with the exit code it really got.",
  "agent.canHandBack": "Hand control back the instant you want it. Clicking a pane, or pressing stop, takes the lease.",
  "agent.cannotAnswer": "Answer a password or a certificate prompt. Those stay yours.",
  "agent.boundaryWhy": "That one is deliberate and it is not going to change. An agent that could type a secret it read off a screen would leave a record saying you approved it, and a record that says the wrong thing is worse than none.",
  "diagnose.cancelled": "Authentication was cancelled. Reconnect to try again.",
  "diagnose.ntlmRefused": "This computer's domain does not accept the sign-in method this version uses. An administrator has set “Restrict NTLM: Incoming NTLM traffic” or raised “LAN Manager authentication level” on the remote computer, so it will only accept Kerberos. Kerberos sign-in is coming in a later release. Until then this computer can be reached from a client that speaks Kerberos, or an administrator can allow NTLM for it.",
  "diagnose.nlaRefused": "The computer refused network level authentication. If it is an older or non-Windows server, turn on “Allow connecting without network level authentication” in this computer's settings.",
  "diagnose.legacyTlsRequired": "This computer only offers TLS 1.0 or 1.1 to encrypt the connection, and this app does not use those versions unless you say so. That is normal for a Windows 7 or Server 2008 R2 machine that was never updated. To connect anyway, edit this computer, open Advanced, then Security, and tick “Allow legacy TLS (1.0 and 1.1)”. Read what it says there first: those versions are weak, and that is the reason it is off by default.",
  "diagnose.legacyTlsUnavailable": "This computer only offers TLS 1.0 or 1.1, and this copy of the app was built without support for them, so the setting you turned on cannot be used. A build that includes legacy TLS support will connect. Nothing you change here will help, and nothing is wrong with the computer you are connecting to.",
  "diagnose.unknownHostKey": "This machine has not been trusted yet, so the connection stopped rather than trusting it silently. Reconnect to see its fingerprint and decide.",
  "diagnose.hostKeyChanged": "This machine is presenting a different SSH identity than the one you trusted before. That can mean it was reinstalled, or that something is sitting in the middle of the connection, and there is no way to tell which from here, so the connection was refused. If you know the key legitimately changed, forget the saved key for this machine and connect again.",
  "diagnose.securityRefused": "The computer answered, but it would not use a security method this version speaks. It may be an old server, or one whose policy forbids the sign-in this app offers.",
  "diagnose.refused": "Connection refused, nothing is listening on that port.",
  "diagnose.timedOut": "The computer didn't respond, it may be asleep, off, or unreachable from this network.",
  "diagnose.badPassword": "Incorrect password, the server did not accept it.",
  "diagnose.tlsUnverified": "The secure connection could not be verified.",
  "diagnose.reset": "The connection was closed by the other side.",
  "diagnose.ended": "The connection ended.",
  "diagnose.endedWith": "{reason}",
  "agent.binaryMissing": "This build is not reporting where dvv is. The path comes from inside the application bundle, and a development build does not have one. Run dvv doctor on a copy that does and it prints these lines with the real path already in them.",
  "agent.turnOff": "Turn it off",
  "agent.turnOffTitle":
    "Close the socket and unlink it. Every agent loses its connection at once.",
  "agent.offIntro":
    "An agent can open your machines, drive them and read the screen, while you watch and take over whenever you want.",
  "agent.offWhy":
    "It is off because it was switched off on this computer. While it is off there is no socket, nothing is listening, and your agents cannot reach your machines.",
  "agent.startFailed": "The last attempt to start it failed: {reason}",
  "agent.turnBackOn": "Turn it back on",
  "agent.oneSocket": "One socket, on this computer only. Nothing opens on the network.",

  // The certificate prompt
  "cert.changedTitle": "Server identity has CHANGED",
  "cert.changedBody":
    "is presenting a different certificate than the one you trusted before. This can mean the server was reinstalled, or that someone is intercepting your connection.",
  "cert.changedWarning": "Do not continue unless you know why this changed.",
  "cert.changedRdp":
    "A Windows reinstall, or a new machine certificate after a domain change, both look exactly like this. So does an attacker. Do not continue unless you know which it is.",
  "cert.typeToProceed": "To proceed anyway, type",
  "cert.trustNewIdentity": "Trust new identity",
  "cert.cancelRecommended": "Cancel (recommended)",
  "cert.verifyTitle": "Verify {host}",
  "cert.firstTimeRdp":
    "Windows Remote Desktop normally identifies itself with a certificate it generated for itself, so on a fresh machine there is nothing to compare this against. Remembering it now means you will be told if it ever changes.",
  "cert.firstTime":
    "This is the first time this computer has identified itself with the key below. Verify the fingerprint matches the one shown on the server, then choose how much to trust it.",
  "cert.connectOnce": "Connect once",
  "cert.trustComputer": "Trust this computer",
  "cert.fingerprintWords": "Fingerprint words:",
  "cert.fingerprintAria": "SHA-256 certificate fingerprint",

  // The credential prompt
  "cred.title": "Authentication required",
  "cred.needsWindowsSignIn": "needs your Windows sign-in before it will let you in.",
  "cred.needsUserAndPassword":
    "needs a user name and password before it will let you in.",
  "cred.needsPassword": "needs a password before it will let you in.",
  "cred.wrongPassword": "Incorrect password. Try again.",
  "cred.attempt": "Attempt {attempt}",
  "cred.vncTruncation":
    "This server uses legacy VNC authentication, only the first {count} characters are used.",
  "cred.remember": "Remember for this computer",
  "cred.rememberSavedOnly": "Saved only if this password works.",

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
    "Enter the 64 character ID shown under Unattended access in OraxDesk Support",

  // The library
  "library.wakeNeedsMac": "This computer has no MAC address saved, so it cannot be woken.",
  "library.rowSelected": "selected",

  // The library: the bar across the top
  "library.searchPlaceholder": "Search or press {chord}K",
  "library.searchAria": "Search hosts",
  "library.sort": "Sort",
  "library.sortAria": "Sort hosts",
  "library.sortLastConnected": "Last connected",
  "library.sortMostUsed": "Most used",
  "library.viewMode": "View mode",
  "library.gridView": "Grid view",
  "library.listView": "List view",
  "library.sessionsWhere": "Where sessions open",
  "library.sessionsInWindows": "Open sessions in their own windows",
  "library.sessionOwnWindow": "Open each session in its own window",
  "library.sessionsAsTabs": "Open sessions as tabs in this window",
  "library.livePreviews": "Live previews",
  "library.livePreviewsHint":
    "Live previews, tiles with an active session show a live picture instead of the saved thumbnail",
  "library.scanning": "Scanning…",
  "library.aboutAndHelp": "About and help",

  // The library: the empty states
  "library.emptyTitle": "How do you want to start?",
  "library.emptyBody":
    "Do you need help on this computer, or are you helping someone else? You can also find your computers on the network and add them.",
  "library.findOnNetwork": "Find computers on my network",
  "library.addComputerManually": "Add a computer manually",
  "library.noMatch": "No computers match “{search}”",
  "library.addAsHost": "Add “{search}” as a new host",
  "library.nearbyHeading": "Nearby, not yet saved",
  "library.nothingDiscovered": "Nothing discovered yet",
  "library.nothingDiscoveredBody":
    "Some computers don't advertise themselves on the network. You can actively scan this subnet, or add a computer by address.",
  "library.scanThisNetwork": "Scan this network",
  "library.addManually": "Add manually",

  // The library: the selection bar
  "library.selectedCount": "{count} hosts selected",
  "library.dragHint": "Drag onto a group or tag in the sidebar, or:",
  "library.moveToGroupAria": "Move selected hosts to a group",
  "library.moveTo": "Move to…",
  "library.addTagAria": "Add a tag to the selected hosts",
  "library.addTag": "Add tag…",
  "library.clearSelection": "Clear selection",
  "library.hostsCount": "{count} hosts",
  "library.hostWord": "host",

  // The library: the list view
  "library.hosts": "Hosts",
  "library.colProtocol": "Protocol",
  "library.online": "Online",
  "library.offline": "Offline or unknown",

  // The library: making a group or a tag
  "library.newGroup": "New Group",
  "library.newTag": "New Tag",
  "library.groupPlaceholder": "Office",
  "library.tagPlaceholder": "prod",
  "library.groupNameAria": "group name",
  "library.tagNameAria": "tag name",
  "library.tagColorAria": "Tag color",
  "library.colorAria": "Color {color}",
  "library.create": "Create",

  // The library: the context menus
  "library.menuEdit": "Edit…",
  "library.menuConnectNewTab": "Connect in new tab",
  "library.menuConnectNewWindow": "Connect in new window",
  "library.menuAddFavorite": "Add to Favorites",
  "library.menuRemoveFavorite": "Remove from Favorites",
  "library.copyName": "{name} copy",
  "library.menuDuplicate": "Duplicate",
  "library.menuWake": "Wake (Wake-on-LAN)",
  "library.menuReloadThumbnail": "Reload thumbnail",
  "library.menuForgetKey": "Forget saved key…",
  "library.menuDelete": "Delete…",
  "library.menuOpenGrid": "Open as grid",
  "library.menuOpenGridSaved": "Open as grid (saved layout)",
  "library.menuSaveLayout": "Save this layout to group",
  "library.menuForgetLayout": "Forget saved layout",
  "library.menuRemoveFromGroup": "Remove {count} hosts from their group",
  "library.menuMoveTo": "Move to {group}",
  "library.menuTagWith": "Tag with {tag}",
  "library.menuDeleteMany": "Delete {count} hosts…",

  // The library: the command palette
  "library.paletteGoTo": "Go to {title}",
  "library.paletteConnectAddress": "Connect to an address…",
  "library.paletteSwitchList": "Switch to list view",
  "library.paletteSwitchGrid": "Switch to grid view",
  "library.paletteRefresh": "Refresh library",
  "library.paletteHelp": "Help & keyboard shortcuts",

  // The library: what the app says
  "library.connectFailed": "Could not connect to {name}: {reason}",
  "library.alreadyOpen": "{name} is already open, brought it to the front",
  "library.connectingTo": "Connecting to {address}",
  "library.connectingToPort": "Connecting to {address} on port {port}",
  "library.lookingUpNumber": "Looking up number {number}…",
  "library.numberNeedsRegistry":
    "A nine-digit number needs the OraxDesk registry. Set the registry URL under Help someone → A computer I can reach first.",
  "library.numberLookupFailed":
    "Could not look up {number}. Check the registry connection and try again.",
  "library.numberNotRegistered":
    "No device is registered with that number. Ask the person there to open and update OraxDesk, then try again.",
  "library.groupEmpty": "{group} has no hosts in it yet",
  "library.groupLayoutChanged":
    "{group} has changed since its layout was saved; opened what still matches",
  "library.openGridFirst": "Open a group as a grid first, then save how you arranged it",
  "library.layoutSaved": "Saved this arrangement to {group}",
  "library.layoutForgotten": "{group} will open as a plain grid from now on",
  "library.undoFailed": "Could not undo: {reason}",
  "library.notInGroupOne": "{hosts} is not in a group",
  "library.notInGroupMany": "{hosts} are not in a group",
  "library.removedFromGroup": "Removed {hosts} from their group",
  "library.moveFailed": "Could not move those hosts: {reason}",
  "library.alreadyInGroup": "{hosts} already in {group}",
  "library.movedToGroup": "Moved {hosts} to {group}",
  "library.alreadyTagged": "{hosts} already tagged {tag}",
  "library.taggedWith": "Tagged {hosts} with {tag}",
  "library.tagFailed": "Could not tag those hosts: {reason}",
  "library.added": "Added {name}",
  "library.removeFailed": "Could not remove that: {reason}",
  "library.saveFailed": "Could not save {name}: {reason}",
  "library.savedWithoutPassword": "{name} was saved, but its password was not: {reason}",
  "library.hostUpdated": "Host updated",
  "library.deleteFailed": "Could not delete {name}: {reason}",
  "library.deletedMany": "Deleted {count} hosts. Saved passwords are gone.",
  "library.restoreFailed": "Could not restore those hosts: {reason}",
  "library.duplicateFailed": "Could not duplicate {name}: {reason}",
  "library.magicPacketSent": "Magic packet sent to {name}",
  "library.wakeFailed": "Could not wake {name}: {reason}",
  "library.forgotKey":
    "Forgot the saved key for {name}. You will be asked to verify it on the next connection.",
  "library.forgetKeyFailed": "Could not forget the saved key for {name}: {reason}",
  "library.alreadyInLibrary": "This machine is already saved as {name}.",
  "library.selectOneToConnect": "Select one machine to connect to.",
  "library.selectOneToWake": "Select one machine to wake.",
  "library.hostGone": "That machine is no longer in your library.",
  "library.deleted": "Deleted {name}",
  "library.groupCreated": "Created the group {name}",
  "library.tagCreated": "Created the tag {name}",
  "library.groupCreateFailed": "Could not create the group: {reason}",
  "library.tagCreateFailed": "Could not create the tag: {reason}",
  "library.undo": "Undo",
  "library.add": "Add",
  "library.edit": "Edit",

  "files.allowFolder": "Allow a folder",
  "files.title": "Files, {host}",
  "files.close": "Close files",
  "files.localPane": "Local",
  "files.remotePane": "Remote, {host}",
  "files.upload": "Upload →",
  "files.uploadTitle":
    "Upload the selected local files (or choose files) to the remote folder",
  "files.uploadTitleDisconnected": "Connect the file-transfer channel first",
  "files.download": "← Download",
  "files.downloadTitle": "Download the selected remote files into the local folder",
  "files.newFolder": "New folder",
  "files.renameF2": "Rename (F2)",
  "files.delete": "Delete",
  "files.keysHint":
    "Enter opens · Backspace goes up · Ctrl/⌘+A selects all · F2 renames · Del removes",
  "files.newFolderLocal": "New folder in the local folder",
  "files.newFolderRemote": "New folder in the remote folder",
  "files.rename": "Rename",
  "files.badName":
    "A name cannot be empty, contain a slash, or be “.” or “..”.",
  "files.deleteOne": "Delete 1 item on {where}?",
  "files.deleteMany": "Delete {count} items on {where}?",
  "files.deleteWhereLocal": "this computer",
  "files.deleteWarn":
    "Folders are removed with everything inside them. This cannot be undone.",
  "files.colName": "Name",
  "files.colSize": "Size",
  "files.colModified": "Modified",
  "files.showHidden": "Show hidden files",
  "files.hideHidden": "Hide dot-files",
  "files.locationAria": "{pane} location",
  "files.filesAria": "{pane} files",
  "files.notConnected": "The file-transfer channel is not connected.",
  "files.loading": "Loading…",
  "files.emptyFolder": "This folder is empty.",
  "files.itemOne": "1 item",
  "files.itemMany": "{count} items",
  "files.selectedCount": "{count} selected",
  "files.transfers": "Transfers",
  "files.activeCount": " ({count} active)",
  "files.clearCompleted": "Clear completed",
  "files.noTransfers":
    "No transfers yet. Drag files onto the session window, or use Upload / Download.",
  "files.cancelTransfer": "Cancel transfer of {name}",
  "files.done": "Done · {size}",
  "files.cancelled": "Cancelled",
  "files.firstConnection": "First connection to {host}:{port}",
  "files.sshUnknown":
    "This computer's SSH identity has not been seen before. Check the fingerprint against the server before trusting it.",
  "files.trustAndConnect": "Trust and connect",
  "files.identityChanged": "The SSH identity of {host}:{port} has changed",
  "files.transferBlocked":
    "File transfer is blocked. This is either a reinstalled server or someone intercepting the connection, there is no “continue anyway”. Verify the new key out of band and remove the stored pin before reconnecting.",
  "files.expected": "expected",
  "files.dropOne": "Drop to send 1 file to {host}",
  "files.dropMany": "Drop to send {count} files to {host}",

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
    "Shown under Unattended access in OraxDesk Support on that computer. If you are not paired, the person there approves you, or you use the password below.",
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
  "host.protocolNameBoundary": "OraxDesk Support (remote help)",
  "host.protocolNameRdp": "Remote Desktop (RDP)",
  "host.protocolNameSsh": "Terminal (SSH)",
  "host.protocolNameVnc": "Screen sharing (VNC)",

  // Preferences
  "prefs.title": "Preferences",
  "prefs.sectionsAria": "Preference sections",
  "prefs.closeAria": "Close preferences",
  "prefs.tabGeneral": "General",
  "prefs.tabAppearance": "Appearance",
  "prefs.tabConnections": "Connections",
  "prefs.tabSession": "Session",
  "prefs.tabInput": "Input",
  "prefs.tabClipboard": "Clipboard",
  "prefs.tabFiles": "Files",
  "prefs.tabSecurity": "Security",
  "prefs.tabNetwork": "Network",
  "prefs.tabAgents": "Agents",

  // Preferences: general
  "prefs.confirmDisconnect": "Confirm before disconnecting",
  "prefs.confirmDisconnectHint": "Ask before ending a session from the toolbar",
  "prefs.captureThumbs": "Capture thumbnails",
  "prefs.livePreviewsHint":
    "While a session is connected, its library tile shows a live picture (about 2 frames per second) instead of the saved thumbnail",
  "prefs.captureThumbsHint":
    "Save a small screenshot of each host after connecting, for the library grid",
  "prefs.compactDensity": "Compact library density",
  "prefs.compactDensityHint": "Smaller tiles and tighter spacing for large libraries",

  // Preferences: appearance
  "prefs.theme": "Theme",
  "prefs.themeHint": "Follow System switches automatically with your OS",
  "prefs.themeSystem": "Follow System",
  "prefs.themeLight": "Light",
  "prefs.themeDark": "Dark",

  // Preferences: connections
  "prefs.tabsInOneWindow": "Show sessions as tabs in one window",
  "prefs.tabsInOneWindowHint":
    "Connected computers become tabs across the top of this window, switched between like browser tabs, instead of each opening a window of its own. Sessions already running stay where they are; this decides where the next one goes.",
  "prefs.multipleTabs": "Allow more than one tab per computer",
  "prefs.multipleWindows": "Allow more than one window per computer",
  "prefs.multipleTabsHint":
    "Normally, connecting to a computer you're already connected to selects the tab it is in instead of starting a second session. Turn this on to open a separate tab every time.",
  "prefs.multipleWindowsHint":
    "Normally, connecting to a computer you're already connected to brings that window back to the front instead of starting a second session. Turn this on to open a separate window every time.",
  "prefs.sharpenOnStop": "Sharpen the picture when motion stops",
  "prefs.sharpenOnStopHint":
    "During movement the image is compressed hard so it stays instant; a moment after things settle, the affected area is repainted at full quality. Turn this off on a metered connection to keep the saved bandwidth.",
  "prefs.rdpDefaults": "Remote Desktop defaults",
  "prefs.allMonitors": "Use all my monitors for new Remote Desktop connections",
  "prefs.allMonitorsHint":
    "New hosts start with every local monitor attached. Existing hosts keep whatever you set on them.",
  "prefs.resolutionForNew": "Resolution for new Remote Desktop hosts",
  "prefs.resolutionForNewHint":
    "Matching the window when connecting is what Windows' own client does. Making it keep matching resizes the remote desktop every time you resize this one, which rearranges that machine's icons each time.",
  "prefs.playRemoteSound": "Play remote sound on this computer",
  "prefs.playRemoteSoundHint":
    "Sound from the remote computer is redirected here rather than left playing there.",
  "prefs.shareClipboardRdp": "Share my clipboard with Remote Desktop connections",
  "prefs.shareClipboardRdpHint": "Copy and paste text in both directions.",
  "prefs.reconnectForever": "Reconnect until I close the window",
  "prefs.reconnectForeverHint": "Keep retrying dropped sessions with exponential backoff",
  "prefs.wolDuringRetry": "Send Wake-on-LAN during retries",
  "prefs.wolDuringRetryHint":
    "If a host with a saved MAC address looks down, send a magic packet while reconnecting",

  // Preferences: session
  "prefs.hideToolbar": "Hide the floating toolbar",
  "prefs.hideToolbarHint":
    "Leave nothing on top of the remote desktop. Everything the toolbar does stays available from the View and Session menus, which show what each session is set to.",
  "prefs.newDefaults": "Defaults for new computers",
  "prefs.newDefaultsHint":
    "Where a computer starts before you have adjusted anything on it. Change one of these while connected, from the toolbar or the menus, and it is remembered against that computer from then on, including which monitor you picked.",
  "prefs.scalingHint": "How the remote desktop is fitted into the window",
  "prefs.qualityHint":
    "Auto infers the link from throughput; the others say what the link is and stop it adapting",
  "prefs.qualityHigh": "High",
  "prefs.qualityMedium": "Medium",
  "prefs.qualityLow": "Low",
  "prefs.grayLevelsHint": "How many shades the black-and-white preset keeps",
  "prefs.zoomLockedHint":
    "Ignore pinch-to-zoom, which is easy to trigger by accident mid-scroll on a trackpad. The zoom controls still work.",
  "prefs.edgePanHint":
    "Scroll the view when the pointer reaches an edge, for a desktop larger than the window. With this off, the part of the screen past the edge can only be reached by space-dragging.",
  "prefs.passShortcutsHint":
    "Send Cmd/Alt+Tab, Cmd+Space and the Windows key to the remote computer instead of this one. Needs Accessibility permission on macOS, and grabs your keyboard while a session is focused; release it at any time with Ctrl+Alt+Shift+Esc.",
  "prefs.viewOnly": "Start in view only",
  "prefs.showRemotePointerHint":
    "Draw the remote machine's own mouse cursor. Turn this off if two pointers feel distracting, your input is sent either way.",
  "prefs.viewOnlyHint":
    "Watch without sending any input. Nothing you type or click reaches the remote computer until you turn it off.",
  "prefs.pointerHint":
    "The system arrow covers the pixels under its own tip, which is where the remote pointer sits, so with both drawn they crowd each other. Dot is a ring centred on the hotspot; Hidden leaves only the remote pointer.",

  // Preferences: input
  "prefs.matchScroll": "Match my scroll direction",
  "prefs.matchScrollHint":
    "Scroll the remote desktop the way this computer scrolls, whatever your trackpad and mouse settings say. Turn it off to reverse the direction on the remote only.",
  "prefs.matchKeyboard": "Match my local keyboard layout",
  "prefs.matchKeyboardHint":
    "Keys type what they type on this keyboard, instead of what the remote machine's layout assigns to the same physical key. Only matters when the two layouts differ.",
  "prefs.typeDictation": "Type text inserted by dictation tools",
  "prefs.typeDictationHint":
    "Text that dictation and automation software inserts without pressing keys is typed into the remote desktop. Accents and CJK input methods work either way, those are you typing.",
  "prefs.typeLocalPaste": "Type a paste that stays on this Mac into the remote",
  "prefs.typeLocalPasteHint":
    "When Cmd+V is left to macOS (system shortcuts not passed through) or you pick Edit ▸ Paste, the clipboard text is typed into the remote desktop key by key. Dictation tools that paste, such as Wispr Flow, need this on.",

  // Preferences: clipboard
  "prefs.clipboardSync": "Sync clipboard automatically",
  "prefs.clipboardSyncHint": "Text copied on either side is available on the other",
  "prefs.clipboardOnFocus": "Push clipboard when the window gains focus",
  "prefs.clipboardOnFocusHint":
    "Send your local clipboard to the remote when you switch back to the session",
  "prefs.clipboardOnPaste": "Push clipboard when pasting into the remote",
  "prefs.clipboardOnPasteHint":
    "Cmd/Ctrl+V sends your local clipboard first, so the remote pastes what you copied most recently",

  // Preferences: files
  "prefs.confirmOverwrite": "Confirm before overwriting files",
  "prefs.confirmOverwriteHint": "Ask when a transfer would replace an existing file",

  // Preferences: security
  "prefs.credentialStorage": "Credential storage",
  "prefs.credentialsIn": "Passwords are stored in: {backend}",
  "prefs.credentialsKeychain":
    "Passwords are stored in your operating system keychain, never in a file.",
  "prefs.strictPinning": "Strict certificate pinning",
  "prefs.strictPinningHint":
    "Refuse to connect when a server's certificate changes, until you explicitly re-trust it",

  // Preferences: network
  "prefs.deepNames": "Look up names from other services",
  "prefs.deepNamesHint":
    "Some Windows machines block every name service. Reading the name they publish on RDP or RPC names them anyway, but it means connecting briefly to ports you are not connecting through, which strict network monitoring may flag. Turn off to use name services only.",
  "prefs.probeRdp": "Look for Remote Desktop while scanning",
  "prefs.probeRdpHint":
    "Also tries port 3389 on each address, so a Windows machine that runs no VNC server still appears. One extra connection per address, at the same polite rate as the rest of the scan.",
  "prefs.mdns": "Discover computers automatically (mDNS/Bonjour)",
  "prefs.mdnsHint": "Listen for VNC servers advertising themselves on your local network",
  "prefs.probeOnline": "Probe saved hosts for online status",
  "prefs.probeOnlineHint":
    "A lightweight, throttled TCP check that powers the green dot on tiles",

  // Preferences: agents
  "prefs.hideAgentCounts": "Hide the agent counts",
  "prefs.hideAgentCountsHint":
    "Take the line reading how many agents are connected, and how much of this computer they are driving, off the activity strip. The strip itself still appears while an agent is driving something, with a card per machine, and this switch stays here.",
  "prefs.rightNow": "Right now",
  "prefs.rightNowHint":
    "Driving means an agent holds the lease on that machine. An agent that is connected but holds nothing is driving nothing, and is counted only in the first number.",
  "prefs.agentsSidebarNote":
    "AI Agents, in the library sidebar, has the lines to paste, the check to run, and the switch that turns all of this off again.",

  // Setting up a provider: Tailscale and Cloudflare
  "provider.summary": "Set up my private infrastructure",
  "provider.intro":
    "Install and connect this helper device to your own provider account. Run setup in Boundary on the recipient device as well, then create a new invitation.",
  "provider.label": "Provider",
  "provider.cloudflareTeam": "Cloudflare team name",
  "provider.configureAccount": "Configure my account through the Cloudflare API",
  "provider.accountId": "Account ID",
  "provider.enrollmentEmails": "Enrollment emails, separated by commas",
  "provider.configureBody":
    "Creates an email enrollment policy and private Mesh device profile, and enables device connectivity for the account. Existing access policies still apply.",
  "provider.tailscaleAuthKey":
    "Device auth key (optional, leave empty for browser login)",
  "provider.cloudflareToken": "Scoped Cloudflare API token",
  "provider.installNote":
    "The official client is installed if missing. Complete provider login and operating system permission prompts when they appear. Windows setup adds a UDP firewall rule limited to this app and the private provider network.",
  "provider.consent": "Install the client and apply the setup described above",
  "provider.installAndConnect": "Install and connect",
  "provider.removePolicy":
    "Remove this deployment's Cloudflare enrollment policy and device profile. This can interrupt access.",
  "provider.removeResources": "Remove Boundary account resources",
  "provider.cancelSetup": "Cancel setup",
  "provider.statusFailed":
    "Could not read setup status. Reopen this dialog to reconnect.",
  "provider.verifyNote":
    "A local connection check is followed by an actual Boundary session to verify the complete route. Private invitations disable public relay fallback.",
  "common.done": "Done",
  "common.close": "Close",
  "common.tryAgain": "Try again",
  "common.dismiss": "Dismiss notification",
  "common.closeDialog": "Close dialog",
  "common.closeTerminal": "Close terminal",
  "common.closePane": "Close this pane",
  "common.resizePanes": "Resize panes",
  "common.restorePane": "Restore pane: {title}",
  "common.maximisePane": "Maximise pane: {title}",
  "common.connecting": "Connecting",
  "common.reconnecting": "Reconnecting",
  "common.openSessions": "Open sessions",
  "common.passwordSaved": "Password saved",
  "common.moveSessionHere": "Move a connected session here",
  "common.choosePane": "Choose what to show in this pane",
  "common.searchHosts": "Search hosts, or type an address",
  "common.commandPalette": "Command palette",
  "common.commandPalettePlaceholder": "Connect to a host or run a command…",
  "common.noPaletteMatch": "No matches for “{query}”",
  "common.librarySections": "Library sections",
  "common.nearby": "Nearby",
  "common.allHosts": "All Hosts",
  "common.favorites": "Favorites",
  "common.recents": "Recents",
  "common.groups": "Groups",
  "common.tags": "Tags",
  "common.newGroup": "New group",
  "common.newTag": "New tag",
  "common.noGroups": "No groups yet",
  "common.noTags": "No tags yet",
  "common.makeGroupFirst": "Make a group first, then drop hosts on it",
  "common.makeTagFirst": "Make a tag first, then drop hosts on it",
  "common.dropToUngroup": "Drop here to remove these hosts from their group",
  "common.dropToTag": "Drop here to tag with {tag}",
  "common.tagFilterMode": "Tag filter mode: {mode}. Click to toggle.",
  "common.tagFilterTitle": "Toggle whether hosts must match ALL selected tags (AND) or ANY (OR)",
  "common.aiAgents": "AI Agents",
  "common.preferences": "Preferences",
  "common.alreadyOpenWindow": "{name} is already open in a window of its own",
  "common.tabDriven": "{status}, agent driving",
  "common.online": "Online",
  "common.unreachable": "Unreachable",
  "common.statusUnknown": "Status unknown",
  "common.osUnknown": "Operating system not identified",
  "host.osWindowsResolved": "Windows, name resolved via {via}, which only a Windows machine answers",
  "host.osInferred": "{os}, inferred from what it answers on the network",
  "common.library": "Library",
  "common.nothingMatches": "Nothing matches. Press Enter to connect to it as an address.",
  "common.noSavedHosts": "No saved hosts yet.",
  "common.closePaneTitle": "Close this pane",
  "common.closePaneAria": "Close pane: {title}",
  "onboarding.saveLabel": "Save…",
  "onboarding.noDiscovered":
    "No discovered computers to pre-fill, use \"+ New Host\" in the library instead.",
  "session.reconnected": "Reconnected",
  "session.screenshotSaved": "Screenshot saved",
  "session.clipboardUnreadable": "Could not read the local clipboard",
  "session.clipboardSent": "Clipboard sent to remote",
  "session.connectionInfo": "Connection info",
  "session.bell": "Bell",
  "session.sendingFiles": "Sending files ({count}) to {target}",
  "pane.connectFailed": "Could not connect to {label}: {reason}",
  "pane.connectFailedGeneric": "Could not connect: {reason}",
  "ssh.reattached": "Reattached to your {multiplexer} session",
  "sshHostKey.previouslyTrusted": "Previously trusted",
  "sshHostKey.presentedNow": "Presented now",
  "sshHostKey.changedTitleGateway": "SSH gateway identity has CHANGED",
  "sshHostKey.changedTitle": "This machine's identity has CHANGED",
  "sshHostKey.changedBody": "The SSH server at {endpoint} is presenting a different host key than the one you trusted before. This can mean the machine was reinstalled, or that someone is intercepting your connection. The connection was refused. If you know the key legitimately changed, remove the saved key for this machine and connect again.",
  "sshHostKey.verifyGatewayTitle": "Verify SSH gateway {host}",
  "sshHostKey.verifyTitle": "Verify {host}",
  "sshHostKey.gatewayBody": "Your connection will be tunnelled through the SSH server at {endpoint}, and this is the first time it has identified itself.",
  "sshHostKey.firstBody": "This is the first time {endpoint} has identified itself, so there is nothing saved to compare it against yet.",
  "sshHostKey.verifyHint": "Verify the fingerprint below matches the server's ({command}) before trusting it.",
  "sshHostKey.hostKey": "host key",
  "sshHostKey.trust": "Trust and connect",
  "sshHostKey.fingerprintAria": "{label} SSH fingerprint",
  "session.problemTitle": "This session ran into a problem",
  "session.problemBody": "The connection has been closed. Nothing was saved from this session.",
  "session.closeTab": "Close tab",
  "session.remoteDesktopAria": "Remote desktop: {name}",
  "session.closeTabAria": "Close {title}",
  "ssh.disconnect": "Disconnect",
  "tabs.newPane": "New pane",
  "pane.session": "Session",
  "pane.noSession": "No session",
  "pane.empty": "Empty pane",
  "session.closeWindow": "Close window",
  "ssh.authenticating": "Authenticating ({method})",

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
    // The shell's own menu bar and tray are built in Rust before this window
    // exists, so they learn the language from here: the settings table keeps
    // it for the next launch, and both menus are rebuilt for this one. The
    // command is idempotent — sending the language that is already stored is
    // free, which matters because this also runs on every mount.
    void safeInvoke("set_ui_language", { lang }, null);
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
 * chose one, and ARABIC otherwise. The app's own default is Arabic, so a
 * component rendered on its own answers in the language the app would have
 * answered in: the fallback is not a second default, it is the SAME default
 * the provider starts with.
 */
export function useT(): I18n["t"] {
  const context = useContext(Context);
  const fallback = useMemo(() => translatorFor(rememberedLanguage() ?? "ar"), []);
  return context?.t ?? fallback;
}

/**
 * The language the interface is in.
 *
 * The same fallback rule as {@link useT}: the language the person chose, or
 * Arabic. It exists for the things a language decides and a string does not:
 * how a date is written, and how a number is grouped.
 */
export function useLang(): Lang {
  const context = useContext(Context);
  const fallback = useMemo(() => rememberedLanguage() ?? "ar", []);
  return context?.lang ?? fallback;
}
