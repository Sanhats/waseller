/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /** Permitir imágenes de Supabase Storage. Agregá acá tu propio dominio si servís imágenes desde otro lado. */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
};

module.exports = nextConfig;
