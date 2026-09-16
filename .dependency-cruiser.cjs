/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sim-purity',
      comment: 'packages/sim must have zero workspace dependencies',
      severity: 'error',
      from: {
        path: '^packages/sim',
      },
      to: {
        path: '^packages/(?!sim)',
      },
    },
    {
      name: 'sim-cannot-import-apps',
      comment: 'packages/sim must not import from apps',
      severity: 'error',
      from: {
        path: '^packages/sim',
      },
      to: {
        path: '^apps',
      },
    },
    {
      name: 'domain-cannot-import-apps',
      comment: 'packages/domain must not import from apps',
      severity: 'error',
      from: {
        path: '^packages/domain',
      },
      to: {
        path: '^apps',
      },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies are forbidden',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
  },
};
