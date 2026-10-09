export const compareArtifactPathSets = (expectedPaths, actualPaths) => {
  const expected = [...expectedPaths].toSorted();
  const actual = [...actualPaths].toSorted();
  const expectedCounts = new Map();
  const actualCounts = new Map();
  for (const value of expected) expectedCounts.set(value, (expectedCounts.get(value) ?? 0) + 1);
  for (const value of actual) actualCounts.set(value, (actualCounts.get(value) ?? 0) + 1);
  const missing = [...expectedCounts]
    .filter(([value]) => !actualCounts.has(value))
    .map(([value]) => value)
    .toSorted();
  const unexpected = [...actualCounts]
    .filter(([value]) => !expectedCounts.has(value))
    .map(([value]) => value)
    .toSorted();
  const duplicates = [...actualCounts]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ path: value, count }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const expectedDuplicates = [...expectedCounts]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ path: value, count }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const expectedSet = [...expectedCounts.keys()].toSorted();
  const actualSet = [...actualCounts.keys()].toSorted();
  const sameUniquePaths =
    expectedSet.length === actualSet.length &&
    expectedSet.every((value, index) => value === actualSet[index]);
  return {
    result:
      sameUniquePaths && duplicates.length === 0 && expectedDuplicates.length === 0
        ? "PASS"
        : "FAIL",
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    unexpected,
    duplicates,
    expectedDuplicates,
    sameUniquePaths,
  };
};

export const assertExactArtifactPathSet = (expectedPaths, actualPaths, label) => {
  const comparison = compareArtifactPathSets(expectedPaths, actualPaths);
  if (comparison.result !== "PASS") {
    throw new Error(`${label} path-set mismatch: ${JSON.stringify(comparison)}`);
  }
  return comparison;
};
