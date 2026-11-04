/**
 * A batch review file holds either accepted submissions (each with the issue to
 * reply to) or discovered candidates that have no issue yet. The two can be
 * mixed: an entry without an issue number is a candidate that is not in
 * data/sources.json, so it is only checked against the index and never replied to.
 */
export function normalizeEntries(review, listed = new Map()) {
  if (review?.schema !== 1 || !Array.isArray(review.entries) || !review.entries.length) {
    throw new Error('Review must contain schema 1 and a nonempty entries list');
  }
  const seen = new Set();
  return review.entries.map(raw => {
    const name = raw?.name;
    if (typeof name !== 'string' || !name) throw new Error('Every entry needs a package name');
    if (seen.has(name)) throw new Error('Duplicate entry: ' + name);
    seen.add(name);
    const issue = raw.issue ?? null;
    if (issue !== null && (!Number.isSafeInteger(issue) || issue < 1)) throw new Error('Issue numbers must be positive integers: ' + name);
    const reply = raw.reply ?? '';
    if (typeof reply !== 'string') throw new Error('Reply drafts must be text: ' + name);
    if (issue !== null && !reply.trim()) throw new Error('A submission with an issue number needs a reply draft: ' + name);
    if (issue === null && reply.trim()) throw new Error('A discovered candidate has no issue to reply to: ' + name);
    const entry = listed.get(name);
    return {
      issue, name, reply,
      replyLanguage: raw.replyLanguage,
      postedComment: raw.postedComment,
      issueState: raw.issueState,
      discovery: !entry,
      packageEntry: entry ?? { name },
    };
  });
}
