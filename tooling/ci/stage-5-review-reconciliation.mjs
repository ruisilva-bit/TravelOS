export const reconcileReviewAdjudication = (findingIds, adjudication) => {
  const canonicalIds = [...new Set(findingIds)].toSorted();
  const categories = {
    evidenceSupportedCorrection: [...(adjudication.evidenceSupportedCorrection ?? [])],
    open: [...(adjudication.open ?? [])],
    unverified: [...(adjudication.unverified ?? [])],
  };
  for (const [name, ids] of Object.entries(categories)) {
    if (new Set(ids).size !== ids.length) throw new Error(`${name} contains duplicate finding IDs`);
    const unknown = ids.filter((id) => !canonicalIds.includes(id));
    if (unknown.length > 0)
      throw new Error(`${name} contains unknown IDs: ${unknown.toSorted().join(", ")}`);
  }
  const evidenceSupported = new Set(categories.evidenceSupportedCorrection);
  const open = new Set(categories.open);
  const rawUnverified = categories.unverified;
  const overlapWithHigherPriority = rawUnverified.filter(
    (id) => evidenceSupported.has(id) || open.has(id),
  );
  const unverified = [...new Set(rawUnverified)].filter(
    (id) => !evidenceSupported.has(id) && !open.has(id),
  );
  const classified = new Set([...evidenceSupported, ...open, ...unverified]);
  const unclassified = canonicalIds.filter((id) => !classified.has(id));
  if (unclassified.length > 0)
    throw new Error(`findings remain unclassified: ${unclassified.join(", ")}`);
  const multiplyClassified = canonicalIds.filter(
    (id) =>
      Number(evidenceSupported.has(id)) + Number(open.has(id)) + Number(unverified.includes(id)) >
      1,
  );
  if (multiplyClassified.length > 0) {
    throw new Error(
      `findings appear in multiple normalized classes: ${multiplyClassified.join(", ")}`,
    );
  }
  return {
    uniqueFindingCount: canonicalIds.length,
    evidenceSupportedCorrection: [...evidenceSupported].toSorted(),
    open: [...open].toSorted(),
    unverified,
    sourceReportedCounts: {
      evidenceSupportedCorrection:
        adjudication.reportedSummaryCounts?.evidenceSupportedCorrection ?? null,
      open: adjudication.reportedSummaryCounts?.open ?? null,
      unverified: adjudication.reportedSummaryCounts?.unverified ?? null,
    },
    sourceListedCounts: {
      evidenceSupportedCorrection: categories.evidenceSupportedCorrection.length,
      open: categories.open.length,
      unverified: categories.unverified.length,
    },
    sourceOverlapIds: [...new Set(overlapWithHigherPriority)].toSorted(),
    normalizedCounts: {
      evidenceSupportedCorrection: evidenceSupported.size,
      open: open.size,
      unverified: unverified.length,
    },
    normalizedCategoriesAreDisjoint: true,
    allFindingsClassified: classified.size === canonicalIds.length,
  };
};
