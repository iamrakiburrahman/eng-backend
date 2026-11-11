module.exports = {
  apps: [
    {
      name: 'eng-backend',
      script: 'dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      error_file: 'logs/pm2-err.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
      node_args: '--max-old-space-size=1024',
    },
  ],
};
