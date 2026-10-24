import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
const localProxy: ProxyOptions = {
  target: 'http://127.0.0.1:3000',
  changeOrigin: true,
  configure(proxy) {
    // The runtime proxy is an EventEmitter; keep a narrow local event contract
    // rather than adding a second proxy/type dependency to this small project.
    const events = proxy as unknown as {
      on(
        event: 'proxyReq',
        handler: (
          outgoing: { setHeader(name: string, value: string): void },
          incoming: { headers: { host?: string; origin?: string } },
        ) => void,
      ): void;
    };
    events.on('proxyReq', (outgoing, incoming) => {
      const host = incoming.headers.host;
      if (
        (host === '127.0.0.1:5173' || host === 'localhost:5173') &&
        incoming.headers.origin === `http://${host}`
      )
        outgoing.setHeader('Origin', 'http://127.0.0.1:3000');
    });
  },
};
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    rollupOptions: {
      output: {
        manualChunks: {
          mindmap: ['mind-elixir'],
          editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-image'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': localProxy, '/assets': localProxy },
  },
});
