import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

// https://vite.dev/config/
/**
 * A short marker for the build, shown in the app's footer.
 *
 * Worth the trouble because "the website makes no sound" and "the website is
 * serving a cached copy of an older build" look exactly the same from the
 * outside, and the only way to tell them apart remotely is to be able to ask
 * which build is on screen.
 */
function buildId(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react()],
})
