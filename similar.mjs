// F75: helps agents see at a glance which requests talk about the same problem.
// This is a LEXICAL match (the same significant words, accents and plurals ignored), not a semantic one: two requests worded with entirely different words
// ("lampadaire éteint" / "plus de lumière dans la rue") are not linked. Nothing is merged or hidden: an agent still sees and answers every request.
const stop = new Set(`les des une aux dans pour avec sans sur sous chez par est sont etait etre ete avoir ont avait fait faire plus pas que qui quoi dont mais car donc entre vers
  depuis cette cet ces mon mes ton tes son ses nos vos leur leurs nous vous ils elles ici tout tous toute toutes tres bien aussi comme encore deja puis alors peut peuvent
  bonjour merci svp voudrais veux besoin habitant ville cite demande message signale signaler probleme rue
  the and for with without from into this that these those are was were been have has had not but they them their our your you its there here very also just can will would
  please thanks hello`.split(/\s+/));

const strip = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '');
// "lampadaires" and "lampadaire" are one word; very short words and bare numbers of one digit carry nothing
const stem = (word) => (word.length > 4 && /[sx]$/.test(word) ? word.slice(0, -1) : word);

const cache = new Map(); // message id -> { words: Set<stem>, shown: Map<stem, word> }; the text of a request never changes
function wordsOf(item) {
  const hit = cache.get(item.id);
  if (hit && hit.length === item.subject.length + item.body.length) return hit.value;
  const words = new Set();
  const shown = new Map();
  for (const text of [item.subject, item.location || '', item.body]) {
    for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const plain = strip(raw);
      if (plain.length < 3 || stop.has(plain)) continue;
      const key = stem(plain);
      if (stop.has(key)) continue;
      words.add(key);
      if (!shown.has(key)) shown.set(key, raw);
    }
  }
  const value = { words, shown };
  if (cache.size > 20_000) cache.clear();
  cache.set(item.id, { length: item.subject.length + item.body.length, value });
  return value;
}

const MAX_ITEMS = 3000; // the most recent requests; older ones are left out of the comparison so one poll stays cheap

/** items: [{ id, user_id, subject, body, location, topic, status }] -> { groups, of } (groups of two or more only) */
export function groupSimilar(items) {
  const recent = [...items].sort((a, b) => b.id - a.id).slice(0, MAX_ITEMS);
  const info = new Map(recent.map((item) => [item.id, wordsOf(item)]));
  // words found in a large share of all requests describe the platform, not a problem
  const frequency = new Map();
  for (const { words } of info.values()) for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1);
  const tooCommon = Math.max(8, Math.floor(recent.length * 0.2));
  // Requests are taken oldest first. A request joins a group only when it resembles at least half of that group's members, never through a single chance
  // link: one loose resemblance must not chain unrelated requests together. Without a match it starts a group of its own.
  const members = new Map(); // group id -> items
  const groupOfItem = new Map();
  const ascending = [...recent].sort((a2, b2) => a2.id - b2.id);
  const index = new Map();
  for (const item of ascending) {
    const mine = info.get(item.id).words;
    const shared = new Map();
    for (const word of mine) for (const other of index.get(word) || []) shared.set(other, (shared.get(other) || 0) + 1);
    const linked = new Map(); // group id -> { count, score }
    for (const [other, count] of shared) {
      const cosine = count / Math.sqrt(mine.size * info.get(other).words.size);
      if (!((count >= 2 && cosine >= 0.5) || (count >= 3 && cosine >= 0.35))) continue;
      const group = groupOfItem.get(other);
      const entry = linked.get(group) || { count: 0, score: 0 };
      entry.count += 1;
      entry.score += cosine;
      linked.set(group, entry);
    }
    let best = null;
    for (const [group, { count, score }] of linked) {
      if (count < Math.ceil(members.get(group).length / 2)) continue;
      if (!best || count / members.get(group).length > best.share || (count / members.get(group).length === best.share && score > best.score)) best = { group, share: count / members.get(group).length, score };
    }
    const group = best ? best.group : item.id;
    if (!members.has(group)) members.set(group, []);
    members.get(group).push(item);
    groupOfItem.set(item.id, group);
    for (const word of mine) {
      if (frequency.get(word) > tooCommon) continue;
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(item.id);
    }
  }
  const groups = [];
  const of = new Map();
  for (const list of members.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.id - b.id);
    const id = list[0].id;
    const counts = new Map();
    for (const item of list) for (const word of info.get(item.id).words) counts.set(word, (counts.get(word) || 0) + 1);
    const common = [...counts].filter(([word, n]) => n >= Math.ceil(list.length * 0.6) && frequency.get(word) <= tooCommon).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
      .map(([word]) => info.get(list[0].id).shown.get(word) || [...info.values()].find((entry) => entry.shown.has(word)).shown.get(word));
    const topicCounts = new Map();
    for (const item of list) if (item.topic) topicCounts.set(item.topic, (topicCounts.get(item.topic) || 0) + 1);
    const topic = [...topicCounts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    groups.push({
      id, ids: list.map((item) => item.id), size: list.length, open: list.filter((item) => item.status !== 'resolved').length,
      residents: new Set(list.map((item) => item.user_id)).size, topic, subject: list[0].subject, shared: common,
    });
    for (const item of list) of.set(item.id, id);
  }
  groups.sort((a, b) => b.open - a.open || b.size - a.size || a.id - b.id);
  return { groups, of };
}
