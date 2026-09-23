const fs = require('node:fs');
const marker = '/tmp/video-processing/worker-health';
const age = Date.now() - fs.statSync(marker).mtimeMs;
if (age > 30000) process.exit(1);
