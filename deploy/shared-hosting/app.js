// Startup file for cPanel "Setup Node.js App" (CloudLinux with LiteSpeed or Passenger).
// Settings come from .env next to this file (chmod 600), not from the cPanel screen,
// so secrets stay out of the control panel. Then the standalone Next.js server starts.
// The Node.js app selector loads the startup file as CommonJS, like the server.js it starts.
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");
const path = require("node:path");

process.loadEnvFile(path.join(__dirname, ".env"));

// The web server keeps only what the app writes to stderr (stderr.log next to this file): send the app's log there too.
process.stdout.write = process.stderr.write.bind(process.stderr);

// The web server hands the app a socket instead of a TCP port, so Next.js cannot know its own address
// and assumes http://127.0.0.1:3000. It uses that address to fetch the page a form redirects to, which
// then fails. Once the server listens, point that address at the public one (APP_URL) instead.
const publicOrigin = new URL(process.env.APP_URL).origin;
const setOrigin = () => {
  process.env.__NEXT_PRIVATE_ORIGIN = publicOrigin;
};
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  const i = args.findLastIndex((a) => typeof a === "function");
  if (i >= 0) {
    const done = args[i];
    // Next.js sets the address inside its own listen callback: set ours right after it.
    args[i] = function (...callbackArgs) {
      const result = done.apply(this, callbackArgs);
      setOrigin();
      Promise.resolve(result).finally(setOrigin);
      return result;
    };
  }
  this.once("listening", () => setImmediate(setOrigin));
  return listen.apply(this, args);
};

require("./server.js");
