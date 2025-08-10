import dotenv from 'dotenv';

const envFile = process.env.ENV_PATH || '.env';

console.log(`Loading env from: ${envFile}`);

const result = dotenv.config({ path: envFile });
if (result.error) {
  console.error('Error loading env file:', result.error);
}

import Grid from './src/Grid/Grid.js';

(async () => {
  console.log("🤖 Starting Grid Trading Bot...");
  console.log("Loaded GRID_MARKET:", process.env.GRID_MARKET);
  try {
    await Grid.run();
    console.log("✅ Grid Bot started successfully.");
  } catch (error) {
    console.error("❌ Grid Bot error:", error);
  }
})();
