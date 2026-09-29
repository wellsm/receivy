const { APP_STAGE = 'dev' } = process.env;

/**
 * Deploys the built SPA (./dist) to S3 + CloudFront. Same stage naming and remote state as the API.
 * `tsconfigFile` carries the `@stage` alias of the stage, so `distribution.ts` reads that stage's API origin.
 *
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: APP_STAGE,
  projectName: 'receivy-web',
  tsconfigFile: `tsconfig.deploy.${APP_STAGE}.json`,
  sourceFiles: ['./src/deploy/distribution.ts'],
  stateFile: {
    path: `${APP_STAGE}-deploy`,
    remote: true
  },
  tags: {
    Project: 'Receivy',
    Stage: APP_STAGE
  }
};
