export const evaluateInstallLifecycleReport = (report) => {
  const observedScripts = report.installScriptsObserved;
  const approvedBuildScripts = report.exactPinVerification?.policies?.approvedBuildScripts;
  const installedPackageCount = report.installedPackageCount;
  const sharedCacheMode =
    Array.isArray(observedScripts) &&
    observedScripts.length === 0 &&
    report.cacheReuse?.sharedCacheRetained === true &&
    report.cacheReuse?.packagesReused === installedPackageCount &&
    report.cacheReuse?.packagesDownloaded === 0;
  const approvedExecutionMode =
    Array.isArray(observedScripts) &&
    observedScripts.length === 1 &&
    /^esbuild postinstall\$ node install[.]js$/.test(observedScripts[0]);
  const checks = {
    repositoryOwnedGenerator: report.generator === "tooling/ci/run-clean-frozen-install.mjs",
    exactPinsPassed: report.exactPinVerification?.result === "PASS",
    approvedBuildPolicyExact:
      Array.isArray(approvedBuildScripts) &&
      approvedBuildScripts.length === 1 &&
      approvedBuildScripts[0] === "esbuild",
    ignoredBuildsAbsent: report.ignoredBuilds?.none === true,
    lifecycleModeAccepted: sharedCacheMode || approvedExecutionMode,
  };
  return {
    schemaVersion: 1,
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    mode: sharedCacheMode
      ? "COMPLETE_SHARED_CACHE_REUSE"
      : approvedExecutionMode
        ? "APPROVED_ESBUILD_EXECUTION"
        : "REJECTED",
    checks,
  };
};

export const lifecyclePolicyRegressionCases = () => {
  const acceptedBase = {
    generator: "tooling/ci/run-clean-frozen-install.mjs",
    installedPackageCount: 561,
    ignoredBuilds: { none: true },
    exactPinVerification: {
      result: "PASS",
      policies: { approvedBuildScripts: ["esbuild"] },
    },
  };
  return [
    {
      name: "complete-cache-reuse-with-no-lifecycle-output",
      expected: "PASS",
      report: {
        ...acceptedBase,
        installScriptsObserved: [],
        cacheReuse: {
          sharedCacheRetained: true,
          packagesReused: 561,
          packagesDownloaded: 0,
        },
      },
    },
    {
      name: "approved-esbuild-execution",
      expected: "PASS",
      report: {
        ...acceptedBase,
        installScriptsObserved: ["esbuild postinstall$ node install.js"],
        cacheReuse: {
          sharedCacheRetained: true,
          packagesReused: 560,
          packagesDownloaded: 1,
        },
      },
    },
    {
      name: "empty-output-without-complete-cache-proof",
      expected: "FAIL",
      report: { ...acceptedBase, installScriptsObserved: [] },
    },
    {
      name: "unapproved-lifecycle-execution",
      expected: "FAIL",
      report: {
        ...acceptedBase,
        installScriptsObserved: ["synthetic-lifecycle-probe postinstall$ node install.mjs"],
      },
    },
    {
      name: "ignored-build-present",
      expected: "FAIL",
      report: {
        ...acceptedBase,
        ignoredBuilds: { none: false },
        installScriptsObserved: [],
        cacheReuse: {
          sharedCacheRetained: true,
          packagesReused: 561,
          packagesDownloaded: 0,
        },
      },
    },
    {
      name: "broadened-build-permission",
      expected: "FAIL",
      report: {
        ...acceptedBase,
        exactPinVerification: {
          result: "PASS",
          policies: { approvedBuildScripts: ["esbuild", "synthetic-lifecycle-probe"] },
        },
        installScriptsObserved: ["esbuild postinstall$ node install.js"],
      },
    },
  ];
};
