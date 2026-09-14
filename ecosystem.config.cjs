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
      // 'src' is excluded for the same reason: pm2 restarting the whole
      // node/Vite process on every component edit (on top of Vite's own
      // HMR) was killing the dev server's live connection mid-edit, forcing
      // a full page reload and occasionally racing a save mid-write —
      // pm2 still restarts for anything outside src/server (vite.config.ts,
      // package.json, index.html, etc.), which genuinely need a fresh process.
      ignore_watch: ['node_modules', 'server', 'src', '.git'],
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

