import { defineConfig } from 'vitest/config';

// Tests that format local times expect UTC, wherever they run.
process.env.TZ = 'UTC';

export default defineConfig({});
