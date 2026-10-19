import type { NextConfig } from "next";

// cacheComponents는 끈다: 로그인 세션(쿠키)을 읽는 화면이 대부분이라 요청 시점 렌더링이 기본이 되는 편이 단순하다.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
