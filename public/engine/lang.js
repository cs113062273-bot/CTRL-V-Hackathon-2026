// Lightweight document-language detection (script ranges + stopword voting).

const STOPWORDS = {
  en: 'the and of to in is you that it for are with on as this be your at or have from by not we can all our will more',
  es: 'el la de que y en los las del se por un una para con no es su al lo como más pero sus le ya o este sí porque esta',
  fr: 'le la les de des et en un une du est pour que qui dans pas sur au avec vous nous ce il elle sont plus par',
  de: 'der die und das ist nicht ein eine zu den mit von sie auf für sich dem des im auch es an werden wir ihr bitte',
  pt: 'o a os as de que e do da em um uma para com não é no na por se dos das mais ao seu sua você',
  it: 'il di che e la per un una non sono del della con si le gli da in è al alla anche più questo',
  nl: 'de het een en van in is dat op te zijn voor met niet aan er ook als bij uw u wij worden',
  vi: 'và của là có không được cho các những trong một người với này để đã khi bạn chúng tôi',
  id: 'dan yang di ini untuk dengan tidak dari dalam akan pada adalah kami anda atau juga ke',
  tr: 've bir bu da de için ile ne çok daha gibi olarak ama sonra mi kadar şey var',
};
const SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

const SCRIPTS = [
  ['ja', /[぀-ヿ]/g],
  ['ko', /[가-힯]/g],
  ['zh', /[一-鿿]/g],
  ['ar', /[؀-ۿ]/g],
  ['he', /[֐-׿]/g],
  ['ru', /[Ѐ-ӿ]/g],
  ['el', /[Ͱ-Ͽ]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['th', /[฀-๿]/g],
];

/** Returns { lang, confidence } where confidence is 'high' | 'medium' | 'low'. */
export function detectLanguage(text) {
  const sample = String(text || '').slice(0, 20000);
  const letters = (sample.match(/\p{L}/gu) || []).length;
  if (letters < 20) return { lang: 'en', confidence: 'low' };
  // Kana implies Japanese even when Han characters dominate.
  const counts = SCRIPTS.map(([lang, re]) => [lang, (sample.match(re) || []).length]);
  const kana = counts[0][1];
  if (kana / letters > 0.05) return { lang: 'ja', confidence: 'high' };
  const top = counts.slice(1).sort((a, b) => b[1] - a[1])[0];
  if (top[1] / letters > 0.3) return { lang: top[0], confidence: 'high' };
  const words = sample.toLowerCase().match(/\p{L}+/gu) || [];
  const scores = Object.fromEntries(Object.keys(SETS).map(k => [k, 0]));
  for (const w of words) for (const k in SETS) if (SETS[k].has(w)) scores[k]++;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (best[1] === 0) return { lang: 'en', confidence: 'low' };
  const margin = best[1] / Math.max(1, second[1]);
  return { lang: best[0], confidence: best[1] >= 8 && margin > 1.5 ? 'high' : 'medium' };
}
