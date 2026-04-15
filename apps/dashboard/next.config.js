/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@waseller/shared", "@waseller/api-core"],
  serverExternalPackages: [
    "@prisma/client",
    "@waseller/db",
    "bullmq",
    "ioredis",
    "@nestjs/common"
  ]
};

module.exports = nextConfig;
