import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bydbweyercozwdxcbase.supabase.co';
  // Edge Functions in this project are public. A non-empty fallback keeps the
  // Supabase client from crashing before those public endpoints can be used.
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || 'public-edge-functions-only';

  return {
    base: env.BASE_PATH || '/',
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
      },
    },
    server: {
      host: true,
      strictPort: false,
    },
  };
});
