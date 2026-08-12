import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN access in `next dev` (e.g. phone/PC via 192.168.x.x)
  allowedDevOrigins: ["192.168.0.105"],
};

export default nextConfig;
