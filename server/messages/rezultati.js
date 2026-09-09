const { getI18nUiString, fillTemplate } = require('../config');

function parseRezPairs(pairsStr) {
  const tokens = String(pairsStr || '').trim().split(/\s+/).filter(Boolean);
  const results = [];
  const keyRe = /^(\d+|[NnНнPpПп])\s*\.\s*(\d+)$/u;
  const aliases = { n: 'N', н: 'N', p: 'P', п: 'P' };

  for (const token of tokens) {
    const match = keyRe.exec(token);
    if (!match) return [];
    const key = /^\d+$/.test(match[1])
      ? match[1]
      : aliases[match[1].toLowerCase()] || match[1].toUpperCase();
    results.push({ id: key, votes: parseInt(match[2], 10) });
  }

  return results;
}

function buildResultLines(result) {
  return (Array.isArray(result && result.candidateVotes) ? result.candidateVotes : [])
    .filter((candidate) => Number(candidate.votes || 0) !== 0)
    .map((candidate) => `${candidate.id}.${candidate.votes}`)
    .join('\n');
}

function buildRezultatiReply(result, templateKey, fallback, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const template = getI18nUiString('sr', templateKey, fallback);
  const baseMessage = fillTemplate(template, {
    candidates: buildResultLines(result),
    nonRegularBallots: Number(result && result.nonRegularBallots || 0),
    remainingBallots: Number(result && result.remainingBallots || 0)
  });
  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

function buildRezultatiQueryReply(result, options = {}) {
  return buildRezultatiReply(
    result,
    'signalRezultatiQueryReply',
    'Тренутно регистрован број гласова:\n{candidates}\nНеважећи листићи: {nonRegularBallots}\nПреостали листићи: {remainingBallots}',
    options
  );
}

function buildRezultatiAcceptedReply(result, options = {}) {
  return buildRezultatiReply(
    result,
    'signalRezultatiAcceptedReply',
    'Резултати гласања су успешно ажурирани:\n{candidates}\nНеважећи листићи: {nonRegularBallots}\nПреостали листићи: {remainingBallots}',
    options
  );
}

module.exports = {
  type: 'rezultati',
  parseRezPairs,
  buildRezultatiQueryReply,
  buildRezultatiAcceptedReply
};
