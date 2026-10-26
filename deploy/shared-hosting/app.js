// Startup file for cPanel "Setup Node.js App" (CloudLinux with LiteSpeed or Passenger).
// Settings come from .env next to this file (chmod 600), not from the cPanel screen,
// so secrets stay out of the control panel. Then the standalone Next.js server starts.
// The Node.js app selector loads the startup file as CommonJS, like the server.js it starts.
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

process.loadEnvFile(path.join(__dirname, ".env"));
require("./server.js");
