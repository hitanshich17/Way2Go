/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode causes every effect to run twice in dev — turning off
  // speeds up the dev experience without affecting production behaviour
  reactStrictMode: false,

  // Tell Next.js to compile this ESM package through SWC instead of
  // treating it as pre-built, which avoids slow Babel fallback paths
  transpilePackages: ['@react-google-maps/api'],

  // Tree-shake heavy packages so only the imports you use get bundled
  experimental: {
    optimizePackageImports: ['@react-google-maps/api'],
  },
}

module.exports = nextConfig
