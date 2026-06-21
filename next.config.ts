import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.54", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  images: {
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/**", search: "?v=20260621-2" },
    ],
    remotePatterns: [
      { protocol: "https", hostname: "flagcdn.com" },
      { protocol: "https", hostname: "media.api-sports.io" },
      { protocol: "https", hostname: "www.thesportsdb.com" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
    ],
  },
};

export default nextConfig;
