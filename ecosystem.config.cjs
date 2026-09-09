module.exports = {
  apps: [
    {
      name: 'ciac-dev',
      cwd: __dirname,
      script: 'npm',
      args: 'run dev',
      watch: true,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'ciac-backend-dev',
      cwd: `${__dirname}/server`,
      script: 'npm',
      args: 'run dev',
      watch: true,
      // Uploaded documents land under server/uploads — without this, every
      // file a user uploads is itself a watched change and restarts the
      // process mid-request.
      ignore_watch: ['node_modules', 'uploads'],
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};

