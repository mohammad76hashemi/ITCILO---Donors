/* KEYWORD DETECTION for the "Describe what you are looking for" box.
   ------------------------------------------------------------------
   No AI. The text a visitor writes is compared with the word lists
   below. When a word is found, the matching filter value counts as a
   keyword (for example "AIDS" → Sector: Health).

   To teach the explorer a new word, add it to the right list.
   - The value on the left must be spelled exactly like in donors.json.
   - Write words in lower case, singular is enough ("loan" also finds "loans").
   - Phrases work too ("civil society", "rule of law").
   - Every value that already exists in the data (including country
     names) is also found automatically, without being listed here.
   ------------------------------------------------------------------ */
window.DPE = window.DPE || {};

DPE.KEYWORDS = {
  sectors: {
    'Health': ['health', 'healthcare', 'hiv', 'aids', 'malaria', 'tuberculosis', 'tb', 'disease', 'medical', 'medicine', 'hospital', 'clinic', 'vaccine', 'vaccination', 'immunisation', 'immunization', 'maternal health', 'mental health', 'pandemic', 'epidemic', 'sante', 'salud'],
    'Education & skills': ['education', 'school', 'teacher', 'training', 'skill', 'literacy', 'vocational', 'tvet', 'university', 'student', 'learning', 'educacion'],
    'Agriculture & food security': ['agriculture', 'agricultural', 'farming', 'farmer', 'food', 'food security', 'crop', 'hunger', 'fishery', 'fisheries', 'livestock', 'agribusiness'],
    'Infrastructure & energy': ['infrastructure', 'energy', 'electricity', 'power', 'renewable', 'solar', 'road', 'transport', 'construction'],
    'Climate & environment': ['climate', 'environment', 'environmental', 'biodiversity', 'forest', 'conservation', 'pollution', 'ocean', 'nature'],
    'Governance & human rights': ['governance', 'human rights', 'democracy', 'rule of law', 'justice', 'corruption', 'accountability', 'election', 'rights'],
    'Social protection': ['social protection', 'social security', 'cash transfer', 'pension', 'safety net', 'welfare'],
    'Gender equality': ['gender', 'women', 'woman', 'girl', 'feminist', 'gender equality'],
    'Water & sanitation': ['water', 'sanitation', 'hygiene', 'wash'],
    'Employment & decent work': ['employment', 'job', 'decent work', 'labour', 'labor', 'worker', 'unemployment', 'livelihood'],
    'Private sector development': ['private sector', 'sme', 'msme', 'entrepreneur', 'entrepreneurship', 'startup', 'start up', 'small business', 'enterprise']
  },

  regions: {
    'Sub-Saharan Africa': ['africa', 'african', 'sub saharan', 'east africa', 'west africa', 'southern africa', 'central africa', 'sahel', 'afrique', 'kenya', 'nigeria', 'ghana', 'ethiopia', 'uganda', 'tanzania', 'rwanda', 'senegal', 'south africa', 'mozambique', 'malawi', 'zambia', 'zimbabwe', 'cameroon', 'mali', 'niger', 'burkina faso', 'cote d ivoire', 'ivory coast', 'congo', 'drc', 'somalia', 'south sudan', 'madagascar', 'sierra leone', 'liberia', 'benin', 'togo', 'botswana', 'namibia'],
    'Middle East & North Africa': ['middle east', 'north africa', 'mena', 'arab', 'egypt', 'morocco', 'tunisia', 'algeria', 'jordan', 'lebanon', 'syria', 'iraq', 'yemen', 'libya', 'palestine', 'iran'],
    'Asia & Pacific': ['asia', 'asian', 'pacific', 'south asia', 'southeast asia', 'india', 'bangladesh', 'pakistan', 'nepal', 'indonesia', 'philippines', 'vietnam', 'viet nam', 'cambodia', 'myanmar', 'afghanistan', 'sri lanka', 'china', 'thailand', 'laos', 'mongolia', 'timor leste'],
    'Latin America & Caribbean': ['latin america', 'caribbean', 'south america', 'central america', 'brazil', 'colombia', 'peru', 'mexico', 'haiti', 'ecuador', 'bolivia', 'guatemala', 'honduras', 'el salvador', 'argentina', 'chile', 'venezuela', 'paraguay', 'nicaragua'],
    'Europe & Central Asia': ['europe', 'european', 'balkans', 'central asia', 'ukraine', 'moldova', 'georgia', 'armenia', 'kazakhstan', 'uzbekistan', 'kyrgyzstan', 'tajikistan', 'turkey', 'turkiye', 'albania', 'serbia', 'kosovo', 'bosnia'],
    'Global': ['global', 'worldwide', 'multi country', 'several countries']
  },

  modalities: {
    'Loans': ['loan', 'lend', 'lending', 'lender', 'borrow', 'borrowing', 'credit', 'debt', 'prestamo', 'pret'],
    'Grants': ['grant', 'donation', 'subsidy', 'subvention', 'donor money', 'non repayable'],
    'Guarantees & equity': ['guarantee', 'equity', 'investment', 'investor', 'invest', 'shares'],
    'Co-financing': ['co financing', 'cofinancing', 'co funding', 'match funding', 'matching fund'],
    'Blended finance': ['blended finance', 'blended', 'impact investment', 'impact investing'],
    'Technical cooperation': ['technical cooperation', 'technical assistance', 'capacity building', 'expertise', 'advisory', 'advice'],
    'Calls for proposals': ['call for proposals', 'calls for proposals', 'open call', 'tender', 'proposal', 'apply'],
    'Budget support': ['budget support'],
    'Core funding': ['core funding', 'unrestricted', 'institutional funding', 'operating cost', 'overhead', 'running cost']
  },

  worksWith: {
    'NGOs & civil society': ['ngo', 'ngos', 'non profit', 'nonprofit', 'not for profit', 'civil society', 'charity', 'cso', 'association', 'ong'],
    'Community-based organisations': ['community', 'cbo', 'grassroots', 'local organisation', 'local organization'],
    'Private sector': ['company', 'business', 'corporate', 'firm', 'social enterprise'],
    'Governments': ['government', 'ministry', 'public sector', 'municipality', 'local authority'],
    'Research institutions': ['research', 'researcher', 'academic', 'think tank', 'university'],
    'UN agencies': ['un agency', 'united nations', 'unicef', 'undp', 'ilo', 'unhcr', 'wfp']
  },

  priorities: {
    'Youth employment': ['youth', 'young people', 'young person'],
    'Climate adaptation': ['adaptation', 'resilience', 'drought', 'flood'],
    'Climate mitigation': ['mitigation', 'emission', 'carbon', 'net zero'],
    'Green transition': ['green transition', 'green economy', 'circular economy', 'green jobs'],
    'Digital transformation': ['digital', 'technology', 'tech', 'ict', 'internet', 'software', 'mobile app'],
    "Women's economic empowerment": ['women entrepreneur', 'women empowerment', 'economic empowerment', 'empower women'],
    'Smallholder farmers': ['smallholder', 'small farmer', 'small scale farmer'],
    'Fragile & conflict-affected settings': ['fragile', 'conflict', 'war', 'refugee', 'displaced', 'humanitarian', 'crisis', 'post conflict'],
    'Global health': ['global health', 'hiv', 'aids', 'malaria', 'pandemic', 'epidemic', 'vaccine'],
    'Financial inclusion': ['financial inclusion', 'microfinance', 'microcredit', 'banking', 'unbanked', 'mobile money'],
    'Democracy & human rights': ['democracy', 'human rights', 'freedom'],
    'Rule of law': ['rule of law', 'justice', 'court', 'legal']
  },

  type: {
    'Development bank': ['development bank', 'bank'],
    'Private foundation': ['foundation', 'philanthropy', 'philanthropic', 'philanthropist'],
    'Bilateral agency': ['bilateral', 'embassy', 'government agency'],
    'Multilateral organisation': ['multilateral'],
    'Global fund': ['global fund']
  }
};

/* ---------- matching (no need to edit below) ---------- */

/* lower case, no accents, punctuation → spaces, padded with spaces so " word " finds whole words */
DPE.normText = s => ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

/* Does the (already normalised) text contain this word or phrase, singular or plural? */
DPE.hasTerm = (normalisedText, term) => {
  const t = DPE.normText(term).trim();
  if (!t) return false;
  const forms = [t, t + 's', t + 'es'];
  if (t.endsWith('y')) forms.push(t.slice(0, -1) + 'ies');
  return forms.some(f => normalisedText.includes(' ' + f + ' '));
};

/* Find keywords in free text.
   dataValues: { field: [values that exist in the data] } so countries and new labels are found too.
   Returns [{ key, field, value, words: [words found in the text] }] */
DPE.detectKeywords = (text, dataValues = {}) => {
  const T = DPE.normText(text);
  const found = new Map();
  const add = (field, value, word) => {
    const key = field + '|' + value;
    if (!found.has(key)) found.set(key, { key, field, value, words: [] });
    const f = found.get(key);
    if (!f.words.includes(word)) f.words.push(word);
  };
  if (!T.trim()) return [];
  for (const [field, map] of Object.entries(DPE.KEYWORDS))
    for (const [value, words] of Object.entries(map))
      for (const w of [value, ...words]) if (DPE.hasTerm(T, w)) add(field, value, w);
  for (const [field, values] of Object.entries(dataValues))
    for (const v of values) if (typeof v === 'string' && v.length > 2 && DPE.hasTerm(T, v)) add(field, v, v);
  return [...found.values()];
};
