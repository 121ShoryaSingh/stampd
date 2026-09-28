import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded at runtime so its optional GCS/Azure SDK requires are not bundled.
  serverExternalPackages: ["@khair/storage-adapter"],
};

export default nextConfig;
