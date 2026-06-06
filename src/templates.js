// Egyptian Arabic message templates — personalized by business type
// Each template uses {name} and {type} placeholders

const typeMap = {
  // Food & Drinks
  'مطعم':     { possessive: 'مطعمك',     article: 'المطعم',     icon: '🍽️' },
  'كافيه':    { possessive: 'كافيهاتك',  article: 'الكافيه',    icon: '☕' },
  'قهوة':     { possessive: 'قهوتك',     article: 'القهوة',     icon: '☕' },
  'بيتزا':    { possessive: 'مطعمك',     article: 'المطعم',     icon: '🍕' },
  'حلواني':   { possessive: 'محلك',      article: 'المحل',      icon: '🍰' },
  'جزار':     { possessive: 'محلك',      article: 'المحل',      icon: '🥩' },
  // Beauty & Health
  'صالون':    { possessive: 'صالونك',    article: 'الصالون',    icon: '💇' },
  'كوافير':   { possessive: 'صالونك',    article: 'الصالون',    icon: '💅' },
  'سبا':      { possessive: 'سبا بتاعك', article: 'السبا',      icon: '🧖' },
  'عيادة':    { possessive: 'عيادتك',    article: 'العيادة',    icon: '🏥' },
  'دكتور':    { possessive: 'عيادتك',    article: 'العيادة',    icon: '👨‍⚕️' },
  'صيدلية':   { possessive: 'صيدليتك',  article: 'الصيدلية',   icon: '💊' },
  // Retail
  'محل':      { possessive: 'محلك',      article: 'المحل',      icon: '🏪' },
  'بوتيك':    { possessive: 'بوتيكك',   article: 'البوتيك',    icon: '👗' },
  'موبايل':   { possessive: 'محلك',      article: 'المحل',      icon: '📱' },
  'ملابس':    { possessive: 'محل الملابس بتاعك', article: 'المحل', icon: '👕' },
  'أحذية':    { possessive: 'محلك',      article: 'المحل',      icon: '👟' },
  // Services
  'مغسلة':   { possessive: 'مغسلتك',    article: 'المغسلة',    icon: '👔' },
  'نجار':     { possessive: 'شغلك',      article: 'الشغل',      icon: '🔨' },
  'سباك':     { possessive: 'شغلك',      article: 'الشغل',      icon: '🔧' },
  'كهربائي':  { possessive: 'شغلك',      article: 'الشغل',      icon: '⚡' },
  'مكتبة':    { possessive: 'مكتبتك',    article: 'المكتبة',    icon: '📚' },
  'جيم':      { possessive: 'الجيم بتاعك', article: 'الجيم',   icon: '💪' },
  'نادي':     { possessive: 'الجيم بتاعك', article: 'النادي',   icon: '🏋️' },
  // Default fallback
  'default':  { possessive: 'بيزنسك',    article: 'المحل',      icon: '🏢' },
};

function getTypeInfo(rawType) {
  if (!rawType) return typeMap['default'];
  const lower = rawType.trim();
  // Try exact match first
  if (typeMap[lower]) return typeMap[lower];
  // Try partial match
  for (const key of Object.keys(typeMap)) {
    if (lower.includes(key) || key.includes(lower)) return typeMap[key];
  }
  return typeMap['default'];
}

// Single message template
const templates = [
  (name, typeInfo) => `السلام عليكم معاك ليث من Craftsite.it.com احنا بنعمل ويبسايت احترافيه وباسعار ااقل من السوق شوف شغلنا في المواقع بتاعنا ولو عجبك اتواصل معانا`,
];

function generateMessage(businessName, businessType) {
  const typeInfo = getTypeInfo(businessType);
  const variant = templates[Math.floor(Math.random() * templates.length)];
  return variant(businessName, typeInfo);
}

module.exports = { generateMessage, typeMap };
