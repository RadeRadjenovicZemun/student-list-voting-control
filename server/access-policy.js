function isMediaRole(role) {
  return role === 'media';
}

function canAccessVotingRecords(role) {
  return !isMediaRole(role);
}

function canApproveIrregularities(remoteAccess, role) {
  return !remoteAccess || role === 'lawyer';
}

function projectMediaIrregularities(records) {
  const counts = { all: records.length, region: {}, municipality: {}, place: {} };
  for (const record of records) {
    for (const dimension of ['region', 'municipality', 'place']) {
      const key = String(record[dimension] || '');
      if (key) counts[dimension][key] = (counts[dimension][key] || 0) + 1;
    }
  }
  return {
    records: records.filter((record) => record.approved === true),
    counts
  };
}

module.exports = {
  canAccessVotingRecords,
  canApproveIrregularities,
  isMediaRole,
  projectMediaIrregularities
};
