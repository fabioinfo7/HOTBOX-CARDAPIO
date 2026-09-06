// Configuração independente do Lovable — usa o plugin oficial do TanStack Start
// + nitro para gerar um servidor Node.js padrão, hospedável em qualquer lugar
// (Railway, Docker, VPS, etc). Substituiu @lovable.dev/vite-tanstack-config.
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
  },
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          output: {
            manualChunks: () => "server",
          },
        },
      },
    },
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // Redireciona o entry de servidor do TanStack Start para src/server.ts
      // (nosso wrapper de erro SSR) — igual configuração original.
      server: { entry: "server" },
    }),
    nitro(),
    viteReact(),
  ],
});
