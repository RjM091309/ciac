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
  ],
};

