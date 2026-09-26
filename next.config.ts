import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Case JSON is read from disk at request time by API routes; make sure the
  // files ship with the serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./cases/**/*.json"],
  },
};

export default nextConfig;
