module.exports = {
  apps: [
    {
      name: 'ciac-dev',
      cwd: __dirname,
      script: 'npm',
      args: 'run dev',
      watch: true,
      // cwd is the monorepo root, so this watch also covers server/ —
      // including server/uploads, where every locator document upload lands.
      // Without excluding it, uploading a file restarted the Vite dev server
      // process too, and its HMR client full-page-reloads the browser on
      // reconnect — the "browser refreshes after upload" bug. The frontend
      // has no reason to react to backend file changes at all; Vite's own
      // watcher already handles src/ hot-reload without this outer restart.
      ignore_watch: ['node_modules', 'server', '.git'],
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

