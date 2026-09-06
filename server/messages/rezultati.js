const { getI18nUiString, fillTemplate } = require('../config');

function parseRezPairs(pairsStr) {
  const pairRe = /(\d+)\s*\.\s*(\d+)/g;
  const results = [];
  let match;
  while ((match = pairRe.exec(pairsStr)) !== null) {
    results.push({ id: match[1], votes: parseInt(match[2], 10) });
  }
  return results;
}

function buildRezultatiAcceptedReply(updatedIds, options = {}) {
  const prependRecipientName = Boolean(options.prependRecipientName);
  const recipientName = String(options.recipientName || '').trim();
  const template = getI18nUiString('sr', 'signalRezultatiAcceptedReply', 'Резултати гласања су прихваћени за кандидате са листе: {candidates}.');
  const baseMessage = fillTemplate(template, { candidates: updatedIds.join(', ') });
  return prependRecipientName && recipientName ? `${recipientName}, ${baseMessage}` : baseMessage;
}

module.exports = {
  type: 'rezultati',
  parseRezPairs,
  buildRezultatiAcceptedReply
};
