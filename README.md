# 🛡️ Discord Protection Bot

بوت حماية ديسكورد جاهز للرفع على Railway.

## الميزات
- فلتر شتائم (عربي + إنجليزي) قابل للتخصيص
- حماية من الروابط الضارة
- Anti-Nuke أساسي
- أوامر سلاش سهلة

## الأوامر
| الأمر | الوظيفة |
|-------|--------|
| `/addword كلمة` | إضافة كلمة ممنوعة |
| `/removeword كلمة` | حذف كلمة |
| `/listwords` | عرض الكلمات الممنوعة |
| `/setlog #روم` | تحديد روم اللوقات |
| `/whitelist @شخص` | إضافة للقائمة البيضاء |
| `/unwhitelist @شخص` | إزالة من القائمة البيضاء |

## طريقة الرفع على Railway

1. ارفع هذا المجلد على GitHub أو ارفعه مباشرة
2. في Railway → New Project → Deploy from GitHub (أو Upload)
3. أضف Environment Variable:
   - الاسم: `TOKEN`
   - القيمة: توكن البوت من Discord Developer Portal
4. اضغط Deploy

## ملاحظات مهمة
- فعّل Message Content Intent و Server Members Intent في بوابة المطورين
- رتبة البوت لازم تكون أعلى من الرتب العادية
- البوت يحتاج صلاحية Administrator أو الصلاحيات المناسبة
